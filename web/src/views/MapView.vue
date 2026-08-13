// 宏观视图（大地图）：宇宙视图（学科星系）⇄ 星座视图（学科内 LOD 三档）
// 交互（电子地图逻辑）：拖拽平移、滚轮/双指缩放；
//   宇宙视图单击星系 → 平滑进入星座视图；星座视图双击空白 / 缩小过阈值 → 退回宇宙视图
//   节点档单击节点 → 详情页；双击节点 → 在中心视图打开；星团档单击星团 → 向该处放大
// 数据：每次进入本页重新拉取 graph/all（含登录用户 state），保证闯关返回后亮度更新
<template>
  <div class="map-page2">
    <div ref="wrap" class="starmap-wrap">
      <canvas
        ref="cv"
        class="starmap-canvas"
        :class="{ grabbing: isPanning, pointer: hoverKind !== null }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @pointerleave="onPointerLeave"
        @dblclick="onDblClick"
        @wheel.prevent="onWheel"
      />
      <div v-if="tip.show" class="starmap-tip" :style="{ left: tip.x + 'px', top: tip.y + 'px' }">
        <b>{{ tip.title }}</b>
        <span>{{ tip.sub }}</span>
      </div>
    </div>

    <!-- 顶部工具条：面包屑 + 返回 + 学科切换 + 图例 -->
    <div class="macro-toolbar panel">
      <button class="crumb" :disabled="mode === 'universe'" @click="exitToUniverse()">🌌 宇宙</button>
      <template v-if="mode === 'constellation'">
        <span class="crumb-sep">/</span>
        <span class="crumb-current">{{ currentSubject }}</span>
      </template>
      <span class="toolbar-spacer" />
      <button v-if="mode === 'constellation'" class="tool-btn" @click="exitToUniverse()">返回宇宙视图</button>
      <select
        class="tool-btn subject-select"
        :value="mode === 'constellation' ? currentSubject : ''"
        @change="(e) => enterGalaxy(e.target.value)"
      >
        <option value="" disabled>切换学科</option>
        <option v-for="g in galaxies" :key="g.subject" :value="g.subject">
          {{ g.subject }}（{{ g.count }}）
        </option>
      </select>
      <button class="tool-btn" @click="showLegend = !showLegend">图例</button>
      <button class="tool-btn" title="返回中心视图" @click="$router.push('/')">✕</button>
    </div>

    <!-- 图例（折叠） -->
    <div v-if="showLegend" class="panel macro-legend">
      <div class="legend-row"><i class="dot dim" />暗淡 · <i class="dot open" />开放 · <i class="dot passed" />通关 · <i class="dot lit" />点亮</div>
      <div class="legend-row"><i class="ring green" />验证通过　<i class="ring yellow" />存在争议</div>
      <div class="legend-row"><i class="line" style="background: #6ea8ff" />主干路径（前置链）　<i class="line dashed" style="border-color: rgba(196,141,255,0.8)" />相关</div>
      <div class="legend-row">星团数字 = 聚合节点数；放大解体为离散节点</div>
    </div>

    <p v-if="loading" class="macro-status">加载星图中…</p>
    <p v-else-if="error" class="macro-status error-text">{{ error }} <button class="link-btn" @click="load">重试</button></p>
    <p v-else-if="mode === 'constellation'" class="macro-hint">
      单击星点看详情 · 双击在中心视图打开 · 双击空白返回宇宙 · 滚轮缩放切换星团/节点
    </p>
    <p v-else class="macro-hint">单击星系进入星座视图 · 拖拽平移 · 滚轮缩放</p>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client.js';
import { useStarmapStore } from '../stores/starmap.js';
import { useUiStore } from '../stores/ui.js';
import { useNavStore } from '../stores/navigation.js';
import { useFxSettings } from '../composables/useFxSettings.js';
import { MacroRenderer, LOD } from '../starmap/macroRenderer.js';
import { layoutUniverse, layoutConstellation, makeSyntheticGraph } from '../starmap/macroLayout.js';

const STATE_LABEL = { dim: '暗淡', open: '开放', passed: '通关', lit: '点亮' };

const router = useRouter();
const starmap = useStarmapStore();
const ui = useUiStore();
const nav = useNavStore();
const fx = useFxSettings();

const wrap = ref(null);
const cv = ref(null);
let renderer = null;
let ro = null;

const loading = ref(true);
const error = ref('');
const mode = ref('universe');
const currentSubject = ref('');
const galaxies = ref([]); // [{ subject, count }]
const showLegend = ref(false);
const isPanning = ref(false);
const hoverKind = ref(null);
const tip = ref({ show: false, x: 0, y: 0, title: '', sub: '' });

let allNodes = [];
let allEdges = [];
let universeCam = null; // 进入星座前的宇宙相机，返回时复原
let exitScale = LOD.EXIT; // 进入星座时按 fitScale 收紧
let anim = null; // 相机动画 rAF
let twinkleRaf = null; // 宇宙视图呼吸闪烁循环（低功耗：仅宇宙模式、页面可见、非 reduced-motion）

// ---- 宇宙视图呼吸闪烁：星系星云/星光随时间明暗变化（静止也有生命力）----
function startTwinkle() {
  stopTwinkle();
  if (fx.reducedMotion.value) return; // 尊重减弱动效
  const loop = () => {
    twinkleRaf = null;
    if (document.hidden || mode.value !== 'universe') return; // 页面隐藏/离开宇宙视图即停
    renderer.render();
    twinkleRaf = requestAnimationFrame(loop);
  };
  twinkleRaf = requestAnimationFrame(loop);
}

function stopTwinkle() {
  if (twinkleRaf) cancelAnimationFrame(twinkleRaf);
  twinkleRaf = null;
}

function onVisibility() {
  if (document.hidden) stopTwinkle();
  else if (mode.value === 'universe') startTwinkle();
}

// ---- 数据 ----
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const { nodes, edges } = await api.graphAll();
    allNodes = nodes;
    allEdges = edges;
    buildUniverse();
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

function buildUniverse() {
  const bySubject = new Map();
  for (const n of allNodes) {
    const s = n.subject ?? '未分类';
    bySubject.set(s, (bySubject.get(s) ?? 0) + 1);
  }
  const subjects = [...bySubject].map(([subject, count]) => ({ subject, count }));
  const anchors = layoutUniverse(subjects);
  galaxies.value = subjects.map((s) => ({ ...s, ...anchors.get(s.subject) }));
  renderer.setUniverse(galaxies.value);
  mode.value = 'universe';
  currentSubject.value = '';
  fitUniverse(false);
  applyNavOverlay();
  renderer.render();
  startTwinkle();
}

// 导航路线（金色，宇宙视图给涉及学科加外环）与热门路径（青色）叠加层
function applyNavOverlay() {
  if (!renderer) return;
  renderer.setHighlight(
    nav.active
      ? { nodes: nav.routeNodeIds, edges: nav.routeEdgePairs, subjects: nav.routeSubjects }
      : {},
  );
  renderer.setHotEdges(nav.hotActive ? nav.hotEdges : []);
}

watch(
  () => [nav.active, nav.routeIndex, nav.routes, nav.hotActive, nav.hotEdges],
  () => {
    applyNavOverlay();
    renderer?.render();
  },
  { deep: true },
);

function fitUniverse() {
  if (!galaxies.value.length) return;
  const pad = 90;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const g of galaxies.value) {
    x0 = Math.min(x0, g.x - g.r - pad);
    y0 = Math.min(y0, g.y - g.r - pad - 40 / renderer.camera.scale);
    x1 = Math.max(x1, g.x + g.r + pad);
    y1 = Math.max(y1, g.y + g.r + pad);
  }
  const w = wrap.value.clientWidth;
  const h = wrap.value.clientHeight;
  universeCam = {
    x: (x0 + x1) / 2,
    y: (y0 + y1) / 2,
    scale: Math.min(1.2, Math.max(0.05, Math.min(w / (x1 - x0), h / (y1 - y0)))),
  };
  renderer.camera.x = universeCam.x;
  renderer.camera.y = universeCam.y;
  renderer.camera.scale = universeCam.scale;
}

// ---- 宇宙 ⇄ 星座 ----
function enterGalaxy(subject, { animate = true } = {}) {
  const g = galaxies.value.find((x) => x.subject === subject);
  if (!g) return;
  const nodes = allNodes.filter((n) => (n.subject ?? '未分类') === subject);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = allEdges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const pos = layoutConstellation(nodes, edges);
  renderer.setConstellation({ nodes, edges, pos });
  mode.value = 'constellation';
  currentSubject.value = subject;
  stopTwinkle(); // 进入星座视图：内容多，暂停宇宙闪烁循环
  universeCam = universeCam ?? { ...renderer.camera };

  // 适配视野
  const pad = 120;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pos.values()) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const w = wrap.value.clientWidth;
  const h = wrap.value.clientHeight;
  const fitScale = Math.min(1.6, Math.max(0.02, Math.min(w / (x1 - x0 + pad * 2), h / (y1 - y0 + pad * 2))));
  exitScale = Math.min(LOD.EXIT, fitScale * 0.55);
  const target = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, scale: fitScale };
  if (animate) animateCamera(target);
  else Object.assign(renderer.camera, target);
  applyNavOverlay();
  renderer.render();
}

function exitToUniverse({ animate = true } = {}) {
  if (mode.value === 'universe') return;
  buildUniverse();
  const target = universeCam ?? { x: 0, y: 0, scale: 0.6 };
  if (animate) animateCamera(target);
  else Object.assign(renderer.camera, target);
  renderer.render();
}

// ---- 相机过渡动画（用户操作即打断）----
function animateCamera(target, ms = 480) {
  cancelAnim();
  const from = { ...renderer.camera };
  const t0 = performance.now();
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const step = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    const k = ease(t);
    renderer.camera.x = from.x + (target.x - from.x) * k;
    renderer.camera.y = from.y + (target.y - from.y) * k;
    renderer.camera.scale = from.scale + (target.scale - from.scale) * k;
    renderer.render();
    if (t < 1) anim = requestAnimationFrame(step);
    else anim = null;
  };
  anim = requestAnimationFrame(step);
}

function cancelAnim() {
  if (anim) cancelAnimationFrame(anim);
  anim = null;
}

// ---- 指针交互 ----
const pointers = new Map();
let downInfo = null;
let moved = false;
let pinch = null;

function onPointerDown(e) {
  cancelAnim();
  cv.value.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), scale0: renderer.camera.scale };
    moved = true;
    return;
  }
  moved = false;
  isPanning.value = false;
  downInfo = { x: e.offsetX, y: e.offsetY, time: Date.now() };
}

function onPointerMove(e) {
  const prev = pointers.get(e.pointerId);
  if (prev && pointers.size === 2 && pinch) {
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch.d0 > 0) {
      renderer.camera.scale = Math.min(4, Math.max(0.03, pinch.scale0 * (d / pinch.d0)));
      afterZoom();
    }
    return;
  }
  if (prev) {
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (downInfo && Math.hypot(e.offsetX - downInfo.x, e.offsetY - downInfo.y) > 5) {
      moved = true;
      isPanning.value = true;
    }
    if (moved) {
      renderer.camera.x -= (e.offsetX - prev.x) / renderer.camera.scale;
      renderer.camera.y -= (e.offsetY - prev.y) / renderer.camera.scale;
      renderer.render();
    }
    return;
  }
  // hover
  const hit = renderer.hitTest(e.offsetX, e.offsetY);
  renderer.hoverTarget = hit;
  hoverKind.value = hit?.type ?? null;
  updateTip(hit, e);
  renderer.render();
}

function updateTip(hit, e) {
  if (!hit) {
    tip.value.show = false;
    return;
  }
  tip.value.x = e.offsetX + 14;
  tip.value.y = e.offsetY + 10;
  tip.value.show = true;
  if (hit.type === 'galaxy') {
    const g = galaxies.value.find((x) => x.subject === hit.subject);
    tip.value.title = hit.subject;
    tip.value.sub = `${g?.count ?? 0} 节点 · 单击进入`;
  } else if (hit.type === 'cluster') {
    tip.value.title = `星团 ×${hit.count}`;
    tip.value.sub = '单击放大解体';
  } else {
    const n = renderer.data?.nodesById[hit.id];
    tip.value.title = n?.title ?? hit.id;
    tip.value.sub = `${STATE_LABEL[n?.state] ?? ''} · 单击详情 · 双击中心视图`;
  }
}

function onPointerUp(e) {
  const wasPinch = pointers.size > 1;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  isPanning.value = false;
  if (!downInfo || wasPinch) return;
  const click = !moved && Date.now() - downInfo.time < 500;
  downInfo = null;
  if (!click) return;
  const hit = renderer.hitTest(e.offsetX, e.offsetY);
  if (!hit) return;
  if (hit.type === 'galaxy') {
    enterGalaxy(hit.subject);
  } else if (hit.type === 'cluster') {
    // 单击星团：向其中心放大一档
    animateCamera({ x: hit.cx, y: hit.cy, scale: LOD.CLUSTER * 1.6 }, 320);
  } else if (hit.type === 'node') {
    router.push(`/node/${encodeURIComponent(hit.id)}`);
  }
}

function onPointerLeave() {
  tip.value.show = false;
  hoverKind.value = null;
  if (renderer) {
    renderer.hoverTarget = null;
    renderer.render();
  }
}

function onDblClick(e) {
  const hit = renderer.hitTest(e.offsetX, e.offsetY);
  if (hit?.type === 'node') {
    // 双击节点 → 在中心视图打开
    starmap.centerOn(hit.id).then(() => router.push('/')).catch((err) => ui.toast(err.message, 'error'));
  } else if (!hit && mode.value === 'constellation') {
    exitToUniverse();
  }
}

function onWheel(e) {
  cancelAnim();
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const cam = renderer.camera;
  const next = Math.min(4, Math.max(0.03, cam.scale * factor));
  const w = renderer.toWorld(e.offsetX, e.offsetY);
  cam.scale = next;
  cam.x = w.x - (e.offsetX - renderer.width / 2) / next;
  cam.y = w.y - (e.offsetY - renderer.height / 2) / next;
  afterZoom();
}

// 缩放后：重绘 + 缩小过阈值自动退回宇宙视图
function afterZoom() {
  renderer.render();
  if (mode.value === 'constellation' && renderer.camera.scale < exitScale) exitToUniverse();
}

function resize() {
  if (!wrap.value || !renderer) return;
  renderer.resize(wrap.value.clientWidth, wrap.value.clientHeight, window.devicePixelRatio || 1);
  if (mode.value === 'universe') fitUniverse();
  renderer.render();
}

// ---- 压测入口（隐藏 debug：浏览器 console 调 window.__starmapStress(2000)）----
function installStressHook() {
  window.__starmapStress = (n = 2000, { seconds = 5 } = {}) => {
    const g = makeSyntheticGraph(n, { subjectCount: 1 });
    allNodes = g.nodes;
    allEdges = g.edges;
    buildUniverse();
    enterGalaxy(g.nodes[0].subject, { animate: false });
    return new Promise((resolve) => {
      let frames = 0;
      const t0 = performance.now();
      const sweep = (now) => {
        // 在星团/过渡/节点档之间往复扫缩放，覆盖三档 LOD
        const phase = ((now - t0) / 1000 / seconds) * Math.PI * 2;
        renderer.camera.scale = 0.08 + (2.6 - 0.08) * (0.5 - 0.5 * Math.cos(phase * 3));
        renderer.camera.x = Math.sin(phase) * 400;
        renderer.camera.y = Math.cos(phase * 0.7) * 300;
        renderer.render();
        frames += 1;
        if (now - t0 < seconds * 1000) requestAnimationFrame(sweep);
        else {
          const elapsed = (now - t0) / 1000;
          const result = {
            nodes: n,
            frames,
            seconds: Number(elapsed.toFixed(2)),
            fps: Number((frames / elapsed).toFixed(1)),
            avgFrameMs: Number(((elapsed * 1000) / frames).toFixed(2)),
          };
          console.log('[starmap stress]', result);
          resolve(result);
        }
      };
      requestAnimationFrame(sweep);
    });
  };
}

onMounted(() => {
  renderer = new MacroRenderer(cv.value);
  ro = new ResizeObserver(resize);
  ro.observe(wrap.value);
  resize();
  load();
  installStressHook();
  document.addEventListener('visibilitychange', onVisibility);
});

onBeforeUnmount(() => {
  ro?.disconnect();
  cancelAnim();
  stopTwinkle();
  document.removeEventListener('visibilitychange', onVisibility);
  delete window.__starmapStress;
});
</script>

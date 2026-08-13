// 宏观视图（一体大地图）：所有学科合并为一张连续世界地图，模仿游戏大地图的连续缩放
// 交互（电子地图逻辑）：拖拽平移、滚轮/双指缩放；
//   全景：学科星系星云；放大：星团聚合 → 离散节点+主干连线（跨学科边淡化为虚线）
//   单击星系 → 平滑聚焦该学科；单击节点 → 详情页；双击节点 → 在中心视图打开
// 数据：每次进入本页重新拉取 graph/all（含登录用户 state），保证闯关返回后亮度更新
<template>
  <div class="map-page2">
    <div ref="wrap" class="starmap-wrap">
      <canvas
        ref="cv"
        class="starmap-canvas"
        :class="{ grabbing: isPanning || rotating, pointer: hoverKind !== null }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @pointerleave="onPointerLeave"
        @dblclick="onDblClick"
        @wheel.prevent="onWheel"
        @contextmenu.prevent
      />
      <div v-if="tip.show" class="starmap-tip" :style="{ left: tip.x + 'px', top: tip.y + 'px' }">
        <b>{{ tip.title }}</b>
        <span>{{ tip.sub }}</span>
      </div>
    </div>

    <!-- 顶部工具条：全景 + 聚焦学科 + 图例 -->
    <div class="macro-toolbar panel">
      <span class="toolbar-spacer" />
      <button class="tool-btn" @click="fitWholeMap(true)">🌌 全景</button>
      <select
        class="tool-btn subject-select"
        value=""
        @change="(e) => focusSubject(e.target.value)"
      >
        <option value="" disabled>聚焦学科</option>
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
      <div class="legend-row"><i class="line" style="background: #6ea8ff" />主干路径（同学科）　<i class="line dashed" style="border-color: rgba(196,141,255,0.8)" />相关</div>
      <div class="legend-row"><i class="line dashed" style="border-color: rgba(110,168,255,0.45)" />跨学科联系（放大后可见）</div>
      <div class="legend-row">滚轮连续缩放：全景星云 → 星团 → 节点网络；单击星系快速聚焦</div>
    </div>

    <p v-if="loading" class="macro-status">加载星图中…</p>
    <p v-else-if="error" class="macro-status error-text">{{ error }} <button class="link-btn" @click="load">重试</button></p>
    <p v-else class="macro-hint">
      一体大地图：滚轮缩放 · 拖拽平移 · 右键拖动旋转 · 单击星系聚焦 · 单击星点看详情 · 双击星点在中心视图打开
    </p>
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
import { MacroRenderer, LOD, worldWeights } from '../starmap/macroRenderer.js';
import { layoutWorld, makeSyntheticGraph } from '../starmap/macroLayout.js';

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
const galaxies = ref([]); // [{ subject, count }]
const showLegend = ref(false);
const isPanning = ref(false);
const rotating = ref(false); // 右键旋转中（光标样式）
const hoverKind = ref(null);
const tip = ref({ show: false, x: 0, y: 0, title: '', sub: '' });

let allNodes = [];
let allEdges = [];
let minScale = 0.02; // 全景 fit 后允许的最小缩放（缩过头自动弹回）
let anim = null; // 相机动画 rAF
let twinkleRaf = null; // 呼吸闪烁循环（低功耗：仅星系/星团/中档，页面可见、非 reduced-motion）

// ---- 呼吸闪烁：星系星云 / 星团随时间明暗变化（静止也有生命力）----
// 星系层与星团/中档全开；节点档内容多暂停（LOD 由循环内按权重判断）
function startTwinkle() {
  stopTwinkle();
  if (fx.reducedMotion.value) return; // 尊重减弱动效
  const loop = () => {
    twinkleRaf = null;
    if (document.hidden) return; // 页面隐藏即停
    const w = worldWeights(renderer.camera.scale);
    if (w.galaxy > 0.02 || w.cluster > 0.02 || w.mid > 0.02) renderer.render(); // 节点档跳过
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
  else startTwinkle();
}

// ---- 数据 ----
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const { nodes, edges } = await api.graphAll();
    allNodes = nodes;
    allEdges = edges;
    buildWorld();
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

// 一体大地图：全部学科节点嵌入统一世界坐标（星系锚点 + 学科内 DAG 分层）
function buildWorld() {
  const bySubject = new Map();
  for (const n of allNodes) {
    const s = n.subject ?? '未分类';
    bySubject.set(s, (bySubject.get(s) ?? 0) + 1);
  }
  const subjects = [...bySubject]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([subject, count]) => ({ subject, count }));
  const { galaxies: gs, pos } = layoutWorld(subjects, allNodes, allEdges);
  galaxies.value = gs;
  renderer.setWorld({ galaxies: gs, nodes: allNodes, edges: allEdges, pos });
  fitWholeMap(false);
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

// 全景：适配整个一体地图（星系 + 学科节点包围盒），限制在星系档阈值内
function fitWholeMap(animate = false) {
  if (!galaxies.value.length) return;
  const pad = 130;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const g of galaxies.value) {
    x0 = Math.min(x0, g.x - g.r);
    y0 = Math.min(y0, g.y - g.r - 70);
    x1 = Math.max(x1, g.x + g.r);
    y1 = Math.max(y1, g.y + g.r + 30);
  }
  const pos = renderer.data?.pos;
  if (pos) {
    for (const p of pos.values()) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  }
  const w = wrap.value.clientWidth;
  const h = wrap.value.clientHeight;
  const scale = Math.min(
    LOD.GALAXY * 0.9, // 全景落在星系档
    Math.max(0.03, Math.min(w / (x1 - x0 + pad * 2), h / (y1 - y0 + pad * 2))),
  );
  minScale = scale * 0.6;
  const target = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, scale };
  if (animate) animateCamera(target);
  else Object.assign(renderer.camera, target);
}

// ---- 连续缩放（一体地图无视图切换）----
function focusSubject(subject) {
  const g = galaxies.value.find((x) => x.subject === subject);
  if (!g) return;
  animateCamera({ x: g.x, y: g.y, scale: LOD.NODE * 1.25 }, 560); // 平滑飞到该学科节点档
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
let rotateInfo = null; // 右键旋转：{ x, rot0 }

function onPointerDown(e) {
  cancelAnim();
  if (e.button === 2) {
    // 右键：旋转视口
    rotateInfo = { x: e.offsetX, rot0: renderer.camera.rot };
    rotating.value = true;
    return;
  }
  cv.value.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = {
      d0: Math.hypot(a.x - b.x, a.y - b.y),
      scale0: renderer.camera.scale,
      a0: Math.atan2(b.y - a.y, b.x - a.x),
      rot0: renderer.camera.rot,
    };
    moved = true;
    return;
  }
  moved = false;
  isPanning.value = false;
  downInfo = { x: e.offsetX, y: e.offsetY, time: Date.now() };
}

function onPointerMove(e) {
  if (rotateInfo) {
    // 右键旋转：水平拖动一圈 ≈ 2π
    renderer.camera.rot = rotateInfo.rot0 + (e.offsetX - rotateInfo.x) * 0.006;
    renderer.render();
    return;
  }
  const prev = pointers.get(e.pointerId);
  if (prev && pointers.size === 2 && pinch) {
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch.d0 > 0) {
      renderer.camera.scale = Math.min(4, Math.max(minScale, pinch.scale0 * (d / pinch.d0)));
      renderer.render();
    }
    // 双指旋转
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    renderer.camera.rot = pinch.rot0 + (ang - pinch.a0);
    renderer.render();
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
    tip.value.sub = `${g?.count ?? 0} 节点 · 单击聚焦`;
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
  if (rotateInfo) {
    rotateInfo = null;
    rotating.value = false;
    return;
  }
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
    focusSubject(hit.subject);
  } else if (hit.type === 'cluster') {
    // 单击星团：向其中心放大一档
    animateCamera({ x: hit.cx, y: hit.cy, scale: LOD.CLUSTER * 1.6 }, 320);
  } else if (hit.type === 'node') {
    router.push(`/node/${encodeURIComponent(hit.id)}`);
  }
}

function onPointerLeave() {
  rotateInfo = null;
  rotating.value = false;
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
  }
  // 空白处双击无操作（一体地图无需返回）
}

function onWheel(e) {
  cancelAnim();
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const cam = renderer.camera;
  const next = Math.min(4, Math.max(minScale, cam.scale * factor)); // 连续缩放，clamp 防缩没/缩爆
  const w = renderer.toWorld(e.offsetX, e.offsetY);
  cam.scale = next;
  cam.x = w.x - (e.offsetX - renderer.width / 2) / next;
  cam.y = w.y - (e.offsetY - renderer.height / 2) / next;
  renderer.render();
}

function resize() {
  if (!wrap.value || !renderer) return;
  renderer.resize(wrap.value.clientWidth, wrap.value.clientHeight, window.devicePixelRatio || 1);
  renderer.render();
}
function installStressHook() {
  window.__starmapStress = (n = 2000, { seconds = 5 } = {}) => {
    const g = makeSyntheticGraph(n, { subjectCount: 4 });
    allNodes = g.nodes;
    allEdges = g.edges;
    buildWorld();
    return new Promise((resolve) => {
      let frames = 0;
      const t0 = performance.now();
      const sweep = (now) => {
        // 在全景星系/星团/过渡/节点档之间往复扫缩放，覆盖四档 LOD
        const phase = ((now - t0) / 1000 / seconds) * Math.PI * 2;
        renderer.camera.scale = 0.08 + (3 - 0.08) * (0.5 - 0.5 * Math.cos(phase * 3));
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

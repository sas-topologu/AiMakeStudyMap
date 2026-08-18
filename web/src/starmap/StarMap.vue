// 星图画布组件：承载渲染器，负责尺寸自适应与全部指针交互
// 单击节点 → recenter（以其为中心重新加载邻域）；双击 / 长按 → open（详情页）
// 拖拽平移、滚轮/双指缩放；hover 显示标题 tooltip；「+N」标记点击展开/折叠相关线
<template>
  <div ref="wrap" class="starmap-wrap">
    <canvas
      ref="cv"
      class="starmap-canvas"
      :class="{ pointer: hoverNode }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="onPointerLeave"
      @dblclick="onDblClick"
      @wheel.prevent="onWheel"
    />
    <div v-if="hoverNode" class="starmap-tip" :style="{ left: tip.x + 'px', top: tip.y + 'px' }">
      <b>{{ hoverNode.title }}</b>
      <span>{{ hoverNode.subject }} · {{ stateLabel(hoverNode.state) }}</span>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, watch, computed } from 'vue';
import { StarMapRenderer } from './renderer.js';
import { computeLayout } from './layout.js';
import { planTransition, SpringSim, TRANSITION } from './transition.js';
import { ParticleSystem } from './particles.js';
import { vectorizeEmblem } from './emblemVector.js';
import { pickEmblemOffsets } from './emblemOffsets.js';
import { useFxSettings } from '../composables/useFxSettings.js';
import { useDevSettings } from '../composables/useDevSettings.js';
import { useStarmapStore } from '../stores/starmap.js';

const props = defineProps({
  nodes: { type: Array, default: () => [] },
  edges: { type: Array, default: () => [] },
  centerId: { type: String, default: null },
  // 导航路线高亮（金色）：{ nodes: [id…], edges: [{from,to}…] }
  highlight: { type: Object, default: () => ({ nodes: [], edges: [] }) },
  // 热门路径（青色）：[{ from, to, count }]
  hotEdges: { type: Array, default: () => [] },
  // 连线风格：legacy / skilltree / depth / trunk（见 renderer.js EDGE_MODES）
  edgeMode: { type: String, default: 'skilltree' },
  // 导航「下一节点 / 上一节点」：钉在上下中轴，让后续指向导航终点
  navNextId: { type: String, default: null },
  navPrevId: { type: String, default: null },
});
const emit = defineEmits(['recenter', 'open']);

const STATE_LABEL = { dim: '暗淡', open: '开放', passed: '通关', lit: '点亮' };
const stateLabel = (s) => STATE_LABEL[s] ?? s;

const fx = useFxSettings();
const dev = useDevSettings();

const wrap = ref(null);
const cv = ref(null);
let renderer = null;
let ro = null;
let dpr = window.devicePixelRatio || 1;

const hoverId = ref(null);
const tip = ref({ x: 0, y: 0 });

const nodesById = computed(() => Object.fromEntries(props.nodes.map((n) => [n.id, n])));
const hoverNode = computed(() => (hoverId.value ? nodesById.value[hoverId.value] : null));

function ringStep() {
  const w = wrap.value?.clientWidth || 800;
  const h = wrap.value?.clientHeight || 600;
  return Math.max(110, Math.min(w, h) / 2 / 3.1) * dev.settings.ringStep;
}

// 页面长宽比拉伸（短边为 1）：宽屏 → x 拉伸，竖屏 → y 拉伸
function aspectStretch() {
  const w = wrap.value?.clientWidth || 800;
  const h = wrap.value?.clientHeight || 600;
  const m = Math.min(w, h);
  return { x: w / m, y: h / m };
}

// 把开发者模式可调参数应用到渲染器
function applyDevSettings() {
  if (!renderer) return;
  renderer.meteorSpeed = dev.settings.meteorSpeed;
  renderer.meteorTail = dev.settings.meteorTail;
  renderer.nodeScale = dev.settings.nodeSize;
  renderer.centerFontScale = dev.settings.centerFont;
  renderer.edgeScale = dev.settings.edgeWidth;
}

// ---- 切换动画状态 ----
let sim = null; // SpringSim
let simRaf = null;
let camRaf = null;
let lastTick = 0;

function currentDisplayedPos() {
  if (sim) return sim.positions();
  return renderer?.layout?.pos ?? null;
}

function computeFitCamera() {
  const w = wrap.value?.clientWidth || 800;
  const h = wrap.value?.clientHeight || 600;
  const base = ringStep() * 2; // 最长环半径（未拉伸）
  const { x: sx, y: sy } = aspectStretch();
  // 按拉伸后的椭圆包围盒适配：铺满视口 88%（留边），长宽比随页面变化
  const scale = Math.min((w * 0.88) / (2 * base * sx), (h * 0.88) / (2 * base * sy));
  return { x: 0, y: 0, scale: Math.min(2, Math.max(0.22, scale)) };
}

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function rebuild({ fit = false } = {}) {
  if (!renderer || !props.centerId) return;
  applyDevSettings();
  const layout = computeLayout({
    centerId: props.centerId,
    nodes: props.nodes,
    edges: props.edges,
    ringStep: ringStep(),
    nav: { nextId: props.navNextId, prevId: props.navPrevId },
    stretch: aspectStretch(),
  });
  renderer.navNextId = props.navNextId;
  renderer.stretch = aspectStretch();
  const prevPos = currentDisplayedPos();
  const prevCenter = renderer.centerId;
  const camTarget = computeFitCamera();

  // 分流：有旧布局且换中心且动效开启 → 弹簧过渡；否则瞬排
  const plan =
    fit && prevCenter && prevCenter !== props.centerId
      ? planTransition(prevPos, layout.pos, props.centerId, {
          width: renderer.width,
          height: renderer.height,
          scale: camTarget.scale,
        }, { enabled: fx.transitionEnabled.value })
      : null;

  if (plan) {
    startTransition(plan, layout, camTarget);
    return;
  }
  stopTransition({ commit: false });
  renderer.setData({ layout, nodesById: nodesById.value, centerId: props.centerId });
  renderer.setHighlight(props.highlight);
  renderer.setHotEdges(props.hotEdges);
  if (fit) Object.assign(renderer.camera, camTarget);
  syncMeteorLoop();
  renderer.render();
}

function startTransition(plan, layout, camTarget) {
  // 旧节点数据并入 nodesById：离开节点在 settle 前仍需绘制
  const mergedNodes = { ...(renderer.nodesById ?? {}), ...nodesById.value };
  const oldEdges = renderer.layout?.edges ?? [];
  const seen = new Set(layout.edges.map((e) => `${e.from}|${e.to}|${e.kind}`));
  const unionEdges = [
    ...layout.edges,
    ...oldEdges.filter((e) => !seen.has(`${e.from}|${e.to}|${e.kind}`)),
  ];

  stopTransition({ commit: false });
  sim = new SpringSim(plan);
  renderer.setData({ layout, nodesById: mergedNodes, centerId: props.centerId });
  renderer.setHighlight(props.highlight);
  renderer.setHotEdges(props.hotEdges);
  renderer.animEdges = unionEdges;
  applySimToRenderer();
  syncMeteorLoop();

  // 相机并行过渡（easeInOutCubic，与弹簧同时完成）
  const camFrom = { ...renderer.camera };
  const t0 = performance.now();
  const camStep = (now) => {
    const t = Math.min(1, (now - t0) / TRANSITION.CAMERA_MS);
    const k = easeInOutCubic(t);
    renderer.camera.x = camFrom.x + (camTarget.x - camFrom.x) * k;
    renderer.camera.y = camFrom.y + (camTarget.y - camFrom.y) * k;
    renderer.camera.scale = camFrom.scale + (camTarget.scale - camFrom.scale) * k;
    if (!sim) renderer.render(); // 弹簧已结束时相机自行驱动重绘
    if (t < 1) camRaf = requestAnimationFrame(camStep);
    else camRaf = null;
  };
  camRaf = requestAnimationFrame(camStep);

  lastTick = performance.now();
  const tick = (now) => {
    if (!sim) return;
    const dt = (now - lastTick) / 1000;
    lastTick = now;
    sim.step(dt);
    applySimToRenderer();
    renderer.render();
    if (sim.settled) {
      finishTransition();
      return;
    }
    simRaf = requestAnimationFrame(tick);
  };
  simRaf = requestAnimationFrame(tick);
}

function applySimToRenderer() {
  renderer.animPos = sim.positions();
  const alpha = new Map();
  for (const id of renderer.animPos.keys()) alpha.set(id, sim.alphaOf(id));
  renderer.animAlpha = alpha;
}

// 动画完成：回落到精确布局坐标
function finishTransition() {
  sim = null;
  if (simRaf) cancelAnimationFrame(simRaf);
  simRaf = null;
  renderer.animPos = null;
  renderer.animAlpha = null;
  renderer.animEdges = null;
  syncMeteorLoop();
  renderer.render();
}

// 打断（用户输入/新数据）：commit=true 时把模拟当前位置写回布局（节点停在当前处）
function stopTransition({ commit = true } = {}) {
  if (simRaf) cancelAnimationFrame(simRaf);
  if (camRaf) cancelAnimationFrame(camRaf);
  simRaf = null;
  camRaf = null;
  if (sim && commit && renderer.layout) {
    const pos = sim.positions();
    for (const [id, lp] of renderer.layout.pos) {
      const p = pos.get(id);
      if (p) {
        lp.x = p.x;
        lp.y = p.y;
      }
    }
  }
  sim = null;
  if (renderer) {
    renderer.animPos = null;
    renderer.animAlpha = null;
    renderer.animEdges = null;
  }
}

function resize() {
  if (!wrap.value || !renderer) return;
  dpr = window.devicePixelRatio || 1;
  renderer.resize(wrap.value.clientWidth, wrap.value.clientHeight, dpr);
  rebuild({ fit: true });
}

// ---- 星光拼形粒子（1d）----
// rAF 仅在粒子活跃时运行；速度 0 / emblems 空 / reduced-motion / 页面隐藏 / 自动关闭 → 全停
const starmap = useStarmapStore();
let ps = null;
let psRaf = null;
let psLast = 0;
let emblemToken = 0; // 防 centerId 快速切换时的异步竞争

async function loadEmblems() {
  const token = ++emblemToken;
  if (!props.centerId) return;
  const card = await starmap.cardFor(props.centerId);
  if (token !== emblemToken) return; // 已切走，丢弃旧结果
  const emblems = card?.emblems ?? [];
  const mediaById = Object.fromEntries((card?.media ?? []).map((m) => [m.id, m]));
  const sets = (
    await Promise.all(emblems.map((e, i) => vectorizeEmblem(props.centerId, i, e, mediaById)))
  ).filter((s) => s.slots.length);
  if (token !== emblemToken) return;
  if (!ps) ps = new ParticleSystem({});
  // 每个特效组分配到节点周边不同的空白位置，分散拼形
  const offsets = pickEmblemOffsets(renderer, props.centerId, sets.length);
  sets.forEach((s, i) => {
    s.offset = offsets[i] ?? { x: 0, y: 0 };
  });
  ps.setEmblems(sets); // 新卡 → 重启生命周期循环（旧粒子直接散开重组）
  syncPsLoop();
}

function psShouldRun() {
  return (
    ps &&
    ps.groups.length > 0 &&
    !ps.autoOff &&
    fx.particleSpeedEffective.value > 0 &&
    !document.hidden
  );
}

function syncPsLoop() {
  if (psShouldRun() && !psRaf) {
    psLast = performance.now();
    psRaf = requestAnimationFrame(psTick);
  } else if (!psShouldRun() && psRaf) {
    cancelAnimationFrame(psRaf);
    psRaf = null;
    if (renderer) {
      renderer.particles = null;
      renderer.render();
    }
  }
}

function psTick(now) {
  psRaf = null;
  if (!psShouldRun()) {
    renderer.particles = null;
    renderer.render();
    return;
  }
  const rawDt = (now - psLast) / 1000;
  psLast = now;
  ps.notePerformance(rawDt); // FPS 采样 → 自动减半/关闭
  if (ps.autoOff) {
    fx.markParticleAutoOff();
    syncPsLoop();
    return;
  }
  ps.setSpeed(fx.particleSpeedEffective.value);
  ps.tick(rawDt);
  renderer.particles = ps.renderState();
  renderer.render();
  psRaf = requestAnimationFrame(psTick);
}

function onVisibility() {
  psLast = performance.now(); // 恢复时不计隐藏时长
  syncPsLoop();
  pulseLast = performance.now();
  syncPulseLoop();
  meteorLast = performance.now();
  syncMeteorLoop();
}

// ---- 相关流星渲染循环（~30fps 节流，reduced-motion/隐藏/无流星即停）----
let meteorRaf = null;
let meteorLast = 0;

function meteorShouldRun() {
  return (renderer?.meteors?.size ?? 0) > 0 && !fx.reducedMotion.value && !document.hidden;
}

function syncMeteorLoop() {
  if (meteorShouldRun() && !meteorRaf) {
    meteorLast = performance.now();
    meteorRaf = requestAnimationFrame(meteorTick);
  } else if (!meteorShouldRun() && meteorRaf) {
    cancelAnimationFrame(meteorRaf);
    meteorRaf = null;
    if (renderer) renderer.render(); // 停循环补一帧（流星回到当前位置静止）
  }
}

function meteorTick(now) {
  meteorRaf = null;
  if (!meteorShouldRun()) {
    if (renderer) renderer.render();
    return;
  }
  if (now - meteorLast >= 33) {
    const dt = (now - meteorLast) / 1000;
    meteorLast = now;
    renderer.tickMeteors(dt);
    renderer.render();
  }
  meteorRaf = requestAnimationFrame(meteorTick);
}

// ---- 技能树呼吸脉冲渲染循环（仅 skilltree 模式，~20fps 节流）----
let pulseRaf = null;
let pulseLast = 0;

function pulseShouldRun() {
  return props.edgeMode === 'skilltree' && !fx.reducedMotion.value && !document.hidden;
}

function syncPulseLoop() {
  if (pulseShouldRun() && !pulseRaf) {
    pulseLast = performance.now();
    pulseRaf = requestAnimationFrame(pulseTick);
  } else if (!pulseShouldRun() && pulseRaf) {
    cancelAnimationFrame(pulseRaf);
    pulseRaf = null;
    if (renderer) renderer.render(); // 停循环时补一帧回到静止态
  }
}

function pulseTick(now) {
  pulseRaf = null;
  if (!pulseShouldRun()) {
    if (renderer) renderer.render();
    return;
  }
  if (now - pulseLast >= 50) {
    pulseLast = now;
    renderer.render();
  }
  pulseRaf = requestAnimationFrame(pulseTick);
}

// ---- 指针交互 ----
const pointers = new Map();
let downInfo = null; // { x, y, time, hit }
let moved = false;
let pinch = null; // { d0, scale0 }
let pressTimer = null;
let longPressed = false;

function clearPress() {
  if (pressTimer) clearTimeout(pressTimer);
  pressTimer = null;
}

function onPointerDown(e) {
  stopTransition(); // 用户输入即打断动画（节点停在当前位置）
  cv.value.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), scale0: renderer.camera.scale };
    clearPress();
    moved = true;
    return;
  }
  moved = false;
  longPressed = false;
  downInfo = { x: e.offsetX, y: e.offsetY, time: Date.now(), hit: renderer.hitTest(e.offsetX, e.offsetY) };
  // 长按 → 打开详情
  clearPress();
  pressTimer = setTimeout(() => {
    if (!moved && downInfo?.hit?.type === 'node') {
      longPressed = true;
      emit('open', downInfo.hit.id);
    }
  }, 580);
}

function onPointerMove(e) {
  const prev = pointers.get(e.pointerId);
  if (prev && pointers.size === 2 && pinch) {
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch.d0 > 0) {
      renderer.camera.scale = Math.min(3, Math.max(0.2, pinch.scale0 * (d / pinch.d0)));
      renderer.render();
    }
    return;
  }
  if (prev) {
    // 当前节点固定在屏幕中心，不可拖拽平移：仅记录是否移动以区分「点击」与「拖动」
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (downInfo && Math.hypot(e.offsetX - downInfo.x, e.offsetY - downInfo.y) > 5) {
      moved = true;
      clearPress();
    }
    return;
  }
  // 无按键：hover tooltip
  const hit = renderer.hitTest(e.offsetX, e.offsetY);
  const id = hit?.type === 'node' ? hit.id : null;
  if (id !== hoverId.value) {
    hoverId.value = id;
    renderer.hoverId = hit?.type === 'node' ? id : null;
    renderer.render();
  }
  tip.value = { x: e.offsetX + 14, y: e.offsetY + 10 };
}

function onPointerUp(e) {
  clearPress();
  const wasPinch = pointers.size > 1;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (!downInfo || wasPinch) return;
  const click = !moved && Date.now() - downInfo.time < 500 && !longPressed;
  downInfo = null;
  if (!click) return;
  const hit = renderer.hitTest(e.offsetX, e.offsetY);
  if (hit?.type === 'node' && hit.id !== props.centerId) {
    emit('recenter', hit.id);
  }
}

function onPointerLeave() {
  hoverId.value = null;
  if (renderer) {
    renderer.hoverId = null;
    renderer.render();
  }
}

function onDblClick(e) {
  const hit = renderer.hitTest(e.offsetX, e.offsetY);
  if (hit?.type === 'node') emit('open', hit.id);
}

function onWheel(e) {
  stopTransition(); // 滚轮缩放打断动画
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const cam = renderer.camera;
  // 以屏幕中心（当前节点）为锚点缩放，中心节点始终固定在中间
  cam.scale = Math.min(3, Math.max(0.2, cam.scale * factor));
  cam.x = 0;
  cam.y = 0;
  renderer.render();
}

onMounted(() => {
  renderer = new StarMapRenderer(cv.value);
  renderer.setEdgeMode(props.edgeMode);
  ro = new ResizeObserver(resize);
  ro.observe(wrap.value);
  resize();
  loadEmblems();
  document.addEventListener('visibilitychange', onVisibility);
  syncPulseLoop();
});

onBeforeUnmount(() => {
  ro?.disconnect();
  clearPress();
  stopTransition({ commit: false });
  if (psRaf) cancelAnimationFrame(psRaf);
  psRaf = null;
  if (pulseRaf) cancelAnimationFrame(pulseRaf);
  pulseRaf = null;
  if (meteorRaf) cancelAnimationFrame(meteorRaf);
  meteorRaf = null;
  document.removeEventListener('visibilitychange', onVisibility);
});

watch(
  () => [props.nodes, props.edges, props.centerId, props.navNextId, props.navPrevId],
  () => rebuild({ fit: true }),
  { deep: true },
);

// 中心切换 → 重取卡片徽章（重启粒子循环）
watch(() => props.centerId, loadEmblems);

// 速度设置/强制降级即时生效
watch(
  () => fx.particleSpeedEffective.value,
  () => syncPsLoop(),
);

// 连线风格切换：更新渲染器并同步呼吸脉冲循环
watch(
  () => props.edgeMode,
  (m) => {
    if (!renderer) return;
    renderer.setEdgeMode(m);
    renderer.render();
    syncPulseLoop();
  },
);

// 导航/热门叠加层：跨中心切换保持（renderer 内独立于 setData 存储）
watch(
  () => [props.highlight, props.hotEdges],
  () => {
    if (!renderer) return;
    renderer.setHighlight(props.highlight);
    renderer.setHotEdges(props.hotEdges);
    renderer.render();
  },
  { deep: true },
);

// 开发者模式滑扭：环带间距变化需重排；其余参数只重应用+重绘（避免重置流星动画）
watch(
  () => dev.settings.ringStep,
  () => {
    if (!renderer) return;
    rebuild({ fit: false });
  },
);
watch(
  () => [
    dev.settings.meteorSpeed,
    dev.settings.meteorTail,
    dev.settings.nodeSize,
    dev.settings.centerFont,
    dev.settings.edgeWidth,
  ],
  () => {
    if (!renderer) return;
    applyDevSettings();
    renderer.render();
  },
);

// 暴露给父组件：图例配色含义
defineExpose({ EDGE_LEGEND: [
  { kind: 'prerequisite', label: '前置依赖', color: 'rgba(96,165,250,0.8)', dash: false },
  { kind: 'successor', label: '后续方向', color: 'rgba(251,191,106,0.8)', dash: false },
  { kind: 'related', label: '相关拓展（流星）', color: 'rgba(210,180,255,0.85)', dash: false },
] });
</script>

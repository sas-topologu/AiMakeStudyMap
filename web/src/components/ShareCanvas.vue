// 分享星座图画布：布局（DAG 分层）+ ShareRenderer 渲染 + 平移/缩放
// 供 /share（创作页）与 /share/:id（公开页）共用；导出 PNG 用 exportPng()
<template>
  <div ref="wrap" class="starmap-wrap">
    <canvas
      ref="cv"
      class="starmap-canvas"
      :class="{ grabbing: panning }"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @wheel.prevent="onWheel"
    />
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { ShareRenderer } from '../starmap/shareRenderer.js';
import { layoutConstellation } from '../starmap/macroLayout.js';

const props = defineProps({
  nodes: { type: Array, default: () => [] }, // [{id,title,subject,state}]（passed/lit）
  edges: { type: Array, default: () => [] },
  theme: { type: String, default: 'default' },
  collapseRelated: { type: Boolean, default: false },
});

const wrap = ref(null);
const cv = ref(null);
const panning = ref(false);
let renderer = null;
let ro = null;
let down = null;
let moved = false;

function rebuild({ fit = false } = {}) {
  if (!renderer) return;
  const pos = layoutConstellation(props.nodes, props.edges);
  renderer.setData({
    nodes: props.nodes,
    edges: props.edges,
    pos,
    theme: props.theme,
    collapseRelated: props.collapseRelated,
  });
  if (fit) fitView();
  renderer.render();
}

function fitView() {
  if (!wrap.value || props.nodes.length === 0) return;
  const b = renderer.bounds();
  const w = wrap.value.clientWidth;
  const h = wrap.value.clientHeight;
  const pad = 140;
  renderer.camera.x = (b.x0 + b.x1) / 2;
  renderer.camera.y = (b.y0 + b.y1) / 2;
  renderer.camera.scale = Math.min(
    1.8,
    Math.max(0.05, Math.min(w / (b.x1 - b.x0 + pad), h / (b.y1 - b.y0 + pad))),
  );
}

function resize() {
  if (!wrap.value || !renderer) return;
  renderer.resize(wrap.value.clientWidth, wrap.value.clientHeight, window.devicePixelRatio || 1);
  rebuild({ fit: true });
}

function onDown(e) {
  cv.value.setPointerCapture(e.pointerId);
  down = { x: e.offsetX, y: e.offsetY };
  moved = false;
}

function onMove(e) {
  if (!down) return;
  const dx = e.offsetX - down.x;
  const dy = e.offsetY - down.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) {
    moved = true;
    panning.value = true;
  }
  if (moved) {
    renderer.camera.x -= dx / renderer.camera.scale;
    renderer.camera.y -= dy / renderer.camera.scale;
    down = { x: e.offsetX, y: e.offsetY };
    renderer.render();
  }
}

function onUp() {
  down = null;
  panning.value = false;
}

function onWheel(e) {
  const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08; // 低灵敏度，屏幕中心缩放
  const cam = renderer.camera;
  cam.scale = Math.min(4, Math.max(0.05, cam.scale * factor));
  renderer.render();
}

onMounted(() => {
  renderer = new ShareRenderer(cv.value);
  ro = new ResizeObserver(resize);
  ro.observe(wrap.value);
  resize();
});

onBeforeUnmount(() => ro?.disconnect());

watch(() => [props.nodes, props.edges, props.theme, props.collapseRelated], () => rebuild({ fit: false }), {
  deep: true,
});

// 导出 PNG（返回 dataURL；父组件触发下载）
function exportPng() {
  renderer.render(); // 确保最新帧
  return cv.value.toDataURL('image/png');
}

defineExpose({ exportPng });
</script>

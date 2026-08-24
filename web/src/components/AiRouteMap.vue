// AI 辅助路线规划 · 定制学习地图渲染
// 输入 POST /agent/plan 返回的定制路线（{ targetTitle, nodes, edges }），
// 用 ShareCanvas（星座图 DAG 分层）渲染「用户需要掌握、尚未点亮」的知识地图，
// 视觉与中心视图/星座图一致。仅含前置依赖链，已挂除已点亮与相关性不高者。
<template>
  <div class="ai-map">
    <div class="ai-map-head">
      <b>定制学习地图 · {{ map.targetTitle }}</b>
      <span class="muted">{{ map.nodes.length }} 个待掌握节点 · {{ map.edges.length }} 条前置链</span>
      <span class="toolbar-spacer" />
      <button class="btn ghost" @click="$emit('replan')">重新规划</button>
      <button class="icon-btn" title="关闭" @click="$emit('close')">✕</button>
    </div>
    <p class="muted ai-map-hint">
      地图仅包含你需要掌握、尚未点亮的节点（已点亮与相关性不高者已剔除），由前置依赖链串成星座图。
    </p>
    <div class="ai-map-canvas">
      <ShareCanvas :nodes="map.nodes" :edges="map.edges" :theme="'default'" />
    </div>
  </div>
</template>

<script setup>
import ShareCanvas from './ShareCanvas.vue';

defineProps({
  map: { type: Object, required: true }, // { target, targetTitle, nodes, edges }
});
defineEmits(['close', 'replan']);
</script>

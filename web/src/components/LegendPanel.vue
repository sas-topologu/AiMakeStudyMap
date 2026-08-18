// 星图图例：折叠面板（默认收起），说明连线/亮度/描边含义
<template>
  <div class="legend panel" :class="{ collapsed }">
    <button class="legend-toggle" @click="collapsed = !collapsed">
      图例 {{ collapsed ? '▸' : '▾' }}
    </button>
    <div v-if="!collapsed" class="legend-body">
      <div class="legend-row"><i class="line" style="background: rgba(96,165,250,0.8)" />前置依赖（下方区）</div>
      <div class="legend-row"><i class="line" style="background: rgba(251,191,106,0.8)" />后续方向（上方区）</div>
      <div class="legend-row"><i class="line" style="background: linear-gradient(90deg, transparent, rgba(210,180,255,0.85))" />相关拓展（左右区·无连线为流星，名称环绕）</div>
      <div class="legend-row"><i class="dot dim" />暗淡 · <i class="dot open" />开放 · <i class="dot passed" />通关 · <i class="dot lit" />点亮</div>
      <div class="legend-row"><i class="ring green" />验证通过　<i class="ring yellow" />存在争议</div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
const collapsed = ref(true);
</script>

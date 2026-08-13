// 术语夹层：多级悬浮定义浮窗，每层可单独关闭；定义内 [[术语]] 可再叠一层
<template>
  <div>
    <div
      v-for="(layer, i) in layers"
      :key="i"
      class="term-layer panel"
      :style="{ left: layer.x + 'px', top: layer.y + 'px', zIndex: 60 + i }"
    >
      <div class="term-layer-head">
        <b>{{ layer.name }}</b>
        <button class="icon-btn" title="关闭本层" @click="$emit('close', i)">✕</button>
      </div>
      <RichText class="term-layer-body" :text="layer.text" @term="(name, e) => $emit('term', name, e)" />
      <div v-if="layers.length > 1 && i === layers.length - 1" class="term-layer-foot">
        <button class="link-btn" @click="$emit('closeAll')">关闭全部</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import RichText from './RichText.vue';

defineProps({
  layers: { type: Array, default: () => [] }, // [{ name, text, x, y }]
});
defineEmits(['close', 'closeAll', 'term']);
</script>

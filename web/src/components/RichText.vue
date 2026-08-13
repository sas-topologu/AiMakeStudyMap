// 富文本：渲染极简 Markdown + [[术语]] 高亮可点（点击事件委托，向父级抛 term 事件）
<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div class="rich" v-html="html" @click="onClick" />
</template>

<script setup>
import { computed } from 'vue';
import { renderMarkdown } from '../utils/markdown.js';

const props = defineProps({
  text: { type: String, default: '' },
});
const emit = defineEmits(['term']);

const html = computed(() => renderMarkdown(props.text));

function onClick(e) {
  const btn = e.target.closest('[data-term]');
  if (btn) emit('term', btn.dataset.term, e);
}
</script>

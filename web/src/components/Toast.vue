// 全局轻提示堆栈（顶部居中）；action.to 用 router 跳转
<template>
  <div class="toasts">
    <div v-for="t in ui.toasts" :key="t.id" class="toast" :class="t.type">
      <span>{{ t.message }}</span>
      <button v-if="t.action" class="toast-action" @click="go(t)">{{ t.action.label }}</button>
    </div>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router';
import { useUiStore } from '../stores/ui.js';

const ui = useUiStore();
const router = useRouter();

function go(t) {
  ui.dismiss(t.id);
  if (t.action?.to) router.push(t.action.to);
}
</script>

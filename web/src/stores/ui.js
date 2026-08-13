// 全局轻提示（toast）；支持可选动作按钮（如「查看更新」跳转）
import { defineStore } from 'pinia';

let seq = 0;

export const useUiStore = defineStore('ui', {
  state: () => ({
    toasts: [], // { id, message, type: 'info'|'success'|'error', action?: { label, to } }
  }),
  actions: {
    toast(message, type = 'info', duration = 2600, action = null) {
      const id = ++seq;
      this.toasts.push({ id, message, type, action });
      setTimeout(() => {
        this.toasts = this.toasts.filter((t) => t.id !== id);
      }, duration);
    },
    dismiss(id) {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    },
  },
});

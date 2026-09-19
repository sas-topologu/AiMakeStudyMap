// 学习策略（由所在的库提供，见 docs/概念模型.md §9.2）
// 计时/防沉迷、跃迁额度都是「约束」，由库自己决定开关；个人端只按策略显示或隐藏入口 ——
// 关掉约束不会减少任何学习功能，只是不再卡人。
import { defineStore } from 'pinia';
import { api } from '../api/client.js';

export const usePolicyStore = defineStore('policy', {
  state: () => ({
    loaded: false,
    timerEnabled: true,
    dailyLimitMinutes: 120,
    jumpQuotaEnabled: true,
  }),
  actions: {
    async load() {
      try {
        const { policy } = await api.policyGet();
        this.timerEnabled = Boolean(policy?.timerEnabled);
        this.dailyLimitMinutes = Number(policy?.dailyLimitMinutes) || 120;
        this.jumpQuotaEnabled = Boolean(policy?.jumpQuotaEnabled);
        this.loaded = true;
      } catch {
        // 库不可达时按默认（约束全开）显示，不打扰用户
      }
    },
  },
});

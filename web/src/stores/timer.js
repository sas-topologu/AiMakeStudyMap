// 倒计时：进行中计时（每秒 tick）+ 当日额度；刷新页面后从 GET /api/timer 恢复
import { defineStore } from 'pinia';
import { api } from '../api/client.js';

export const useTimerStore = defineStore('timer', {
  state: () => ({
    endsAt: null, // ms 时间戳
    remainingSeconds: 0,
    daily: null, // { usedSeconds, remainingSeconds }
    loaded: false,
    _ticker: null,
  }),
  getters: {
    active: (s) => s.endsAt !== null && s.remainingSeconds > 0,
    remainingText(s) {
      const t = Math.max(0, s.remainingSeconds);
      const m = Math.floor(t / 60);
      const sec = t % 60;
      return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    },
    dailyRemainingMinutes: (s) =>
      s.daily && s.daily.remainingSeconds !== null ? Math.floor(s.daily.remainingSeconds / 60) : null,
  },
  actions: {
    _applyTimer(timer) {
      if (timer && new Date(timer.endsAt).getTime() > Date.now()) {
        this.endsAt = new Date(timer.endsAt).getTime();
        this.remainingSeconds = timer.remainingSeconds;
      } else {
        this.endsAt = null;
        this.remainingSeconds = 0;
      }
      this._ensureTicker();
    },
    // 页面加载 / 刷新后恢复
    async restore() {
      try {
        const { timer, daily } = await api.timerCurrent();
        this.daily = daily;
        this._applyTimer(timer);
      } catch {
        /* 未登录或离线时静默 */
      } finally {
        this.loaded = true;
      }
    },
    async start(minutes) {
      const r = await api.timerStart(minutes);
      this._applyTimer(r);
      await this.refreshDaily();
      return r;
    },
    async refreshDaily() {
      try {
        const { timer, daily } = await api.timerCurrent();
        this.daily = daily;
        if (!this.active) this._applyTimer(timer);
      } catch {
        /* 静默 */
      }
    },
    _ensureTicker() {
      if (this._ticker) return;
      this._ticker = setInterval(() => {
        if (!this.endsAt) return;
        this.remainingSeconds = Math.max(0, Math.round((this.endsAt - Date.now()) / 1000));
        if (this.remainingSeconds <= 0) this.endsAt = null; // 到时自动失效（提交时同样会被拒绝）
      }, 1000);
    },
  },
});

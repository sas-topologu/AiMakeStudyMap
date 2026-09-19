// 本地成果（离线产出）：先记在这里，联网后上报给库。
// 这些成果是「未认证」的 —— 但**不做任何标记**，与已认证的平等展示（docs/概念模型.md §4）。
import { defineStore } from 'pinia';
import { api } from '../api/client.js';

const KEY = 'starmap:progress.v1';
const LEVEL = { dim: 0, open: 1, passed: 2, lit: 3 };

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

export const useLocalProgressStore = defineStore('localProgress', {
  state: () => ({ items: load(), syncing: false }),
  getters: {
    // 待上报（离线产出、库还没确认过）的成果
    pending: (s) =>
      Object.entries(s.items)
        .filter(([, v]) => v.pending)
        .map(([nodeId, v]) => ({ nodeId, state: v.state, passSeconds: v.passSeconds ?? null })),
    hasPending() {
      return this.pending.length > 0;
    },
  },
  actions: {
    _save() {
      localStorage.setItem(KEY, JSON.stringify(this.items));
    },
    // 记一条本地成果（只升不降）
    record(nodeId, state, { passSeconds = null } = {}) {
      const cur = this.items[nodeId];
      if (cur && LEVEL[cur.state] >= LEVEL[state]) return;
      this.items[nodeId] = {
        state,
        passSeconds: passSeconds ?? cur?.passSeconds ?? null,
        at: new Date().toISOString(),
        pending: true,
      };
      this._save();
    },
    stateOf(nodeId) {
      return this.items[nodeId]?.state ?? null;
    },
    // 本地状态与库侧状态取更高者（用于展示）
    merge(nodeId, serverState) {
      const local = this.stateOf(nodeId);
      if (!local) return serverState ?? 'dim';
      if (!serverState) return local;
      return LEVEL[local] > LEVEL[serverState] ? local : serverState;
    },
    // 联网后上报：库一律接收；返回权威状态
    async sync() {
      const items = this.pending;
      if (items.length === 0) return { accepted: 0, skipped: 0 };
      this.syncing = true;
      try {
        const res = await api.achievementsUpload(items);
        for (const it of items) {
          const cur = this.items[it.nodeId];
          if (cur) cur.pending = false;
        }
        // 库侧更高（例如已由库见证过）：采用库侧状态
        for (const [nodeId, state] of Object.entries(res?.states ?? {})) {
          const local = this.items[nodeId]?.state ?? 'dim';
          if (LEVEL[state] > LEVEL[local]) {
            this.items[nodeId] = { state, passSeconds: null, at: new Date().toISOString(), pending: false };
          }
        }
        this._save();
        return res;
      } finally {
        this.syncing = false;
      }
    },
    clear() {
      this.items = {};
      this._save();
    },
  },
});

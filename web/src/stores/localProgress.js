// 本地成果（离线产出）：先记在这里，联网后上报给库。
// **按数据源分账** —— 在 A 库离线通关的成果，绝不能上报给 B 库（去中心化下一个人可连多个库）。
// 这些成果是「未认证」的 —— 但**不做任何标记**，与已认证的平等展示（docs/概念模型.md §4）。
import { defineStore } from 'pinia';
import { api, getTerminalBase } from '../api/client.js';

const KEY = 'starmap:progress.v1';
const LEVEL = { dim: 0, open: 1, passed: 2, lit: 3 };

// 兼容早期版本（按 nodeId 平铺的旧结构）：整体归到当前数据源名下
function migrate(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const values = Object.values(raw);
  const looksOld = values.length > 0 && values.every((v) => v && typeof v === 'object' && 'state' in v);
  return looksOld ? { [getTerminalBase()]: raw } : raw;
}

function load() {
  try {
    return migrate(JSON.parse(localStorage.getItem(KEY) || '{}'));
  } catch {
    return {};
  }
}

export const useLocalProgressStore = defineStore('localProgress', {
  state: () => ({ bySrc: load(), syncing: false }),
  getters: {
    // 当前数据源名下的本地成果
    items() {
      return this.bySrc[getTerminalBase()] ?? {};
    },
    // 待上报（离线产出、库还没确认过）的成果
    pending() {
      return Object.entries(this.items)
        .filter(([, v]) => v.pending)
        .map(([nodeId, v]) => ({ nodeId, state: v.state, passSeconds: v.passSeconds ?? null }));
    },
    hasPending() {
      return this.pending.length > 0;
    },
  },
  actions: {
    _save() {
      localStorage.setItem(KEY, JSON.stringify(this.bySrc));
    },
    _bucket() {
      const base = getTerminalBase();
      if (!this.bySrc[base]) this.bySrc[base] = {};
      return this.bySrc[base];
    },
    // 记一条本地成果（同一数据源内只升不降）
    record(nodeId, state, { passSeconds = null } = {}) {
      const bucket = this._bucket();
      const cur = bucket[nodeId];
      if (cur && LEVEL[cur.state] >= LEVEL[state]) return;
      bucket[nodeId] = {
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
    // 联网后上报给**当前数据源**；库一律接收；返回权威状态
    async sync() {
      const items = this.pending;
      if (items.length === 0) return { accepted: 0, skipped: 0 };
      this.syncing = true;
      try {
        const res = await api.achievementsUpload(items);
        const bucket = this.items;
        for (const it of items) {
          const cur = bucket[it.nodeId];
          if (cur) cur.pending = false;
        }
        // 库侧更高（例如已由库见证过）：采用库侧状态
        for (const [nodeId, state] of Object.entries(res?.states ?? {})) {
          const local = bucket[nodeId]?.state ?? 'dim';
          if (LEVEL[state] > LEVEL[local]) {
            bucket[nodeId] = { state, passSeconds: null, at: new Date().toISOString(), pending: false };
          }
        }
        this._save();
        return res;
      } finally {
        this.syncing = false;
      }
    },
    // 只清当前数据源的本地成果
    clear() {
      delete this.bySrc[getTerminalBase()];
      this._save();
    },
  },
});

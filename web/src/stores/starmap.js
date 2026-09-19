// 星图数据：当前中心节点 + 邻域（depth=2）
// 本地缓存（localStorage）：
//   - cards：完整知识卡（/api/sync 差异合并、详情页读取时写入）
//   - hoods：以某节点为中心的邻域快照（含当时用户状态；闯关/跃迁后失效清空）
//   - contentVersion：与 /api/meta/version 比对，不一致则 /api/sync?since= 增量合并
import { defineStore } from 'pinia';
import { api } from '../api/client.js';
import { useUiStore } from './ui.js';
import { useLocalProgressStore } from './localProgress.js';

const CACHE_KEY = 'starmap.cache.v2'; // v2：连线深度 3→2，旧 depth=3 邻域缓存作废
const RECENT_KEY = 'starmap.recent';
const RELATED_KEY = 'starmap:relatedVisible'; // 次级网络（相关连线）是否展开

function emptyCache() {
  return { contentVersion: 0, userId: null, cards: {}, hoods: {} };
}

export const useStarmapStore = defineStore('starmap', {
  state: () => ({
    centerId: null,
    nodes: [], // 邻域节点（含 state/depth）
    edges: [],
    loading: false,
    error: null,
    offlineFallback: false, // 离线时用本地缓存兜底
    relatedVisible: localStorage.getItem(RELATED_KEY) === '1', // 次级网络（相关连线）是否展开
    cache: emptyCache(),
    synced: false,
  }),
  getters: {
    centerNode: (s) => s.nodes.find((n) => n.id === s.centerId) || null,
    nodesById: (s) => Object.fromEntries(s.nodes.map((n) => [n.id, n])),
    recentId: () => localStorage.getItem(RECENT_KEY),
    // 当前邻域内各状态计数（"我的进度"面板用）
    stateCounts: (s) => {
      const c = { dim: 0, open: 0, passed: 0, lit: 0 };
      for (const n of s.nodes) c[n.state] = (c[n.state] ?? 0) + 1;
      return c;
    },
  },
  actions: {
    _loadCache() {
      try {
        this.cache = { ...emptyCache(), ...JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') };
      } catch {
        this.cache = emptyCache();
      }
    },
    _saveCache() {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(this.cache));
      } catch {
        /* 超出配额时放弃持久化，不影响运行 */
      }
    },

    // 启动：读缓存 → 比对版本 → 差异同步（邻域快照含边数据，版本变化时整体失效重建）
    async init(userId) {
      this._loadCache();
      if (this.cache.userId !== userId) {
        // 状态是用户相关的，换用户后邻域快照不可用；卡片内容可保留
        this.cache.userId = userId;
        this.cache.hoods = {};
        this._saveCache();
      }
      if (this.synced) return;
      try {
        const { contentVersion } = await api.metaVersion();
        if (contentVersion !== this.cache.contentVersion) {
          const oldVersion = this.cache.contentVersion;
          const diff = await api.sync(this.cache.contentVersion);
          for (const card of diff.nodes) this.cache.cards[card.id] = card;
          this.cache.hoods = {};
          this.cache.contentVersion = diff.version;
          this._saveCache();
          // 非首次同步（本地已有旧版本缓存）→ 提示知识库更新，可跳更新日志
          if (oldVersion > 0) {
            useUiStore().toast(`知识库已更新至 v${diff.version}`, 'info', 5000, {
              label: '查看更新',
              to: '/changelog',
            });
          }
        }
      } catch {
        /* 离线时用缓存继续 */
      } finally {
        this.synced = true;
      }
    },

    // 以 id 为中心加载邻域（优先缓存；离线时用缓存兜底，保证没有数据源也能用）
    async centerOn(id, { force = false } = {}) {
      this.loading = true;
      this.error = null;
      try {
        if (!force && this.cache.hoods[id]) {
          const hood = this.cache.hoods[id];
          this.nodes = this._withLocalStates(hood.nodes);
          this.edges = hood.edges;
        } else {
          try {
            const hood = await api.neighborhood(id, 2);
            this.nodes = this._withLocalStates(hood.nodes);
            this.edges = hood.edges;
            this.cache.hoods[id] = hood; // 缓存里存库侧原始状态，本地成果不写进缓存
            this._saveCache();
          } catch (e) {
            // 数据源不可达（离线）：回退到本地缓存的任何邻域；仍无则保留现状，只提示不中断
            const cached = this.cache.hoods[id] || Object.values(this.cache.hoods)[0];
            if (cached) {
              this.nodes = this._withLocalStates(cached.nodes);
              this.edges = cached.edges;
              this.offlineFallback = true;
            } else {
              this.error = e;
              return;
            }
          }
        }
        this.centerId = id;
        localStorage.setItem(RECENT_KEY, id);
      } finally {
        this.loading = false;
      }
    },

    // 库侧状态叠加本地成果（离线跃迁/离线通关后的本地状态要能在星图上看到）
    _withLocalStates(nodes) {
      const local = useLocalProgressStore();
      return (nodes ?? []).map((n) => {
        const merged = local.merge(n.id, n.state);
        return merged === n.state ? n : { ...n, state: merged };
      });
    },

    // 次级网络（相关关系）默认折叠：相关节点只画流星；展开后画相关连线
    toggleRelated() {
      this.relatedVisible = !this.relatedVisible;
      localStorage.setItem(RELATED_KEY, this.relatedVisible ? '1' : '0');
      return this.relatedVisible;
    },

    // 缓存里的节点状态：离线时用来还原真实进度（不能退化成 dim）
    cachedState(id) {
      const here = this.nodes?.find((n) => n.id === id)?.state;
      if (here) return here;
      for (const hood of Object.values(this.cache.hoods)) {
        const s = hood?.nodes?.find((n) => n.id === id)?.state;
        if (s) return s;
      }
      return null;
    },

    // 用户状态可能变化（通关/点亮/跃迁）后：邻域快照失效，强制刷新当前中心
    async refreshStates() {
      this.cache.hoods = {};
      this._saveCache();
      if (this.centerId) await this.centerOn(this.centerId, { force: true });
    },

    // 初始中心：最近学习节点，否则全量列表第一个（离线时退化为本地缓存的任一节点）
    async resolveInitialCenter() {
      const recent = this.recentId;
      if (recent) return recent;
      try {
        const { nodes } = await api.graphAll();
        return nodes[0]?.id ?? null;
      } catch {
        const cached = Object.keys(this.cache.hoods)[0] || Object.keys(this.cache.cards)[0];
        return cached || null;
      }
    },

    // 详情页读取的卡片写入缓存（供离线/同步复用）
    // 详情接口不下发题库：缓存里已有的题库要保留，否则会把离线能力覆盖掉
    cacheCard(card) {
      if (!card?.id) return;
      const prev = this.cache.cards[card.id];
      this.cache.cards[card.id] =
        prev?.questionBank && !card.questionBank ? { ...card, questionBank: prev.questionBank } : card;
      this._saveCache();
    },

    // 完整卡片（粒子徽章等用）：缓存优先，miss 走详情接口
    async cardFor(id) {
      if (this.cache.cards[id]) return this.cache.cards[id];
      try {
        const { card } = await api.nodeDetail(id);
        this.cacheCard(card);
        return card;
      } catch {
        return null;
      }
    },
  },
});

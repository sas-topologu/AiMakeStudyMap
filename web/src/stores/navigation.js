// 导航模式：路线数据 + 热门路径开关
// 路线高亮（金色）与热门路径（青色）分别注入中心视图/宏观视图渲染器的高亮层
import { defineStore } from 'pinia';
import { api } from '../api/client.js';

export const ROUTE_TYPES = {
  shortest: { label: '最短路径', hint: '仅核心前置，应试 / 速查' },
  full: { label: '全面路径', hint: '含相关拓展，科研 / 深度学习' },
  easy: { label: '低难路径', hint: '绕开高难节点，入门 / 跨行' },
};

export const useNavStore = defineStore('nav', {
  state: () => ({
    active: false,
    type: null,
    from: null,
    to: null,
    toTitle: '',
    routes: [], // [{ nodes: [{id,title,subject,difficulty,hard,state}], expansions? }]
    routeIndex: 0,
    hotActive: false,
    hotEdges: [], // [{ from, to, count }]
  }),
  getters: {
    route: (s) => s.routes[s.routeIndex] ?? null,
    routeNodeIds() {
      return (this.route?.nodes ?? []).map((n) => n.id);
    },
    // 相邻节点对（学习顺序），供渲染器匹配高亮边
    routeEdgePairs() {
      const ids = this.routeNodeIds;
      return ids.slice(0, -1).map((id, i) => ({ from: id, to: ids[i + 1] }));
    },
    routeSubjects() {
      return [...new Set((this.route?.nodes ?? []).map((n) => n.subject).filter(Boolean))];
    },
    hardCount() {
      return (this.route?.nodes ?? []).filter((n) => n.hard).length;
    },
    avgDifficulty() {
      const ns = this.route?.nodes ?? [];
      if (!ns.length) return 0;
      return ns.reduce((s, n) => s + (n.difficulty ?? 1), 0) / ns.length;
    },
  },
  actions: {
    start({ type, from, to, toTitle, routes }) {
      this.active = true;
      this.type = type;
      this.from = from;
      this.to = to;
      this.toTitle = toTitle;
      this.routes = routes;
      this.routeIndex = 0;
    },
    exit() {
      this.active = false;
      this.routes = [];
      this.routeIndex = 0;
    },
    setRouteIndex(i) {
      if (i >= 0 && i < this.routes.length) this.routeIndex = i;
    },
    async toggleHot() {
      if (this.hotActive) {
        this.hotActive = false;
        this.hotEdges = [];
        return;
      }
      const { edges } = await api.navHot();
      this.hotEdges = edges;
      this.hotActive = true;
    },
  },
});

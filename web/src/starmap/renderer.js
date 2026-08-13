// Canvas 2D 星图渲染器（自研，无图库依赖）—— 中心视图
// 职责：对角线与环带参考线 / 连线（前置·后续·相关三样式）/ 星点（四态亮度+可信度描边）
//      相关线折叠（>6 条默认画 5 条，其余折成「+N」标记，点击展开/再折叠）/ 命中检测
// 相机、星空背景、星点绘制等通用能力在 canvasBase.js（宏观视图共用）。
import { CanvasStage, drawSparkleStar } from './canvasBase.js';

const RELATED_VISIBLE = 5; // 折叠时可见的相关线条数
const RELATED_MAX = 6; // 超过即折叠

const EDGE_STYLE = {
  prerequisite: { color: 'rgba(96,165,250,0.5)', width: 1.2, dash: [] },
  successor: { color: 'rgba(251,191,106,0.5)', width: 1.2, dash: [] },
  related: { color: 'rgba(196,141,255,0.45)', width: 1, dash: [4, 4] },
};

export class StarMapRenderer extends CanvasStage {
  constructor(canvas) {
    super(canvas);
    this.layout = null; // { pos: Map, edges: [], depth: Map }
    this.nodesById = {};
    this.centerId = null;
    this.hoverId = null;
    this.expandedRelated = new Set();
    this.badges = []; // 本帧绘制的「+N」标记（命中检测用）
    // 叠加层：导航路线（金色发光）与热门路径（青色），跨 setData 保持
    this.highlight = { nodes: new Set(), edges: new Set() };
    this.hotEdges = new Set();
    // 切换动画（1c）：模拟进行时每帧由 StarMap.vue 注入动态坐标/透明度，null=用精确布局
    this.animPos = null; // Map<id, {x,y}>
    this.animAlpha = null; // Map<id, 0~1>
    this.animEdges = null; // 动画期间的新旧边并集（离开节点的边随之淡出）
    this.particles = null; // 星光拼形粒子（1d）：{ points:[{x,y,alpha,r}], caption } | null
  }

  // 当前应使用的节点坐标（动画中读动态值，否则读布局）
  posOf(id) {
    return this.animPos?.get(id) ?? this.layout?.pos.get(id) ?? null;
  }

  _alphaOf(id) {
    return this.animAlpha?.get(id) ?? 1;
  }

  // 阶段 5 导航：nodes=[id…]，edges=[{from,to}…]（无向匹配）
  setHighlight({ nodes = [], edges = [] } = {}) {
    this.highlight = {
      nodes: new Set(nodes),
      edges: new Set(edges.map((e) => [e.from, e.to].sort().join('|'))),
    };
  }

  // 热门路径：[{ from, to, count }]
  setHotEdges(list = []) {
    this.hotEdges = new Set(list.map((e) => [e.from, e.to].sort().join('|')));
  }

  setData({ layout, nodesById, centerId }) {
    this.layout = layout;
    this.nodesById = nodesById;
    this.centerId = centerId;
    this.expandedRelated.clear();
  }

  nodeRadius(id) {
    if (id === this.centerId) return 15;
    const d = this.layout?.depth.get(id) ?? 1;
    return Math.max(5.5, 10 - d * 1.2);
  }

  // 相关线折叠：返回 { visibleEdges, hiddenCount: Map<nodeId, number> }
  _collapseRelated(edges) {
    const relatedByNode = new Map();
    for (const e of edges) {
      if (e.kind !== 'related') continue;
      for (const id of [e.from, e.to]) {
        if (!relatedByNode.has(id)) relatedByNode.set(id, []);
        relatedByNode.get(id).push(e);
      }
    }
    const hidden = new Set();
    const hiddenCount = new Map();
    for (const [id, list] of relatedByNode) {
      if (list.length > RELATED_MAX && !this.expandedRelated.has(id)) {
        const sorted = [...list].sort((a, b) => {
          const oa = a.from === id ? a.to : a.from;
          const ob = b.from === id ? b.to : b.from;
          return oa < ob ? -1 : 1;
        });
        for (const e of sorted.slice(RELATED_VISIBLE)) hidden.add(e);
        hiddenCount.set(id, list.length - RELATED_VISIBLE);
      }
    }
    return { visibleEdges: edges.filter((e) => !hidden.has(e)), hiddenCount };
  }

  toggleRelated(id) {
    if (this.expandedRelated.has(id)) this.expandedRelated.delete(id);
    else this.expandedRelated.add(id);
  }

  // ---- 命中检测（屏幕坐标）----
  hitTest(sx, sy) {
    for (const b of this.badges) {
      if (Math.hypot(sx - b.x, sy - b.y) <= 11) return { type: 'badge', id: b.id };
    }
    if (!this.layout) return null;
    const w = this.toWorld(sx, sy);
    let best = null;
    let bestDist = Infinity;
    for (const id of this.layout.pos.keys()) {
      const p = this.posOf(id);
      if (!p) continue;
      const r = this.nodeRadius(id) + 4 / this.camera.scale;
      const d = Math.hypot(w.x - p.x, w.y - p.y);
      if (d <= r && d < bestDist) {
        best = id;
        bestDist = d;
      }
    }
    return best ? { type: 'node', id: best } : null;
  }

  // ---- 渲染 ----
  render() {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawBackground();

    if (!this.layout || !this.centerId) return;

    this.beginWorld();
    this._drawGuides();
    if (this.particles) this._drawParticles(); // 粒子层：世界空间、连线之下（不遮挡图结构）
    // 动画期间：边取新旧并集（离开节点的边随之淡出），节点取动态坐标（含屏外飞入/飞出）
    const activeEdges = this.animEdges ?? this.layout.edges;
    const { visibleEdges, hiddenCount } = this._collapseRelated(activeEdges);
    this.badges = [];
    for (const e of visibleEdges) this._drawEdge(e);
    this._drawEdgeOverlay(this.hotEdges, '#4be1e1', 2.6); // 热门路径：青色
    this._drawEdgeOverlay(this.highlight.edges, '#ffe27a', 3); // 导航路线：金色
    const drawIds = this.animPos ? [...this.animPos.keys()] : [...this.layout.pos.keys()];
    for (const id of drawIds) {
      const p = this.posOf(id);
      if (p) this._drawNode(id, p);
    }
    this._drawNodeRings();
    for (const [id, count] of hiddenCount) this._drawBadge(id, count);
    this._drawLabels();
    ctx.restore();
  }

  // 星光拼形（星座模型）：浅色细线勾轮廓（初始透明，眼位填满后显现）+ 眼位 + 星星
  _drawParticles() {
    const { ctx, camera } = this;
    const P = this.particles;
    if (!P) return;
    ctx.save();
    const lw = 1.1 / camera.scale;

    // 1) 星座连线（浅色细线，初始透明，reveal 后显现）
    if (P.paths) {
      for (const path of P.paths) {
        if (path.alpha <= 0.01 || path.points.length < 2) continue;
        ctx.globalAlpha = path.alpha;
        ctx.strokeStyle = '#9db4e8';
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(path.points[0].x, path.points[0].y);
        for (let i = 1; i < path.points.length; i += 1) ctx.lineTo(path.points[i].x, path.points[i].y);
        ctx.stroke();
      }
    }

    // 2) 眼位：未占=暗点提示；已占=不重复绘制（由落位星星显示，避免圆点+星形叠加过密）
    if (P.slots) {
      for (const s of P.slots) {
        if (s.occupied) continue;
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = '#9db4e8';
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.6 / camera.scale + 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 3) 星星：flying=小星芒飘动，slotting=亮星飞向眼位，locked=亮星点
    if (P.points) {
      for (const p of P.points) {
        if (p.alpha <= 0.01) continue;
        if (p.state === 'locked') {
          ctx.globalAlpha = 0.95;
          ctx.fillStyle = '#ffffff';
          drawSparkleStar(ctx, p.x, p.y, p.r * 0.8, { arm: 1.6, core: 0.9 });
        } else if (p.state === 'slotting') {
          ctx.globalAlpha = p.alpha;
          ctx.fillStyle = '#eef3ff';
          drawSparkleStar(ctx, p.x, p.y, p.r * 0.9, { arm: 2.4, core: 0.8 });
        } else {
          ctx.globalAlpha = p.alpha * 0.75;
          ctx.fillStyle = '#cdd8ff';
          drawSparkleStar(ctx, p.x, p.y, p.r * 0.7, { arm: 3, core: 0.6 });
        }
      }
    }

    // 4) 标题
    if (P.captions) {
      for (const cap of P.captions) {
        ctx.globalAlpha = cap.alpha;
        ctx.fillStyle = '#cdd8f5';
        ctx.font = `${12 / camera.scale}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(cap.text, cap.x ?? 0, cap.y);
      }
    }
    ctx.restore();
  }

  _drawGuides() {
    const { ctx } = this;
    const L = 4000;
    ctx.save();
    ctx.strokeStyle = 'rgba(148,163,255,0.07)';
    ctx.lineWidth = 1 / this.camera.scale;
    for (const [x1, y1, x2, y2] of [
      [-L, -L, L, L],
      [-L, L, L, -L],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    // 同心环参考线（半径取该环任一节点到中心的距离）
    const ringRadius = new Map();
    for (const [id, p] of this.layout.pos) {
      const d = this.layout.depth.get(id);
      if (d > 0 && !ringRadius.has(d)) ringRadius.set(d, Math.hypot(p.x, p.y));
    }
    ctx.strokeStyle = 'rgba(148,163,255,0.05)';
    for (const r of ringRadius.values()) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawEdge(e) {
    const { ctx } = this;
    const a = this.posOf(e.from);
    const b = this.posOf(e.to);
    if (!a || !b) return;
    const st = EDGE_STYLE[e.kind] ?? EDGE_STYLE.related;
    const hot = this.hoverId && (e.from === this.hoverId || e.to === this.hoverId);
    ctx.save();
    ctx.strokeStyle = st.color;
    // 动画淡入淡出：边透明度跟随两端点较小者
    ctx.globalAlpha = (hot ? 1 : 0.9) * Math.min(this._alphaOf(e.from), this._alphaOf(e.to));
    ctx.lineWidth = (hot ? st.width + 0.8 : st.width) / Math.sqrt(this.camera.scale);
    ctx.setLineDash(st.dash);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  _drawNode(id, p) {
    const node = this.nodesById[id] ?? {};
    this.drawStarNode(node, p.x, p.y, this.nodeRadius(id), {
      hover: id === this.hoverId,
      center: id === this.centerId,
      alphaScale: this._alphaOf(id),
    });
  }

  // 边叠加层：仅画当前邻域内存在的边（无向匹配 pairSet）
  _drawEdgeOverlay(pairSet, color, width) {
    if (!pairSet || pairSet.size === 0) return;
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = width / Math.sqrt(this.camera.scale);
    for (const e of this.layout.edges) {
      if (!pairSet.has([e.from, e.to].sort().join('|'))) continue;
      const a = this.posOf(e.from);
      const b = this.posOf(e.to);
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 导航路线节点外环（金色）
  _drawNodeRings() {
    if (this.highlight.nodes.size === 0) return;
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = '#ffe27a';
    ctx.shadowColor = 'rgba(255,226,122,0.7)';
    ctx.shadowBlur = 10;
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 2 / this.camera.scale;
    for (const id of this.highlight.nodes) {
      const p = this.posOf(id);
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, this.nodeRadius(id) + 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawBadge(id, count) {
    const { ctx } = this;
    const p = this.posOf(id);
    if (!p) return;
    const r = this.nodeRadius(id);
    const bx = p.x + (r + 11) * 0.72;
    const by = p.y - (r + 11) * 0.72;
    ctx.save();
    ctx.fillStyle = 'rgba(30,38,66,0.95)';
    ctx.strokeStyle = 'rgba(196,141,255,0.8)';
    ctx.lineWidth = 1 / this.camera.scale;
    ctx.beginPath();
    ctx.arc(bx, by, 8.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#d7b8ff';
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`+${count}`, bx, by + 0.5);
    ctx.restore();
    const s = this.toScreen(bx, by);
    this.badges.push({ id, x: s.x, y: s.y });
  }

  _drawLabels() {
    const { ctx, camera } = this;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const [id, p] of this.layout.pos) {
      const pos = this.posOf(id);
      if (!pos) continue;
      const isCenter = id === this.centerId;
      // 缩放太小时只画中心与悬停标签，避免拥挤
      if (!isCenter && id !== this.hoverId && camera.scale < 0.5) continue;
      const node = this.nodesById[id] ?? {};
      const r = this.nodeRadius(id);
      ctx.font = `${isCenter ? '600 13px' : '11px'} system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.fillStyle =
        node.state === 'dim'
          ? 'rgba(170,180,210,0.55)'
          : isCenter
            ? 'rgba(255,255,255,0.95)'
            : 'rgba(226,232,255,0.8)';
      ctx.fillText(node.title ?? id, pos.x, pos.y + r + 5);
    }
    ctx.restore();
  }
}

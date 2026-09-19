// Canvas 2D 星图渲染器（自研，无图库依赖）—— 中心视图
// 职责：对角线与环带参考线 / 连线（仅前置·后续主干；相关不再连线）/ 星点（四态亮度+内容状态描边）
//      相关节点以「流星」形式在左右区划过（尾部渐变淡出、速度适中）/ 导航方向箭头 / 命中检测
// 相机、星空背景、星点绘制等通用能力在 canvasBase.js（宏观视图共用）。
import { CanvasStage, drawSparkleStar, STATE_STYLE } from './canvasBase.js';
import { hashStr, mulberry32 } from './macroLayout.js';

const DEG = Math.PI / 180;

// 流星淡入淡出包络：两端淡出（屏幕外），中段满亮（屏幕内）
const fadeEnvelope = (t) => {
  if (t < 0.1) return t / 0.1;
  if (t > 0.9) return (1 - t) / 0.1;
  return 1;
};

// 连线风格：legacy 原版全亮 / skilltree 按学习状态分档（技能树）/ depth 按环带深度衰减 / trunk 只画主干
// UI 切换入口在 HomeView「连线风格」面板，模式在 renderer 内保存，setData 不清除
export const EDGE_MODES = [
  { key: 'legacy', label: '原版' },
  { key: 'skilltree', label: '技能树' },
  { key: 'depth', label: '深度' },
  { key: 'trunk', label: '主干' },
];

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
    this.edgeMode = 'skilltree'; // 连线风格（见 EDGE_MODES）
    // 次级网络（相关关系）：默认折叠 —— 相关节点只画流星；展开后改用相关连线（紫色虚线）
    this.showRelated = false;
    // 叠加层：导航路线（金色发光）与热门路径（青色），跨 setData 保持
    this.highlight = { nodes: new Set(), edges: new Set() };
    this.hotEdges = new Set();
    // 切换动画（1c）：模拟进行时每帧由 StarMap.vue 注入动态坐标/透明度，null=用精确布局
    this.animPos = null; // Map<id, {x,y}>
    this.animAlpha = null; // Map<id, 0~1>
    this.animEdges = null; // 动画期间的新旧边并集（离开节点的边随之淡出）
    this.particles = null; // 星光拼形粒子（1d）：{ points:[{x,y,alpha,r}], caption } | null
    // 相关节点流星（左右区，无连线）：id -> { tangent, phase }；由 StarMap 的 rAF 循环推进 meteorTime
    this.meteors = new Map();
    this.meteorTime = 0;
    this.navNextId = null; // 导航「下一节点」id（后续指向导航终点，画方向箭头）
    // 可调界面要素（开发者模式注入，默认近似值）
    this.meteorSpeed = 50; // 流星屏幕速度 px/s
    this.meteorTail = 44; // 流星尾迹长度 px
    this.nodeScale = 1; // 节点大小倍率
    this.centerFontScale = 1; // 中心视图字号倍率
    this.edgeScale = 1; // 连线粗细倍率
    this.stretch = null; // 页面长宽比拉伸 { x, y }（参考环线用）
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

  // 次级网络（相关关系）：默认折叠（相关节点画流星），展开后改用相关连线
  setRelatedVisible(v) {
    const next = Boolean(v);
    if (next === this.showRelated) return;
    this.showRelated = next;
    this._rebuildMeteors(); // 折/展切换会改变"哪些节点有连线"，流星表要跟着重建
  }

  setData({ layout, nodesById, centerId }) {
    this.layout = layout;
    this.nodesById = nodesById;
    this.centerId = centerId;
    this._rebuildMeteors();
  }

  nodeRadius(id) {
    const base = id === this.centerId ? 15 : Math.max(5.5, 10 - (this.layout?.depth.get(id) ?? 1) * 1.2);
    return base * this.nodeScale;
  }

  // ---- 相关节点流星（左右区，无连线）----
  // 规则：存在连线（前置/后续主干边）的节点不生成流星，保持静态星；仅「纯相关」节点以流星呈现。
  // 轨迹：沿所在环切线方向的一条直线，从屏幕外飞入、穿过节点位置、再飞出屏幕（真正的流星），
  // 中段满亮、两端淡出（屏幕外）。屏幕速度恒定 = METEOR_PX_PER_S（3 秒走 1 厘米），与缩放无关。
  _rebuildMeteors() {
    this.meteors.clear();
    this.meteorTime = 0;
    // 有连线的节点集合（相关边默认不连线，不算；展开次级网络后要算）
    const hasLine = new Set();
    for (const e of this.layout?.edges ?? []) {
      if (e.kind === 'related' && !this.showRelated) continue;
      hasLine.add(e.from);
      hasLine.add(e.to);
    }
    for (const [id, p] of this.layout?.pos ?? []) {
      if (p.sector !== 'left' && p.sector !== 'right') continue;
      if (hasLine.has(id)) continue; // 存在连线 → 不生成流星
      const a = (p.angle ?? Math.atan2(p.y, p.x)) * DEG;
      const rand = mulberry32(hashStr(id));
      this.meteors.set(id, {
        tangent: { x: -Math.sin(a), y: Math.cos(a) },
        phase: rand(), // 0~1，错开相位
      });
    }
  }

  _isMeteor(id) {
    return this.meteors.has(id);
  }

  // 轨迹半径：视口半对角线 + 余量（世界单位），保证两端都在屏幕外，随缩放自适应
  _meteorReach() {
    const halfW = (this.width / 2) / (this.camera.scale || 1);
    const halfH = (this.height / 2) / (this.camera.scale || 1);
    return Math.hypot(halfW, halfH) + 80;
  }

  // 单向划过：从 -reach 飞到 +reach（穿过节点位置中点），alpha 两端淡出。
  // 屏幕速度恒定：世界速度 = 屏幕速度 / scale，故缩放时流星在屏幕上的快慢不变。
  _meteorState(id) {
    const m = this.meteors.get(id);
    if (!m) return { offset: 0, alpha: 0 };
    const reach = this._meteorReach();
    const total = 2 * reach;
    const worldSpeed = this.meteorSpeed / (this.camera.scale || 1);
    const dist = (this.meteorTime * worldSpeed + m.phase * total) % total;
    const offset = dist - reach; // -reach .. +reach
    const t = (offset + reach) / total; // 0..1
    return { offset, alpha: fadeEnvelope(t) };
  }

  _meteorOffset(id) {
    const m = this.meteors.get(id);
    if (!m) return { x: 0, y: 0, alpha: 0 };
    const st = this._meteorState(id);
    return { x: m.tangent.x * st.offset, y: m.tangent.y * st.offset, alpha: st.alpha };
  }

  // 推进流星动画（StarMap.vue 的 rAF 循环调用）
  tickMeteors(dt) {
    this.meteorTime += Math.min(dt, 1 / 30);
  }

  // 切换连线风格（校验 key）
  setEdgeMode(mode) {
    if (!EDGE_MODES.some((m) => m.key === mode)) return;
    this.edgeMode = mode;
  }

  // ---- 命中检测（屏幕坐标）----
  hitTest(sx, sy) {
    if (!this.layout) return null;
    const w = this.toWorld(sx, sy);
    let best = null;
    let bestDist = Infinity;
    for (const id of this.layout.pos.keys()) {
      const p = this.posOf(id);
      if (!p) continue;
      const r = this.nodeRadius(id) + 4 / this.camera.scale;
      // 流星即节点、无固定星位：只命中当前流星头位置；其余节点命中家位置
      let px = p.x;
      let py = p.y;
      if (this._isMeteor(id)) {
        const off = this._meteorOffset(id);
        px = p.x + off.x;
        py = p.y + off.y;
      }
      const d = Math.hypot(w.x - px, w.y - py);
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
    // 动画期间：边取新旧并集（离开节点的边随之淡出）；相关连线默认折叠，展开后照画
    const activeEdges = this.animEdges ?? this.layout.edges;
    for (const e of activeEdges) {
      if (e.kind === 'related' && !this.showRelated) continue;
      this._drawEdge(e);
    }
    this._drawEdgeOverlay(this.hotEdges, '#4be1e1', 2.6); // 热门路径：青色
    this._drawEdgeOverlay(this.highlight.edges, '#ffe27a', 3); // 导航路线：金色（相关边仅此途径连线）
    this._drawNavGuide(); // 导航方向指示（中心 → 下一节点，后续指向导航终点）
    // 节点：相关节点画流星，其余（中心/前置/后续）画星点
    const drawIds = this.animPos ? [...this.animPos.keys()] : [...this.layout.pos.keys()];
    for (const id of drawIds) {
      const p = this.posOf(id);
      if (!p) continue;
      if (this._isMeteor(id)) this._drawMeteor(id, p);
      else this._drawNode(id, p);
    }
    this._drawNodeRings();
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
          ctx.globalAlpha = Math.min(0.95, p.alpha); // 正常 0.95；消散相随 alpha 淡出
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
    const sx = this.stretch?.x ?? 1;
    const sy = this.stretch?.y ?? 1;
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
    // 同心环参考线（按页面长宽比画椭圆；半径取该环任一节点的未拉伸半径）
    const ringRadius = new Map();
    for (const [id, p] of this.layout.pos) {
      const d = this.layout.depth.get(id);
      if (d > 0 && !ringRadius.has(d)) ringRadius.set(d, Math.hypot(p.x / sx, p.y / sy));
    }
    ctx.strokeStyle = 'rgba(148,163,255,0.05)';
    for (const r of ringRadius.values()) {
      ctx.beginPath();
      ctx.ellipse(0, 0, r * sx, r * sy, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 按当前连线风格计算边的透明度/线宽/是否呼吸脉冲
  _styleForEdge(e, st, hot) {
    if (this.edgeMode === 'legacy') {
      return { alpha: hot ? 1 : 0.9, width: st.width, pulse: false };
    }
    if (this.edgeMode === 'depth') {
      const d = Math.max(
        this.layout.depth.get(e.from) ?? 0,
        this.layout.depth.get(e.to) ?? 0,
      );
      let alpha = d <= 0 ? 0.95 : d === 1 ? 0.8 : d === 2 ? 0.45 : 0.24;
      if (e.kind === 'related') alpha *= 0.6;
      if (this.hoverId) alpha = hot ? 1 : alpha * 0.3;
      return { alpha, width: st.width * (d <= 1 ? 1 : 0.85), pulse: false };
    }
    if (this.edgeMode === 'trunk') {
      let alpha = 0.85;
      if (this.hoverId) alpha = hot ? 1 : alpha * 0.25;
      return { alpha, width: st.width, pulse: false };
    }
    // skilltree：按两端节点学习状态分档（dim 未解锁 / open 可解锁 / passed 已通关 / lit 点亮）
    const stateOf = (id) => this.nodesById[id]?.state ?? 'dim';
    const s1 = stateOf(e.from);
    const s2 = stateOf(e.to);
    const bright = (s) => s === 'lit' || s === 'passed';
    const b1 = bright(s1);
    const b2 = bright(s2);
    let alpha;
    if (b1 && b2) alpha = 0.85; // 已点亮的树枝
    else if (b1 || b2) {
      const other = b1 ? s2 : s1;
      alpha = other === 'open' ? 0.55 : other === 'dim' ? 0.2 : 0.6;
    } else if (s1 === 'open' || s2 === 'open') alpha = 0.4; // 可解锁域
    else alpha = 0.1; // 未探索迷雾
    if (e.kind === 'related') alpha *= 0.6;
    // 与中心直连的边保持焦点（本卡「来路」清晰）
    if (e.from === this.centerId || e.to === this.centerId) alpha = Math.min(1, alpha * 1.3);
    // 可解锁边呼吸脉冲：一端已学（lit/passed）一端可点（open）；hover 聚焦时暂停呼吸
    const pulse = !this.hoverId && (b1 || b2) && (b1 ? s2 : s1) === 'open';
    if (this.hoverId) alpha = hot ? 1 : alpha * 0.25;
    return { alpha, width: st.width, pulse };
  }

  _drawEdge(e) {
    const { ctx } = this;
    const a = this.posOf(e.from);
    const b = this.posOf(e.to);
    if (!a || !b) return;
    const st = EDGE_STYLE[e.kind] ?? EDGE_STYLE.related;
    const hot = this.hoverId && (e.from === this.hoverId || e.to === this.hoverId);
    const s = this._styleForEdge(e, st, hot);
    let alpha = s.alpha;
    if (s.pulse) alpha += 0.12 * Math.sin((performance.now() / 1000) * 2.2);
    ctx.save();
    ctx.strokeStyle = st.color;
    // 动画淡入淡出：边透明度跟随两端点较小者
    ctx.globalAlpha = alpha * Math.min(this._alphaOf(e.from), this._alphaOf(e.to));
    ctx.lineWidth = ((s.width + (hot ? 0.8 : 0)) * this.edgeScale) / Math.sqrt(this.camera.scale);
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

  // 相关节点流星（即节点本身，无固定星位）：头部状态色小星芒 + 尾部渐变淡出，
  // 名称跟在尾迹上（首字靠近流星头、字正立），首尾随 alpha 淡入淡出
  _drawMeteor(id, p) {
    const { ctx, camera } = this;
    const m = this.meteors.get(id);
    if (!m) return;
    const st = this._meteorState(id);
    const hx = p.x + m.tangent.x * st.offset;
    const hy = p.y + m.tangent.y * st.offset;
    const node = this.nodesById[id] ?? {};
    const stateStyle = STATE_STYLE[node.state] ?? STATE_STYLE.dim;
    const r = this.nodeRadius(id);
    const alpha = this._alphaOf(id) * st.alpha;

    // 尾迹：沿运动反方向渐变（紫罗兰，暗示「相关」；随亮度淡出）
    const tailLen = this.meteorTail / Math.sqrt(camera.scale); // 屏幕恒定尾迹长度
    const tx = -m.tangent.x;
    const ty = -m.tangent.y;
    const grad = ctx.createLinearGradient(hx, hy, hx + tx * tailLen, hy + ty * tailLen);
    grad.addColorStop(0, `rgba(210,180,255,${0.85 * st.alpha})`);
    grad.addColorStop(1, 'rgba(210,180,255,0)');
    ctx.save();
    ctx.globalAlpha = 0.8 * alpha;
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.6 / Math.sqrt(camera.scale);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx + tx * tailLen, hy + ty * tailLen);
    ctx.stroke();
    ctx.restore();

    // 头部：状态色小星芒 + 光晕
    ctx.save();
    ctx.globalAlpha = stateStyle.alpha * alpha;
    if (stateStyle.glow > 0) {
      ctx.shadowColor = stateStyle.glowColor;
      ctx.shadowBlur = stateStyle.glow * Math.min(1.4, camera.scale);
    }
    ctx.fillStyle = stateStyle.fill;
    drawSparkleStar(ctx, hx, hy, r * 0.85, { arm: 1.8, core: 0.85 });
    ctx.shadowBlur = 0;
    ctx.restore();

    if (id === this.hoverId) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.2 / camera.scale;
      ctx.globalAlpha = Math.max(0.3, alpha);
      ctx.beginPath();
      ctx.arc(hx, hy, r + 3.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 名称跟在尾迹上：首字靠近流星头，沿运动反方向（尾迹方向）排布，字始终正立
    const title = node.title ?? id;
    const headR = r * 0.85;
    const gap = 13; // 字间距≈字号（中文方块字）
    const nameAlpha = this._alphaOf(id) * st.alpha;
    ctx.save();
    ctx.globalAlpha = nameAlpha;
    ctx.font = '13px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = node.state === 'dim' ? 'rgba(170,180,210,0.85)' : 'rgba(226,232,255,0.95)';
    const start = headR + gap * 0.6; // 首字中心距流星头
    for (let i = 0; i < title.length; i += 1) {
      const d = start + i * gap;
      ctx.fillText(title[i], hx - m.tangent.x * d, hy - m.tangent.y * d);
    }
    ctx.restore();
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

  // 导航方向指示：从中心到「下一节点」的虚线箭头（金色呼吸脉冲），后续指向导航终点
  _drawNavGuide() {
    const nextId = this.navNextId;
    if (!nextId) return;
    const a = this.posOf(this.centerId);
    const b = this.posOf(nextId);
    if (!a || !b) return;
    const { ctx, camera } = this;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const ux = dx / len;
    const uy = dy / len;
    const pulse = 0.65 + 0.35 * Math.sin((performance.now() / 1000) * 2.4);

    const sx = a.x + ux * (this.nodeRadius(this.centerId) + 8);
    const sy = a.y + uy * (this.nodeRadius(this.centerId) + 8);
    const ex = b.x - ux * (this.nodeRadius(nextId) + 10);
    const ey = b.y - uy * (this.nodeRadius(nextId) + 10);

    ctx.save();
    ctx.strokeStyle = `rgba(255,226,122,${0.5 * pulse})`;
    ctx.lineWidth = 1.6 / camera.scale;
    ctx.setLineDash([4 / camera.scale, 6 / camera.scale]);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    // 箭头头部（指向下一节点）
    const headLen = 8 / camera.scale;
    ctx.setLineDash([]);
    ctx.fillStyle = `rgba(255,226,122,${0.85 * pulse})`;
    ctx.beginPath();
    ctx.moveTo(ex + ux * headLen, ey + uy * headLen);
    ctx.lineTo(ex - uy * headLen * 0.5, ey + ux * headLen * 0.5);
    ctx.lineTo(ex + uy * headLen * 0.5, ey - ux * headLen * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawLabels() {
    const { camera } = this;
    for (const [id, p] of this.layout.pos) {
      if (this._isMeteor(id)) continue; // 流星名称沿尾迹绘制，见 _drawMeteor
      const pos = this.posOf(id); // 流星节点标签固定在家位置（不随流星头移动/淡出）
      if (!pos) continue;
      const isCenter = id === this.centerId;
      // 缩得过小时只画中心与悬停标签，避免拥挤（屏幕恒定字号下仍保持可读）
      if (!isCenter && id !== this.hoverId && camera.scale < 0.5) continue;
      const node = this.nodesById[id] ?? {};
      const r = this.nodeRadius(id);
      const fontPx = Math.round((isCenter ? 15 : 13) * this.centerFontScale);
      this.drawScreenText(node.title ?? id, pos.x, pos.y + r + 5, {
        font: `${isCenter ? 600 : 400} ${fontPx}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`,
        fill:
          node.state === 'dim'
            ? 'rgba(170,180,210,0.7)'
            : isCenter
              ? 'rgba(255,255,255,0.95)'
              : 'rgba(226,232,255,0.85)',
        align: 'center',
        baseline: 'top',
      });
    }
  }
}

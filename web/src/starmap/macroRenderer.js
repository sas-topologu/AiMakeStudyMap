// 宏观视图渲染器：一体大地图（所有学科合并为连续世界，模仿游戏地图连续缩放）
// 复用 canvasBase.js 的相机/星空/星点绘制；布局数据来自 macroLayout.js（纯函数）
//
// LOD 四档（按相机 scale 连续过渡，阈值均为可调常量）：
//   星系（scale < GALAXY）：全景——学科星系星云 + 名称标签（缩小看大片星空与星云）
//   星团（GALAXY~CLUSTER）：网格聚合星团——视口内节点分桶，桶绘发光星团（亮度∝节点数），
//                          桶间有同学科 prerequisite 边则绘星座连线，星团上标聚合数
//   中档（CLUSTER~NODE）：离散节点小点（无标题）+ 同学科 prerequisite 主干连线
//   节点（scale > NODE）：完整离散节点网络——四态亮度+可信度描边+标题，可点击；
//                          连线按学习状态分档（仿中心视图技能树模式）+ hover 聚焦；
//                          相关线每节点最多 3 条；跨学科边淡化为细虚线（不横穿全图）
// 相邻档位 ±FADE 区间内两档叠加淡入淡出，平滑切换。
// 视口裁剪：每帧只处理 visibleWorldRect 内的单元，帧耗 O(可见单元)。
//
// 阶段 5 预留：setHighlight({ nodes, edges, subjects }) 叠加"路线高亮"层——
// 节点档绘制时叠加描边加粗的高亮边与节点外环，星系层给涉及学科加金色外环。
import { CanvasStage, STATE_STYLE } from './canvasBase.js';
import { bucketize, bucketKeyOf, mulberry32, hashStr } from './macroLayout.js';

export const LOD = {
  GALAXY: 0.32, // scale 低于此 → 星系星云档（全景）
  CLUSTER: 0.5, // 低于此（且高于 GALAXY）→ 星团档
  NODE: 1.4, // 高于此 → 节点档
  FADE: 0.25, // 阈值附近淡入淡出区间（相对 ±25%）
  CELL_PX: 96, // 聚合网格的屏幕基准边长（像素）
  EXIT: 0.16, // 兼容保留（一体地图后不再使用）
};

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const fadeIn = (scale, threshold) =>
  clamp01((scale - threshold * (1 - LOD.FADE)) / (threshold * 2 * LOD.FADE));

const RELATED_MAX_NODE = 3; // 节点档：每节点最多显示的相关线条数（仿中心视图折叠，无徽标）

// 星系对之间跨学科联系：统计跨学科边数（key: subjA|subjB 字典序）
function crossSubjectPairs(edges, nodesById) {
  const pairs = new Map();
  for (const e of edges) {
    const sa = nodesById[e.from]?.subject ?? '';
    const sb = nodesById[e.to]?.subject ?? '';
    if (!sa || !sb || sa === sb) continue;
    const key = sa < sb ? `${sa}|${sb}` : `${sb}|${sa}`;
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
  }
  return pairs;
}

// 相关线截断：节点 related 边超阈值时按另一端 id 排序保留前 N 条，其余隐藏
function collapseRelated(edges) {
  const relatedByNode = new Map();
  for (const e of edges) {
    if (e.type !== 'related') continue;
    for (const id of [e.from, e.to]) {
      if (!relatedByNode.has(id)) relatedByNode.set(id, []);
      relatedByNode.get(id).push(e);
    }
  }
  const hidden = new Set();
  for (const [id, list] of relatedByNode) {
    if (list.length <= RELATED_MAX_NODE) continue;
    const sorted = [...list].sort((a, b) => {
      const oa = a.from === id ? a.to : a.from;
      const ob = b.from === id ? b.to : b.from;
      return oa < ob ? -1 : 1;
    });
    for (const e of sorted.slice(RELATED_MAX_NODE)) hidden.add(e);
  }
  return new Set(edges.filter((e) => e.type === 'related' && !hidden.has(e)));
}

// 四档权重（同帧可能多档叠加，处于过渡带）
export function worldWeights(scale) {
  const galaxy = 1 - fadeIn(scale, LOD.GALAXY);
  const cluster = fadeIn(scale, LOD.GALAXY) * (1 - fadeIn(scale, LOD.CLUSTER));
  const node = fadeIn(scale, LOD.NODE);
  const mid = Math.max(0, 1 - galaxy - cluster - node);
  return { galaxy, cluster, mid, node };
}

// 兼容旧调用（星团/节点两档）：一体地图后仅节点档判断仍会用到
const lodWeights = (scale) => {
  const w = worldWeights(scale);
  return { cluster: w.cluster, mid: w.mid, node: w.node };
};

export class MacroRenderer extends CanvasStage {
  constructor(canvas) {
    super(canvas);
    this.data = null; // 世界数据：{ galaxies, nodes, nodesById, edges, pos, visibleRelated }
    this.hoverTarget = null;
    this.frameClusters = []; // 本帧星团（hitTest 用，屏幕坐标）
    // 叠加层：导航路线（金色，nodes/edges/subjects）与热门路径（青色）
    this.highlight = { nodes: new Set(), edges: new Set(), subjects: new Set() };
    this.hotEdges = new Set();
  }

  // ---- 数据 ----
  setWorld({ galaxies, nodes, edges, pos }) {
    const nodesById = Object.fromEntries(nodes.map((n) => [n.id, n]));
    // 预计算跨学科边标志（渲染时跨学科长线淡化/不画）
    const edgesMeta = edges.map((e) => ({
      ...e,
      cross: (nodesById[e.from]?.subject ?? '') !== (nodesById[e.to]?.subject ?? ''),
    }));
    this.data = {
      galaxies: galaxies.map((g) => {
        const rand = mulberry32(hashStr(g.subject));
        const sparkleCount = Math.min(240, 6 + Math.round(g.count * 2.2));
        const sparkles = Array.from({ length: sparkleCount }, () => {
          const a = rand() * Math.PI * 2;
          const d = Math.sqrt(rand()) * g.r * 0.82; // 圆盘均匀分布
          return {
            dx: Math.cos(a) * d,
            dy: Math.sin(a) * d,
            r: rand() * 1.6 + 0.5,
            a: rand() * 0.6 + 0.3,
            twPhase: rand() * Math.PI * 2, // 呼吸闪烁相位（错开）
            twSpeed: 0.5 + rand() * 1.5, // 闪烁角速度
          };
        });
        return { ...g, sparkles, glow: Math.min(0.55, 0.22 + 0.035 * Math.sqrt(g.count)) };
      }),
      nodes,
      nodesById,
      edges: edgesMeta,
      pos,
      visibleRelated: collapseRelated(edgesMeta), // 相关线截断（每节点最多 RELATED_MAX_NODE 条）
      crossPairs: crossSubjectPairs(edgesMeta, nodesById), // 星系对之间跨学科联系（星空连成一片）
    };
    this.hoverTarget = null;
    this.frameClusters = [];
  }

  // 阶段 5 路线高亮：nodes=[id...]，edges=[{from,to}...]（无向匹配），subjects=[学科…]（星系层外环）
  setHighlight({ nodes = [], edges = [], subjects = [] } = {}) {
    this.highlight = {
      nodes: new Set(nodes),
      edges: new Set(edges.map((e) => [e.from, e.to].sort().join('|'))),
      subjects: new Set(subjects),
    };
  }

  // 热门路径：[{ from, to, count }]（青色，与导航金色区分）
  setHotEdges(list = []) {
    this.hotEdges = new Set(list.map((e) => [e.from, e.to].sort().join('|')));
  }

  _isEdgeHighlighted(e) {
    return this.highlight.edges.has([e.from, e.to].sort().join('|'));
  }

  // ---- 命中检测（屏幕坐标）----
  hitTest(sx, sy) {
    if (!this.data) return null;
    const weights = worldWeights(this.camera.scale);
    const w = this.toWorld(sx, sy);
    // 星系层（权重过半时星系优先命中）
    if (weights.galaxy > 0.5) {
      for (const g of this.data.galaxies) {
        if (Math.hypot(w.x - g.x, w.y - g.y) <= g.r) return { type: 'galaxy', subject: g.subject };
      }
    }
    // 节点档（含过渡带）优先命中节点
    if (weights.node > 0.3) {
      let best = null;
      let bestDist = Infinity;
      for (const [id, p] of this.data.pos) {
        const d = Math.hypot(w.x - p.x, w.y - p.y);
        if (d <= 6 + 4 / this.camera.scale && d < bestDist) {
          best = id;
          bestDist = d;
        }
      }
      if (best) return { type: 'node', id: best };
    }
    if (weights.cluster + weights.mid > 0.2) {
      for (const c of this.frameClusters) {
        if (Math.hypot(sx - c.x, sy - c.y) <= Math.max(14, c.r)) {
          return { type: 'cluster', cx: c.cx, cy: c.cy, count: c.count };
        }
      }
    }
    return null;
  }

  // ---- 渲染 ----
  render() {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawBackground();
    this.beginWorld();
    if (this.data) {
      const w = worldWeights(this.camera.scale);
      this._drawCrossLinks(w.galaxy + w.cluster); // 跨学科联系线随星系/星团层淡入淡出
      if (w.galaxy > 0.02) this._drawGalaxies(w.galaxy);
      if (w.cluster > 0.02) this._drawClusters(w.cluster);
      if (w.mid > 0.02) this._drawMid(w.mid);
      if (w.node > 0.02) this._drawNear(w.node);
    }
    ctx.restore();
  }

  // 星系间跨学科联系线：知识互有关联，星空连成一片（亮度/粗细∝跨学科边数）
  _drawCrossLinks(alpha) {
    const { ctx, camera } = this;
    if (!this.data?.crossPairs?.size || alpha <= 0.02) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(158,176,228,0.55)';
    ctx.setLineDash([6 / camera.scale, 7 / camera.scale]);
    for (const [key, count] of this.data.crossPairs) {
      const [sa, sb] = key.split('|');
      const ga = this.data.galaxies.find((g) => g.subject === sa);
      const gb = this.data.galaxies.find((g) => g.subject === sb);
      if (!ga || !gb) continue;
      ctx.globalAlpha = Math.min(0.5, 0.1 + count * 0.06) * alpha;
      ctx.lineWidth = (0.8 + Math.min(1.1, count * 0.18)) / camera.scale;
      ctx.beginPath();
      ctx.moveTo(ga.x, ga.y);
      ctx.lineTo(gb.x, gb.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawGalaxies(alpha) {
    const { ctx, camera } = this;
    const rect = this.visibleWorldRect(160);
    const hoverSubject = this.hoverTarget?.type === 'galaxy' ? this.hoverTarget.subject : null;
    for (const g of this.data.galaxies) {
      if (g.x + g.r < rect.x0 || g.x - g.r > rect.x1 || g.y + g.r < rect.y0 || g.y - g.r > rect.y1) {
        continue; // 视口裁剪
      }
      const hot = g.subject === hoverSubject;
      const glow = g.glow * (hot ? 1.5 : 1) * alpha;
      const grad = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.r);
      grad.addColorStop(0, `rgba(214,228,255,${Math.min(0.95, glow + 0.25)})`);
      grad.addColorStop(0.45, `rgba(122,162,255,${glow})`);
      grad.addColorStop(1, 'rgba(122,162,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2);
      ctx.fill();

      // 星云内部亮点（节点聚合发光，呼吸闪烁）
      ctx.fillStyle = '#e8efff';
      const t = performance.now() / 1000;
      for (const s of g.sparkles) {
        const tw = 0.7 + 0.3 * Math.sin(t * s.twSpeed + s.twPhase); // 闪烁 0.7~1.0
        ctx.globalAlpha = Math.min(1, s.a * tw * (hot ? 1 : 0.85) * alpha);
        ctx.beginPath();
        ctx.arc(g.x + s.dx, g.y + s.dy, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (hot) {
        ctx.strokeStyle = `rgba(190,215,255,${0.8 * alpha})`;
        ctx.lineWidth = 1.5 / camera.scale;
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.r + 4 / camera.scale, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 导航路线覆盖的学科：金色外环提示
      if (this.highlight.subjects.has(g.subject)) {
        ctx.save();
        ctx.strokeStyle = '#ffe27a';
        ctx.shadowColor = 'rgba(255,226,122,0.7)';
        ctx.shadowBlur = 12;
        ctx.globalAlpha = 0.9 * alpha;
        ctx.lineWidth = 2.2 / camera.scale;
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.r + 7 / camera.scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // 学科名 + 节点数（屏幕恒定字号）
      ctx.fillStyle = `rgba(226,232,255,${0.95 * alpha})`;
      ctx.font = `600 ${15 / camera.scale}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(g.subject, g.x, g.y + g.r + 8 / camera.scale);
      ctx.fillStyle = `rgba(139,149,184,${0.9 * alpha})`;
      ctx.font = `${11 / camera.scale}px system-ui, sans-serif`;
      ctx.fillText(`${g.count} 节点`, g.x, g.y + g.r + 26 / camera.scale);
    }
  }

  // 聚合网格边长（世界单位，按 2 的幂量化，避免缩放时桶抖动）
  _cellWorld() {
    const raw = LOD.CELL_PX / this.camera.scale;
    return Math.max(32, 2 ** Math.ceil(Math.log2(raw)));
  }

  _visibleNodes(rect) {
    const out = [];
    for (const [id, p] of this.data.pos) {
      if (p.x >= rect.x0 && p.x <= rect.x1 && p.y >= rect.y0 && p.y <= rect.y1) {
        out.push({ id, x: p.x, y: p.y });
      }
    }
    return out;
  }

  // 远档：星团聚合
  _drawClusters(alpha) {
    const { ctx, camera } = this;
    const cell = this._cellWorld();
    const rect = this.visibleWorldRect(cell);
    const buckets = bucketize(this._visibleNodes(rect), cell);

    // 桶间星座连线（prerequisite 主干）
    ctx.save();
    ctx.globalAlpha = 0.35 * alpha;
    ctx.strokeStyle = '#6ea8ff';
    ctx.lineWidth = 1.2 / camera.scale;
    const drawn = new Set();
    for (const e of this.data.edges) {
      if (e.type !== 'prerequisite' || e.cross) continue; // 跨学科长线在星团档不画
      const a = this.data.pos.get(e.from);
      const b = this.data.pos.get(e.to);
      if (!a || !b) continue;
      const ka = bucketKeyOf(a.x, a.y, cell);
      const kb = bucketKeyOf(b.x, b.y, cell);
      if (ka === kb) continue;
      const ba = buckets.get(ka);
      const bb = buckets.get(kb);
      if (!ba || !bb) continue;
      const pair = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (drawn.has(pair)) continue;
      drawn.add(pair);
      ctx.beginPath();
      ctx.moveTo(ba.cx, ba.cy);
      ctx.lineTo(bb.cx, bb.cy);
      ctx.stroke();
    }
    ctx.restore();

    // 星团本体
    this.frameClusters = [];
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const b of buckets.values()) {
      const r = Math.min(cell * 0.55, cell * (0.2 + 0.09 * Math.sqrt(b.count)));
      const glow = Math.min(0.9, 0.4 + 0.09 * Math.sqrt(b.count)) * alpha;
      const grad = ctx.createRadialGradient(b.cx, b.cy, 0, b.cx, b.cy, r);
      grad.addColorStop(0, `rgba(205,222,255,${glow})`);
      grad.addColorStop(0.55, `rgba(122,162,255,${glow * 0.55})`);
      grad.addColorStop(1, 'rgba(122,162,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(b.cx, b.cy, r, 0, Math.PI * 2);
      ctx.fill();

      // 光晕内撒点（数量∝桶内节点，角度确定性）
      ctx.fillStyle = `rgba(232,239,255,${0.85 * alpha})`;
      const dots = Math.min(12, b.count);
      for (let i = 0; i < dots; i += 1) {
        const a = i * 2.399963; // 黄金角
        const d = Math.sqrt((i + 0.5) / dots) * r * 0.62;
        ctx.beginPath();
        ctx.arc(b.cx + Math.cos(a) * d, b.cy + Math.sin(a) * d, 1.4 / camera.scale + 0.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // 聚合数
      ctx.fillStyle = `rgba(255,255,255,${0.9 * alpha})`;
      ctx.font = `600 ${12 / camera.scale}px system-ui, sans-serif`;
      ctx.fillText(String(b.count), b.cx, b.cy);

      const s = this.toScreen(b.cx, b.cy);
      this.frameClusters.push({ cx: b.cx, cy: b.cy, x: s.x, y: s.y, r: r * camera.scale, count: b.count });
    }
    ctx.restore();
  }

  // 中档：离散节点（无标题）+ prerequisite 主干
  _drawMid(alpha) {
    const { ctx, camera } = this;
    const rect = this.visibleWorldRect(30 / camera.scale);

    ctx.save();
    ctx.strokeStyle = '#6ea8ff';
    ctx.globalAlpha = 0.4 * alpha;
    ctx.lineWidth = 1 / camera.scale;
    for (const e of this.data.edges) {
      if (e.type !== 'prerequisite' || e.cross) continue; // 跨学科长线在中档不画
      const a = this.data.pos.get(e.from);
      const b = this.data.pos.get(e.to);
      if (!a || !b) continue;
      if ((a.x < rect.x0 && b.x < rect.x0) || (a.x > rect.x1 && b.x > rect.x1)) continue;
      if ((a.y < rect.y0 && b.y < rect.y0) || (a.y > rect.y1 && b.y > rect.y1)) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = alpha;
    for (const it of this._visibleNodes(rect)) {
      const node = this.data.nodesById[it.id];
      const st = STATE_STYLE[node?.state] ?? STATE_STYLE.dim;
      ctx.fillStyle = st.fill;
      ctx.beginPath();
      ctx.arc(it.x, it.y, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    this._drawHighlight(alpha);
    this._drawHotEdges(alpha);
  }

  // 近档：完整离散节点网络（连线按学习状态分档 + hover 聚焦）
  _drawNear(alpha) {
    const { ctx, camera } = this;
    const rect = this.visibleWorldRect(60 / camera.scale);
    const hoverId = this.hoverTarget?.type === 'node' ? this.hoverTarget.id : null;
    const stateOf = (id) => this.data.nodesById[id]?.state ?? 'dim';
    const bright = (s) => s === 'lit' || s === 'passed';

    // 边：prerequisite 按两端学习状态分档（仿中心视图技能树模式）；
    // related 截断显示为细虚线；跨学科边淡化为长虚线（联系提示，不横穿）
    for (const e of this.data.edges) {
      const a = this.data.pos.get(e.from);
      const b = this.data.pos.get(e.to);
      if (!a || !b) continue;
      if ((a.x < rect.x0 && b.x < rect.x0) || (a.x > rect.x1 && b.x > rect.x1)) continue;
      if ((a.y < rect.y0 && b.y < rect.y0) || (a.y > rect.y1 && b.y > rect.y1)) continue;
      const hot = hoverId && (e.from === hoverId || e.to === hoverId);
      let baseAlpha;
      let width;
      let dash = null;
      if (e.type === 'related') {
        if (!this.data.visibleRelated.has(e)) continue;
        baseAlpha = 0.22;
        width = 1;
        dash = [4 / camera.scale, 4 / camera.scale];
      } else if (e.cross) {
        baseAlpha = 0.25; // 跨学科边：淡虚线（学科间联系提示）
        width = 1;
        dash = [3 / camera.scale, 6 / camera.scale];
      } else {
        const s1 = stateOf(e.from);
        const s2 = stateOf(e.to);
        const b1 = bright(s1);
        const b2 = bright(s2);
        if (b1 && b2) baseAlpha = 0.75; // 已点亮的树枝
        else if (b1 || b2) baseAlpha = (b1 ? s2 : s1) === 'open' ? 0.6 : 0.3; // 可解锁/未探索
        else if (s1 === 'open' || s2 === 'open') baseAlpha = 0.45;
        else baseAlpha = 0.12; // 未探索迷雾
        width = 1.1;
      }
      ctx.save();
      ctx.strokeStyle = e.type === 'related' ? 'rgba(196,141,255,0.6)' : '#6ea8ff';
      const focused = hot && !e.cross ? Math.min(1, baseAlpha + 0.4) : hoverId && !hot ? baseAlpha * 0.3 : baseAlpha;
      ctx.globalAlpha = focused * alpha;
      ctx.lineWidth = (hot ? width + 0.7 : width) / camera.scale;
      if (dash) ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    }

    // 节点（四态 + 可信度描边）
    const visible = this._visibleNodes(rect);
    for (const it of visible) {
      const node = this.data.nodesById[it.id];
      if (!node) continue;
      this.drawStarNode(node, it.x, it.y, 6, { hover: it.id === hoverId, alphaScale: alpha });
    }

    // 标题（屏幕恒定字号）
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `${11 / camera.scale}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
    for (const it of visible) {
      const node = this.data.nodesById[it.id];
      ctx.fillStyle =
        node?.state === 'dim'
          ? `rgba(170,180,210,${0.6 * alpha})`
          : `rgba(226,232,255,${0.88 * alpha})`;
      ctx.fillText(node?.title ?? it.id, it.x, it.y + 9 / camera.scale);
    }
    ctx.restore();

    this._drawHighlight(alpha);
    this._drawHotEdges(alpha);
  }

  // 阶段 5 路线高亮叠加层：高亮边加粗发光 + 高亮节点外环
  _drawHighlight(alpha) {
    const { nodes, edges } = this.highlight;
    if (nodes.size === 0 && edges.size === 0) return;
    const { ctx, camera } = this;
    ctx.save();
    ctx.strokeStyle = '#ffe27a';
    ctx.shadowColor = 'rgba(255,226,122,0.7)';
    ctx.shadowBlur = 10;
    for (const e of this.data.edges) {
      if (!this._isEdgeHighlighted(e)) continue;
      const a = this.data.pos.get(e.from);
      const b = this.data.pos.get(e.to);
      if (!a || !b) continue;
      ctx.globalAlpha = 0.95 * alpha;
      ctx.lineWidth = 3 / camera.scale;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (const id of nodes) {
      const p = this.data.pos.get(id);
      if (!p) continue;
      ctx.globalAlpha = 0.95 * alpha;
      ctx.lineWidth = 2 / camera.scale;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 热门路径叠加层：青色发光边（与导航金色区分）
  _drawHotEdges(alpha) {
    if (this.hotEdges.size === 0 || !this.data) return;
    const { ctx, camera } = this;
    ctx.save();
    ctx.strokeStyle = '#4be1e1';
    ctx.shadowColor = 'rgba(75,225,225,0.7)';
    ctx.shadowBlur = 8;
    for (const e of this.data.edges) {
      if (!this.hotEdges.has([e.from, e.to].sort().join('|'))) continue;
      const a = this.data.pos.get(e.from);
      const b = this.data.pos.get(e.to);
      if (!a || !b) continue;
      ctx.globalAlpha = 0.9 * alpha;
      ctx.lineWidth = 2.6 / camera.scale;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

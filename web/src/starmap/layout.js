// 中心视图布局：前置/后续向中轴线（垂直轴）靠拢，相关节点占左右两侧
//   后续（successor）→ 上方窄扇区；前置（prerequisite）→ 下方窄扇区；相关（related）→ 左右宽扇区
// 多层按 depth 放在同心环带上（第 d 环半径 = ringStep * d），深层节点角度归属于其父节点象限
// 导航锚点：nav.nextId/prevId 分别钉在 270°/90°，让「后续指向导航终点」
// 防碰撞：同环节点按角度均分 + 最小角距推移（简单实现，不追求完美）
const DEG = Math.PI / 180;

// 屏幕坐标系（y 向下）：0° = 右，90° = 下，180° = 左，270° = 上
// 前置/后续向中轴线（垂直轴）靠拢：不再铺满对角线半区，而是收窄为以 90°/270° 为中心的窄扇区；
// 相关节点获得两侧更宽的区域（以流星形式划过，见 renderer.js）。
export const SECTORS = {
  top: { lo: 240, hi: 300, label: '后续' }, // 中心 270°（正上方）
  bottom: { lo: 60, hi: 120, label: '前置' }, // 中心 90°（正下方）
  left: { lo: 120, hi: 240, label: '相关' },
  right: { lo: 300, hi: 420, label: '相关' }, // 跨 360°，归一化时处理
};

const SECTOR_MARGIN = 8; // 与扇区边界保持的角度余量
const MIN_GAP_DEG = 11; // 同环最小角距

const norm360 = (a) => ((a % 360) + 360) % 360;

// 在 [lo, hi] 内、避开 cuts（锚点角度）后，把 count 个角度按区间宽度比例均分。
// 用于导航锚点附近其余节点的排布：锚点两侧对称展开，其余节点自然「指向」锚点方向。
export function distributeAngles(count, lo, hi, cuts = []) {
  if (count <= 0) return [];
  const sorted = cuts
    .map(norm360)
    .filter((c) => c >= lo && c <= hi)
    .sort((a, b) => a - b);
  const intervals = [];
  let cur = lo;
  for (const c of sorted) {
    if (c - MIN_GAP_DEG > cur) intervals.push([cur, c - MIN_GAP_DEG]);
    cur = Math.max(cur, c + MIN_GAP_DEG);
  }
  if (hi - cur > 0.5) intervals.push([cur, hi]);
  if (intervals.length === 0) intervals.push([lo, hi]); // 锚点占满扇区时的兜底

  const widths = intervals.map(([a, b]) => b - a);
  const total = widths.reduce((s, w) => s + w, 0);
  const counts = widths.map((w) => Math.round((w / total) * count));
  let diff = count - counts.reduce((s, x) => s + x, 0);
  let widest = 0;
  for (let i = 1; i < widths.length; i += 1) if (widths[i] > widths[widest]) widest = i;
  counts[widest] += diff;

  const out = [];
  for (let i = 0; i < intervals.length; i += 1) {
    const [a, b] = intervals[i];
    const n = counts[i];
    for (let j = 0; j < n; j += 1) {
      out.push(n === 1 ? (a + b) / 2 : a + ((b - a) * j) / (n - 1));
    }
  }
  out.sort((x, y) => x - y);
  return out;
}

export function computeLayout({ centerId, nodes, edges, ringStep = 160, nav = null, stretch = null }) {
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  // 整体长宽比拉伸：适应页面宽高比（stretch = { x: 宽/短边, y: 高/短边 }；null 时不拉伸=圆形）
  const sx = stretch?.x ?? 1;
  const sy = stretch?.y ?? 1;

  // 邻接表（双向，排序保证确定性）
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!nodesById.has(e.from) || !nodesById.has(e.to)) continue;
    adj.get(e.from).push({ other: e.to, edge: e });
    adj.get(e.to).push({ other: e.from, edge: e });
  }
  for (const list of adj.values()) list.sort((a, b) => (a.other < b.other ? -1 : 1));

  // BFS：确定父节点与深度（渲染递归深度受服务器 depth ≤2 约束，绝不无限展开）
  const depth = new Map([[centerId, 0]]);
  const parent = new Map();
  const queue = [centerId];
  while (queue.length) {
    const cur = queue.shift();
    const d = depth.get(cur);
    if (d >= 2) continue; // 深度上限 2 层
    for (const { other } of adj.get(cur) ?? []) {
      if (!depth.has(other)) {
        depth.set(other, d + 1);
        parent.set(other, cur);
        queue.push(other);
      }
    }
  }

  // 深度 1 节点按与中心的关系分区：前置→下，后续→上，相关→左右交替
  const sectorOf = new Map();
  const relToCenter = (id) => {
    let kind = null;
    for (const { edge } of adj.get(centerId) ?? []) {
      const isThis =
        (edge.from === centerId && edge.to === id) || (edge.from === id && edge.to === centerId);
      if (!isThis) continue;
      let k = null;
      if (edge.type === 'prerequisite') {
        k = edge.from === centerId ? 'pre' : 'suc'; // from=中心 → to 是中心的前置
      } else if (edge.type === 'related') {
        k = 'rel';
      }
      // 同一对节点可能有多条边，优先级 pre > suc > rel
      if (k === 'pre') return 'pre';
      if (k === 'suc') kind = 'suc';
      else if (k === 'rel' && kind !== 'suc') kind = 'rel';
    }
    return kind ?? 'rel';
  };

  const ring1 = [...depth.entries()].filter(([, d]) => d === 1).map(([id]) => id);
  const relBucket = [];
  for (const id of ring1) {
    const kind = relToCenter(id);
    if (kind === 'pre') sectorOf.set(id, 'bottom');
    else if (kind === 'suc') sectorOf.set(id, 'top');
    else relBucket.push(id);
  }
  relBucket.sort();
  relBucket.forEach((id, i) => sectorOf.set(id, i % 2 === 0 ? 'right' : 'left'));

  // 导航锚点：下一节点钉在正上方(270°)→「后续指向导航终点」，上一节点钉在正下方(90°)
  const anchors = new Map(); // id -> { deg, sector }
  if (nav?.nextId && depth.has(nav.nextId)) anchors.set(nav.nextId, { deg: 270, sector: 'top' });
  if (nav?.prevId && depth.has(nav.prevId)) anchors.set(nav.prevId, { deg: 90, sector: 'bottom' });
  for (const [id, a] of anchors) sectorOf.set(id, a.sector);

  // 深层节点继承父节点象限
  for (let d = 2; d <= 3; d += 1) {
    for (const [id, dd] of depth) {
      if (dd === d) sectorOf.set(id, sectorOf.get(parent.get(id)) ?? 'bottom');
    }
  }

  // 逐环放置：环内按 (象限, 父节点角度, id) 排序后在象限角域内均分；锚点精确钉在目标角
  const pos = new Map([[centerId, { x: 0, y: 0, angle: null, ring: 0, sector: 'center' }]]);
  for (let d = 1; d <= 3; d += 1) {
    const r = ringStep * d;
    const ringNodes = [...depth.entries()].filter(([, dd]) => dd === d).map(([id]) => id);
    if (!ringNodes.length) continue;

    const bySector = { top: [], bottom: [], left: [], right: [] };
    for (const id of ringNodes) bySector[sectorOf.get(id) ?? 'bottom'].push(id);

    for (const [sectorName, ids] of Object.entries(bySector)) {
      if (!ids.length) continue;
      const sector = SECTORS[sectorName];
      const span = sector.hi - sector.lo;
      const margin = Math.min(SECTOR_MARGIN, span / (ids.length + 1) / 2);
      const lo = sector.lo + margin;
      const hi = sector.hi - margin;

      const anchoredIds = ids.filter((id) => anchors.has(id));
      const restIds = ids.filter((id) => !anchors.has(id));
      restIds.sort((a, b) => {
        const pa = pos.get(parent.get(a))?.angle ?? (lo + hi) / 2;
        const pb = pos.get(parent.get(b))?.angle ?? (lo + hi) / 2;
        return pa - pb || (a < b ? -1 : 1);
      });

      // 锚点精确放置
      for (const id of anchoredIds) {
        pos.set(id, { x: 0, y: 0, angle: norm360(anchors.get(id).deg), ring: d, sector: sectorName });
      }
      // 其余节点在 [lo,hi] 内、避开锚点角度均分
      const cuts = anchoredIds.map((id) => anchors.get(id).deg);
      const angles = distributeAngles(restIds.length, lo, hi, cuts);
      restIds.forEach((id, i) => {
        pos.set(id, {
          x: 0,
          y: 0,
          angle: norm360(angles[i] ?? (lo + hi) / 2),
          ring: d,
          sector: sectorName,
        });
      });
    }

    // 同环防碰撞：角距过近时沿环向后推移
    const placed = ringNodes
      .map((id) => pos.get(id))
      .sort((a, b) => a.angle - b.angle);
    for (let i = 1; i < placed.length; i += 1) {
      const gap = placed[i].angle - placed[i - 1].angle;
      if (gap < MIN_GAP_DEG) placed[i].angle = placed[i - 1].angle + MIN_GAP_DEG;
    }
    // 碰撞推移后锚点回到精确位置（其余节点已避开）
    for (const [id, a] of anchors) {
      if (depth.get(id) !== d) continue;
      const p = pos.get(id);
      if (p) p.angle = norm360(a.deg);
    }
    for (const id of ringNodes) {
      const p = pos.get(id);
      const a = p.angle * DEG;
      p.x = Math.cos(a) * r * sx; // 按页面长宽比拉伸（宽屏→横向椭圆，竖屏→纵向椭圆）
      p.y = Math.sin(a) * r * sy;
    }
  }

  // 边附加渲染类别：successor（琥珀）/ prerequisite（蓝）/ related（不再连线，仅导航高亮时叠加）
  const styledEdges = [];
  for (const e of edges) {
    if (!pos.has(e.from) || !pos.has(e.to)) continue;
    let kind = e.type;
    if (e.type === 'prerequisite') {
      // from 依赖 to；深度更浅的一端视角下，对端是后续
      const df = depth.get(e.from) ?? 0;
      const dt = depth.get(e.to) ?? 0;
      kind = df < dt ? 'successor' : 'prerequisite';
    }
    styledEdges.push({ ...e, kind });
  }

  return { pos, edges: styledEdges, depth };
}

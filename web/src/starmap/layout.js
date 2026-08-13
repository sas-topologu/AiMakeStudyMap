// 中心视图布局：屏幕两条对角线分四象限
//   后续（successor）→ 上方区；前置（prerequisite）→ 下方区；相关（related）→ 左右两区
// 多层按 depth 放在同心环带上（第 d 环半径 = ringStep * d），深层节点角度归属于其父节点象限
// 防碰撞：同环节点按角度均分 + 最小角距推移（简单实现，不追求完美）
const DEG = Math.PI / 180;

// 屏幕坐标系（y 向下）：0° = 右，90° = 下，180° = 左，270° = 上
export const SECTORS = {
  top: { lo: 225, hi: 315, label: '后续' },
  bottom: { lo: 45, hi: 135, label: '前置' },
  left: { lo: 135, hi: 225, label: '相关' },
  right: { lo: 315, hi: 405, label: '相关' }, // 跨 360°，归一化时处理
};

const SECTOR_MARGIN = 8; // 与对角线保持的角度余量
const MIN_GAP_DEG = 11; // 同环最小角距

const norm360 = (a) => ((a % 360) + 360) % 360;

export function computeLayout({ centerId, nodes, edges, ringStep = 160 }) {
  const nodesById = new Map(nodes.map((n) => [n.id, n]));

  // 邻接表（双向，排序保证确定性）
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!nodesById.has(e.from) || !nodesById.has(e.to)) continue;
    adj.get(e.from).push({ other: e.to, edge: e });
    adj.get(e.to).push({ other: e.from, edge: e });
  }
  for (const list of adj.values()) list.sort((a, b) => (a.other < b.other ? -1 : 1));

  // BFS：确定父节点与深度（渲染递归深度受服务器 depth ≤3 约束，绝不无限展开）
  const depth = new Map([[centerId, 0]]);
  const parent = new Map();
  const queue = [centerId];
  while (queue.length) {
    const cur = queue.shift();
    const d = depth.get(cur);
    if (d >= 3) continue; // 深度上限 3 层
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

  // 深层节点继承父节点象限
  for (let d = 2; d <= 3; d += 1) {
    for (const [id, dd] of depth) {
      if (dd === d) sectorOf.set(id, sectorOf.get(parent.get(id)) ?? 'bottom');
    }
  }

  // 逐环放置：环内按 (象限, 父节点角度, id) 排序后在象限角域内均分
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
      ids.sort((a, b) => {
        const pa = pos.get(parent.get(a))?.angle ?? (lo + hi) / 2;
        const pb = pos.get(parent.get(b))?.angle ?? (lo + hi) / 2;
        return pa - pb || (a < b ? -1 : 1);
      });
      ids.forEach((id, i) => {
        const angle = ids.length === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * i) / (ids.length - 1);
        pos.set(id, { x: 0, y: 0, angle: norm360(angle), ring: d, sector: sectorName });
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
    for (const id of ringNodes) {
      const p = pos.get(id);
      const a = p.angle * DEG;
      p.x = Math.cos(a) * r;
      p.y = Math.sin(a) * r;
    }
  }

  // 边附加渲染类别：successor（琥珀）/ prerequisite（蓝）/ related（紫虚线）
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

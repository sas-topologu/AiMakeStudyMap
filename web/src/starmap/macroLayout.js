// 宏观视图布局（纯函数，与渲染解耦，便于单测/压测复用）
// - layoutUniverse：宇宙视图，学科星系沿椭圆分布，返回每星系锚点与半径
// - layoutConstellation：星座视图，学科内按 prerequisite DAG 最长路径分层
//   （y=层次向上，x=同层均布；related 不参与定位；坐标确定性：同数据同结果）
// - bucketize：网格聚合（星团档 LOD 用）
// - makeSyntheticGraph：合成压测数据（确定性 PRNG）
const DEG = Math.PI / 180;

// ---- 宇宙视图 ----
// subjects: [{ subject, count }] → Map<subject, { x, y, r }>
export function layoutUniverse(subjects) {
  const list = [...subjects].sort((a, b) => (a.subject < b.subject ? -1 : 1));
  const n = list.length;
  const out = new Map();
  if (n === 0) return out;
  if (n === 1) {
    out.set(list[0].subject, { x: 0, y: 0, r: galaxyRadius(list[0].count) });
    return out;
  }
  const rx = 300 + 26 * n;
  const ry = 200 + 16 * n;
  list.forEach((s, i) => {
    const a = (-90 + (360 * i) / n) * DEG; // 从正上方起顺时针均布
    out.set(s.subject, {
      x: Math.cos(a) * rx,
      y: Math.sin(a) * ry,
      r: galaxyRadius(s.count),
    });
  });
  return out;
}

const galaxyRadius = (count) => 42 + 13 * Math.sqrt(count);

// ---- 星座视图 ----
// nodes: [{ id, ... }]；edges: [{ from, to, type }]（from 的前置是 to）
// → Map<id, { x, y, layer }>；layer 0 在底部，向上递增
export function layoutConstellation(nodes, edges, { hGap = 95, vGap = 115 } = {}) {
  const ids = new Set(nodes.map((n) => n.id));
  // 前置关系（仅限学科内、prerequisite 边；related 不参与定位）
  const prereqsOf = new Map([...ids].map((id) => [id, []]));
  const dependentsOf = new Map([...ids].map((id) => [id, []]));
  for (const e of edges) {
    if (e.type !== 'prerequisite' || !ids.has(e.from) || !ids.has(e.to)) continue;
    prereqsOf.get(e.from).push(e.to);
    dependentsOf.get(e.to).push(e.from);
  }

  // 最长路径分层（Kahn 拓扑 + 层递推，迭代式避免深链递归爆栈）
  const remaining = new Map([...ids].map((id) => [id, prereqsOf.get(id).length]));
  const layer = new Map();
  let frontier = [...ids].filter((id) => remaining.get(id) === 0).sort();
  for (const id of frontier) layer.set(id, 0);
  while (frontier.length) {
    const next = [];
    for (const id of frontier) {
      for (const dep of dependentsOf.get(id)) {
        layer.set(dep, Math.max(layer.get(dep) ?? 0, layer.get(id) + 1));
        remaining.set(dep, remaining.get(dep) - 1);
        if (remaining.get(dep) === 0) next.push(dep);
      }
    }
    next.sort();
    frontier = next;
  }
  // 防御：导入已保证 DAG；若仍有环，未分层节点兜底为 0
  for (const id of ids) if (!layer.has(id)) layer.set(id, 0);

  // 同层按 id 排序均布（确定性），层越高越靠上（y 负方向）
  const byLayer = new Map();
  for (const id of ids) {
    const l = layer.get(id);
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l).push(id);
  }
  const pos = new Map();
  for (const [l, row] of byLayer) {
    row.sort();
    row.forEach((id, i) => {
      pos.set(id, { x: (i - (row.length - 1) / 2) * hGap, y: -l * vGap, layer: l });
    });
  }
  return pos;
}

// ---- 网格聚合（星团档）----
// items: 可迭代的 { id, x, y }；cellWorld：网格边长（世界单位）
// → Map<key, { cx, cy, count, ids }>（cx/cy 为桶内质心）
export function bucketize(items, cellWorld) {
  const buckets = new Map();
  for (const it of items) {
    const key = `${Math.floor(it.x / cellWorld)},${Math.floor(it.y / cellWorld)}`;
    let b = buckets.get(key);
    if (!b) {
      b = { sx: 0, sy: 0, count: 0, ids: [] };
      buckets.set(key, b);
    }
    b.sx += it.x;
    b.sy += it.y;
    b.count += 1;
    b.ids.push(it.id);
  }
  for (const b of buckets.values()) {
    b.cx = b.sx / b.count;
    b.cy = b.sy / b.count;
    delete b.sx;
    delete b.sy;
  }
  return buckets;
}

export const bucketKeyOf = (x, y, cellWorld) =>
  `${Math.floor(x / cellWorld)},${Math.floor(y / cellWorld)}`;

// FNV-1a 字符串哈希（稳定无符号 32 位）：用于内容种子（星系星光、特效中心点等）
export function hashStr(s) {
  let h = 2166136261;
  for (const c of String(s)) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---- 合成压测数据 ----
// 生成 n 节点 / subjectCount 个学科的确定性图：prerequisite 主链 + 随机前置 + 少量 related
export function makeSyntheticGraph(nodeCount, { subjectCount = 1, seed = 42 } = {}) {
  const rand = mulberry32(seed);
  const subjects = Array.from({ length: subjectCount }, (_, i) => `压测学科${i + 1}`);
  const states = ['dim', 'dim', 'dim', 'open', 'passed', 'lit'];
  const nodes = [];
  for (let i = 0; i < nodeCount; i += 1) {
    nodes.push({
      id: `syn.${String(i).padStart(5, '0')}`,
      title: `合成节点 ${i}`,
      subject: subjects[i % subjectCount],
      difficulty: 1 + Math.floor(rand() * 5),
      credibility: rand() < 0.85 ? 'verified' : 'disputed',
      state: states[Math.floor(rand() * states.length)],
    });
  }
  const edges = [];
  for (let i = 1; i < nodeCount; i += 1) {
    // 同学科内的随机前置：同余列中向前取（j 与 i 同 subject 且 j < i，保证 DAG）
    const earlier = Math.floor(i / subjectCount); // 同学科排在本节点之前的数量
    if (earlier > 0 && rand() < 0.8) {
      const k = Math.floor(rand() * earlier);
      edges.push({ from: nodes[i].id, to: nodes[k * subjectCount + (i % subjectCount)].id, type: 'prerequisite' });
    }
    // 主链：保证层次深度
    if (earlier > 0 && rand() < 0.35) {
      edges.push({ from: nodes[i].id, to: nodes[i - subjectCount].id, type: 'prerequisite' });
    }
    // 少量相关边
    if (rand() < 0.06) {
      const j = Math.floor(rand() * i);
      edges.push({ from: nodes[i].id, to: nodes[j].id, type: 'related' });
    }
  }
  return { nodes, edges };
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

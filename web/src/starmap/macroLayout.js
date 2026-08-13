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

// ---- 一体大地图：学科星系 + 学科内节点统一世界坐标 ----
// 所有学科合并为一张连续地图：星系锚点沿椭圆分布（相邻间距 ≥ 学科局部布局对角 +
// 边距，保证星系内节点不互相重叠）；各学科节点按 DAG 分层后平移到星系锚点。
// 返回 { galaxies: [{subject,count,x,y,r}], pos: Map<id,{x,y}> }
export function layoutWorld(subjects, nodes, edges) {
  const bySubject = new Map();
  for (const n of nodes) {
    const subj = n.subject ?? '未分类';
    if (!bySubject.has(subj)) bySubject.set(subj, []);
    bySubject.get(subj).push(n);
  }
  // 各学科局部布局 + 包围盒（layoutConstellation 复用，确定性不变；间距收紧使地图更聚拢）
  const locals = new Map();
  let maxDiag = 0;
  for (const [subj, list] of bySubject) {
    const ids = new Set(list.map((n) => n.id));
    const localEdges = edges.filter(
      (e) => e.type === 'prerequisite' && ids.has(e.from) && ids.has(e.to),
    );
    const pos = layoutConstellation(list, localEdges, { ringStep: 72 });
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of pos.values()) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    const w = x1 - x0 || 0;
    const h = y1 - y0 || 0;
    maxDiag = Math.max(maxDiag, Math.hypot(w, h));
    locals.set(subj, { pos, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });
  }
  // 星系锚点：正 n 边形均布（相邻弦距精确 = chord ≥ 学科对角 + 边距）
  const sorted = [...subjects].sort((a, b) => (a.subject < b.subject ? -1 : 1));
  const n = sorted.length;
  const chord = maxDiag + 140;
  const anchors = new Map();
  if (n <= 1) {
    anchors.set(sorted[0].subject, { x: 0, y: 0 });
  } else {
    const R = chord / (2 * Math.sin(Math.PI / n)); // 正 n 边形外接圆半径：边长 = chord
    sorted.forEach((s, i) => {
      const a = (-90 + (360 * i) / n) * DEG; // 从正上方起顺时针均布
      anchors.set(s.subject, { x: Math.cos(a) * R, y: Math.sin(a) * R });
    });
  }
  const galaxies = sorted.map((s) => {
    const a = anchors.get(s.subject);
    return {
      subject: s.subject,
      count: s.count,
      x: a.x,
      y: a.y,
      r: galaxyRadius(s.count),
      local: locals.get(s.subject) ?? null,
    };
  });
  // 学科标签择地生成：沿锚点径向向外，放在学科节点群外围（避开节点与邻星系）
  for (const g of galaxies) {
    let rMax = 0;
    if (g.local) {
      for (const p of g.local.pos.values()) {
        rMax = Math.max(rMax, Math.hypot(p.x - g.local.cx, p.y - g.local.cy));
      }
    }
    const rBox = rMax || g.r;
    let dx = g.x;
    let dy = g.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) {
      dx = 0;
      dy = -1;
    } else {
      dx /= len;
      dy /= len;
    }
    const d = rBox + 36;
    g.labelPos = { x: g.x + dx * d, y: g.y + dy * d };
  }
  // 节点全局坐标：局部坐标平移到星系锚点
  const pos = new Map();
  for (const g of galaxies) {
    if (!g.local) continue;
    for (const [id, p] of g.local.pos) {
      pos.set(id, { x: p.x - g.local.cx + g.x, y: p.y - g.local.cy + g.y });
    }
  }
  return { galaxies, pos };
}

// ---- 星座视图（蛛网布局）----
// 基础概念靠近中心，前沿逐步向外辐射（仿蛛网）：
//   无前置的基础节点（layer 0）在中心小圆均布（单基础则在圆心）；
//   第 L 层节点分布在半径 coreR + L*ringStep 的环上；
//   子节点角度继承主父节点扇区（连线短、不交叉）；related 不参与定位；确定性。
export function layoutConstellation(nodes, edges, { ringStep = 75, coreR = 30 } = {}) {
  const ids = new Set(nodes.map((n) => n.id));
  // 前置关系（仅限学科内、prerequisite 边；related 不参与定位）
  const prereqsOf = new Map([...ids].map((id) => [id, []]));
  const dependentsOf = new Map([...ids].map((id) => [id, []]));
  for (const e of edges) {
    if (e.type !== 'prerequisite' || !ids.has(e.from) || !ids.has(e.to)) continue;
    prereqsOf.get(e.from).push(e.to);
    dependentsOf.get(e.to).push(e.from);
  }
  for (const list of prereqsOf.values()) list.sort();
  for (const list of dependentsOf.values()) list.sort();

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
  const maxLayer = Math.max(0, ...layer.values());

  // 角度分配：layer 0 均布中心小圆；每层子节点继承主父角度扇区
  const angle = new Map();
  const layer0 = [...ids].filter((id) => layer.get(id) === 0).sort();
  layer0.forEach((id, i) => angle.set(id, (Math.PI * 2 * i) / layer0.length));

  const norm = (a) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  for (let L = 1; L <= maxLayer; L += 1) {
    const cur = [...ids].filter((id) => layer.get(id) === L).sort();
    const unit = (Math.PI * 2) / cur.length; // 该层每个节点的基础扇区
    const groups = new Map(); // 主父 id -> [子节点]（主父 = 字典序最小且已有角度的前置）
    const orphans = [];
    for (const id of cur) {
      const parent = prereqsOf.get(id).find((p) => angle.has(p)) ?? null;
      if (parent) {
        if (!groups.has(parent)) groups.set(parent, []);
        groups.get(parent).push(id);
      } else {
        orphans.push(id);
      }
    }
    // 组以父角度为中心，子节点在 ±扇区内均布（扇区宽 = 节点数×基础扇区×0.92 留缝）
    for (const [parent, kids] of groups) {
      const c = angle.get(parent);
      const w = kids.length * unit * 0.92;
      kids.forEach((id, i) => {
        const a = c + (i - (kids.length - 1) / 2) * (w / kids.length);
        angle.set(id, norm(a));
      });
    }
    // 无父节点（数据异常兜底）：均分剩余整圆
    orphans.forEach((id, i) => angle.set(id, norm((Math.PI * 2 * i) / orphans.length + 0.3)));
  }

  // 极坐标 → 笛卡尔：layer 0 在中心小圆（多基础）或圆心；其余层在 coreR + L*ringStep 环上
  const pos = new Map();
  for (const id of ids) {
    const l = layer.get(id);
    const r = l === 0 ? (layer0.length > 1 ? coreR : 0) : coreR + l * ringStep;
    const a = angle.get(id) ?? 0;
    pos.set(id, { x: Math.cos(a) * r, y: Math.sin(a) * r, layer: l });
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

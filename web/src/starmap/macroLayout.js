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
// 返回 { galaxies: [{subject,count,x,y,r,labelPos}], pos: Map<id,{x,y}> }
//
// 通用生成规则（规模自适应，不依赖任何固定地图尺寸）：
//   1) 学科内部：蛛网布局（layoutConstellation），学科「团」半径 = 节点分布实际半径
//   2) 学科团排列：圆堆积——按半径降序从原点贪心堆叠，每团贴着已放团放置、
//      取离原点最近的可行位；团间距 GAP 与节点连线尺度同量级，学科自然凑在一起
//   3) 学科标签：沿团中心远离全局质心的方向，放在团外缘
// 新增节点/新增学科时自动重排，无需调整参数。
export function layoutWorld(subjects, nodes, edges) {
  const GAP = 70; // 团间最小间隙（≈蛛网 ringStep，连线与团距同尺度）

  const bySubject = new Map();
  for (const n of nodes) {
    const subj = n.subject ?? '未分类';
    if (!bySubject.has(subj)) bySubject.set(subj, []);
    bySubject.get(subj).push(n);
  }
  // 1) 各学科蛛网局部布局；团半径 = 节点到蛛网中心的最大距离
  const locals = new Map();
  for (const [subj, list] of bySubject) {
    const ids = new Set(list.map((n) => n.id));
    const localEdges = edges.filter(
      (e) => e.type === 'prerequisite' && ids.has(e.from) && ids.has(e.to),
    );
    const pos = layoutConstellation(list, localEdges, { ringStep: 72, minDist: 40 });
    let rMax = 0;
    for (const p of pos.values()) rMax = Math.max(rMax, Math.hypot(p.x, p.y));
    locals.set(subj, { pos, r: Math.max(40, rMax + 18) });
  }

  // 2) 圆堆积：确定性贪心（按学科名排序；贴边 5° 步进扫描，取离原点最近可行位）
  const sorted = [...subjects].sort((a, b) => (a.subject < b.subject ? -1 : 1));
  const placed = []; // { x, y, r }
  const centers = new Map();
  for (const s of sorted) {
    const r = locals.get(s.subject)?.r ?? 40;
    const p = packCircle(placed, r, GAP);
    placed.push({ x: p.x, y: p.y, r });
    centers.set(s.subject, { x: p.x, y: p.y, r });
  }

  // 3) 学科标签：沿团中心远离全局质心方向、放在团外缘
  const galaxies = sorted.map((s) => {
    const c = centers.get(s.subject);
    return {
      subject: s.subject,
      count: s.count,
      x: c.x,
      y: c.y,
      r: c.r,
      local: locals.get(s.subject) ?? null,
    };
  });
  const centroid = {
    x: placed.reduce((sum, p) => sum + p.x, 0) / Math.max(1, placed.length),
    y: placed.reduce((sum, p) => sum + p.y, 0) / Math.max(1, placed.length),
  };
  for (const g of galaxies) {
    let dx = g.x - centroid.x;
    let dy = g.y - centroid.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) {
      dx = 0;
      dy = -1;
    } else {
      dx /= len;
      dy /= len;
    }
    const d = g.r + 26;
    g.labelPos = { x: g.x + dx * d, y: g.y + dy * d };
  }

  // 4) 节点全局坐标：蛛网局部坐标平移到团中心
  const pos = new Map();
  for (const g of galaxies) {
    if (!g.local) continue;
    for (const [id, p] of g.local.pos) {
      pos.set(id, { x: p.x + g.x, y: p.y + g.y });
    }
  }
  return { galaxies, pos };
}

// 贪心圆堆积：为半径 r 的圆找「与已放圆不相交且离原点最近」的位置
// （确定性：按放置顺序枚举已放圆、固定角度步进扫描贴边候选）
function packCircle(placed, r, gap) {
  if (placed.length === 0) return { x: 0, y: 0 };
  const STEPS = 72;
  const STEP = (Math.PI * 2) / STEPS;
  let best = null;
  let bestDist = Infinity;
  for (const p of placed) {
    const d = p.r + r + gap;
    for (let i = 0; i < STEPS; i += 1) {
      const a = i * STEP;
      const x = p.x + Math.cos(a) * d;
      const y = p.y + Math.sin(a) * d;
      const free = placed.every(
        (q) => Math.hypot(x - q.x, y - q.y) >= q.r + r + gap - 1e-6,
      );
      if (!free) continue;
      const dist = Math.hypot(x, y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x, y };
      }
    }
  }
  // 兜底（理论上必找到：贴着任意已放圆的外侧总有一处空隙）
  return best ?? { x: placed[0].x, y: placed[0].y + placed[0].r + r + gap };
}

// ---- 星座视图（蛛网布局）----
// 基础概念靠近中心，前沿逐步向外辐射（仿蛛网）：
//   无前置的基础节点（layer 0）在中心小圆均布（单基础则在圆心）；
//   第 L 层节点分布在半径 ≥ 内层 + ringStep 的环上；
//   子节点角度继承主父节点扇区（连线短、不交叉）；related 不参与定位；确定性。
//
// 间距自适应（minDist，世界单位）：解决「部分区域过密、部分过空」——
//   1) 同层弧长间距 ≥ minDist：每层半径 r[L] = max(内层 + ringStep, minDist / 最小角间距)，
//      节点多的层自动放大半径，节点少的层不再被固定环半径撑出巨大弧长；
//   2) 组扇区改为 Voronoi 划分（相邻组边界 = 父角度中点，瓜分整圆）：
//      组间永不重叠、不留死角，节点少的层也均匀铺开而非聚成一簇；
//   3) 层间径向间距 ≥ ringStep（≥ minDist），轮辐处不再叠罗汉。
// minDist 基准换算：节点档标题字号 11px（屏幕恒定）× 5 字 ≈ 55px 屏幕；
// 节点档最低完整显示 scale = 1.4 → 55 / 1.4 ≈ 39.3，取 40 世界单位。
export function layoutConstellation(nodes, edges, { ringStep = 75, coreR = 30, minDist = 40 } = {}) {
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

  // 角度分配：layer 0 均布中心小圆；每层子节点继承主父角度扇区（Voronoi 组扇区）
  const angle = new Map();
  const layer0 = [...ids].filter((id) => layer.get(id) === 0).sort();
  layer0.forEach((id, i) => angle.set(id, (Math.PI * 2 * i) / Math.max(1, layer0.length)));

  // 各层环半径（自适应）：layer0 由基础节点数定；深层由「内层 + ringStep」与
  // 「minDist / 弦长因子」取大，保证同层节点**欧氏距离（弦长）≥ minDist**。
  // 弦长 = 2r·sin(Δθ/2)（Δθ 为该层最小角间距），故 r ≥ minDist / (2·sin(Δθ/2))；
  // 单节点层 Δθ=2π → 因子为 0，无需约束。
  const rad = new Map();
  if (layer0.length > 1) {
    const f0 = 2 * Math.sin(Math.PI / layer0.length); // 相邻基础节点角距 2π/n0 的弦因子
    rad.set(0, Math.max(coreR, f0 > 1e-9 ? minDist / f0 : 0));
  } else {
    rad.set(0, 0);
  }

  const norm = (a) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  for (let L = 1; L <= maxLayer; L += 1) {
    const cur = [...ids].filter((id) => layer.get(id) === L).sort();
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
    // 组按父角度升序（并列按父 id，保证确定性），组间 Voronoi 边界 = 相邻父角度中点：
    // 组 i 可用扇区 [left_i, right_i]，组内均布 → 组间无重叠、无死角。
    const gList = [...groups.entries()].map(([parent, kids]) => ({
      parent,
      kids,
      a: angle.get(parent),
    }));
    gList.sort((x, y) => (x.a !== y.a ? x.a - y.a : x.parent < y.parent ? -1 : 1));
    const k = gList.length;
    const bounds = [];
    for (let i = 0; i < k; i += 1) {
      const a = gList[i].a;
      const b = gList[(i + 1) % k].a;
      bounds.push(i === k - 1 ? (a + b + Math.PI * 2) / 2 : (a + b) / 2);
    }
    for (let i = 0; i < k; i += 1) {
      const left = i === 0 ? bounds[k - 1] - Math.PI * 2 : bounds[i - 1];
      const right = bounds[i];
      const n = gList[i].kids.length;
      gList[i].kids.forEach((id, j) => {
        angle.set(id, norm(left + ((j + 0.5) / n) * (right - left)));
      });
    }
    // 无父节点（数据异常兜底）：聚在最后一个组边界之后的小扇区，不占整圆
    if (orphans.length) {
      const base = norm(bounds[k - 1] ?? 0);
      orphans.forEach((id, i) => angle.set(id, norm(base + (i + 0.5) * 0.08)));
    }

    // 该层最小角间距（排序后相邻差，含首尾 wrap）→ 决定环半径下限（弦长 ≥ minDist）
    const angs = cur.map((id) => angle.get(id)).sort((a, b) => a - b);
    let gap = Infinity;
    for (let i = 0; i < angs.length; i += 1) {
      const d = i === angs.length - 1 ? angs[0] + Math.PI * 2 - angs[i] : angs[i + 1] - angs[i];
      if (d > 1e-9) gap = Math.min(gap, d);
    }
    if (!Number.isFinite(gap) || gap <= 0) gap = Math.PI * 2;
    const chordFactor = 2 * Math.sin(gap / 2); // 弦长 = r * chordFactor
    const rNeed = minDist > 0 && chordFactor > 1e-9 ? minDist / chordFactor : 0;
    rad.set(L, Math.max((rad.get(L - 1) ?? 0) + ringStep, rNeed));
  }

  // 极坐标 → 笛卡尔：layer 0 在中心小圆（多基础）或圆心；其余层在自适应半径环上
  const pos = new Map();
  for (const id of ids) {
    const l = layer.get(id);
    const r = rad.get(l) ?? 0;
    const a = angle.get(id) ?? 0;
    pos.set(id, { x: Math.cos(a) * r, y: Math.sin(a) * r, layer: l });
  }
  return pos;
}

// ---- 主干链（学科内最长 prerequisite 链）----
// 标识先于星座：前端先用该纯函数算出每个学科的「主干」节点链，
// 再以它为骨架在宏观视图各档位渲染可读标签（后端仅提供 nodes/edges 资料）。
// 返回学习顺序（根 → 叶）的节点 id 数组；无前置边时退化为字典序第一个节点。
export function longestChain(nodes, edges) {
  const ids = new Set(nodes.map((n) => n.id));
  const prereqsOf = new Map([...ids].map((id) => [id, []]));
  const dependentsOf = new Map([...ids].map((id) => [id, []]));
  for (const e of edges) {
    if (e.type !== 'prerequisite' || !ids.has(e.from) || !ids.has(e.to)) continue;
    prereqsOf.get(e.from).push(e.to);
    dependentsOf.get(e.to).push(e.from);
  }
  for (const list of prereqsOf.values()) list.sort();
  for (const list of dependentsOf.values()) list.sort();

  // Kahn 最长路径分层（与 layoutConstellation 同语义；防御：环兜底为 0）
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
  for (const id of ids) if (!layer.has(id)) layer.set(id, 0);

  // 最深节点（字典序打破并列，保证确定性）
  let deep = null;
  let deepLayer = -1;
  for (const id of ids) {
    const l = layer.get(id);
    if (l > deepLayer || (l === deepLayer && (deep === null || id < deep))) {
      deep = id;
      deepLayer = l;
    }
  }
  if (deep == null) return [];

  // 从最深节点沿「层级最高的前置」回溯到根，得到一条最长链
  const chain = [deep];
  let cur = deep;
  let guard = ids.size + 1;
  while (guard-- > 0) {
    const prereqs = prereqsOf.get(cur) ?? [];
    if (prereqs.length === 0) break;
    let best = null;
    let bestLayer = -1;
    for (const p of prereqs) {
      const l = layer.get(p) ?? 0;
      if (l > bestLayer || (l === bestLayer && (best === null || p < best))) {
        best = p;
        bestLayer = l;
      }
    }
    if (best == null || best === cur) break;
    chain.push(best);
    cur = best;
  }
  chain.reverse();
  return chain;
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

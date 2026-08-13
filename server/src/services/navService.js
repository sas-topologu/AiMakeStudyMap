// 导航寻路服务（纯函数为主，图数据注入便于测试）
//
// 图语义：prerequisite 边 from→to 表示「from 的前置是 to」。
// 学习路线 = 从起点 A 向目标 B 推进的前置依赖链：沿「前置」方向从 B 出发找 A，
// 找到后反转为学习顺序（A → … → B）。B 不依赖 A（含方向相反/不同支）→ 无路线（调用方抛 NO_ROUTE）。
//
// 高难判定规则（替代早期「通关人数 < hard_threshold(10)」方案——冷启动时几乎所有节点都会误判为高难）：
//   通过率 = 通关人数（passed/lit 去重用户）/ max(1, 尝试人数（有该节点任意状态行的用户）)
//   尝试人数 ≥ minAttempts（默认 5）且通过率 < maxPassRate（默认 0.3）→ 高难
//   尝试人数 < minAttempts → 数据不足，不判高难
//   阈值可在 meta 表配置：hard_min_attempts / hard_max_pass_rate
const HARD_COST = 10; // 低难路径：进入高难节点的代价（普通节点 1）
const NORMAL_COST = 1;
const DFS_POOL = 50; // 备选路线枚举的候选池上限
const DFS_BUDGET = 20000; // DFS 扩展次数保险丝

// nodeIds: 可迭代 id；edges: [{ from, to, type }]
// 返回 [{ nodes: [id…](学习顺序), expansions?: [{ at, nodes: [id…] }] }]；无路线返回 []
export function findRoutes(nodeIds, edges, from, to, type, { hardIds = new Set(), maxRoutes = 3 } = {}) {
  if (from === to) return [{ nodes: [from] }];

  const prereqsOf = new Map(); // x → [前置…]
  const relatedOf = new Map();
  for (const id of nodeIds) {
    prereqsOf.set(id, []);
    relatedOf.set(id, []);
  }
  for (const e of edges) {
    if (!prereqsOf.has(e.from) || !prereqsOf.has(e.to)) continue;
    if (e.type === 'prerequisite') prereqsOf.get(e.from).push(e.to);
    else if (e.type === 'related') {
      relatedOf.get(e.from).push(e.to);
      relatedOf.get(e.to).push(e.from);
    }
  }
  for (const m of [prereqsOf, relatedOf]) {
    for (const list of m.values()) list.sort(); // 确定性
  }

  // BFS：目标 →(沿前置)→ 起点，最短链（方向为 B→A，返回前统一反转）
  const shortest = bfsPath(prereqsOf, to, from);
  if (!shortest) return [];
  const learning = (p) => [...p].reverse();

  if (type === 'easy') {
    const best = dijkstra(prereqsOf, to, from, hardIds);
    return best ? [{ nodes: learning(best) }] : [];
  }

  if (type === 'full') {
    const main = learning(shortest);
    const onChain = new Set(main);
    const expansions = [];
    for (const id of main) {
      const ex = (relatedOf.get(id) ?? []).filter((x) => !onChain.has(x));
      if (ex.length) expansions.push({ at: id, nodes: ex });
    }
    return [{ nodes: main, expansions }];
  }

  // shortest：BFS 最短 1 条 + 限深 DFS（边数 ≤ 最短+2）枚举简单路径补足备选
  const routes = [{ nodes: learning(shortest) }];
  const maxDepth = shortest.length - 1 + 2; // 边数上限
  const pool = [];
  let budget = DFS_BUDGET;
  const path = [to];
  const onPath = new Set([to]);
  const dfs = (cur) => {
    if (pool.length >= DFS_POOL || budget <= 0) return;
    budget -= 1;
    if (cur === from) {
      const key = path.join('|');
      if (key !== shortest.join('|')) pool.push([...path]);
      return;
    }
    if (path.length - 1 >= maxDepth) return;
    for (const nx of prereqsOf.get(cur) ?? []) {
      if (onPath.has(nx)) continue;
      path.push(nx);
      onPath.add(nx);
      dfs(nx);
      path.pop();
      onPath.delete(nx);
    }
  };
  dfs(to);
  pool.sort((a, b) => a.length - b.length || a.join('|').localeCompare(b.join('|')));
  for (const p of pool.slice(0, Math.max(0, maxRoutes - 1))) routes.push({ nodes: learning(p) });
  return routes;
}

function bfsPath(prereqsOf, start, goal) {
  const parent = new Map([[start, null]]);
  let frontier = [start];
  while (frontier.length) {
    const next = [];
    for (const cur of frontier) {
      if (cur === goal) {
        const path = [];
        for (let x = goal; x !== null; x = parent.get(x)) path.push(x);
        return path.reverse(); // start(目标) → … → goal(起点)，与 DFS 方向一致
      }
      for (const nx of prereqsOf.get(cur) ?? []) {
        if (!parent.has(nx)) {
          parent.set(nx, cur);
          next.push(nx);
        }
      }
    }
    frontier = next;
  }
  return null;
}

// Dijkstra：节点代价（进入 hard 节点 10，普通 1；起点不计），尽量绕开高难
function dijkstra(prereqsOf, start, goal, hardIds) {
  const cost = (id) => (hardIds.has(id) ? HARD_COST : NORMAL_COST);
  const dist = new Map([[start, 0]]);
  const parent = new Map([[start, null]]);
  const done = new Set();
  for (;;) {
    // 小图场景：线性取最小堆顶即可
    let cur = null;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!done.has(id) && d < best) {
        best = d;
        cur = id;
      }
    }
    if (cur === null) return null;
    if (cur === goal) {
      const path = [];
      for (let x = goal; x !== null; x = parent.get(x)) path.push(x);
      return path.reverse(); // start(目标) → … → goal(起点)，与 BFS/DFS 方向一致
    }
    done.add(cur);
    for (const nx of prereqsOf.get(cur) ?? []) {
      if (done.has(nx)) continue;
      const nd = best + cost(nx);
      if (nd < (dist.get(nx) ?? Infinity)) {
        dist.set(nx, nd);
        parent.set(nx, cur);
      }
    }
  }
}

// 高难节点集合（规则见文件头注释）
export function hardNodeIds(db) {
  const minAttempts = metaNumber(db, 'hard_min_attempts', 5);
  const maxPassRate = metaNumber(db, 'hard_max_pass_rate', 0.3);
  const rows = db
    .prepare(
      `SELECT node_id,
              COUNT(DISTINCT user_id) AS attempts,
              COUNT(DISTINCT CASE WHEN state IN ('passed', 'lit') THEN user_id END) AS passed
       FROM user_node_state GROUP BY node_id`
    )
    .all();
  return new Set(
    rows
      .filter((r) => r.attempts >= minAttempts && r.passed / Math.max(1, r.attempts) < maxPassRate)
      .map((r) => r.node_id)
  );
}

function metaNumber(db, key, fallback) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

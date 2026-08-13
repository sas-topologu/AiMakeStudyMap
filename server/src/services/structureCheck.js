// 结构检测服务：纯函数，输入为节点 id 集合 + 边列表
// 边格式：{ from_id, to_id, type }，type ∈ ('prerequisite', 'related')

// 对 prerequisite 边做 DAG 校验（Tarjan 强连通分量），返回所有环（节点 id 数组的数组）
export function detectCycles(nodes, edges) {
  const adj = new Map();
  for (const id of nodes) adj.set(id, []);
  for (const e of edges) {
    if (e.type !== 'prerequisite') continue;
    if (adj.has(e.from_id)) adj.get(e.from_id).push(e.to_id);
  }

  let index = 0;
  const indices = new Map();
  const lowlink = new Map();
  const onStack = new Set();
  const stack = [];
  const cycles = [];

  // 迭代版 Tarjan（避免递归深度问题）
  function strongconnect(start) {
    const callStack = [[start, 0]];
    indices.set(start, index);
    lowlink.set(start, index);
    index += 1;
    stack.push(start);
    onStack.add(start);

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1];
      const [v, i] = frame;
      const neighbors = adj.get(v) || [];
      if (i < neighbors.length) {
        frame[1] = i + 1;
        const w = neighbors[i];
        if (!indices.has(w)) {
          indices.set(w, index);
          lowlink.set(w, index);
          index += 1;
          stack.push(w);
          onStack.add(w);
          callStack.push([w, 0]);
        } else if (onStack.has(w)) {
          lowlink.set(v, Math.min(lowlink.get(v), indices.get(w)));
        }
      } else {
        callStack.pop();
        if (lowlink.get(v) === indices.get(v)) {
          const scc = [];
          let w;
          do {
            w = stack.pop();
            onStack.delete(w);
            scc.push(w);
          } while (w !== v);
          // 分量大小 >1 即为环；自环单独判断
          if (scc.length > 1 || (adj.get(v) || []).includes(v)) {
            cycles.push(scc);
          }
        }
        if (callStack.length > 0) {
          const parent = callStack[callStack.length - 1][0];
          lowlink.set(parent, Math.min(lowlink.get(parent), lowlink.get(v)));
        }
      }
    }
  }

  for (const id of nodes) {
    if (!indices.has(id)) strongconnect(id);
  }
  return cycles;
}

// 以前置+后续+相关全部边构成无向图，最大连通分量为主网络，
// 返回不在主网络中的节点群（孤岛，节点 id 数组的数组）
export function detectIslands(nodes, edges) {
  const parent = new Map();
  for (const id of nodes) parent.set(id, id);
  const find = (x) => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    // 路径压缩
    let cur = x;
    while (parent.get(cur) !== r) {
      const next = parent.get(cur);
      parent.set(cur, r);
      cur = next;
    }
    return r;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const e of edges) {
    if (parent.has(e.from_id) && parent.has(e.to_id)) union(e.from_id, e.to_id);
  }

  // 按根分组
  const groups = new Map();
  for (const id of nodes) {
    const r = find(id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(id);
  }
  if (groups.size <= 1) return [];

  // 最大连通分量为主网络
  const sorted = [...groups.values()].sort((a, b) => b.length - a.length);
  return sorted.slice(1);
}

// 聚合校验：errors 含 dangling 引用、环、related 自环；warnings 含孤岛
export function validateGraph(nodes, edges) {
  const errors = [];
  const warnings = [];
  const nodeSet = new Set(nodes);

  for (const e of edges) {
    if (!nodeSet.has(e.from_id)) {
      errors.push(`悬空引用：边 ${e.type} 的起点 ${e.from_id} 不存在（指向 ${e.to_id}）`);
    }
    if (!nodeSet.has(e.to_id)) {
      errors.push(`悬空引用：边 ${e.type} 的终点 ${e.to_id} 不存在（来自 ${e.from_id}）`);
    }
    if (e.type === 'related' && e.from_id === e.to_id) {
      errors.push(`related 不允许自环：${e.from_id}`);
    }
  }

  for (const cycle of detectCycles(nodes, edges)) {
    errors.push(`前置依赖成环：${cycle.join(' -> ')}`);
  }

  for (const group of detectIslands(nodes, edges)) {
    warnings.push(`孤岛节点群（不在主网络中）：${group.join(', ')}`);
  }

  return { errors, warnings };
}

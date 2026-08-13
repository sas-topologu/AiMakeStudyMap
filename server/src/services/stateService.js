// 节点状态机：dim 暗淡 → open 开放 → passed 通关 → lit 点亮
// 核心规则全部在服务端判定，前端只做展示（防本地篡改）
import { edgesOf, allEdges } from '../db/contentRepo.js';
import { errors } from '../errors.js';

const LEVEL = { dim: 0, open: 1, passed: 2, lit: 3 };

// 显式存储的状态（无记录返回 null）
export function storedState(db, userId, nodeId) {
  const row = db
    .prepare('SELECT state FROM user_node_state WHERE user_id = ? AND node_id = ?')
    .get(userId, nodeId);
  return row ? row.state : null;
}

// 有效状态 = max(显式存储, 推导开放)
// 推导开放：任一相连节点（前置/后续/相关）已被该用户 passed 或 lit
export function effectiveState(db, userId, nodeId) {
  if (userId == null) return 'dim';
  const stored = storedState(db, userId, nodeId);
  let level = stored ? LEVEL[stored] : 0;

  if (level < LEVEL.open) {
    const { prerequisites, successors, related } = edgesOf(db, nodeId);
    const neighbors = [...new Set([...prerequisites, ...successors, ...related])];
    if (neighbors.length > 0) {
      const placeholders = neighbors.map(() => '?').join(',');
      const row = db
        .prepare(
          `SELECT 1 FROM user_node_state
           WHERE user_id = ? AND node_id IN (${placeholders})
             AND state IN ('passed', 'lit') LIMIT 1`
        )
        .get(userId, ...neighbors);
      if (row) level = LEVEL.open;
    }
  }
  return Object.keys(LEVEL).find((k) => LEVEL[k] === level);
}

// 批量有效状态：一次取出该用户全部状态行 + 全图边，内存计算，不逐节点查库
// 语义与 effectiveState 完全一致（显式存储优先；任一相邻节点 passed/lit 推导 open）
export function batchEffectiveStates(db, userId, nodeIds) {
  if (userId == null) return Object.fromEntries(nodeIds.map((id) => [id, 'dim']));

  const stored = new Map(
    db
      .prepare('SELECT node_id, state FROM user_node_state WHERE user_id = ?')
      .all(userId)
      .map((r) => [r.node_id, r.state])
  );
  const passedLit = new Set(
    [...stored].filter(([, s]) => s === 'passed' || s === 'lit').map(([id]) => id)
  );

  // 全图邻接（prerequisite 双向 + related 双向，去重）
  const neighbors = new Map();
  const link = (a, b) => {
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    neighbors.get(a).add(b);
  };
  for (const e of allEdges(db)) {
    link(e.from_id, e.to_id);
    link(e.to_id, e.from_id);
  }

  const result = {};
  for (const id of nodeIds) {
    const s = stored.get(id);
    let level = s ? LEVEL[s] : 0;
    if (level < LEVEL.open && passedLit.size > 0) {
      const ns = neighbors.get(id);
      if (ns) {
        for (const n of ns) {
          if (passedLit.has(n)) {
            level = LEVEL.open;
            break;
          }
        }
      }
    }
    result[id] = Object.keys(LEVEL).find((k) => LEVEL[k] === level);
  }
  return result;
}

// 写入显式状态（跃迁 open / 通关 passed / 点亮 lit）
export function setState(db, userId, nodeId, state, { passSeconds = null, litAt = null } = {}) {
  db.prepare(
    `INSERT INTO user_node_state (user_id, node_id, state, pass_seconds, lit_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, node_id) DO UPDATE SET
       state = excluded.state,
       pass_seconds = COALESCE(excluded.pass_seconds, user_node_state.pass_seconds),
       lit_at = COALESCE(excluded.lit_at, user_node_state.lit_at),
       updated_at = datetime('now')`
  ).run(userId, nodeId, state, passSeconds, litAt);
}

// 闯关前置校验：dim 不可闯关（open/passed/lit 均可）
export function assertCanChallenge(db, userId, nodeId) {
  if (effectiveState(db, userId, nodeId) === 'dim') {
    throw errors.forbiddenState('节点未开放，不可闯关');
  }
}

// 讨论区发言：需 passed 及以上
export function canPost(db, userId, nodeId) {
  return LEVEL[effectiveState(db, userId, nodeId)] >= LEVEL.passed;
}

// 二创区上传：需 lit
export function canCreate(db, userId, nodeId) {
  return effectiveState(db, userId, nodeId) === 'lit';
}

// 维护服务：空洞节点信号（高频无结果搜索）、图数据加载（供扫描工具）
import { allEdges } from '../db/contentRepo.js';

// 近 N 天 matched=0 且出现次数 ≥ minCount 的查询词排行（空洞节点信号）
export function findHollowQueries(db, { minCount = 3, days = 7 } = {}) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  return db
    .prepare(
      `SELECT query, COUNT(*) AS count, MAX(created_at) AS last_at
       FROM search_logs
       WHERE matched = 0 AND created_at > ?
       GROUP BY query
       HAVING COUNT(*) >= ?
       ORDER BY count DESC, query`
    )
    .all(since, minCount);
}

// 从库中读全图（节点 id 集 + 边列表），供 detectIslands/detectCycles
export function loadGraph(db) {
  const nodes = db.prepare('SELECT id FROM nodes').all().map((r) => r.id);
  return { nodes, edges: allEdges(db) };
}

// 待办积压：pending 勘误 / 待审二创的数量与最老时间
export function pendingBacklog(db) {
  const corrections = db
    .prepare(
      "SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM corrections WHERE status = 'pending'"
    )
    .get();
  const creations = db
    .prepare(
      "SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM creations WHERE status = 'pending'"
    )
    .get();
  return {
    corrections: { count: corrections.n, oldest: corrections.oldest },
    creations: { count: creations.n, oldest: creations.oldest },
  };
}

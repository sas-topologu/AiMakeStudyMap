// 导航：路线查询（最短/全面/低难）+ 热门路径
import { Router } from 'express';
import { errors } from '../errors.js';
import { allEdges } from '../db/contentRepo.js';
import { authOptional } from '../middleware/auth.js';
import { findRoutes, hardNodeIds } from '../services/navService.js';
import { batchEffectiveStates } from '../services/stateService.js';

const TYPES = new Set(['shortest', 'full', 'easy']);

export function navRouter({ db, secret }) {
  const router = Router();

  // 路线：from（起点，通常为当前学习节点）→ to（目标）；登录时标注节点 state
  router.get('/nav/route', authOptional(secret), (req, res) => {
    const from = String(req.query.from ?? '');
    const to = String(req.query.to ?? '');
    if (!from || !to) throw errors.validation('from 与 to 不能为空');
    const type = TYPES.has(req.query.type) ? req.query.type : 'shortest';

    const nodes = db.prepare('SELECT id, title, subject, difficulty FROM nodes').all();
    const ids = new Set(nodes.map((n) => n.id));
    if (!ids.has(from)) throw errors.notFound('起点节点不存在');
    if (!ids.has(to)) throw errors.notFound('目标节点不存在');

    const edges = allEdges(db).map((e) => ({ from: e.from_id, to: e.to_id, type: e.type }));
    const hardIds = hardNodeIds(db);
    const raw = findRoutes([...ids], edges, from, to, type, { hardIds });
    if (raw.length === 0) throw errors.noRoute('该目标与当前节点无前置依赖链，建议使用跃迁');

    const states = req.user ? batchEffectiveStates(db, req.user.id, [...ids]) : null;
    const info = new Map(nodes.map((n) => [n.id, n]));
    const pack = (id) => ({
      id,
      title: info.get(id)?.title ?? id,
      subject: info.get(id)?.subject ?? '',
      difficulty: info.get(id)?.difficulty ?? 1,
      hard: hardIds.has(id),
      ...(states ? { state: states[id] } : {}),
    });
    res.json({
      type,
      from,
      to,
      routes: raw.map((r) => ({
        nodes: r.nodes.map(pack),
        ...(r.expansions
          ? { expansions: r.expansions.map((ex) => ({ at: ex.at, nodes: ex.nodes.map(pack) })) }
          : {}),
      })),
    });
  });

  // 热门路径：同时 passed/lit 了某 prerequisite 边两端节点的用户数 ≥2 的边
  router.get('/nav/hot', (req, res) => {
    const edges = db
      .prepare(
        `SELECT e.from_id AS "from", e.to_id AS "to", COUNT(DISTINCT u1.user_id) AS count
         FROM edges e
         JOIN user_node_state u1 ON u1.node_id = e.from_id AND u1.state IN ('passed', 'lit')
         JOIN user_node_state u2 ON u2.user_id = u1.user_id
                                AND u2.node_id = e.to_id AND u2.state IN ('passed', 'lit')
         WHERE e.type = 'prerequisite'
         GROUP BY e.from_id, e.to_id
         HAVING count >= 2
         ORDER BY count DESC
         LIMIT 100`
      )
      .all();
    res.json({ edges });
  });

  return router;
}

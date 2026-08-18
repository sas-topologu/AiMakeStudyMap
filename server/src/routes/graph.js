// 星图数据：邻域 BFS（深度 ≤2）、宏观全量、版本同步
import { Router } from 'express';
import { errors } from '../errors.js';
import {
  edgesOf,
  allEdges,
  getContentVersion,
  listNodesUpdatedSince,
} from '../db/contentRepo.js';
import { effectiveState, batchEffectiveStates } from '../services/stateService.js';
import { authOptional } from '../middleware/auth.js';

const clampDepth = (d) => Math.min(2, Math.max(1, d));

export function graphRouter({ db, secret }) {
  const router = Router();

  // 以节点为中心按边 BFS 扩展，深度上限 2 层；不一次性拉全库
  router.get('/graph/neighborhood/:id', authOptional(secret), (req, res) => {
    const startId = req.params.id;
    const exists = db.prepare('SELECT 1 FROM nodes WHERE id = ?').get(startId);
    if (!exists) throw errors.notFound('节点不存在');

    const depthLimit = clampDepth(Number(req.query.depth) || 2);
    const userId = req.user?.id ?? null;

    // BFS
    const depthOf = new Map([[startId, 0]]);
    let frontier = [startId];
    for (let d = 1; d <= depthLimit && frontier.length > 0; d += 1) {
      const next = [];
      for (const id of frontier) {
        const { prerequisites, successors, related } = edgesOf(db, id);
        for (const nid of [...prerequisites, ...successors, ...related]) {
          if (!depthOf.has(nid)) {
            depthOf.set(nid, d);
            next.push(nid);
          }
        }
      }
      frontier = next;
    }

    const ids = [...depthOf.keys()];
    const placeholders = ids.map(() => '?').join(',');
    const nodes = db
      .prepare(
        `SELECT id, title, subject, category, credibility, difficulty
         FROM nodes WHERE id IN (${placeholders})`
      )
      .all(...ids)
      .map((n) => ({
        ...n,
        state: effectiveState(db, userId, n.id),
        depth: depthOf.get(n.id),
      }));
    const edges = db
      .prepare(
        `SELECT from_id AS "from", to_id AS "to", type FROM edges
         WHERE from_id IN (${placeholders}) AND to_id IN (${placeholders})`
      )
      .all(...ids, ...ids);

    res.json({ nodes, edges });
  });

  // 宏观视图：轻量全量（不含正文）；登录用户批量标注有效状态
  router.get('/graph/all', authOptional(secret), (req, res) => {
    const nodes = db
      .prepare('SELECT id, title, subject, difficulty, credibility FROM nodes ORDER BY id')
      .all();
    const edges = allEdges(db).map((e) => ({ from: e.from_id, to: e.to_id, type: e.type }));
    if (req.user) {
      const states = batchEffectiveStates(db, req.user.id, nodes.map((n) => n.id));
      for (const n of nodes) n.state = states[n.id];
    }
    res.json({ nodes, edges });
  });

  // 节点库全局版本号
  router.get('/meta/version', (req, res) => {
    res.json({ contentVersion: getContentVersion(db) });
  });

  // 差异同步：返回 updated_version > since 的节点完整卡片
  router.get('/sync', (req, res) => {
    const since = Number(req.query.since) || 0;
    res.json({
      version: getContentVersion(db),
      nodes: listNodesUpdatedSince(db, since),
    });
  });

  // 更新日志（公开，倒序）
  router.get('/changelog', (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const logs = db
      .prepare('SELECT version, summary, detail, created_at FROM changelogs ORDER BY version DESC LIMIT ?')
      .all(limit)
      .map((l) => ({ version: l.version, summary: l.summary, detail: l.detail, createdAt: l.created_at }));
    res.json({ logs });
  });

  return router;
}

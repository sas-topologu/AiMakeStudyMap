// 星图分享：把用户已通关/点亮的节点导出为星座图配置，公开可读
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { errors, parseBody } from '../errors.js';
import { authRequired, quotaRefresher } from '../middleware/auth.js';

const shareSchema = z.object({
  config: z
    .object({
      theme: z.string().max(30).optional(),
      collapseRelated: z.boolean().optional(),
    })
    .default({}),
});

// nanoid 风格短 id
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
function shortId(n = 10) {
  const bytes = crypto.randomBytes(n);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function shareRouter({ db, secret }) {
  const router = Router();

  // 创建分享：取该用户全部 passed/lit 节点及其间全部边
  router.post('/share', authRequired(secret), quotaRefresher(db), (req, res) => {
    const { config } = parseBody(shareSchema, req.body);
    const id = shortId();
    db.prepare('INSERT INTO shares (id, user_id, config_json, created_at) VALUES (?, ?, ?, ?)').run(
      id,
      req.user.id,
      JSON.stringify(config),
      new Date().toISOString()
    );
    res.status(201).json({ shareId: id, url: `/share/${id}` });
  });

  // 读取分享（公开，不含敏感信息）
  router.get('/share/:id', (req, res) => {
    const share = db
      .prepare(
        `SELECT s.*, u.username AS owner FROM shares s JOIN users u ON u.id = s.user_id WHERE s.id = ?`
      )
      .get(req.params.id);
    if (!share) throw errors.notFound('分享不存在');

    const states = db
      .prepare(
        "SELECT node_id, state FROM user_node_state WHERE user_id = ? AND state IN ('passed', 'lit')"
      )
      .all(share.user_id);
    const stateOf = new Map(states.map((s) => [s.node_id, s.state]));
    const ids = [...stateOf.keys()];

    let nodes = [];
    let edges = [];
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      nodes = db
        .prepare(`SELECT id, title, subject FROM nodes WHERE id IN (${placeholders})`)
        .all(...ids)
        .map((n) => ({ ...n, state: stateOf.get(n.id) }));
      edges = db
        .prepare(
          `SELECT from_id AS "from", to_id AS "to", type FROM edges
           WHERE from_id IN (${placeholders}) AND to_id IN (${placeholders})`
        )
        .all(...ids, ...ids);
    }

    res.json({
      owner: share.owner,
      config: JSON.parse(share.config_json),
      nodes,
      edges,
    });
  });

  return router;
}

// 分级讨论区（类贴吧）+ 前十纪念碑 + 速通榜
// 注意：posts/replies 的 created_at 用 JS ISO 串存储，保证限流窗口的字符串比较正确
import { Router } from 'express';
import { z } from 'zod';
import { errors, parseBody } from '../errors.js';
import { authRequired, quotaRefresher } from '../middleware/auth.js';
import { canPost } from '../services/stateService.js';
import { promotePioneers, isPioneer, listPioneers } from '../services/pioneerService.js';

const postSchema = z.object({
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(5000),
});
const replySchema = z.object({ body: z.string().min(1).max(5000) });
const monumentSchema = z.object({ message: z.string().min(1).max(500) });

// 热度限流：最近 1 小时（帖+回复）达到阈值 → 429
// 阈值存 meta.post_rate_threshold，默认 100
function assertNotRateLimited(db, nodeId) {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'post_rate_threshold'").get();
  const threshold = row ? Number(row.value) : 100;
  const since = new Date(Date.now() - 3600_000).toISOString();
  const posts = db
    .prepare('SELECT COUNT(*) AS n FROM posts WHERE node_id = ? AND created_at > ?')
    .get(nodeId, since).n;
  const replies = db
    .prepare(
      `SELECT COUNT(*) AS n FROM replies r JOIN posts p ON p.id = r.post_id
       WHERE p.node_id = ? AND r.created_at > ?`
    )
    .get(nodeId, since).n;
  if (posts + replies >= threshold) {
    throw errors.rateLimited('该节点讨论热度过高，已开启限制发言模式，请稍后再试');
  }
}

// 速通榜前 10 的用户 id → 名次（用于发言标记与排序加权）
function topRanks(db, nodeId) {
  const rows = db
    .prepare(
      `SELECT user_id FROM user_node_state
       WHERE node_id = ? AND state = 'lit' AND pass_seconds IS NOT NULL
       ORDER BY pass_seconds ASC LIMIT 10`
    )
    .all(nodeId);
  return new Map(rows.map((r, i) => [r.user_id, i + 1]));
}

export function postsRouter({ db, secret }) {
  const router = Router();
  const guard = [authRequired(secret), quotaRefresher(db)];

  // ---- 纪念碑 ----
  router.get('/nodes/:id/monument', (req, res) => {
    promotePioneers(db); // 懒提升
    const pioneers = listPioneers(db, req.params.id).map((p) => ({
      username: p.username,
      message: p.message,
      createdAt: p.created_at,
      certified: p.certified === 1, // 只标「已认证」；未认证的照常展示、不带任何标记
    }));
    res.json({ pioneers });
  });

  // 拓荒者留言：每人一条（upsert），同步置顶到讨论区
  router.post('/nodes/:id/monument', ...guard, (req, res) => {
    promotePioneers(db);
    const nodeId = req.params.id;
    if (!isPioneer(db, nodeId, req.user.id)) {
      throw errors.forbidden('仅拓荒者可在纪念碑留言');
    }
    const { message } = parseBody(monumentSchema, req.body);
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare('UPDATE pioneers SET message = ? WHERE node_id = ? AND user_id = ?').run(
        message,
        nodeId,
        req.user.id
      );
      // 同步一条置顶帖（已存在则更新内容），使纪念碑在讨论区置顶展示
      const existing = db
        .prepare('SELECT id FROM posts WHERE node_id = ? AND user_id = ? AND is_pioneer = 1')
        .get(nodeId, req.user.id);
      if (existing) {
        db.prepare('UPDATE posts SET body = ?, pinned = 1 WHERE id = ?').run(message, existing.id);
      } else {
        db.prepare(
          `INSERT INTO posts (node_id, user_id, title, body, is_pioneer, pinned, created_at)
           VALUES (?, ?, ?, ?, 1, 1, ?)`
        ).run(nodeId, req.user.id, '拓荒者纪念碑', message, now);
      }
    })();
    res.json({ ok: true });
  });

  // ---- 讨论区 ----
  // 列表：置顶（纪念碑+pinned）→ 速通前 10 作者帖 → 普通帖（时间倒序）
  router.get('/nodes/:id/posts', (req, res) => {
    promotePioneers(db); // 懒提升
    const nodeId = req.params.id;
    const rankOf = topRanks(db, nodeId);
    const pioneerIds = new Set(
      db.prepare('SELECT user_id FROM pioneers WHERE node_id = ?').all(nodeId).map((r) => r.user_id)
    );
    const rows = db
      .prepare(
        `SELECT p.*, u.username,
                (SELECT COUNT(*) FROM replies r WHERE r.post_id = p.id) AS replyCount
         FROM posts p JOIN users u ON u.id = p.user_id
         WHERE p.node_id = ? AND p.hidden = 0`
      )
      .all(nodeId);

    const posts = rows
      .map((p) => ({
        id: p.id,
        title: p.title,
        excerpt: p.body.slice(0, 100),
        author: p.username,
        authorRank: rankOf.get(p.user_id) ?? null, // 速通前 10 标记
        isPioneer: p.is_pioneer === 1 || pioneerIds.has(p.user_id),
        pinned: p.pinned,
        replyCount: p.replyCount,
        createdAt: p.created_at,
      }))
      .sort((a, b) => {
        if (b.pinned !== a.pinned) return b.pinned - a.pinned; // 置顶在前
        const ra = a.authorRank ?? Infinity;
        const rb = b.authorRank ?? Infinity;
        if (ra !== rb) return ra - rb; // 高排名作者其次（提高推送概率）
        return b.createdAt.localeCompare(a.createdAt); // 其余时间倒序
      });
    res.json({ posts });
  });

  // 发帖：登录 + passed 及以上 + 限流
  router.post('/nodes/:id/posts', ...guard, (req, res) => {
    const nodeId = req.params.id;
    if (!canPost(db, req.user.id, nodeId)) {
      throw errors.forbiddenState('节点通关后才可发言');
    }
    assertNotRateLimited(db, nodeId);
    const { title, body } = parseBody(postSchema, req.body);
    const info = db
      .prepare(
        'INSERT INTO posts (node_id, user_id, title, body, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(nodeId, req.user.id, title, body, new Date().toISOString());
    res.status(201).json({ id: info.lastInsertRowid });
  });

  // 帖子详情 + 回复（时间正序）
  router.get('/posts/:id', (req, res) => {
    const post = db
      .prepare(
        `SELECT p.*, u.username FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ? AND p.hidden = 0`
      )
      .get(req.params.id);
    if (!post) throw errors.notFound('帖子不存在');
    const rankOf = topRanks(db, post.node_id);
    const replies = db
      .prepare(
        `SELECT r.id, r.body, r.created_at, u.username
         FROM replies r JOIN users u ON u.id = r.user_id
         WHERE r.post_id = ? ORDER BY r.created_at`
      )
      .all(post.id)
      .map((r) => ({ id: r.id, author: r.username, body: r.body, createdAt: r.created_at }));
    res.json({
      id: post.id,
      nodeId: post.node_id,
      title: post.title,
      body: post.body,
      author: post.username,
      authorRank: rankOf.get(post.user_id) ?? null,
      isPioneer: post.is_pioneer === 1 || isPioneer(db, post.node_id, post.user_id),
      pinned: post.pinned,
      createdAt: post.created_at,
      replies,
    });
  });

  // 回复：登录 + passed 及以上（按帖子所属节点判定）+ 限流（回复计入节点热度）
  router.post('/posts/:id/replies', ...guard, (req, res) => {
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
    if (!post) throw errors.notFound('帖子不存在');
    if (!canPost(db, req.user.id, post.node_id)) {
      throw errors.forbiddenState('节点通关后才可发言');
    }
    assertNotRateLimited(db, post.node_id);
    const { body } = parseBody(replySchema, req.body);
    const info = db
      .prepare('INSERT INTO replies (post_id, user_id, body, created_at) VALUES (?, ?, ?, ?)')
      .run(post.id, req.user.id, body, new Date().toISOString());
    res.status(201).json({ id: info.lastInsertRowid });
  });

  // ---- 速通榜 ----
  router.get('/nodes/:id/speedrun', (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 50));
    const rows = db
      .prepare(
        `SELECT u.username, s.pass_seconds, s.lit_at, s.certified
         FROM user_node_state s JOIN users u ON u.id = s.user_id
         WHERE s.node_id = ? AND s.state = 'lit' AND s.pass_seconds IS NOT NULL
         ORDER BY s.pass_seconds ASC LIMIT ?`
      )
      .all(req.params.id, limit);
    res.json({
      ranks: rows.map((r, i) => ({
        rank: i + 1,
        username: r.username,
        seconds: r.pass_seconds,
        litAt: r.lit_at,
        certified: r.certified === 1, // 只标「已认证」；未认证的照常上榜、不带任何标记
      })),
    });
  });

  return router;
}

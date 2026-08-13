// 二创区 + 管理端审核
import { Router } from 'express';
import { z } from 'zod';
import { errors, parseBody } from '../errors.js';
import { authRequired, adminRequired, quotaRefresher } from '../middleware/auth.js';
import { canCreate } from '../services/stateService.js';

const creationSchema = z.object({
  type: z.enum(['mindmap', 'game', 'summary']),
  title: z.string().min(1).max(80),
  content: z.string().min(1).max(20000), // 文本/JSON/URL，不做文件上传
});
const reviewSchema = z.object({ action: z.enum(['approve', 'reject']) });
const correctionReviewSchema = z.object({
  action: z.enum(['approve', 'reject']),
  note: z.string().max(500).optional(),
});
const changelogSchema = z.object({
  version: z.number().int().min(1),
  summary: z.string().min(1).max(200),
  detail: z.string().max(5000).optional(),
});

export function creationsRouter({ db, secret }) {
  const router = Router();

  // 已审核二创列表（任何状态可读）
  router.get('/nodes/:id/creations', (req, res) => {
    const rows = db
      .prepare(
        `SELECT c.id, c.type, c.title, c.content, c.created_at, u.username
         FROM creations c JOIN users u ON u.id = c.user_id
         WHERE c.node_id = ? AND c.status = 'approved'
         ORDER BY c.created_at DESC`
      )
      .all(req.params.id);
    res.json({
      creations: rows.map((c) => ({
        id: c.id,
        type: c.type,
        title: c.title,
        content: c.content,
        author: c.username,
        createdAt: c.created_at,
      })),
    });
  });

  // 上传二创：登录 + 点亮（lit）→ 进入待审核
  router.post('/nodes/:id/creations', authRequired(secret), quotaRefresher(db), (req, res) => {
    const nodeId = req.params.id;
    if (!canCreate(db, req.user.id, nodeId)) {
      throw errors.forbiddenState('节点点亮后才可上传二创');
    }
    const { type, title, content } = parseBody(creationSchema, req.body);
    const info = db
      .prepare(
        `INSERT INTO creations (node_id, user_id, type, title, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(nodeId, req.user.id, type, title, content, new Date().toISOString());
    res.status(201).json({ id: info.lastInsertRowid, status: 'pending' });
  });

  return router;
}

// 管理端：审核队列（adminRequired 挂在具体路由上，避免 router.use 拦截全部 /api 请求）
export function adminRouter({ db, secret }) {
  const router = Router();
  const admin = adminRequired(secret, db);

  router.get('/admin/review-queue', admin, (req, res) => {
    const rows = db
      .prepare(
        `SELECT c.*, u.username FROM creations c JOIN users u ON u.id = c.user_id
         WHERE c.status = 'pending' ORDER BY c.created_at`
      )
      .all();
    const corrections = db
      .prepare(
        `SELECT c.*, u.username, n.title AS node_title FROM corrections c
         JOIN users u ON u.id = c.user_id
         JOIN nodes n ON n.id = c.node_id
         WHERE c.status = 'pending' ORDER BY c.created_at`
      )
      .all();
    res.json({
      creations: rows.map((c) => ({
        id: c.id,
        nodeId: c.node_id,
        type: c.type,
        title: c.title,
        content: c.content,
        author: c.username,
        createdAt: c.created_at,
      })),
      corrections: corrections.map((c) => ({
        id: c.id,
        nodeId: c.node_id,
        nodeTitle: c.node_title,
        author: c.username,
        body: c.body,
        createdAt: c.created_at,
      })),
    });
  });

  router.post('/admin/review/creations/:id', admin, (req, res) => {
    const { action } = parseBody(reviewSchema, req.body);
    const info = db
      .prepare(
        "UPDATE creations SET status = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'"
      )
      .run(action === 'approve' ? 'approved' : 'rejected', new Date().toISOString(), req.params.id);
    if (info.changes === 0) throw errors.notFound('待审核二创不存在');
    res.json({ ok: true, status: action === 'approve' ? 'approved' : 'rejected' });
  });

  // 勘误审核：approve = 接受为待办任务（合并需改源卡后跑 npm run import，见 corrections.js 注释）
  router.post('/admin/review/corrections/:id', admin, (req, res) => {
    const { action, note } = parseBody(correctionReviewSchema, req.body);
    const info = db
      .prepare(
        "UPDATE corrections SET status = ?, review_note = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'"
      )
      .run(
        action === 'approve' ? 'approved' : 'rejected',
        note ?? null,
        new Date().toISOString(),
        req.params.id
      );
    if (info.changes === 0) throw errors.notFound('待审核勘误不存在');
    res.json({ ok: true, status: action === 'approve' ? 'approved' : 'rejected' });
  });

  // 人工补充/修订某版本的更新说明（同 version 已存在则覆盖 summary/detail）
  router.post('/admin/changelog', admin, (req, res) => {
    const { version, summary, detail } = parseBody(changelogSchema, req.body);
    db.prepare(
      `INSERT INTO changelogs (version, summary, detail, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(version) DO UPDATE SET summary = excluded.summary, detail = excluded.detail`
    ).run(version, summary, detail ?? null, new Date().toISOString());
    res.json({ ok: true, version });
  });

  return router;
}

// 勘误：用户提交修改建议 → 待办任务 → 审核
// 语义说明：approve 表示「接受为待办任务」；真正合并由维护者按《知识卡制作规范》
// 修改 content/cards 源卡后跑 npm run import 完成版本迭代（本阶段不做自动改卡）
import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { ApiError, errors, parseBody } from '../errors.js';
import { authRequired, quotaRefresher } from '../middleware/auth.js';

const correctionSchema = z.object({
  body: z.string().min(5, '勘误内容至少 5 字').max(2000),
});

export function correctionsRouter({ db, secret }) {
  const router = Router();
  const guard = [authRequired(secret), quotaRefresher(db)];

  // 提交勘误：登录即可（任何状态用户都能提交，这是纠错入口不是发言）
  router.post('/nodes/:id/corrections', ...guard, (req, res) => {
    const nodeId = req.params.id;
    const node = db.prepare('SELECT 1 FROM nodes WHERE id = ?').get(nodeId);
    if (!node) throw errors.notFound('节点不存在');
    const { body } = parseBody(correctionSchema, req.body);

    // 每人每节点 pending 状态下去重
    const dup = db
      .prepare(
        "SELECT 1 FROM corrections WHERE node_id = ? AND user_id = ? AND status = 'pending'"
      )
      .get(nodeId, req.user.id);
    if (dup) {
      throw new ApiError(409, 'VALIDATION', '你已有一条待处理的勘误，请勿重复提交');
    }

    const info = db
      .prepare('INSERT INTO corrections (node_id, user_id, body, created_at) VALUES (?, ?, ?, ?)')
      .run(nodeId, req.user.id, body, new Date().toISOString());
    // 建一条 correction_review 任务，由管理 Agent 桥审核（批准/驳回）
    const taskId = crypto.randomBytes(8).toString('hex');
    db.prepare(
      "INSERT INTO ai_tasks (id, type, role, status, subject_id, created_at) VALUES (?, 'correction_review', 'operator', 'pending', ?, ?)"
    ).run(taskId, String(info.lastInsertRowid), new Date().toISOString());
    res.status(201).json({ id: info.lastInsertRowid, status: 'pending', taskId });
  });

  // 我的勘误及处理状态
  router.get('/corrections/mine', ...guard, (req, res) => {
    const rows = db
      .prepare(
        `SELECT c.*, n.title AS node_title FROM corrections c
         JOIN nodes n ON n.id = c.node_id
         WHERE c.user_id = ? ORDER BY c.created_at DESC`
      )
      .all(req.user.id);
    res.json({
      corrections: rows.map((c) => ({
        id: c.id,
        nodeId: c.node_id,
        nodeTitle: c.node_title,
        body: c.body,
        status: c.status,
        reviewNote: c.review_note,
        createdAt: c.created_at,
        reviewedAt: c.reviewed_at,
      })),
    });
  });

  return router;
}

// 举报/滥用流程：用户举报帖子/回复/二创/纪念碑/节点 → 建 report_review 任务 → 管理 AI 初审
// （回写 verdict: remove→隐藏内容 / dismissed→不予处理），全程留档。
import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { errors, parseBody } from '../errors.js';
import { authRequired } from '../middleware/auth.js';

const reportSchema = z.object({
  targetType: z.enum(['post', 'reply', 'creation', 'monument', 'node']),
  targetId: z.string().min(1),
  reason: z.string().min(4, '请填写举报原因（至少 4 字）'),
});

const shortId = () => crypto.randomBytes(8).toString('hex');
const nowIso = () => new Date().toISOString();

export function reportsRouter({ db, secret }) {
  const router = Router();
  const isAdmin = (userId) => db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId)?.is_admin === 1;

  // 提交举报：存 pending + 建 report_review 任务（管理桥处理）
  router.post('/reports', authRequired(secret), (req, res) => {
    const { targetType, targetId, reason } = parseBody(reportSchema, req.body);
    const info = db
      .prepare(
        "INSERT INTO reports (target_type, target_id, reporter_id, reason, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)"
      )
      .run(targetType, targetId, req.user.id, reason, nowIso());
    const taskId = shortId();
    db.prepare(
      "INSERT INTO ai_tasks (id, type, role, status, subject_id, created_at) VALUES (?, 'report_review', 'operator', 'pending', ?, ?)"
    ).run(taskId, String(info.lastInsertRowid), nowIso());
    res.status(201).json({ ok: true, reportId: info.lastInsertRowid, taskId, status: 'pending' });
  });

  // 查询举报（本用户提交的）
  router.get('/reports/mine', authRequired(secret), (req, res) => {
    const list = db
      .prepare('SELECT id, target_type, target_id, reason, status, verdict, created_at, resolved_at FROM reports WHERE reporter_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(req.user.id);
    res.json({ reports: list });
  });

  // 管理面板：举报队列（管理员）
  router.get('/reports', authRequired(secret), (req, res) => {
    if (!isAdmin(req.user.id)) throw errors.forbidden('需管理员权限');
    const list = db
      .prepare("SELECT * FROM reports WHERE status IN ('pending', 'actioned') ORDER BY created_at DESC LIMIT 100")
      .all();
    res.json({ reports: list });
  });

  return router;
}

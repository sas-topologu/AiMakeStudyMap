// AI 任务桥：服务端管理 Agent（外部执行者，平台所有者配置）通过任务队列接入。
// - GET  /api/ai-tasks                    拉取待处理任务（仅管理员；管理桥按间隔轮询）
// - GET  /api/ai-tasks/:id                读任务详情（card_review 返回投稿卡供 AI 审核）
// - POST /api/ai-tasks/:id/result         回写一审结论：approve → 进公示(ai_reviewed)，reject → 打回
// - POST /api/ai-tasks/finalize           （第三方/社区终审）对公示中卡 approve(提前入库)/reopen(异议)
// - POST /api/ai-tasks/settle-expired     公示到期自动通过（管理桥轮询调用）
// 执行者鉴权：管理任务需管理员 JWT（admin 用户登录后带 token 调用；管理桥可配置账号自动登录）。
import { Router } from 'express';
import { errors } from '../errors.js';
import { authRequired } from '../middleware/auth.js';
import {
  validateCards, nowIso, markAiReviewed, finalize, markReopened, settleExpired,
} from '../services/cardIngest.js';

export function aiTasksRouter({ db, secret }) {
  const router = Router();
  // req.user（jwt 解码）不含 is_admin，这里查库判定（仅本路由用，避免全局开销）
  const isAdmin = (userId) => db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId)?.is_admin === 1;

  // 拉取任务队列（管理员；role 默认 operator）
  router.get('/ai-tasks', authRequired(secret), (req, res) => {
    if (!isAdmin(req.user.id)) throw errors.forbidden('需管理员权限访问管理任务');
    const role = req.query.role === 'member' ? 'member' : 'operator';
    const list = db
      .prepare(
        'SELECT id, type, subject_id, created_at FROM ai_tasks WHERE role = ? AND status = ? ORDER BY created_at LIMIT 20'
      )
      .all(role, 'pending');
    res.json({
      tasks: list.map((t) => ({ id: t.id, type: t.type, subjectId: t.subject_id, createdAt: t.created_at })),
    });
  });

  // 读单个任务详情（管理员）：card_review 返回投稿卡内容供管理 AI 审核
  router.get('/ai-tasks/:id', authRequired(secret), (req, res) => {
    if (!isAdmin(req.user.id)) throw errors.forbidden('需管理员权限管理任务');
    const task = db.prepare('SELECT * FROM ai_tasks WHERE id = ?').get(req.params.id);
    if (!task) throw errors.notFound('任务不存在');
    let card = null;
    if (task.type === 'card_review') {
      const sub = db.prepare('SELECT * FROM card_submissions WHERE id = ?').get(task.subject_id);
      if (sub) {
        const parsed = JSON.parse(sub.card_json);
        card = parsed.length === 1 ? parsed[0] : parsed;
      }
    }
    res.json({ id: task.id, type: task.type, status: task.status, subjectId: task.subject_id, card });
  });

  // 回写一审结论（管理员）：approve → 进公示(ai_reviewed)待复审；reject → 打回
  router.post('/ai-tasks/:id/result', authRequired(secret), (req, res) => {
    if (!isAdmin(req.user.id)) throw errors.forbidden('需管理员权限管理任务');
    const { verdict, reason, model } = req.body;
    const task = db.prepare("SELECT * FROM ai_tasks WHERE id = ? AND status = 'pending'").get(req.params.id);
    if (!task) throw errors.notFound('任务不存在或已处理');
    const doneAt = nowIso();
    if (task.type === 'card_review') {
      const sub = db.prepare("SELECT * FROM card_submissions WHERE id = ? AND status = 'pending'").get(task.subject_id);
      if (!sub) throw errors.notFound('投稿不存在或已处理');
      const cards = JSON.parse(sub.card_json);
      if (verdict === 'approve') {
        // 入库前再次校验；通过则进公示窗口（不立即入库）
        const check = validateCards(db, cards);
        const status = check.ok ? 'ai_reviewed' : 'rejected';
        const due = check.ok ? markAiReviewed(db, sub.id, '') : null;
        if (!check.ok) {
          db.prepare("UPDATE card_submissions SET status='rejected', reason=?, reviewed_at=? WHERE id=?")
            .run(check.errors.join('\n'), doneAt, sub.id);
        }
        db.prepare(
          "UPDATE ai_tasks SET status='done', verdict=?, result_json=?, model=?, done_at=? WHERE id=?"
        ).run(
          check.ok ? 'approve' : 'reject',
          JSON.stringify({ status, reviewExpireAt: due, reason: check.ok ? undefined : check.errors }),
          model ?? null, doneAt, task.id
        );
        return res.json({ ok: true, status, reviewExpireAt: due, reason: check.ok ? undefined : check.errors });
      }
      // reject（打回）
      const rejectReason = reason || 'AI 审核未通过';
      db.prepare(
        "UPDATE card_submissions SET status='rejected', reason=?, reviewed_at=? WHERE id=?"
      ).run(rejectReason, doneAt, sub.id);
      db.prepare(
        "UPDATE ai_tasks SET status='done', verdict='reject', result_json=?, model=?, done_at=? WHERE id=?"
      ).run(JSON.stringify({ reason: rejectReason }), model ?? null, doneAt, task.id);
      return res.json({ ok: true, status: 'rejected', reason: rejectReason });
    }
    // 其他任务类型（correction/report/legal）
    db.prepare(
      "UPDATE ai_tasks SET status='done', verdict=?, result_json=?, model=?, done_at=? WHERE id=?"
    ).run(verdict ?? 'done', JSON.stringify(req.body), model ?? null, doneAt, task.id);
    res.json({ ok: true, status: 'done' });
  });

  // 公示期终审（第三方/社区）：approve 提前入库；reopen 标记异议
  router.post('/ai-tasks/finalize', authRequired(secret), (req, res) => {
    if (!isAdmin(req.user.id)) throw errors.forbidden('需管理员权限管理任务');
    const { submissionId, verdict, reason, actor = 'thirdparty' } = req.body;
    const sub = db.prepare("SELECT * FROM card_submissions WHERE id = ? AND status = 'ai_reviewed'").get(submissionId);
    if (!sub) throw errors.notFound('投稿不存在或不在公示期');
    const cards = JSON.parse(sub.card_json);
    if (verdict === 'approve') {
      const check = validateCards(db, cards);
      if (!check.ok) {
        return res.status(400).json({ ok: false, errors: check.errors });
      }
      const r = finalize(db, submissionId, cards);
      return res.json({ ok: true, status: 'approved', actor, ...r });
    }
    markReopened(db, submissionId, reason || `${actor} 提出异议`);
    res.json({ ok: true, status: 'reopened', actor });
  });

  // 公示到期自动通过（管理桥轮询调用；也供测试/定时）
  router.post('/ai-tasks/settle-expired', authRequired(secret), (req, res) => {
    if (!isAdmin(req.user.id)) throw errors.forbidden('需管理员权限管理任务');
    const settled = settleExpired(db);
    res.json({ ok: true, settled });
  });

  return router;
}

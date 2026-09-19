// AI 任务桥：群体端管理 Agent（外部执行者，平台所有者配置）通过任务队列接入。
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

  // 管理面板聚合（管理员抽查留档）：投稿/举报/勘误队列 + 任务计数
  router.get('/ai-tasks/manage', authRequired(secret), (req, res) => {
    if (!isAdmin(req.user.id)) throw errors.forbidden('需管理员权限');
    const submissions = db
      .prepare('SELECT id, node_id, user_id, status, review_due_at, created_at, reviewed_at FROM card_submissions ORDER BY created_at DESC LIMIT 100')
      .all();
    const reports = db
      .prepare("SELECT id, target_type, target_id, reason, status, verdict, created_at FROM reports WHERE status IN ('pending','actioned') ORDER BY created_at DESC LIMIT 100")
      .all();
    const corrections = db
      .prepare("SELECT c.id, c.node_id, n.title AS node_title, c.body, c.status, c.review_note, c.created_at FROM corrections c JOIN nodes n ON n.id=c.node_id WHERE c.status='pending' ORDER BY c.created_at DESC LIMIT 100")
      .all();
    const pendingTasks = db.prepare("SELECT type, COUNT(*) n FROM ai_tasks WHERE status='pending' GROUP BY type").all();
    res.json({ submissions, reports, corrections, pendingTasks });
  });

  // 读单个任务详情（管理员）：card_review 返回投稿卡；report_review 返回被举报内容（供 AI 初审）
  router.get('/ai-tasks/:id', authRequired(secret), (req, res) => {
    if (!isAdmin(req.user.id)) throw errors.forbidden('需管理员权限管理任务');
    const task = db.prepare('SELECT * FROM ai_tasks WHERE id = ?').get(req.params.id);
    if (!task) throw errors.notFound('任务不存在');
    let card = null;
    let reported = null;
    if (task.type === 'card_review') {
      const sub = db.prepare('SELECT * FROM card_submissions WHERE id = ?').get(task.subject_id);
      if (sub) {
        const parsed = JSON.parse(sub.card_json);
        card = parsed.length === 1 ? parsed[0] : parsed;
      }
    } else if (task.type === 'report_review') {
      const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(task.subject_id);
      if (report) reported = { ...report, content: readTargetContent(db, report.target_type, report.target_id) };
    } else if (task.type === 'correction_review') {
      const corr = db
        .prepare(
          `SELECT c.*, n.title AS node_title FROM corrections c JOIN nodes n ON n.id = c.node_id WHERE c.id = ?`
        )
        .get(task.subject_id);
      reported = corr ?? null;
    }
    res.json({ id: task.id, type: task.type, status: task.status, subjectId: task.subject_id, card, reported });
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
    // 举报任务：remove → 隐藏目标内容；否则标记 dismissed
    if (task.type === 'report_review') {
      const report = db.prepare("SELECT * FROM reports WHERE id = ? AND status = 'pending'").get(task.subject_id);
      if (!report) throw errors.notFound('举报不存在或已处理');
      if (verdict === 'remove') {
        hideTarget(db, report.target_type, report.target_id);
        db.prepare("UPDATE reports SET status='actioned', verdict='remove', resolved_at=? WHERE id=?").run(doneAt, report.id);
      } else {
        db.prepare("UPDATE reports SET status='dismissed', verdict=?, resolved_at=? WHERE id=?").run(verdict ?? 'dismissed', doneAt, report.id);
      }
      db.prepare(
        "UPDATE ai_tasks SET status='done', verdict=?, result_json=?, model=?, done_at=? WHERE id=?"
      ).run(verdict ?? 'dismissed', JSON.stringify(req.body), model ?? null, doneAt, task.id);
      return res.json({ ok: true, status: verdict === 'remove' ? 'actioned' : 'dismissed' });
    }
    // 勘误任务：approve → 受理（status approved）；reject → 驳回并留 review_note
    if (task.type === 'correction_review') {
      const corr = db.prepare("SELECT * FROM corrections WHERE id = ? AND status = 'pending'").get(task.subject_id);
      if (!corr) throw errors.notFound('勘误不存在或已处理');
      const approved = verdict === 'approve';
      db.prepare(
        "UPDATE corrections SET status=?, review_note=?, reviewed_at=? WHERE id=?"
      ).run(approved ? 'approved' : 'rejected', reason || '', doneAt, corr.id);
      db.prepare(
        "UPDATE ai_tasks SET status='done', verdict=?, result_json=?, model=?, done_at=? WHERE id=?"
      ).run(approved ? 'approve' : 'reject', JSON.stringify(req.body), model ?? null, doneAt, task.id);
      return res.json({ ok: true, status: approved ? 'approved' : 'rejected' });
    }

    // 其他任务类型（legal）
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

// 读取被举报对象内容（供管理 AI 初审；举报即授权查看该对象）
function readTargetContent(db, type, id) {
  const t = {
    post: () => db.prepare('SELECT id, node_id, title, body, user_id, created_at FROM posts WHERE id = ?').get(id),
    reply: () => db.prepare('SELECT id, post_id, body, user_id, created_at FROM replies WHERE id = ?').get(id),
    creation: () => db.prepare('SELECT id, node_id, type, title, content, user_id, created_at FROM creations WHERE id = ?').get(id),
    monument: () => db.prepare('SELECT node_id, message, user_id, created_at FROM pioneers WHERE node_id = ? AND message != ?').get(id, ''),
    node: () => { const n = db.prepare('SELECT id, title, subject, summary FROM nodes WHERE id = ?').get(id); return n; },
  }[type];
  return t ? t() : null;
}

// 隐藏目标内容（remove）：置对应表 hidden=1；node 无 hidden 列（知识卡走勘误/审核，不隐藏）
function hideTarget(db, type, id) {
  const table = { post: 'posts', reply: 'replies', creation: 'creations', monument: 'pioneers' }[type];
  if (!table) return;
  db.prepare(`UPDATE ${table} SET hidden = 1 WHERE id = ?`).run(id);
}

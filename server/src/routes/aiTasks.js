// AI 任务桥：服务端管理 Agent（外部执行者，平台所有者配置）通过任务队列接入。
// - GET  /api/ai-tasks      拉取待处理任务（仅管理员；管理桥按间隔轮询）
// - POST /api/ai-tasks/:id/result  回写判定；按任务类型执行状态机（card_review：过审入库/打回）
// 执行者鉴权：管理任务需管理员 JWT（admin 用户登录后带 token 调用；管理桥可配置账号自动登录）。
import { Router } from 'express';
import { errors } from '../errors.js';
import { authRequired } from '../middleware/auth.js';
import { insertCards, validateCards, nowIso } from '../services/cardIngest.js';

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
        card = parsed.length === 1 ? parsed[0] : parsed; // 单卡直接给对象，多卡给数组
      }
    }
    res.json({ id: task.id, type: task.type, status: task.status, subjectId: task.subject_id, card });
  });

  // 回写任务结果（管理员）；card_review 过审 → 入库，拒绝 → 打回
  router.post('/ai-tasks/:id/result', authRequired(secret), (req, res) => {
    if (!isAdmin(req.user.id)) throw errors.forbidden('需管理员权限管理任务');
    const { verdict, reason, model } = req.body;
    const task = db.prepare("SELECT * FROM ai_tasks WHERE id = ? AND status = 'pending'").get(req.params.id);
    if (!task) throw errors.notFound('任务不存在或已处理');

    const doneAt = nowIso();

    // 按类型执行状态机
    if (task.type === 'card_review') {
      const sub = db.prepare("SELECT * FROM card_submissions WHERE id = ? AND status = 'pending'").get(task.subject_id);
      if (!sub) throw errors.notFound('投稿不存在或已处理');
      const cards = JSON.parse(sub.card_json);
      if (verdict === 'approve') {
        // 入库前再次校验（防入库前被篡改/悬空）
        const check = validateCards(db, cards);
        if (!check.ok) {
          // 校验失败：打回并记录
          db.prepare(
            "UPDATE card_submissions SET status='rejected', reason=?, reviewed_at=? WHERE id=?"
          ).run(check.errors.join('\n'), doneAt, sub.id);
          db.prepare(
            "UPDATE ai_tasks SET status='done', verdict='reject', result_json=?, model=?, done_at=? WHERE id=?"
          ).run(JSON.stringify({ reason: check.errors }), model ?? null, doneAt, task.id);
          return res.json({ ok: true, status: 'rejected', reason: check.errors });
        }
        const r = insertCards(db, cards);
        db.prepare(
          "UPDATE card_submissions SET status='approved', reviewed_at=? WHERE id=?"
        ).run(doneAt, sub.id);
        db.prepare(
          "UPDATE ai_tasks SET status='done', verdict='approve', result_json=?, model=?, done_at=? WHERE id=?"
        ).run(JSON.stringify(r), model ?? null, doneAt, task.id);
        return res.json({ ok: true, status: 'approved', ...r });
      }
      // reject
      const rejectReason = reason || 'AI 审核未通过';
      db.prepare(
        "UPDATE card_submissions SET status='rejected', reason=?, reviewed_at=? WHERE id=?"
      ).run(rejectReason, doneAt, sub.id);
      db.prepare(
        "UPDATE ai_tasks SET status='done', verdict='reject', result_json=?, model=?, done_at=? WHERE id=?"
      ).run(JSON.stringify({ reason: rejectReason }), model ?? null, doneAt, task.id);
      return res.json({ ok: true, status: 'rejected', reason: rejectReason });
    }

    // 其他任务类型（correction/report/legal）暂只标记完成并留档
    db.prepare(
      "UPDATE ai_tasks SET status='done', verdict=?, result_json=?, model=?, done_at=? WHERE id=?"
    ).run(verdict ?? 'done', JSON.stringify(req.body), model ?? null, doneAt, task.id);
    res.json({ ok: true, status: 'done' });
  });

  return router;
}

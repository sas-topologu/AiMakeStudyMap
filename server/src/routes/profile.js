// 个人数据导出：把与个人高度相关的内容聚合为一份结构化数据，
// 供「个人知识画像文档」生成（发给 AI 可迅速了解用户，用于训练个人助手）。
// 覆盖：闯关进度（每节点状态/通关用时/点亮时间）、学习投入（每日时长）、
// 公开发布内容（讨论帖/回复/纪念碑/二创/勘误）、分享记录。
// 说明：刷题试卷存内存不持久化，无法导出；search_logs 无 user_id（全局空洞信号），不归属个人。
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';

function nowIso() {
  return new Date().toISOString();
}

export function profileRouter({ db, secret }) {
  const router = Router();

  // 聚合当前用户全部可导出个人数据（仅本人可读）
  router.get('/profile/export', authRequired(secret), (req, res) => {
    const uid = req.user.id;

    const user = db
      .prepare('SELECT id, username, created_at FROM users WHERE id = ?')
      .get(uid);

    // 全部节点 + 用户状态（不在表中的节点 = dim 未学）
    const allNodes = db
      .prepare('SELECT id, title, subject, difficulty FROM nodes ORDER BY subject, id')
      .all();
    const states = db
      .prepare(
        'SELECT node_id, state, pass_seconds, lit_at FROM user_node_state WHERE user_id = ?'
      )
      .all(uid);
    const stateOf = new Map(states.map((s) => [s.node_id, s]));
    const nodes = allNodes.map((n) => {
      const st = stateOf.get(n.id);
      return {
        id: n.id,
        title: n.title,
        subject: n.subject,
        difficulty: n.difficulty,
        state: st?.state ?? null,
        passSeconds: st?.pass_seconds ?? null,
        litAt: st?.lit_at ?? null,
      };
    });

    // 每日学习时长
    const daily = db
      .prepare('SELECT day, seconds FROM daily_usage WHERE user_id = ? ORDER BY day')
      .all(uid);

    // 我发起的讨论帖 + 每帖全部回复（标注是否本人）
    const posts = db
      .prepare(
        `SELECT p.id, p.node_id, p.title, p.body, p.created_at, n.title AS "nodeTitle"
         FROM posts p JOIN nodes n ON n.id = p.node_id
         WHERE p.user_id = ? ORDER BY p.created_at`
      )
      .all(uid)
      .map((p) => ({
        ...p,
        replies: db
          .prepare(
            `SELECT r.id, r.user_id, r.body, r.created_at, u.username
             FROM replies r JOIN users u ON u.id = r.user_id
             WHERE r.post_id = ? ORDER BY r.created_at`
          )
          .all(p.id)
          .map((r) => ({ ...r, isMine: r.user_id === uid, user_id: undefined })),
        user_id: undefined,
      }));

    // 我在他人帖子下的回复（自己帖子里的已随帖列出，避免重复）
    const replies = db
      .prepare(
        `SELECT r.id, r.post_id, r.body, r.created_at,
                p.title AS "postTitle", p.node_id, n.title AS "nodeTitle"
         FROM replies r
         JOIN posts p ON p.id = r.post_id
         JOIN nodes n ON n.id = p.node_id
         WHERE r.user_id = ? AND p.user_id != ?
         ORDER BY r.created_at`
      )
      .all(uid, uid);

    // 拓荒者纪念碑留言
    const monument = db
      .prepare(
        `SELECT p.node_id, p.message, p.created_at, n.title AS "nodeTitle"
         FROM pioneers p JOIN nodes n ON n.id = p.node_id
         WHERE p.user_id = ? ORDER BY p.created_at`
      )
      .all(uid);

    // 二创作品（含审核状态）
    const creations = db
      .prepare(
        `SELECT c.node_id, c.type, c.title, c.content, c.status, c.created_at, n.title AS "nodeTitle"
         FROM creations c JOIN nodes n ON n.id = c.node_id
         WHERE c.user_id = ? ORDER BY c.created_at`
      )
      .all(uid);

    // 勘误提交
    const corrections = db
      .prepare(
        `SELECT c.node_id, c.body, c.status, c.created_at, n.title AS "nodeTitle"
         FROM corrections c JOIN nodes n ON n.id = c.node_id
         WHERE c.user_id = ? ORDER BY c.created_at`
      )
      .all(uid);

    // 分享记录
    const shares = db
      .prepare('SELECT id, config_json, created_at FROM shares WHERE user_id = ? ORDER BY created_at DESC')
      .all(uid)
      .map((s) => ({ ...s, config: JSON.parse(s.config_json), config_json: undefined }));

    res.json({
      generatedAt: nowIso(),
      user: { id: user.id, username: user.username, createdAt: user.created_at },
      nodes,
      usage: { daily },
      posts,
      replies,
      monument,
      creations,
      corrections,
      shares,
    });
  });

  return router;
}

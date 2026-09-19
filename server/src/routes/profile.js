// 个人数据导出：把与个人高度相关的内容聚合为一份结构化数据，
// 供「个人知识画像文档」生成（发给 AI 可迅速了解用户，用于训练个人助手）。
// 覆盖：闯关进度（每节点状态/通关用时/点亮时间）、学习投入（每日时长）、
// 公开发布内容（讨论帖/回复/纪念碑/二创/勘误）、分享记录。
// 说明：刷题试卷存内存不持久化，无法导出；search_logs 无 user_id（全局空洞信号），不归属个人。
import { Router } from 'express';
import { z } from 'zod';
import { authRequired } from '../middleware/auth.js';
import { errors, parseBody } from '../errors.js';
import { STATE_LEVEL, effectiveState, setState } from '../services/stateService.js';
import { fingerprint } from './terminal.js';

function nowIso() {
  return new Date().toISOString();
}

// 个人进度：导出 / 导入（去中心化 —— 数据要能带走）
const progressImportSchema = z.object({
  source: z.object({ name: z.string().optional(), fingerprint: z.string().optional() }).partial().optional(),
  states: z
    .array(
      z.object({
        nodeId: z.string().min(1),
        state: z.enum(['open', 'passed', 'lit']),
        passSeconds: z.number().int().min(0).max(86400).nullish(),
        litAt: z.string().nullish(),
        certified: z.boolean().optional(),
      })
    )
    .max(5000)
    .default([]),
});

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

  // ---- 个人进度：导出（去中心化：数据要能带走）----
  // 只导出「学习进度」本身（节点状态 / 通关用时 / 点亮时间 / 认证与否）+ 来源库指纹。
  // 社区内容（帖子、二创、勘误等）不在这里 —— 它们属于社区，不属于可搬走的个人进度。
  router.get('/profile/progress', authRequired(secret), (req, res) => {
    const rows = db
      .prepare(
        `SELECT node_id, state, pass_seconds, lit_at, certified
         FROM user_node_state WHERE user_id = ? ORDER BY node_id`
      )
      .all(req.user.id);
    res.json({
      kind: 'starmap-progress',
      version: 1,
      exportedAt: nowIso(),
      source: { name: '智点星谱库', fingerprint: fingerprint(db) },
      states: rows.map((r) => ({
        nodeId: r.node_id,
        state: r.state,
        passSeconds: r.pass_seconds,
        litAt: r.lit_at,
        certified: r.certified === 1,
      })),
    });
  });

  // ---- 个人进度：导入 ----
  // 规则：只升不降；库里没有的节点跳过（返回 ignored）；
  // 认证只在**导回同一个库**（指纹相同）时保留 —— 认证的含义是"这个库当场见证过"，
  // 换一个库导入，新库并没有见证过，所以只能记未认证。
  router.post('/profile/progress', authRequired(secret), (req, res) => {
    const { source, states } = parseBody(progressImportSchema, req.body ?? {});
    const uid = req.user.id;
    const myFingerprint = fingerprint(db);
    const sameLibrary = Boolean(source?.fingerprint) && source.fingerprint === myFingerprint;
    const nodeExists = db.prepare('SELECT 1 FROM nodes WHERE id = ?');

    let imported = 0;
    let skipped = 0;
    const ignored = [];
    for (const s of states) {
      if (!nodeExists.get(s.nodeId)) {
        skipped += 1;
        ignored.push(s.nodeId);
        continue;
      }
      const current = effectiveState(db, uid, s.nodeId);
      if (STATE_LEVEL[s.state] <= STATE_LEVEL[current]) {
        skipped += 1; // 已有同级或更高：不动
        continue;
      }
      setState(db, uid, s.nodeId, s.state, {
        passSeconds: s.passSeconds ?? null,
        litAt: s.litAt ?? null,
        certified: sameLibrary && s.certified === true,
      });
      imported += 1;
    }

    res.json({ imported, skipped, ignored, sameLibrary, fingerprint: myFingerprint });
  });

  return router;
}

// AI 辅助路线规划：为外部 Agent 提供知识图谱信息读取接口 + 定制个性化学习地图
// - GET  /agent/graph  ：Agent 读取全量知识图谱（节点资料 + 前置/相关关系），
//                        带用户 token 时每个节点标注该用户当前状态，供 Agent 排除「已点亮」。
//                        入口在导航功能中，用户在外部的 Agent 对话里讲述要掌握的技能。
// - POST /agent/plan   ：给定技能（节点 id 或关键词），返回「用户需要掌握」的定制地图——
//                        目标的一切 prerequisite 前置闭包，剔除已通关/已点亮节点，
//                        仅保留 prerequisite 关系（排除相关性不高），供渲染中心视图样式的地图。
import { Router } from 'express';
import { errors } from '../errors.js';
import { allEdges } from '../db/contentRepo.js';
import { authOptional, authRequired } from '../middleware/auth.js';
import { batchEffectiveStates } from '../services/stateService.js';

function nodeBasic(db) {
  return db
    .prepare('SELECT id, title, subject, difficulty FROM nodes ORDER BY id')
    .all();
}

export function agentRouter({ db, secret }) {
  const router = Router();

  // ---- 图谱数据（Agent 读取） ----
  router.get('/agent/graph', authOptional(secret), (req, res) => {
    const nodes = db
      .prepare(
        'SELECT id, title, subject, category, difficulty, summary FROM nodes ORDER BY subject, id'
      )
      .all();
    const edges = allEdges(db).map((e) => ({ from: e.from_id, to: e.to_id, type: e.type }));
    const ids = nodes.map((n) => n.id);
    const states = req.user ? batchEffectiveStates(db, req.user.id, ids) : null;
    res.json({
      nodes: states ? nodes.map((n) => ({ ...n, state: states[n.id] })) : nodes,
      edges,
      user: req.user ? { id: req.user.id, username: req.user.username } : null,
    });
  });

  // ---- 定制学习地图（AI 生成；仅「需要掌握」且未点亮，只保留 prerequisite） ----
  router.post('/agent/plan', authRequired(secret), (req, res) => {
    const target = String(req.body?.target ?? '').trim();
    if (!target) throw errors.validation('请给出要掌握的技能（节点 id 或关键词）');

    const nodes = nodeBasic(db);
    // 定位目标：精确 id 优先 → title 关键词 → summary 关键词（均取字典序最小，确定性）
    let targetId = nodes.find((n) => n.id === target)?.id;
    if (!targetId) {
      const lower = target.toLowerCase();
      const byTitle = nodes.filter((n) => n.title.toLowerCase().includes(lower));
      if (byTitle.length) targetId = byTitle[0].id;
      else {
        const bySummary = db
          .prepare('SELECT id FROM nodes WHERE LOWER(summary) LIKE ? ORDER BY id')
          .all(`%${lower}%`);
        if (bySummary.length) targetId = bySummary[0].id;
      }
    }
    if (!targetId) throw errors.notFound('未找到该技能对应的知识节点');

    // prerequisite 反向邻接（from 的前置是 to）：从目标 BFS 收集全部前置闭包
    const preOf = new Map(); // from -> [to...]
    for (const e of allEdges(db)) {
      if (e.type !== 'prerequisite') continue;
      if (!preOf.has(e.from_id)) preOf.set(e.from_id, []);
      preOf.get(e.from_id).push(e.to_id);
    }
    const closure = new Set([targetId]);
    const queue = [targetId];
    while (queue.length) {
      const cur = queue.pop();
      for (const p of preOf.get(cur) ?? []) {
        if (!closure.has(p)) {
          closure.add(p);
          queue.push(p);
        }
      }
    }

    // 排除已通关/已点亮（已掌握），其余即「需要掌握」
    const states = batchEffectiveStates(db, req.user.id, [...closure]);
    const toLearn = [...closure].filter((id) => states[id] !== 'lit' && states[id] !== 'passed');
    const learnSet = new Set(toLearn);

    // 待学节点之间仅保留 prerequisite 边（排除 related 等「相关性不高」的关系）
    const edges = allEdges(db)
      .filter((e) => e.type === 'prerequisite' && learnSet.has(e.from_id) && learnSet.has(e.to_id))
      .map((e) => ({ from: e.from_id, to: e.to_id, type: e.type }));

    const info = new Map(nodes.map((n) => [n.id, n]));
    res.json({
      target: targetId,
      targetTitle: info.get(targetId)?.title ?? targetId,
      total: closure.size,
      toLearn: toLearn.length,
      nodes: toLearn.map((id) => ({
        id,
        title: info.get(id)?.title ?? id,
        subject: info.get(id)?.subject ?? '',
        difficulty: info.get(id)?.difficulty ?? 1,
        state: states[id],
      })),
      edges,
    });
  });

  return router;
}

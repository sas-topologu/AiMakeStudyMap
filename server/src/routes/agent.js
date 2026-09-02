// AI 辅助路线规划 + 缺卡让 AI 制作：为外部 Agent 提供知识图谱读取 / 定制学习地图 /
// 制作规范 / 知识卡投稿接口。
// - GET  /agent/graph  ：Agent 读取全量知识图谱（节点资料 + 前置/相关关系），带 token 标注状态。
// - POST /agent/plan   ：给定技能，返回「需要掌握」的定制地图（prerequisite 前置闭包，剔除已点亮）。
//                        若图谱中无对应知识卡，返回 { missing: true }，提示用户「是否让 AI 制作」。
// - POST /agent/course ：给定技能，返回按学习顺序的课程大纲（基础→目标，含每步状态）——定制课程用。
// - GET  /agent/spec   ：返回知识卡制作规范 v2.1 + 模板骨架，供用户个人 Agent「按照规范制作」。
// - POST /agent/cards  ：投稿知识卡（校验 → 存待审 → 建 card_review 任务），由管理 AI 一审后入库。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { errors } from '../errors.js';
import { allEdges } from '../db/contentRepo.js';
import { authOptional, authRequired } from '../middleware/auth.js';
import { batchEffectiveStates } from '../services/stateService.js';
import { validateCards, createSubmission, checkFreeze } from '../services/cardIngest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const SPEC_PATH = path.resolve(PROJECT_ROOT, 'docs/知识卡制作规范.md');

function nodeBasic(db) {
  return db.prepare('SELECT id, title, subject, difficulty FROM nodes ORDER BY id').all();
}

// 模板骨架：供外部 Agent 参考字段结构（规范文档为最终依据）
const CARD_TEMPLATE = {
  id: 'subject.field.concept',
  title: '概念中文标题',
  subject: '学科（如 数学 / 物理 / 计算机 / 人工智能 / 化学 / 生物 / 地理）',
  category: '自然科学',
  credibility: 'verified',
  difficulty: 2,
  summary: '一段话摘要：这个知识解决什么问题、结论是什么。',
  objectives: ['学完能…', '学完能…', '学完能…'],
  sections: [
    {
      heading: '节标题（沿认知递进主线）',
      tier: 'core',
      body: '段落2~4句，公式独占一行，[[术语]] 需在 terms 定义。',
      examples: [{ id: 'ex1', title: '例题1', problem: '…', steps: ['…', '…'], answer: '…' }],
      pitfalls: ['常见易错点1', '常见易错点2'],
      tools: { heading: '工具表（如积分表）', rows: ['条目1', '条目2'] },
    },
  ],
  terms: { 术语: '定义', 另一个术语: '定义' },
  relations: { prerequisites: ['已入库的前置节点 id'], related: ['已入库的相关节点 id'] },
  questionBank: [
    { id: 'q1', type: 'choice', stem: '…', options: ['A', 'B'], answer: 0, explanation: '…', difficulty: 1 },
    { id: 'q2', type: 'fill', stem: '…', answer: '唯一答案', explanation: '…', difficulty: 2 },
  ],
  version: 1,
};

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

  // ---- 定制学习地图（AI 生成；缺卡返回 missing 提示） ----
  router.post('/agent/plan', authRequired(secret), (req, res) => {
    const target = String(req.body?.target ?? '').trim();
    if (!target) throw errors.validation('请给出要掌握的技能（节点 id 或关键词）');

    const nodes = nodeBasic(db);
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
    if (!targetId) {
      // 缺卡：提示用户是否让 AI 制作
      return res.status(200).json({
        missing: true,
        query: target,
        message: `「${target}」暂未收录为知识卡。可让 AI 按规范制作，或换一个更具体的技能关键词。`,
      });
    }

    const preOf = new Map();
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

    const states = batchEffectiveStates(db, req.user.id, [...closure]);
    const toLearn = [...closure].filter((id) => states[id] !== 'lit' && states[id] !== 'passed');
    const learnSet = new Set(toLearn);
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

  // ---- 定制课程（方案乙：返回已排好「学习顺序」的课程大纲，供任意 Agent 接入定制）----
  // 与 plan 相比，course 把前置闭包按「基础→目标」拓扑排序成学习序列，并标注每步状态与缺卡。
  // Agent 拿到后可据此定制学习计划；链上某概念无卡（目标缺卡）时返回 missing，提示先补制。
  router.post('/agent/course', authOptional(secret), (req, res) => {
    const target = String(req.body?.target ?? '').trim();
    if (!target) throw errors.validation('请给出要掌握的技能（节点 id 或关键词）');

    const nodes = nodeBasic(db);
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
    if (!targetId) {
      return res.status(200).json({
        missing: true,
        query: target,
        message:
          `「${target}」暂未收录为知识卡。可 POST /api/agent/spec 取规范、按规范制作后 ` +
          `POST /api/agent/cards 提交入库，再重新定制课程。`,
      });
    }

    // 前置邻接（from 的前置是 to）：from -> [to...]
    const preOf = new Map();
    for (const e of allEdges(db)) {
      if (e.type !== 'prerequisite') continue;
      if (!preOf.has(e.from_id)) preOf.set(e.from_id, []);
      preOf.get(e.from_id).push(e.to_id);
    }
    // 闭包（目标 + 全部前置）
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

    // Kahn 分层：layer[id] = 从「无前置根」到该节点的步数（基础小、目标大）；学习顺序 = layer 升序
    const dependentsOf = new Map([...closure].map((id) => [id, []])); // to -> [from...]（依赖该前置的节点）
    const inDeg = new Map([...closure].map((id) => [id, 0]));
    for (const from of closure) {
      for (const to of preOf.get(from) ?? []) {
        if (!closure.has(to)) continue;
        dependentsOf.get(to).push(from);
        inDeg.set(from, inDeg.get(from) + 1);
      }
    }
    const layer = new Map();
    let frontier = [...closure].filter((id) => inDeg.get(id) === 0).sort();
    for (const id of frontier) layer.set(id, 0);
    while (frontier.length) {
      const next = [];
      for (const cur of frontier) {
        for (const from of dependentsOf.get(cur) ?? []) {
          layer.set(from, Math.max(layer.get(from) ?? 0, layer.get(cur) + 1));
          inDeg.set(from, inDeg.get(from) - 1);
          if (inDeg.get(from) === 0) next.push(from);
        }
      }
      next.sort();
      frontier = next;
    }
    for (const id of closure) if (!layer.has(id)) layer.set(id, 0);

    const states = batchEffectiveStates(db, req.user?.id ?? null, [...closure]);
    const info = new Map(nodes.map((n) => [n.id, n]));
    // 保留已点亮但不计「待学」：steps 仍展示全部闭包（含已掌握），供 agent 排复习/掌握率
    const steps = [...closure]
      .map((id) => ({
        id,
        title: info.get(id)?.title ?? id,
        subject: info.get(id)?.subject ?? '',
        difficulty: info.get(id)?.difficulty ?? 1,
        state: states[id],
        layer: layer.get(id) ?? 0,
      }))
      .sort((a, b) => a.layer - b.layer || (a.id < b.id ? -1 : 1));
    const masteredCount = [...closure].filter((id) => states[id] === 'lit' || states[id] === 'passed').length;

    res.json({
      target: targetId,
      targetTitle: info.get(targetId)?.title ?? targetId,
      total: closure.size,
      remaining: closure.size - masteredCount,
      mastered: masteredCount,
      progressPct: closure.size ? Math.round((masteredCount / closure.size) * 100) : 0,
      steps,
    });
  });

  // ---- 制作规范 + 模板（供外部 Agent 按规范制作） ----
  router.get('/agent/spec', (req, res) => {
    let spec = '';
    try {
      spec = fs.readFileSync(SPEC_PATH, 'utf8');
    } catch {
      /* 兜底 */
    }
    res.json({
      version: 'v2.1',
      spec,
      template: CARD_TEMPLATE,
      note: '按规范制作知识卡 JSON，完成后 POST /api/agent/cards 提交（cards 数组），校验通过即入库为星图新节点。',
    });
  });

  // ---- 投稿知识卡（校验 → 存待审 → 建 card_review 任务；仅登录用户） ----
  // 方案乙 + 服务端管理 AI：投稿不直接入库，一审通过后进公示窗口，公示期无异议/第三方终审通过才入库。
  // 投稿被拒达到本周阈值即功能冻结（冻结投稿功能，时长随次数递增，每周重置）。
  router.post('/agent/cards', authRequired(secret), (req, res) => {
    const freeze = checkFreeze(db, req.user.id);
    if (freeze.frozen) {
      throw errors.rateLimited(`投稿功能已冻结（${freeze.freezeWait}）。请稍后再试。`);
    }
    const cards = req.body?.cards;
    if (!Array.isArray(cards) || cards.length === 0) {
      throw errors.validation('请提供 cards 数组（至少一张制作好的知识卡）');
    }
    for (const card of cards) {
      if (!card?.id) throw errors.validation('卡片缺少 id');
    }
    // 校验：schema + 节内术语 + media 资产 + 结构（并入当前库现有节点图，避免悬空误报）
    const check = validateCards(db, cards);
    if (!check.ok) {
      return res.status(400).json({ ok: false, errors: check.errors });
    }
    const { submissionId, taskId } = createSubmission(db, req.user.id, cards);
    res.status(201).json({
      ok: true,
      submissionId,
      taskId,
      status: 'pending',
      message: '已提交审核；一审通过后进入公示窗口，无异议即入库为星图新节点。',
    });
  });

  // ---- 我的投稿状态（投稿者查看审核进度） ----
  router.get('/agent/submissions/mine', authRequired(secret), (req, res) => {
    const list = db
      .prepare(
        `SELECT id, node_id, status, reason, review_due_at, created_at, reviewed_at
         FROM card_submissions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
      )
      .all(req.user.id);
    res.json({ submissions: list });
  });

  return router;
}

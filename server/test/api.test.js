import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { runImport } from '../../content/tools/import.js';
import { openDatabase } from '../src/db/connection.js';
import { createApp } from '../src/app.js';

// ---- 测试夹具：5 节点链 t.a ← t.b ← t.c ← t.d ← t.e ----
function makeCard(id, { prerequisites = [], difficulty = 4 } = {}) {
  return {
    id,
    title: `${id} 标题`,
    subject: '数学',
    category: '自然科学',
    credibility: 'verified',
    difficulty,
    summary: `${id} 摘要`,
    sections: [
      { heading: '概念', body: `[[甲]]与[[乙]]。` },
      { heading: '性质', body: `[[丙]]的性质。` },
      { heading: '应用', body: '应用。' },
    ],
    terms: { 甲: '定义甲', 乙: '定义乙', 丙: '定义丙' },
    relations: { prerequisites, related: [] },
    questionBank: [1, 2, 3, 4]
      .map((n) => ({
        id: `q${n}`,
        type: 'choice',
        stem: `选择题 ${n}`,
        options: ['对', '错'],
        answer: 0, // 正确选项恒为下标 0
        explanation: '解析',
        difficulty: 1,
      }))
      .concat([
        { id: 'q5', type: 'fill', stem: '填空 5', answer: '42', explanation: '解析', difficulty: 1 },
        { id: 'q6', type: 'fill', stem: '填空 6', answer: '42', explanation: '解析', difficulty: 2 },
      ]),
    version: 1,
  };
}

// 试卷全部答对：choice 选 0，fill 答 '42'
function correctAnswers(questions) {
  return Object.fromEntries(questions.map((q) => [q.seq, q.type === 'choice' ? 0 : '42']));
}

describe('API 集成', () => {
  let tmp, db, agent;
  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  async function registerUser(username) {
    const res = await agent.post('/api/auth/register').send({ username, password: 'secret1' });
    expect(res.status).toBe(201);
    return res.body.token;
  }

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starmap-api-'));
    const dir = path.join(tmp, 'cards');
    fs.mkdirSync(dir);
    const chain = ['t.a', 't.b', 't.c', 't.d', 't.e'];
    chain.forEach((id, i) => {
      const card = makeCard(id, { prerequisites: i === 0 ? [] : [chain[i - 1]] });
      fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(card));
    });
    const dbPath = path.join(tmp, 'test.db');
    runImport({ dir, dbPath });
    db = openDatabase(dbPath);
    agent = request(createApp(db, { secret: 'test-secret' }));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('注册 / 登录 / JWT 鉴权', async () => {
    const token = await registerUser('用户甲');
    const login = await agent.post('/api/auth/login').send({ username: '用户甲', password: 'secret1' });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();
    expect(login.body.user.username).toBe('用户甲');

    const wrong = await agent.post('/api/auth/login').send({ username: '用户甲', password: 'bad-password' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('UNAUTHORIZED');

    const noToken = await agent.post('/api/jump').send({ nodeId: 't.a' });
    expect(noToken.status).toBe(401);

    const dup = await agent.post('/api/auth/register').send({ username: '用户甲', password: 'secret1' });
    expect(dup.status).toBe(400);

    const withToken = await agent.get('/api/nodes/t.a').set(auth(token));
    expect(withToken.status).toBe(200);
  });

  it('状态机：初始 dim；通关前置后邻居推导为 open；dim 闯关 403', async () => {
    const token = await registerUser('user1');
    // 初始：t.b 为 dim
    let res = await agent.get('/api/nodes/t.b').set(auth(token));
    expect(res.body.state).toBe('dim');
    // dim 节点闯关 → 403 FORBIDDEN_STATE
    res = await agent.post('/api/nodes/t.b/challenge/start').set(auth(token)).send({ mode: 'pass' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_STATE');

    // 跃迁打开 t.a 并通关
    await agent.post('/api/jump').set(auth(token)).send({ nodeId: 't.a' });
    await agent.post('/api/timer/start').set(auth(token)).send({ minutes: 60 });
    const paper = await agent.post('/api/nodes/t.a/challenge/start').set(auth(token)).send({ mode: 'pass' });
    await agent
      .post(`/api/papers/${paper.body.paperId}/submit`)
      .set(auth(token))
      .send({ answers: correctAnswers(paper.body.questions) });

    // t.b 的邻居 t.a 已通关 → t.b 推导为 open
    res = await agent.get('/api/nodes/t.b').set(auth(token));
    expect(res.body.state).toBe('open');
    // t.c 不相邻通关节点 → 仍 dim
    res = await agent.get('/api/nodes/t.c').set(auth(token));
    expect(res.body.state).toBe('dim');
  });

  it('闯关闭环：NO_TIMER → pass 全对 passed → exam 全对 lit（pass_seconds>0）', async () => {
    const token = await registerUser('user2');
    await agent.post('/api/jump').set(auth(token)).send({ nodeId: 't.a' });

    // 无计时开卷 → 409 NO_TIMER
    let res = await agent.post('/api/nodes/t.a/challenge/start').set(auth(token)).send({ mode: 'pass' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_TIMER');

    // 开计时 → pass 试卷恰好 3 题 → 全对通关
    await agent.post('/api/timer/start').set(auth(token)).send({ minutes: 120 });
    const pass = await agent.post('/api/nodes/t.a/challenge/start').set(auth(token)).send({ mode: 'pass' });
    expect(pass.status).toBe(200);
    expect(pass.body.questions).toHaveLength(3);
    expect(pass.body.questions[0]).not.toHaveProperty('answer');
    expect(pass.body.questions[0]).not.toHaveProperty('explanation');

    const r1 = await agent
      .post(`/api/papers/${pass.body.paperId}/submit`)
      .set(auth(token))
      .send({ answers: correctAnswers(pass.body.questions) });
    expect(r1.body.result).toBe('passed');
    expect(r1.body.correct).toBe(3);
    expect(r1.body.total).toBe(3);
    expect(r1.body.state).toBe('passed');
    expect(r1.body.perQuestion[0]).toHaveProperty('explanation');

    // exam：difficulty=4 → 22-16=6 题（题库容量 6）→ 全对点亮
    const exam = await agent.post('/api/nodes/t.a/challenge/start').set(auth(token)).send({ mode: 'exam' });
    expect(exam.body.questions).toHaveLength(6);
    const r2 = await agent
      .post(`/api/papers/${exam.body.paperId}/submit`)
      .set(auth(token))
      .send({ answers: correctAnswers(exam.body.questions) });
    expect(r2.body.result).toBe('lit');
    expect(r2.body.state).toBe('lit');

    const row = db
      .prepare('SELECT state, pass_seconds, lit_at FROM user_node_state WHERE user_id = 1 AND node_id = ?')
      .get('t.a');
    expect(row.state).toBe('lit');
    expect(row.pass_seconds).toBeGreaterThan(0);
    expect(row.lit_at).toBeTruthy();
  });

  it('判分：答错则 failed，不落状态', async () => {
    const token = await registerUser('user3');
    await agent.post('/api/jump').set(auth(token)).send({ nodeId: 't.a' });
    await agent.post('/api/timer/start').set(auth(token)).send({ minutes: 30 });
    const paper = await agent.post('/api/nodes/t.a/challenge/start').set(auth(token)).send({ mode: 'pass' });
    const answers = correctAnswers(paper.body.questions);
    answers['1'] = 1; // 故意答错第一题
    const res = await agent
      .post(`/api/papers/${paper.body.paperId}/submit`)
      .set(auth(token))
      .send({ answers });
    expect(res.body.result).toBe('failed');
    const node = await agent.get('/api/nodes/t.a').set(auth(token));
    expect(node.body.state).toBe('open');
  });

  it('防沉迷：连开两个 120 分钟计时，第二个 DAILY_LIMIT', async () => {
    const token = await registerUser('user4');
    const first = await agent.post('/api/timer/start').set(auth(token)).send({ minutes: 120 });
    expect(first.status).toBe(200);
    const second = await agent.post('/api/timer/start').set(auth(token)).send({ minutes: 120 });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DAILY_LIMIT');

    const status = await agent.get('/api/timer').set(auth(token));
    expect(status.body.timer.remainingSeconds).toBeGreaterThan(0);
    expect(status.body.daily.remainingSeconds).toBe(0);
  });

  it('跃迁：扣额度转 open；额度耗尽 → NO_QUOTA；跨月月赠 min(2,…)', async () => {
    const token = await registerUser('user5');
    // 初始额度 1：jump dim 节点 t.a → open，额度归 0
    let res = await agent.post('/api/jump').set(auth(token)).send({ nodeId: 't.a' });
    expect(res.body).toEqual({ state: 'open', quota: 0 });
    // 免费放行：已 open 再 jump 不扣额度
    res = await agent.post('/api/jump').set(auth(token)).send({ nodeId: 't.a' });
    expect(res.body).toEqual({ state: 'open', quota: 0 });
    // 额度 0 时 jump dim → NO_QUOTA
    res = await agent.post('/api/jump').set(auth(token)).send({ nodeId: 't.b' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_QUOTA');

    // 模拟跨月：改 quota_month 后任一登录请求触发月赠（0+1，上限 2）
    db.prepare("UPDATE users SET quota_month = '2000-01' WHERE id = 1").run();
    await agent.get('/api/timer').set(auth(token));
    const user = db.prepare('SELECT jump_quota, quota_month FROM users WHERE id = 1').get();
    expect(user.jump_quota).toBe(1);
    expect(user.quota_month).toMatch(/^\d{4}-\d{2}$/);
    expect(user.quota_month).not.toBe('2000-01');
  });

  it('搜索：模糊匹配并标注用户状态', async () => {
    const token = await registerUser('user6');
    await agent.post('/api/jump').set(auth(token)).send({ nodeId: 't.a' });
    const res = await agent.get('/api/search?q=t.a').set(auth(token));
    expect(res.status).toBe(200);
    const hit = res.body.results.find((r) => r.id === 't.a');
    expect(hit).toMatchObject({ id: 't.a', state: 'open' });
    // 未登录搜索 → 状态均为 dim
    const anon = await agent.get('/api/search?q=摘要');
    expect(anon.body.results.length).toBeGreaterThan(0);
    expect(anon.body.results.every((r) => r.state === 'dim')).toBe(true);
  });

  it('同步：since=0 返回全部；内容未变后 since=当前版本返回空', async () => {
    let res = await agent.get('/api/sync?since=0');
    expect(res.body.version).toBe(1);
    expect(res.body.nodes).toHaveLength(5);
    expect(res.body.nodes[0]).toHaveProperty('questionBank'); // 完整卡片含题库
    expect(res.body.nodes[0]).toHaveProperty('updated_version', 1);

    // 重复导入（内容不变）后 since=1 无差异
    runImport({ dir: path.join(tmp, 'cards'), dbPath: path.join(tmp, 'test.db') });
    res = await agent.get('/api/sync?since=1');
    expect(res.body.nodes).toHaveLength(0);

    const meta = await agent.get('/api/meta/version');
    expect(meta.body.contentVersion).toBe(1);
  });

  it('neighborhood 深度限制：5 节点链 depth=3 只到第 4 个节点', async () => {
    const res = await agent.get('/api/graph/neighborhood/t.a?depth=3');
    expect(res.status).toBe(200);
    const ids = res.body.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['t.a', 't.b', 't.c', 't.d']);
    expect(res.body.nodes.find((n) => n.id === 't.d').depth).toBe(3);
    expect(res.body.edges).toHaveLength(3);
    // depth clamp：越界参数压回 1~3
    const d9 = await agent.get('/api/graph/neighborhood/t.a?depth=9');
    expect(d9.body.nodes).toHaveLength(4);

    const all = await agent.get('/api/graph/all');
    expect(all.body.nodes).toHaveLength(5);
    expect(all.body.nodes[0]).not.toHaveProperty('summary');
  });
});

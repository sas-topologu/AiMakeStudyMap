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

  it('刷题练习：不计时、不占时间、不落状态、可反复、返回用时', async () => {
    const token = await registerUser('user_practice');
    await agent.post('/api/jump').set(auth(token)).send({ nodeId: 't.a' });

    // 无学习倒计时也能开卷（练习模式不要求计时）
    const p1 = await agent
      .post('/api/nodes/t.a/challenge/start')
      .set(auth(token))
      .send({ mode: 'practice' });
    expect(p1.status).toBe(200);
    expect(p1.body.mode).toBe('practice');
    expect(p1.body.questions.length).toBeLessThanOrEqual(5);
    expect(p1.body.questions[0]).not.toHaveProperty('answer');

    // 全对提交：不落状态（保持 open），返回本次用时
    const r1 = await agent
      .post(`/api/papers/${p1.body.paperId}/submit`)
      .set(auth(token))
      .send({ answers: correctAnswers(p1.body.questions) });
    expect(r1.body.result).toBe('practice');
    expect(r1.body.state).toBe('open');
    expect(typeof r1.body.elapsedSeconds).toBe('number');

    // 可反复刷题：再次开卷成功
    const p2 = await agent
      .post('/api/nodes/t.a/challenge/start')
      .set(auth(token))
      .send({ mode: 'practice' });
    expect(p2.status).toBe(200);
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

  it('neighborhood 深度限制：5 节点链 depth=2 只到第 3 个节点', async () => {
    const res = await agent.get('/api/graph/neighborhood/t.a?depth=2');
    expect(res.status).toBe(200);
    const ids = res.body.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['t.a', 't.b', 't.c']);
    expect(res.body.nodes.find((n) => n.id === 't.c').depth).toBe(2);
    expect(res.body.edges).toHaveLength(2);
    // depth clamp：越界参数压回 1~2
    const d9 = await agent.get('/api/graph/neighborhood/t.a?depth=9');
    expect(d9.body.nodes).toHaveLength(3);

    const all = await agent.get('/api/graph/all');
    expect(all.body.nodes).toHaveLength(5);
    expect(all.body.nodes[0]).not.toHaveProperty('summary');
  });

  it('个人数据导出：空账号返回骨架（全节点未学、空内容列表）', async () => {
    const token = await registerUser('profile0');
    const res = await agent.get('/api/profile/export').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('profile0');
    expect(res.body.nodes).toHaveLength(5); // 全部节点，未学 state 为 null
    expect(res.body.nodes.every((n) => n.state === null)).toBe(true);
    expect(res.body.usage.daily).toEqual([]);
    expect(res.body.posts).toEqual([]);
    expect(res.body.replies).toEqual([]);
    expect(res.body.monument).toEqual([]);
    expect(res.body.creations).toEqual([]);
    expect(res.body.corrections).toEqual([]);
    expect(res.body.shares).toEqual([]);
    expect(res.body.generatedAt).toBeTruthy();
  });

  it('个人数据导出：汇总闯关进度/学习时长/发布内容/分享', async () => {
    const token = await registerUser('profile1');
    const { id: uid } = await agent.get('/api/auth/me').set(auth(token)).then((r) => r.body.user);
    const iso = new Date().toISOString();
    // 直接造数据（状态/时长/社交/分享）
    db.prepare(
      "INSERT INTO user_node_state (user_id, node_id, state, pass_seconds, lit_at, updated_at) VALUES (?,?,?,?,?,?)"
    ).run(uid, 't.a', 'lit', 300, iso, iso);
    db.prepare(
      "INSERT INTO user_node_state (user_id, node_id, state, updated_at) VALUES (?,?,?,?)"
    ).run(uid, 't.b', 'passed', iso);
    db.prepare(
      "INSERT INTO user_node_state (user_id, node_id, state, updated_at) VALUES (?,?,?,?)"
    ).run(uid, 't.c', 'open', iso);
    db.prepare(
      "INSERT INTO daily_usage (user_id, day, seconds) VALUES (?, '2026-08-01', 1800)"
    ).run(uid);
    db.prepare(
      "INSERT INTO daily_usage (user_id, day, seconds) VALUES (?, '2026-08-02', 900)"
    ).run(uid);
    const post = db.prepare(
      "INSERT INTO posts (node_id, user_id, title, body, created_at) VALUES ('t.a', ?, '我的第一帖', '分享笔记：勾股定理证明', ?)"
    ).run(uid, iso);
    db.prepare(
      "INSERT INTO replies (post_id, user_id, body, created_at) VALUES (?, ?, '回复自己帖：补充', ?)"
    ).run(post.lastInsertRowid, uid, iso);
    // 他人帖子下我的回复
    const other = db.prepare(
      "INSERT INTO posts (node_id, user_id, title, body, created_at) VALUES ('t.b', ?, '他人帖', '内容', ?)"
    ).run(uid === 1 ? 2 : 1, iso); // 需要第二个用户
    db.prepare(
      "INSERT INTO replies (post_id, user_id, body, created_at) VALUES (?, ?, '我评他人帖', ?)"
    ).run(other.lastInsertRowid, uid, iso);
    db.prepare(
      "INSERT INTO pioneers (node_id, user_id, message, created_at) VALUES ('t.a', ?, '拓荒纪念', ?)"
    ).run(uid, iso);
    db.prepare(
      "INSERT INTO creations (node_id, user_id, type, title, content, status, created_at) VALUES ('t.a', ?, 'summary', '我的总结', '全文内容', 'approved', ?)"
    ).run(uid, iso);
    db.prepare(
      "INSERT INTO corrections (node_id, user_id, body, status, created_at) VALUES ('t.a', ?, '建议修正措辞', 'pending', ?)"
    ).run(uid, iso);
    db.prepare(
      "INSERT INTO shares (id, user_id, config_json, created_at) VALUES ('abc123', ?, '{\"theme\":\"default\"}', ?)"
    ).run(uid, iso);

    const res = await agent.get('/api/profile/export').set(auth(token));
    expect(res.status).toBe(200);
    // 进度
    const byId = Object.fromEntries(res.body.nodes.map((n) => [n.id, n]));
    expect(byId['t.a']).toMatchObject({ state: 'lit', passSeconds: 300 });
    expect(byId['t.b'].state).toBe('passed');
    expect(byId['t.c'].state).toBe('open');
    expect(byId['t.d'].state).toBe(null);
    // 时长
    expect(res.body.usage.daily).toHaveLength(2);
    expect(res.body.usage.daily[0]).toMatchObject({ day: '2026-08-01', seconds: 1800 });
    // 讨论帖（含回复与 isMine 标注）
    expect(res.body.posts).toHaveLength(1);
    expect(res.body.posts[0]).toMatchObject({ title: '我的第一帖', nodeTitle: 't.a 标题' });
    expect(res.body.posts[0].replies).toHaveLength(1);
    expect(res.body.posts[0].replies[0].isMine).toBe(true);
    // 他人帖下的回复
    expect(res.body.replies).toHaveLength(1);
    expect(res.body.replies[0].body).toBe('我评他人帖');
    // 纪念碑 / 二创 / 勘误 / 分享
    expect(res.body.monument).toHaveLength(1);
    expect(res.body.creations).toHaveLength(1);
    expect(res.body.creations[0]).toMatchObject({ title: '我的总结', status: 'approved' });
    expect(res.body.corrections).toHaveLength(1);
    expect(res.body.shares).toHaveLength(1);
    expect(res.body.shares[0]).toMatchObject({ id: 'abc123', config: { theme: 'default' } });
  });

  it('个人数据导出：未登录返回 401', async () => {
    const res = await agent.get('/api/profile/export');
    expect(res.status).toBe(401);
  });

  it('AI 图谱读取：公开可读全量节点（含摘要），带 token 时标注状态', async () => {
    const token = await registerUser('agent0');
    await agent.post('/api/jump').set(auth(token)).send({ nodeId: 't.a' }); // t.a 变 open
    const anon = await agent.get('/api/agent/graph');
    expect(anon.status).toBe(200);
    expect(anon.body.nodes).toHaveLength(5);
    expect(anon.body.nodes[0]).toHaveProperty('summary'); // Agent 规划需摘要
    expect(anon.body.nodes[0]).not.toHaveProperty('state'); // 匿名无状态
    expect(anon.body.edges.length).toBeGreaterThan(0);
    expect(anon.body.edges[0]).toHaveProperty('from');
    expect(anon.body.edges[0]).toHaveProperty('type');

    const authed = await agent.get('/api/agent/graph').set(auth(token));
    const a = authed.body.nodes.find((n) => n.id === 't.a');
    expect(a.state).toBe('open'); // 带 token 标注用户状态
  });

  it('AI 定制地图：目标前置闭包，剔除已点亮与 related，仅 prerequisite', async () => {
    const token = await registerUser('agent1');
    const { id: uid } = await agent.get('/api/auth/me').set(auth(token)).then((r) => r.body.user);
    // t.e 已点亮（已掌握）→ 定制 t.e 的目标应剔除；前置链 t.a~t.d 保留
    db.prepare(
      "INSERT INTO user_node_state (user_id, node_id, state, updated_at) VALUES (?,?,?,?)"
    ).run(uid, 't.e', 'lit', new Date().toISOString());

    const res = await agent
      .post('/api/agent/plan')
      .set(auth(token))
      .send({ target: 't.e' });
    expect(res.status).toBe(200);
    expect(res.body.target).toBe('t.e');
    expect(res.body.targetTitle).toBe('t.e 标题');
    // 排除已点亮的 t.e
    expect(res.body.nodes.map((n) => n.id)).not.toContain('t.e');
    // 保留前置链 t.a/t.b/t.c/t.d
    expect(res.body.nodes.map((n) => n.id).sort()).toEqual(['t.a', 't.b', 't.c', 't.d']);
    // 边均为 prerequisite
    expect(res.body.edges.every((e) => e.type === 'prerequisite')).toBe(true);
  });

  it('AI 定制地图：目标未点亮时包含目标节点；未知目标返回 404', async () => {
    const token = await registerUser('agent2');
    // 目标 t.c 未点亮 → 保留 t.c；前置链 t.a/t.b 保留
    const res = await agent
      .post('/api/agent/plan')
      .set(auth(token))
      .send({ target: 't.c' });
    expect(res.status).toBe(200);
    expect(res.body.nodes.map((n) => n.id).sort()).toEqual(['t.a', 't.b', 't.c']);
    // 未知目标 → 404
    const missing = await agent.post('/api/agent/plan').set(auth(token)).send({ target: '不存在' });
    expect(missing.status).toBe(404);
  });
});

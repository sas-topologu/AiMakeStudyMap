import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { runImport } from '../../content/tools/import.js';
import { openDatabase } from '../src/db/connection.js';
import { createApp } from '../src/app.js';
import { setState } from '../src/services/stateService.js';
import { onNodeLit, promotePioneers } from '../src/services/pioneerService.js';

// ---- 夹具：2 节点链 t.a ← t.b ----
function makeCard(id, { prerequisites = [] } = {}) {
  return {
    id,
    title: `${id} 标题`,
    subject: '数学',
    category: '自然科学',
    credibility: 'verified',
    difficulty: 4,
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
        answer: 0,
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

const correctAnswers = (questions) =>
  Object.fromEntries(questions.map((q) => [q.seq, q.type === 'choice' ? 0 : '42']));

describe('社交系统 API', () => {
  let tmp, db, agent;
  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  async function registerUser(username) {
    const res = await agent.post('/api/auth/register').send({ username, password: 'secret1' });
    expect(res.status).toBe(201);
    return res.body.token;
  }

  // 完整走通 点亮 流程（jump → 计时 → pass → exam）
  async function litViaQuiz(token, nodeId = 't.a') {
    await agent.post('/api/jump').set(auth(token)).send({ nodeId });
    await agent.post('/api/timer/start').set(auth(token)).send({ minutes: 120 });
    const pass = await agent
      .post(`/api/nodes/${nodeId}/challenge/start`)
      .set(auth(token))
      .send({ mode: 'pass' });
    await agent
      .post(`/api/papers/${pass.body.paperId}/submit`)
      .set(auth(token))
      .send({ answers: correctAnswers(pass.body.questions) });
    const exam = await agent
      .post(`/api/nodes/${nodeId}/challenge/start`)
      .set(auth(token))
      .send({ mode: 'exam' });
    const res = await agent
      .post(`/api/papers/${exam.body.paperId}/submit`)
      .set(auth(token))
      .send({ answers: correctAnswers(exam.body.questions) });
    expect(res.body.result).toBe('lit');
  }

  // 直接造一个 lit 用户（不写库外的流程）
  function makeLitUser(username, nodeId, seconds) {
    const info = db
      .prepare(
        "INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', datetime('now'))"
      )
      .run(username);
    setState(db, info.lastInsertRowid, nodeId, 'lit', {
      passSeconds: seconds,
      litAt: new Date().toISOString(),
    });
    return info.lastInsertRowid;
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starmap-social-'));
    const dir = path.join(tmp, 'cards');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 't.a.json'), JSON.stringify(makeCard('t.a')));
    fs.writeFileSync(
      path.join(dir, 't.b.json'),
      JSON.stringify(makeCard('t.b', { prerequisites: ['t.a'] }))
    );
    const dbPath = path.join(tmp, 'test.db');
    runImport({ dir, dbPath });
    db = openDatabase(dbPath);
    agent = request(createApp(db, { secret: 'test-secret', pioneerTimer: false }));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('拓荒者：点亮<10人 → 候选；到期人数仍<10 → 提升；纪念碑留言与讨论区置顶', async () => {
    const adminToken = await registerUser('admin1'); // 首个用户为管理员
    const token = await registerUser('pioneer1');
    await litViaQuiz(token);

    // 点亮时已记候选（check_at 在 30 分钟后）
    const cand = db.prepare('SELECT * FROM pioneer_candidates WHERE node_id = ?').get('t.a');
    expect(cand).toBeTruthy();
    expect(cand.lit_count_at_grant).toBe(1);
    expect(db.prepare('SELECT * FROM pioneers').all()).toHaveLength(0);

    // 模拟 check_at 过期，人数仍 <10 → 懒提升（纪念碑读取路径触发）
    db.prepare("UPDATE pioneer_candidates SET check_at = '2000-01-01T00:00:00.000Z'").run();
    const mon = await agent.get('/api/nodes/t.a/monument');
    expect(mon.body.pioneers).toHaveLength(1);
    expect(mon.body.pioneers[0].username).toBe('pioneer1');

    // 非拓荒者留言 → 403
    let res = await agent
      .post('/api/nodes/t.a/monument')
      .set(auth(adminToken))
      .send({ message: '冒名留言' });
    expect(res.status).toBe(403);

    // 拓荒者留言（upsert：再发覆盖）
    res = await agent
      .post('/api/nodes/t.a/monument')
      .set(auth(token))
      .send({ message: '首杀留念' });
    expect(res.status).toBe(200);
    const mon2 = await agent.get('/api/nodes/t.a/monument');
    expect(mon2.body.pioneers[0].message).toBe('首杀留念');

    // 讨论区置顶展示
    const posts = await agent.get('/api/nodes/t.a/posts');
    expect(posts.body.posts[0]).toMatchObject({ pinned: 1, isPioneer: true, title: '拓荒者纪念碑' });
  });

  it('拓荒者：到期时人数已达 10 → 不提升且候选删除', async () => {
    await registerUser('admin1');
    setState(db, 1, 't.a', 'lit', { passSeconds: 10, litAt: new Date().toISOString() });
    onNodeLit(db, 1, 't.a'); // 人数 1 <10 → 候选
    expect(db.prepare('SELECT * FROM pioneer_candidates').all()).toHaveLength(1);

    // 再补 9 个 lit 用户 → 总人数 10
    for (let i = 0; i < 9; i += 1) makeLitUser(`filler${i}`, 't.a', 100 + i);
    db.prepare("UPDATE pioneer_candidates SET check_at = '2000-01-01T00:00:00.000Z'").run();
    promotePioneers(db);

    expect(db.prepare('SELECT * FROM pioneers').all()).toHaveLength(0);
    expect(db.prepare('SELECT * FROM pioneer_candidates').all()).toHaveLength(0);
  });

  it('讨论区：dim 发帖 403；passed 可发；限流阈值 2 时第 3 帖 429；回复计入热度', async () => {
    const dimToken = await registerUser('admin1'); // 管理员但节点状态 dim
    const posterToken = await registerUser('poster');
    setState(db, 2, 't.a', 'passed');

    // dim 发帖 → 403 FORBIDDEN_STATE
    let res = await agent
      .post('/api/nodes/t.a/posts')
      .set(auth(dimToken))
      .send({ title: '你好', body: '正文' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_STATE');

    // passed 发帖成功；回复成功
    res = await agent
      .post('/api/nodes/t.a/posts')
      .set(auth(posterToken))
      .send({ title: '第一帖', body: '正文内容' });
    expect(res.status).toBe(201);
    const postId = res.body.id;
    res = await agent
      .post(`/api/posts/${postId}/replies`)
      .set(auth(posterToken))
      .send({ body: '自顶一下' });
    expect(res.status).toBe(201);

    // 阈值调为 3：当前热度 2（1 帖 + 1 回复），再发 1 帖成功（热度达 3），之后 429
    db.prepare(
      "INSERT INTO meta (key, value) VALUES ('post_rate_threshold', '3') ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run();
    res = await agent
      .post('/api/nodes/t.a/posts')
      .set(auth(posterToken))
      .send({ title: '第二帖', body: '正文内容' });
    expect(res.status).toBe(201);
    res = await agent
      .post('/api/nodes/t.a/posts')
      .set(auth(posterToken))
      .send({ title: '第三帖', body: '正文内容' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('讨论区列表：置顶在前，速通前 10 作者带 authorRank 且排普通帖之前', async () => {
    await registerUser('admin1');
    const fast = await registerUser('fast'); // id=2
    const slow = await registerUser('slow'); // id=3
    const plain = await registerUser('plain'); // id=4
    // fast/slow 点亮（进速通榜），plain 仅通关
    setState(db, 2, 't.a', 'lit', { passSeconds: 5, litAt: new Date().toISOString() });
    setState(db, 3, 't.a', 'lit', { passSeconds: 99, litAt: new Date().toISOString() });
    setState(db, 4, 't.a', 'passed');

    // 顺序插入：普通帖最早，高手帖最晚
    const post = (t, title) =>
      agent.post('/api/nodes/t.a/posts').set(auth(t)).send({ title, body: '正文' });
    await post(plain, '普通帖');
    await post(slow, '榜眼帖');
    await post(fast, '状元帖');
    // 手动置顶 slow 的帖子验证 pinned 优先于 authorRank
    db.prepare("UPDATE posts SET pinned = 1 WHERE title = '榜眼帖'").run();

    const res = await agent.get('/api/nodes/t.a/posts');
    const titles = res.body.posts.map((p) => p.title);
    expect(titles).toEqual(['榜眼帖', '状元帖', '普通帖']);
    const byTitle = Object.fromEntries(res.body.posts.map((p) => [p.title, p]));
    expect(byTitle['状元帖'].authorRank).toBe(1);
    expect(byTitle['榜眼帖'].authorRank).toBe(2);
    expect(byTitle['普通帖'].authorRank).toBeNull();
    expect(byTitle['状元帖'].excerpt).toBe('正文');
  });

  it('帖子详情：回复按时间正序返回', async () => {
    await registerUser('admin1');
    const token = await registerUser('poster');
    setState(db, 2, 't.a', 'passed');
    const created = await agent
      .post('/api/nodes/t.a/posts')
      .set(auth(token))
      .send({ title: '帖', body: '正文' });
    const postId = created.body.id;
    await agent.post(`/api/posts/${postId}/replies`).set(auth(token)).send({ body: '一楼' });
    await agent.post(`/api/posts/${postId}/replies`).set(auth(token)).send({ body: '二楼' });

    const res = await agent.get(`/api/posts/${postId}`);
    expect(res.body.title).toBe('帖');
    expect(res.body.replies.map((r) => r.body)).toEqual(['一楼', '二楼']);
    expect(res.body.replies[0].author).toBe('poster');
  });

  it('速通榜：按 pass_seconds 升序排名', async () => {
    await registerUser('admin1');
    makeLitUser('u50', 't.a', 50);
    makeLitUser('u20', 't.a', 20);
    makeLitUser('u30', 't.a', 30);
    setState(db, 1, 't.a', 'passed'); // passed 不进榜

    const res = await agent.get('/api/nodes/t.a/speedrun');
    expect(res.body.ranks.map((r) => [r.rank, r.username, r.seconds])).toEqual([
      [1, 'u20', 20],
      [2, 'u30', 30],
      [3, 'u50', 50],
    ]);
    expect(res.body.ranks[0].litAt).toBeTruthy();
  });

  it('二创区：passed 上传 403；lit 上传 pending；审核通过才展示；reject 不展示；非 admin 403', async () => {
    const adminToken = await registerUser('admin1');
    const creatorToken = await registerUser('creator'); // id=2
    const passerToken = await registerUser('passer'); // id=3
    setState(db, 2, 't.a', 'lit', { passSeconds: 10, litAt: new Date().toISOString() });
    setState(db, 3, 't.a', 'passed');

    // passed（未点亮）上传 → 403
    let res = await agent
      .post('/api/nodes/t.a/creations')
      .set(auth(passerToken))
      .send({ type: 'mindmap', title: '导图', content: '{}' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_STATE');

    // lit 上传 → pending，列表不可见
    res = await agent
      .post('/api/nodes/t.a/creations')
      .set(auth(creatorToken))
      .send({ type: 'mindmap', title: '思维导图', content: '{"root":"有理数"}' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    const cid = res.body.id;
    const second = await agent
      .post('/api/nodes/t.a/creations')
      .set(auth(creatorToken))
      .send({ type: 'summary', title: '总结图', content: 'data:image/png;base64,...' });
    expect((await agent.get('/api/nodes/t.a/creations')).body.creations).toHaveLength(0);

    // 非 admin 访问审核接口 → 403
    res = await agent.get('/api/admin/review-queue').set(auth(creatorToken));
    expect(res.status).toBe(403);

    // admin 审核：approve 一个、reject 一个
    const queue = await agent.get('/api/admin/review-queue').set(auth(adminToken));
    expect(queue.body.creations).toHaveLength(2);
    await agent
      .post(`/api/admin/review/creations/${cid}`)
      .set(auth(adminToken))
      .send({ action: 'approve' });
    await agent
      .post(`/api/admin/review/creations/${second.body.id}`)
      .set(auth(adminToken))
      .send({ action: 'reject' });

    const list = await agent.get('/api/nodes/t.a/creations');
    expect(list.body.creations).toHaveLength(1);
    expect(list.body.creations[0]).toMatchObject({
      id: cid,
      type: 'mindmap',
      author: 'creator',
    });
  });

  it('星图分享：创建 + 公开读取 + 只含自己的通关数据', async () => {
    await registerUser('admin1');
    const token = await registerUser('sharer'); // id=2
    setState(db, 2, 't.a', 'lit', { passSeconds: 10, litAt: new Date().toISOString() });
    setState(db, 2, 't.b', 'passed');
    const otherToken = await registerUser('other'); // id=3
    setState(db, 3, 't.a', 'passed'); // 他人数据不应混入

    const created = await agent
      .post('/api/share')
      .set(auth(token))
      .send({ config: { theme: 'dark', collapseRelated: true } });
    expect(created.status).toBe(201);
    expect(created.body.url).toBe(`/share/${created.body.shareId}`);

    // 公开读取（不带 token）
    const res = await agent.get(`/api/share/${created.body.shareId}`);
    expect(res.status).toBe(200);
    expect(res.body.owner).toBe('sharer');
    expect(res.body.config).toEqual({ theme: 'dark', collapseRelated: true });
    const stateOf = Object.fromEntries(res.body.nodes.map((n) => [n.id, n.state]));
    expect(stateOf).toEqual({ 't.a': 'lit', 't.b': 'passed' });
    expect(res.body.edges).toEqual([{ from: 't.b', to: 't.a', type: 'prerequisite' }]);
    expect(res.body).not.toHaveProperty('user_id');

    // 未登录不能创建
    const anon = await agent.post('/api/share').send({ config: {} });
    expect(anon.status).toBe(401);
  });
});

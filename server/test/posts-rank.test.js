import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { runImport } from '../../content/tools/import.js';
import { openDatabase } from '../src/db/connection.js';
import { createApp } from '../src/app.js';
import { setState } from '../src/services/stateService.js';

// 原设计要求：「速通榜高排名用户的讨论区发言要标记并提高推送概率」
// 这条排序此前没有测试钉住 —— 这里补上，防止以后被无意改掉。
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
      { heading: '概念', body: '[[甲]]与[[乙]]。' },
      { heading: '性质', body: '[[丙]]的性质。' },
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

describe('讨论区：速通高排名作者的发言提高推送（排前）', () => {
  let tmp, db, agent, tokenA, tokenB, uidA, uidB;
  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const post = (token, title) =>
    agent.post('/api/nodes/t.a/posts').set(auth(token)).send({ title, body: `${title} 正文` });

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starmap-posts-'));
    const dir = path.join(tmp, 'cards');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 't.a.json'), JSON.stringify(makeCard('t.a')));
    const dbPath = path.join(tmp, 'test.db');
    runImport({ dir, dbPath });
    db = openDatabase(dbPath);
    agent = request(createApp(db, { secret: 'test-secret' }));

    tokenA = (await agent.post('/api/auth/register').send({ username: '速通甲', password: 'Secret12' })).body.token;
    tokenB = (await agent.post('/api/auth/register').send({ username: '普通乙', password: 'Secret12' })).body.token;
    uidA = db.prepare("SELECT id FROM users WHERE username = '速通甲'").get().id;
    uidB = db.prepare("SELECT id FROM users WHERE username = '普通乙'").get().id;
    // 两人都通关（有发言权）；甲点亮且用时短 → 速通第 1
    setState(db, uidA, 't.a', 'lit', { passSeconds: 10, litAt: new Date().toISOString() });
    setState(db, uidB, 't.a', 'passed');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('普通帖：高排名作者的帖子排在前面，并带 authorRank 标记', async () => {
    // 乙先发（时间更早），甲后发 —— 若只按时间，乙会在前
    expect((await post(tokenB, '乙的帖子')).status).toBe(201);
    await new Promise((r) => setTimeout(r, 5));
    expect((await post(tokenA, '甲的帖子')).status).toBe(201);

    const res = await agent.get('/api/nodes/t.a/posts');
    expect(res.status).toBe(200);
    const titles = res.body.posts.map((p) => p.title);
    expect(titles).toEqual(['甲的帖子', '乙的帖子']); // 排名加权 > 时间
    expect(res.body.posts[0].authorRank).toBe(1);
    expect(res.body.posts[1].authorRank).toBeNull();
  });

  it('置顶仍然最优先：置顶帖压过高排名作者', async () => {
    await post(tokenB, '乙的帖子');
    await post(tokenA, '甲的帖子');
    db.prepare("UPDATE posts SET pinned = 1 WHERE title = '乙的帖子'").run();

    const res = await agent.get('/api/nodes/t.a/posts');
    expect(res.body.posts.map((p) => p.title)).toEqual(['乙的帖子', '甲的帖子']);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { runImport } from '../../content/tools/import.js';
import { openDatabase } from '../src/db/connection.js';
import { createApp } from '../src/app.js';
import { setState } from '../src/services/stateService.js';

// 个人进度导出/导入：去中心化 —— 数据要能带走，且认证只在"同一个库"里保留
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

describe('个人进度导出 / 导入', () => {
  let tmp, db, agent, token, uid, fp;
  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const certifiedOf = (nodeId) =>
    db.prepare('SELECT certified FROM user_node_state WHERE user_id = ? AND node_id = ?').get(uid, nodeId)
      ?.certified;
  const stateOf = (nodeId) =>
    db.prepare('SELECT state FROM user_node_state WHERE user_id = ? AND node_id = ?').get(uid, nodeId)?.state;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starmap-progress-'));
    const dir = path.join(tmp, 'cards');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 't.a.json'), JSON.stringify(makeCard('t.a')));
    fs.writeFileSync(path.join(dir, 't.b.json'), JSON.stringify(makeCard('t.b', { prerequisites: ['t.a'] })));
    const dbPath = path.join(tmp, 'test.db');
    runImport({ dir, dbPath });
    db = openDatabase(dbPath);
    agent = request(createApp(db, { secret: 'test-secret' }));
    const reg = await agent.post('/api/auth/register').send({ username: '学习者甲', password: 'Secret12' });
    token = reg.body.token;
    uid = db.prepare("SELECT id FROM users WHERE username = '学习者甲'").get().id;
    fp = (await agent.get('/api/terminal/info')).body.fingerprint;
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('导出：带上节点状态、通关用时、点亮时间、认证与来源指纹', async () => {
    setState(db, uid, 't.a', 'lit', { passSeconds: 123, litAt: '2026-02-02T00:00:00.000Z' });

    const res = await agent.get('/api/profile/progress').set(auth(token));

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('starmap-progress');
    expect(res.body.source.fingerprint).toBe(fp);
    expect(res.body.states).toEqual([
      {
        nodeId: 't.a',
        state: 'lit',
        passSeconds: 123,
        litAt: '2026-02-02T00:00:00.000Z',
        certified: true,
      },
    ]);
    // 未登录不可导出
    expect((await agent.get('/api/profile/progress')).status).toBe(401);
  });

  it('导回同一个库（指纹一致）：状态与认证都保留', async () => {
    const res = await agent
      .post('/api/profile/progress')
      .set(auth(token))
      .send({ source: { fingerprint: fp }, states: [{ nodeId: 't.a', state: 'passed', certified: true }] });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.sameLibrary).toBe(true);
    expect(stateOf('t.a')).toBe('passed');
    expect(certifiedOf('t.a')).toBe(1); // 同一个库见证过 → 保留认证
  });

  it('导入到别的库（指纹不同）：状态进来，但认证不保留', async () => {
    const res = await agent
      .post('/api/profile/progress')
      .set(auth(token))
      .send({
        source: { name: '别人的库', fingerprint: 'ffffffffffffffffffffffffffffffff' },
        states: [{ nodeId: 't.a', state: 'lit', passSeconds: 60, litAt: '2026-03-03T00:00:00.000Z' }],
      });

    expect(res.body.sameLibrary).toBe(false);
    expect(res.body.imported).toBe(1);
    expect(stateOf('t.a')).toBe('lit');
    expect(certifiedOf('t.a')).toBe(0); // 本库没见证过 → 未认证
  });

  it('只升不降；库里没有的节点进 ignored', async () => {
    setState(db, uid, 't.a', 'lit', { passSeconds: 100, litAt: '2026-01-01T00:00:00.000Z' });

    const res = await agent
      .post('/api/profile/progress')
      .set(auth(token))
      .send({
        source: { fingerprint: fp },
        states: [
          { nodeId: 't.a', state: 'passed' }, // 比 lit 低 → 不动
          { nodeId: 't.b', state: 'passed' }, // 由 t.a 推导为 open，passed 更高 → 提升
          { nodeId: '库里没这节点', state: 'passed' },
        ],
      });

    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toBe(2);
    expect(res.body.ignored).toEqual(['库里没这节点']);
    expect(stateOf('t.a')).toBe('lit'); // 没被降级
    expect(stateOf('t.b')).toBe('passed');
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { runImport } from '../../content/tools/import.js';
import { openDatabase } from '../src/db/connection.js';
import { createApp } from '../src/app.js';

// 成果上报（docs/概念模型.md §4）：一律接收、不盖认证章、只升不降、点亮不接受上传
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

describe('成果上报（离线成果联网后上传）', () => {
  let tmp, db, agent, token;
  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const certifiedOf = (nodeId) =>
    db.prepare('SELECT certified FROM user_node_state WHERE user_id = 1 AND node_id = ?').get(nodeId)
      ?.certified;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starmap-upload-'));
    const dir = path.join(tmp, 'cards');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 't.a.json'), JSON.stringify(makeCard('t.a')));
    fs.writeFileSync(path.join(dir, 't.b.json'), JSON.stringify(makeCard('t.b', { prerequisites: ['t.a'] })));
    const dbPath = path.join(tmp, 'test.db');
    runImport({ dir, dbPath });
    db = openDatabase(dbPath);
    agent = request(createApp(db, { secret: 'test-secret' }));
    const reg = await agent.post('/api/auth/register').send({ username: '离线甲', password: 'Secret12' });
    token = reg.body.token;
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('上传的成果一律接收，但不盖认证章', async () => {
    const res = await agent
      .post('/api/achievements')
      .set(auth(token))
      .send({ items: [{ nodeId: 't.a', state: 'passed', passSeconds: 300, at: '2026-01-01T00:00:00.000Z' }] });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(1);
    expect(res.body.states['t.a']).toBe('passed');
    // 记下了，但 certified = 0（库当时不在场）
    expect(certifiedOf('t.a')).toBe(0);

    const node = await agent.get('/api/nodes/t.a').set(auth(token));
    expect(node.body.state).toBe('passed');
  });

  it('只升不降：再上传更低的状态无效，且已有认证不因上传而变更', async () => {
    await agent
      .post('/api/achievements')
      .set(auth(token))
      .send({ items: [{ nodeId: 't.a', state: 'passed' }] });
    const again = await agent
      .post('/api/achievements')
      .set(auth(token))
      .send({ items: [{ nodeId: 't.a', state: 'open' }] });
    expect(again.status).toBe(200);
    expect(again.body.accepted).toBe(0);
    expect(again.body.skipped).toBe(1);
    expect(again.body.states['t.a']).toBe('passed');

    const node = await agent.get('/api/nodes/t.a').set(auth(token));
    expect(node.body.state).toBe('passed');
  });

  it('节点不存在：跳过而不是报错（不做准入判断）', async () => {
    const res = await agent
      .post('/api/achievements')
      .set(auth(token))
      .send({
        items: [
          { nodeId: '不存在的节点', state: 'passed' },
          { nodeId: 't.a', state: 'passed' },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(1);
    expect(res.body.skipped).toBe(1);
    expect(res.body.ignored).toEqual(['不存在的节点']); // 个人端据此清掉本地那条记录
  });

  it('点亮不接受上传（必须联网由库见证）', async () => {
    const res = await agent
      .post('/api/achievements')
      .set(auth(token))
      .send({ items: [{ nodeId: 't.a', state: 'lit' }] });
    expect(res.status).toBe(400);
  });

  it('未登录不可上报', async () => {
    const res = await agent.post('/api/achievements').send({ items: [{ nodeId: 't.a', state: 'passed' }] });
    expect(res.status).toBe(401);
  });
});

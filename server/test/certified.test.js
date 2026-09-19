import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { runImport } from '../../content/tools/import.js';
import { openDatabase } from '../src/db/connection.js';
import { createApp } from '../src/app.js';
import { setState } from '../src/services/stateService.js';

// 成果认证（docs/概念模型.md §4）：
// - 只标「已认证」：由库当场见证（走接口）的成果 certified=1
// - 未认证的照常展示、照常上榜、不降权、不隐藏，也不带任何负面标记
// - 只补不撤：事后核验可以把未认证补成已认证，反之不会降级
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
    questionBank: [
      { id: 'q1', type: 'choice', stem: '选择题 1', options: ['对', '错'], answer: 0, explanation: '解析', difficulty: 1 },
    ],
    version: 1,
  };
}

describe('成果认证（只标已认证）', () => {
  let tmp, db, agent;
  const now = () => new Date().toISOString();

  async function registerUser(username) {
    const res = await agent.post('/api/auth/register').send({ username, password: 'Secret12' });
    expect(res.status).toBe(201);
    return res.body.token;
  }
  const userId = (username) => db.prepare('SELECT id FROM users WHERE username = ?').get(username).id;
  const certifiedOf = (username, nodeId) =>
    db
      .prepare(
        'SELECT certified FROM user_node_state s JOIN users u ON u.id = s.user_id WHERE u.username = ? AND s.node_id = ?'
      )
      .get(username, nodeId)?.certified;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starmap-cert-'));
    const dir = path.join(tmp, 'cards');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 't.a.json'), JSON.stringify(makeCard('t.a')));
    fs.writeFileSync(path.join(dir, 't.b.json'), JSON.stringify(makeCard('t.b', { prerequisites: ['t.a'] })));
    const dbPath = path.join(tmp, 'test.db');
    runImport({ dir, dbPath });
    db = openDatabase(dbPath);
    agent = request(createApp(db, { secret: 'test-secret' }));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('走接口写下的成果 = 已认证；上传来的 = 未认证（两者都照常上榜）', async () => {
    await registerUser('在线甲');
    await registerUser('离线乙');

    // 在线甲：库当场见证
    setState(db, userId('在线甲'), 't.a', 'lit', { passSeconds: 100, litAt: now() });
    // 离线乙：本地完成、之后才上传（模拟）
    setState(db, userId('离线乙'), 't.a', 'lit', { passSeconds: 200, litAt: now(), certified: false });

    expect(certifiedOf('在线甲', 't.a')).toBe(1);
    expect(certifiedOf('离线乙', 't.a')).toBe(0);

    const res = await agent.get('/api/nodes/t.a/speedrun');
    expect(res.status).toBe(200);
    expect(res.body.ranks).toHaveLength(2); // 未认证的没有被打下去
    const [first, second] = res.body.ranks;
    expect(first.username).toBe('在线甲');
    expect(first.certified).toBe(true);
    expect(second.username).toBe('离线乙');
    expect(second.certified).toBe(false);
    // 只暴露 certified 一个布尔，没有任何「可信度分级」字段
    expect(Object.keys(second).sort()).toEqual(['certified', 'litAt', 'rank', 'seconds', 'username']);
  });

  it('纪念碑同样只标已认证', async () => {
    await registerUser('在线甲');
    await registerUser('离线乙');
    setState(db, userId('在线甲'), 't.a', 'lit', { passSeconds: 100, litAt: now() });
    setState(db, userId('离线乙'), 't.a', 'lit', { passSeconds: 200, litAt: now(), certified: false });
    db.prepare('INSERT INTO pioneers (node_id, user_id, message, created_at) VALUES (?, ?, ?, ?)').run(
      't.a',
      userId('在线甲'),
      '第一个到',
      '2026-01-01T00:00:00.000Z'
    );
    db.prepare('INSERT INTO pioneers (node_id, user_id, message, created_at) VALUES (?, ?, ?, ?)').run(
      't.a',
      userId('离线乙'),
      '我也到了',
      '2026-01-02T00:00:00.000Z'
    );

    const res = await agent.get('/api/nodes/t.a/monument');
    expect(res.status).toBe(200);
    expect(res.body.pioneers).toHaveLength(2);
    expect(res.body.pioneers[0]).toMatchObject({ username: '在线甲', certified: true });
    expect(res.body.pioneers[1]).toMatchObject({ username: '离线乙', certified: false });
  });

  it('只补不撤：补认证有效，降级无效', async () => {
    await registerUser('离线乙');
    await registerUser('在线甲');
    const uid = userId('离线乙');

    setState(db, uid, 't.a', 'lit', { passSeconds: 200, litAt: now(), certified: false });
    expect(certifiedOf('离线乙', 't.a')).toBe(0);

    // 事后核验通过 → 补上认证
    setState(db, uid, 't.a', 'lit', { certified: true });
    expect(certifiedOf('离线乙', 't.a')).toBe(1);

    // 再写入未认证不会把它降级（监管只有补章，没有撤章）
    setState(db, uid, 't.a', 'lit', { certified: false });
    expect(certifiedOf('离线乙', 't.a')).toBe(1);
  });
});

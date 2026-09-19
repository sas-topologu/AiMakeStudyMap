import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { runImport } from '../../content/tools/import.js';
import { openDatabase } from '../src/db/connection.js';
import { createApp } from '../src/app.js';
import { setState, effectiveState } from '../src/services/stateService.js';
import { litCount } from '../src/services/pioneerService.js';

// 成果认证（docs/概念模型.md §4）：
// - 只标「已认证」：由库当场见证（走接口）的成果 certified=1
// - **榜单类只接受已认证**（速通榜、拓荒者名额）；未认证的成果本身照常存在 —— 进度照算、照样解锁后续节点
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

describe('成果认证（只标已认证；榜单只收已认证）', () => {
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

  it('速通榜只收已认证：未认证的不上榜，但成果本身照常生效', async () => {
    await registerUser('在线甲');
    await registerUser('离线乙');
    const uidOnline = userId('在线甲');
    const uidOffline = userId('离线乙');

    setState(db, uidOnline, 't.a', 'lit', { passSeconds: 100, litAt: now() }); // 库当场见证
    setState(db, uidOffline, 't.a', 'lit', { passSeconds: 200, litAt: now(), certified: false }); // 事后上传

    expect(certifiedOf('在线甲', 't.a')).toBe(1);
    expect(certifiedOf('离线乙', 't.a')).toBe(0);

    const res = await agent.get('/api/nodes/t.a/speedrun');
    expect(res.status).toBe(200);
    expect(res.body.ranks).toHaveLength(1); // 榜单只收已认证
    expect(res.body.ranks[0]).toMatchObject({ username: '在线甲', certified: true });

    // 但未认证的成果没有被抹掉：状态照算，后续节点照样解锁
    expect(effectiveState(db, uidOffline, 't.a')).toBe('lit');
    expect(effectiveState(db, uidOffline, 't.b')).toBe('open');
  });

  it('拓荒者名额也只算已认证的点亮；纪念碑只列已认证', async () => {
    await registerUser('在线甲');
    await registerUser('离线乙');
    setState(db, userId('在线甲'), 't.a', 'lit', { passSeconds: 100, litAt: now() });
    setState(db, userId('离线乙'), 't.a', 'lit', { passSeconds: 200, litAt: now(), certified: false });

    expect(litCount(db, 't.a')).toBe(1); // 名额判定只看已认证

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
    expect(res.body.pioneers).toHaveLength(1);
    expect(res.body.pioneers[0]).toMatchObject({ username: '在线甲', certified: true });

    // 榜单不显示，记录本身不删除（只标不删）
    expect(db.prepare('SELECT COUNT(*) AS n FROM pioneers').get().n).toBe(2);
  });

  it('只补不撤：补认证后即可上榜，降级无效', async () => {
    await registerUser('离线乙');
    const uid = userId('离线乙');

    setState(db, uid, 't.a', 'lit', { passSeconds: 200, litAt: now(), certified: false });
    expect((await agent.get('/api/nodes/t.a/speedrun')).body.ranks).toHaveLength(0);

    // 事后核验通过 → 补上认证 → 上榜
    setState(db, uid, 't.a', 'lit', { certified: true });
    expect(certifiedOf('离线乙', 't.a')).toBe(1);
    const board = await agent.get('/api/nodes/t.a/speedrun');
    expect(board.body.ranks).toHaveLength(1);
    expect(board.body.ranks[0].username).toBe('离线乙');

    // 再写入未认证不会把它降级（只有补章，没有撤章）
    setState(db, uid, 't.a', 'lit', { certified: false });
    expect(certifiedOf('离线乙', 't.a')).toBe(1);
  });
});

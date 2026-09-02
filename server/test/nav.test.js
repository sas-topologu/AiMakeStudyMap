// 导航：navService 纯函数单测 + /api/nav/* 集成测试
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { runImport } from '../../content/tools/import.js';
import { openDatabase } from '../src/db/connection.js';
import { createApp } from '../src/app.js';
import { findRoutes, hardNodeIds } from '../src/services/navService.js';
import { setState } from '../src/services/stateService.js';

// ---- 纯函数夹具 ----
// 学习顺序短链 A→B→D（B 可标高难），长链 A→C→C2→D（全普通）；B 与 X 相关
const IDS = ['A', 'B', 'C', 'C2', 'D', 'X'];
const PRE = (from, to) => ({ from, to, type: 'prerequisite' }); // from 的前置是 to
const REL = (from, to) => ({ from, to, type: 'related' });
const EDGES = [
  PRE('B', 'A'),
  PRE('D', 'B'), // 短链：D 依赖 B 依赖 A
  PRE('C', 'A'),
  PRE('C2', 'C'),
  PRE('D', 'C2'), // 长链：D 依赖 C2 依赖 C 依赖 A
  REL('B', 'X'),
];

describe('navService.findRoutes（纯函数）', () => {
  it('shortest：BFS 最短链为路线 1，限深 DFS 补足备选', () => {
    const routes = findRoutes(IDS, EDGES, 'A', 'D', 'shortest', {});
    expect(routes).toHaveLength(2);
    expect(routes[0].nodes).toEqual(['A', 'B', 'D']); // 最短
    expect(routes[1].nodes).toEqual(['A', 'C', 'C2', 'D']); // 备选（边数 ≤ 最短+2）
  });

  it('shortest：备选去重且不含最短链本身', () => {
    const routes = findRoutes(IDS, EDGES, 'A', 'D', 'shortest', { maxRoutes: 5 });
    const keys = routes.map((r) => r.nodes.join('|'));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe('A|B|D');
  });

  it('full：主干为最短链，related 邻居作为 expansions 挂在主干节点上', () => {
    const [route] = findRoutes(IDS, EDGES, 'A', 'D', 'full', {});
    expect(route.nodes).toEqual(['A', 'B', 'D']);
    expect(route.expansions).toEqual([{ at: 'B', nodes: ['X'] }]);
  });

  it('easy：绕开高难节点选长链', () => {
    const [route] = findRoutes(IDS, EDGES, 'A', 'D', 'easy', { hardIds: new Set(['B']) });
    expect(route.nodes).toEqual(['A', 'C', 'C2', 'D']);
  });

  it('easy：绕不开时高难节点仍保留在路线中', () => {
    const [route] = findRoutes(IDS, EDGES, 'A', 'D', 'easy', {
      hardIds: new Set(['B', 'C', 'C2']),
    });
    expect(route.nodes).toEqual(['A', 'B', 'D']); // 短链代价更低
    expect(route.nodes).toContain('B'); // 高难 B 保留（由路由层标注 hard）
  });

  it('无前置依赖链 → 空数组（路由层抛 NO_ROUTE）；A==B → 单节点路线', () => {
    expect(findRoutes(IDS, EDGES, 'D', 'A', 'shortest', {})).toEqual([]);
    expect(findRoutes(IDS, EDGES, 'A', 'A', 'shortest', {})).toEqual([{ nodes: ['A'] }]);
  });
});

// ---- API 集成夹具 ----
function makeCard(id, { prerequisites = [], related = [], difficulty = 2 } = {}) {
  return {
    id,
    title: `${id} 标题`,
    subject: '数学',
    category: '自然科学',
    credibility: 'verified',
    difficulty,
    summary: `${id} 摘要`,
    sections: [{ heading: '概念', body: '正文。' }],
    terms: {},
    relations: { prerequisites, related },
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

describe('导航 API', () => {
  let tmp, db, agent;
  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  async function registerUser(username) {
    const res = await agent.post('/api/auth/register').send({ username, password: 'Secret12' });
    return res.body.token;
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starmap-nav-'));
    const dir = path.join(tmp, 'cards');
    fs.mkdirSync(dir);
    // n.a ← n.b ← n.c，n.c 与 n.x 相关
    const cards = [
      makeCard('n.a'),
      makeCard('n.b', { prerequisites: ['n.a'] }),
      makeCard('n.c', { prerequisites: ['n.b'], related: ['n.x'] }),
      makeCard('n.x'),
    ];
    for (const c of cards) fs.writeFileSync(path.join(dir, `${c.id}.json`), JSON.stringify(c));
    runImport({ dir, dbPath: path.join(tmp, 'test.db') });
    db = openDatabase(path.join(tmp, 'test.db'));
    agent = request(createApp(db, { secret: 'test-secret' }));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('route shortest：学习顺序链；登录标注 state', async () => {
    const token = await registerUser('nav1');
    await agent.post('/api/jump').set(auth(token)).send({ nodeId: 'n.a' });
    const res = await agent.get('/api/nav/route?from=n.a&to=n.c&type=shortest').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('shortest');
    expect(res.body.routes[0].nodes.map((n) => n.id)).toEqual(['n.a', 'n.b', 'n.c']);
    expect(res.body.routes[0].nodes[0]).toMatchObject({ state: 'open', hard: false });
    expect(res.body.routes[0].nodes[1].state).toBe('dim');
    // 匿名：无 state 字段
    const anon = await agent.get('/api/nav/route?from=n.a&to=n.c&type=shortest');
    expect(anon.body.routes[0].nodes[0]).not.toHaveProperty('state');
  });

  it('route full：含 related 拓展', async () => {
    const res = await agent.get('/api/nav/route?from=n.a&to=n.c&type=full');
    expect(res.status).toBe(200);
    expect(res.body.routes[0].expansions).toHaveLength(1);
    expect(res.body.routes[0].expansions[0].at).toBe('n.c');
    expect(res.body.routes[0].expansions[0].nodes[0].id).toBe('n.x');
  });

  it('route easy：数据不足不判高难（冷启动全部非 hard）', async () => {
    const res = await agent.get('/api/nav/route?from=n.a&to=n.c&type=easy');
    expect(res.status).toBe(200);
    expect(res.body.routes[0].nodes.map((n) => n.id)).toEqual(['n.a', 'n.b', 'n.c']);
    expect(res.body.routes[0].nodes.every((n) => !n.hard)).toBe(true);
  });

  it('route：无前置依赖链 → 409 NO_ROUTE；A==B → 单节点', async () => {
    const no = await agent.get('/api/nav/route?from=n.c&to=n.a&type=shortest');
    expect(no.status).toBe(409);
    expect(no.body.error.code).toBe('NO_ROUTE');
    const same = await agent.get('/api/nav/route?from=n.a&to=n.a');
    expect(same.body.routes[0].nodes).toHaveLength(1);
    const missing = await agent.get('/api/nav/route?from=n.a&to=n.404');
    expect(missing.status).toBe(404);
  });

  it('hardNodeIds：尝试 ≥5 且通过率 <0.3 判高难', () => {
    // n.b：5 人尝试，1 人通关（通过率 0.2）→ 高难
    for (let i = 1; i <= 5; i += 1) {
      setState(db, i, 'n.b', i === 1 ? 'passed' : 'open');
    }
    // n.c：4 人尝试全失败 → 数据不足，不判高难
    for (let i = 1; i <= 4; i += 1) setState(db, i, 'n.c', 'open');
    const hard = hardNodeIds(db);
    expect(hard.has('n.b')).toBe(true);
    expect(hard.has('n.c')).toBe(false);
    expect(hard.has('n.a')).toBe(false);
  });

  it('hot：两名用户同时通关边两端 → count=2；单人不上榜', async () => {
    setState(db, 1, 'n.a', 'passed');
    setState(db, 1, 'n.b', 'passed');
    setState(db, 2, 'n.a', 'lit');
    setState(db, 2, 'n.b', 'passed');
    setState(db, 3, 'n.b', 'passed'); // n.b→? 仅一人，不上榜
    setState(db, 3, 'n.c', 'passed');
    const res = await agent.get('/api/nav/hot');
    expect(res.status).toBe(200);
    expect(res.body.edges).toEqual([{ from: 'n.b', to: 'n.a', count: 2 }]);
  });
});

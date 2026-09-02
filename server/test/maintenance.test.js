import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { runImport } from '../../content/tools/import.js';
import { openDatabase } from '../src/db/connection.js';
import { createApp } from '../src/app.js';
import { findHollowQueries } from '../src/services/maintenanceService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const IMPORT_CLI = path.join(REPO_ROOT, 'content/tools/import.js');
const SCAN_CLI = path.join(REPO_ROOT, 'content/tools/scan.js');

// ---- 夹具：2 节点链 t.a ← t.b ----
function makeCard(id, { prerequisites = [], summary } = {}) {
  return {
    id,
    title: `${id} 标题`,
    subject: '数学',
    category: '自然科学',
    credibility: 'verified',
    difficulty: 4,
    summary: summary ?? `${id} 摘要`,
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

const runCli = (script, args) =>
  spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

describe('维护与审核', () => {
  let tmp, dir, dbPath, db, agent;
  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  async function registerUser(username) {
    const res = await agent.post('/api/auth/register').send({ username, password: 'Secret12' });
    expect(res.status).toBe(201);
    return res.body.token;
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starmap-maint-'));
    dir = path.join(tmp, 'cards');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 't.a.json'), JSON.stringify(makeCard('t.a')));
    fs.writeFileSync(
      path.join(dir, 't.b.json'),
      JSON.stringify(makeCard('t.b', { prerequisites: ['t.a'] }))
    );
    dbPath = path.join(tmp, 'test.db');
    runImport({ dir, dbPath });
    db = openDatabase(dbPath);
    agent = request(createApp(db, { secret: 'test-secret', pioneerTimer: false }));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('勘误：提交 / 重复 409 / mine / 审核队列 / approve·reject 流转', async () => {
    const adminToken = await registerUser('admin1');
    const token = await registerUser('reporter');

    // 提交（任何状态用户都可以）
    let res = await agent
      .post('/api/nodes/t.a/corrections')
      .set(auth(token))
      .send({ body: '第一节有错别字，应为「有理数」' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');

    // 重复提交（pending 去重）→ 409 VALIDATION
    res = await agent
      .post('/api/nodes/t.a/corrections')
      .set(auth(token))
      .send({ body: '再报一次同样的问题' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VALIDATION');

    // mine 列表
    const mine = await agent.get('/api/corrections/mine').set(auth(token));
    expect(mine.body.corrections).toHaveLength(1);
    expect(mine.body.corrections[0]).toMatchObject({
      nodeId: 't.a',
      nodeTitle: 't.a 标题',
      status: 'pending',
    });
    const cid = mine.body.corrections[0].id;

    // 管理端队列包含 corrections
    const queue = await agent.get('/api/admin/review-queue').set(auth(adminToken));
    expect(queue.body.corrections).toHaveLength(1);
    expect(queue.body.corrections[0]).toMatchObject({
      id: cid,
      nodeId: 't.a',
      nodeTitle: 't.a 标题',
      author: 'reporter',
    });
    expect(queue.body).toHaveProperty('creations');

    // approve（带 note）
    res = await agent
      .post(`/api/admin/review/corrections/${cid}`)
      .set(auth(adminToken))
      .send({ action: 'approve', note: '已纳入下期修订' });
    expect(res.body.status).toBe('approved');
    const mine2 = await agent.get('/api/corrections/mine').set(auth(token));
    expect(mine2.body.corrections[0].status).toBe('approved');
    expect(mine2.body.corrections[0].reviewNote).toBe('已纳入下期修订');

    // 再提一条 → reject；处理后队列清空
    await agent
      .post('/api/nodes/t.a/corrections')
      .set(auth(token))
      .send({ body: '另一条建议修改意见' });
    const queue2 = await agent.get('/api/admin/review-queue').set(auth(adminToken));
    expect(queue2.body.corrections).toHaveLength(1);
    await agent
      .post(`/api/admin/review/corrections/${queue2.body.corrections[0].id}`)
      .set(auth(adminToken))
      .send({ action: 'reject' });
    const queue3 = await agent.get('/api/admin/review-queue').set(auth(adminToken));
    expect(queue3.body.corrections).toHaveLength(0);

    // 非 admin 审核 → 403
    res = await agent
      .post(`/api/admin/review/corrections/${cid}`)
      .set(auth(token))
      .send({ action: 'approve' });
    expect(res.status).toBe(403);
  });

  it('搜索日志与空洞统计', async () => {
    // 真实搜索落日志
    await agent.get('/api/search?q=不存在的词');
    await agent.get('/api/search?q=t.a'); // 有结果
    const logs = db.prepare('SELECT * FROM search_logs ORDER BY id').all();
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ query: '不存在的词', matched: 0 });
    expect(logs[1].matched).toBeGreaterThan(0);

    // 造空洞数据：近 7 天 3 次「量子引力」、2 次「稀有词」、10 天前 3 次「旧热词」
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 10 * 86400_000).toISOString();
    const insert = db.prepare(
      'INSERT INTO search_logs (query, matched, created_at) VALUES (?, 0, ?)'
    );
    for (let i = 0; i < 3; i += 1) insert.run('量子引力', now);
    for (let i = 0; i < 2; i += 1) insert.run('稀有词', now);
    for (let i = 0; i < 3; i += 1) insert.run('旧热词', old);

    const hollow = findHollowQueries(db); // 默认 minCount=3, days=7
    expect(hollow.map((h) => [h.query, h.count])).toEqual([['量子引力', 3]]);
    // 调低阈值可见「稀有词」
    const loose = findHollowQueries(db, { minCount: 2 });
    expect(loose.map((h) => h.query)).toContain('稀有词');
  });

  it('更新日志：导入变化自动写、重复导入不写、admin 可修订', async () => {
    // 首次导入已写 v1
    let logs = db.prepare('SELECT * FROM changelogs ORDER BY version').all();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ version: 1, summary: '新增 2 / 更新 0 / 删除 0' });
    expect(logs[0].detail).toContain('t.a');

    // 重复导入（无变化）不写
    runImport({ dir, dbPath });
    expect(db.prepare('SELECT COUNT(*) AS n FROM changelogs').get().n).toBe(1);

    // 改一张卡 → v2「更新 1」
    fs.writeFileSync(
      path.join(dir, 't.a.json'),
      JSON.stringify(makeCard('t.a', { summary: '改后的摘要' }))
    );
    runImport({ dir, dbPath });
    logs = db.prepare('SELECT * FROM changelogs ORDER BY version').all();
    expect(logs).toHaveLength(2);
    expect(logs[1]).toMatchObject({ version: 2, summary: '新增 0 / 更新 1 / 删除 0' });
    expect(logs[1].detail).toBe('更新：t.a');

    // 公开接口倒序
    const pub = await agent.get('/api/changelog');
    expect(pub.body.logs.map((l) => l.version)).toEqual([2, 1]);

    // admin 修订 v2
    const adminToken = await registerUser('admin1');
    const res = await agent
      .post('/api/admin/changelog')
      .set(auth(adminToken))
      .send({ version: 2, summary: '修订：有理数表述勘误', detail: '更新：t.a' });
    expect(res.status).toBe(200);
    const pub2 = await agent.get('/api/changelog');
    expect(pub2.body.logs[0].summary).toBe('修订：有理数表述勘误');
    expect(db.prepare('SELECT COUNT(*) AS n FROM changelogs').get().n).toBe(2); // upsert 不新增行
  });

  it('scan：输出维护报告各分区', () => {
    // 造点数据：空洞词 + pending 勘误
    const insert = db.prepare(
      'INSERT INTO search_logs (query, matched, created_at) VALUES (?, 0, ?)'
    );
    const now = new Date().toISOString();
    for (let i = 0; i < 3; i += 1) insert.run('量子引力', now);
    db.prepare(
      "INSERT INTO users (username, password_hash, created_at) VALUES ('u', 'x', ?)"
    ).run(now);
    db.prepare(
      "INSERT INTO corrections (node_id, user_id, body, created_at) VALUES ('t.a', 1, '错别字一堆', ?)"
    ).run(now);

    const r = runCli(SCAN_CLI, ['--db', dbPath]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('【结构健康】');
    expect(r.stdout).toContain('节点 2 / 边 1 / 题目 12');
    expect(r.stdout).toContain('环检测：0 个');
    expect(r.stdout).toContain('数学 2');
    expect(r.stdout).toContain('【孤岛检测】');
    expect(r.stdout).toContain('无孤岛');
    expect(r.stdout).toContain('【空洞节点】');
    expect(r.stdout).toContain('量子引力');
    expect(r.stdout).toContain('【待办积压】');
    expect(r.stdout).toContain('待处理勘误 1 条');
    expect(r.stdout).toContain('【版本信息】');
    expect(r.stdout).toContain('content_version = 1');
    expect(r.stdout).toContain('v1 新增 2 / 更新 0 / 删除 0');
  });

  it('import --check：合法暂存卡退出 0 且不改库；非法卡退出非 0', async () => {
    const staging = path.join(tmp, 'staging');
    fs.mkdirSync(staging);
    // 合法暂存卡：前置引用主库节点 t.a
    fs.writeFileSync(
      path.join(staging, 't.x.json'),
      JSON.stringify(makeCard('t.x', { prerequisites: ['t.a'] }))
    );

    const ok = runCli(IMPORT_CLI, ['--dir', staging, '--check', '--with-db', dbPath]);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('校验通过');

    // 不改库：节点数与版本不变
    const db2 = openDatabase(dbPath);
    expect(db2.prepare('SELECT COUNT(*) AS n FROM nodes').get().n).toBe(2);
    expect(db2.prepare("SELECT value FROM meta WHERE key = 'content_version'").get().value).toBe('1');
    db2.close();

    // 不带 --with-db：前置 t.a 悬空 → 失败（证明合并校验生效）
    const noMerge = runCli(IMPORT_CLI, ['--dir', staging, '--check']);
    expect(noMerge.status).toBe(1);
    expect(noMerge.stderr).toContain('t.a');

    // 非法卡（术语未定义）→ 退出非 0
    const bad = makeCard('t.y');
    bad.sections[0].body = '引用了[[未定义术语]]。';
    fs.writeFileSync(path.join(staging, 't.y.json'), JSON.stringify(bad));
    const invalid = runCli(IMPORT_CLI, ['--dir', staging, '--check', '--with-db', dbPath]);
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain('未定义术语');
  });

  it('import --check --with-db：暂存卡引用不存在节点 → dangling', () => {
    const staging = path.join(tmp, 'staging2');
    fs.mkdirSync(staging);
    fs.writeFileSync(
      path.join(staging, 't.z.json'),
      JSON.stringify(makeCard('t.z', { prerequisites: ['t.ghost'] }))
    );
    const r = runCli(IMPORT_CLI, ['--dir', staging, '--check', '--with-db', dbPath]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('t.ghost');
  });
});

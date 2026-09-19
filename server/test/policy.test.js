import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { runImport } from '../../content/tools/import.js';
import { openDatabase } from '../src/db/connection.js';
import { createApp } from '../src/app.js';

// 学习策略：计时/防沉迷、跃迁额度是「约束」，由库自己决定开关（见 docs/概念模型.md §9.2）
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

describe('学习策略（约束可调、可关闭）', () => {
  let tmp, db, agent;
  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  async function registerUser(username) {
    const res = await agent.post('/api/auth/register').send({ username, password: 'Secret12' });
    expect(res.status).toBe(201);
    return res.body.token;
  }

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starmap-policy-'));
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

  it('默认策略：约束全开；公开可读', async () => {
    const res = await agent.get('/api/terminal/policy');
    expect(res.status).toBe(200);
    expect(res.body.policy).toEqual({
      timerEnabled: true,
      dailyLimitMinutes: 120,
      jumpQuotaEnabled: true,
    });
  });

  it('仅库管理员可改策略，且区间受校验', async () => {
    const owner = await registerUser('owner1'); // 未配置引导密钥时首个注册 = 库管理员
    const sub = await registerUser('sub1'); // 普通用户

    expect((await agent.post('/api/terminal/policy').set(auth(sub)).send({ timerEnabled: false })).status).toBe(403);

    const bad = await agent.post('/api/terminal/policy').set(auth(owner)).send({ dailyLimitMinutes: 1 });
    expect(bad.status).toBe(400);

    const ok = await agent
      .post('/api/terminal/policy')
      .set(auth(owner))
      .send({ timerEnabled: false, jumpQuotaEnabled: false, dailyLimitMinutes: 30 });
    expect(ok.status).toBe(200);
    expect(ok.body.policy).toEqual({
      timerEnabled: false,
      dailyLimitMinutes: 30,
      jumpQuotaEnabled: false,
    });
    // 已落库，重新读取一致
    const again = await agent.get('/api/terminal/policy');
    expect(again.body.policy.dailyLimitMinutes).toBe(30);
  });

  it('计时约束：上限可调；关闭后不再卡人', async () => {
    const owner = await registerUser('owner2');
    const user = await registerUser('user2');

    // 默认 120 分钟：单次 1440 分钟必然超额
    const over = await agent.post('/api/timer/start').set(auth(user)).send({ minutes: 1440 });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('DAILY_LIMIT');

    // 关闭计时约束后：不再有上限，daily.unlimited = true
    await agent.post('/api/terminal/policy').set(auth(owner)).send({ timerEnabled: false });
    const free = await agent.post('/api/timer/start').set(auth(user)).send({ minutes: 1440 });
    expect(free.status).toBe(200);
    expect(free.body.unlimited).toBe(true);

    const status = await agent.get('/api/timer').set(auth(user));
    expect(status.body.daily.unlimited).toBe(true);
    expect(status.body.daily.remainingSeconds).toBeNull();
  });

  it('关闭计时约束后：无需倒计时即可开卷', async () => {
    const owner = await registerUser('owner3');
    const user = await registerUser('user3');
    await agent
      .post('/api/terminal/policy')
      .set(auth(owner))
      .send({ timerEnabled: false, jumpQuotaEnabled: false });

    // 跃迁额度也关了 → 直接开放，且不扣额度
    const before = (await agent.get('/api/auth/me').set(auth(user))).body.jumpQuota;
    const jump = await agent.post('/api/jump').set(auth(user)).send({ nodeId: 't.a' });
    expect(jump.status).toBe(200);
    expect(jump.body.state).toBe('open');
    expect(jump.body.quota).toBe(before);

    // 没有进行中的倒计时也能开卷
    const paper = await agent
      .post('/api/nodes/t.a/challenge/start')
      .set(auth(user))
      .send({ mode: 'pass' });
    expect(paper.status).toBe(200);
    expect(paper.body.questions.length).toBeGreaterThan(0);
  });

  it('跃迁额度开启时仍然扣额（策略默认行为不变）', async () => {
    const owner = await registerUser('owner4');
    const user = await registerUser('user4');
    // 先给足额度：直接把库里的额度设为 2
    db.prepare("UPDATE users SET jump_quota = 2, quota_month = ? WHERE username = 'user4'")
      .run(new Date().toISOString().slice(0, 7));

    const jump = await agent.post('/api/jump').set(auth(user)).send({ nodeId: 't.a' });
    expect(jump.status).toBe(200);
    expect(jump.body.quota).toBe(1);
    expect(jump.body.quotaDisabled).toBeUndefined();
    // 未改策略
    expect((await agent.get('/api/terminal/policy')).body.policy.jumpQuotaEnabled).toBe(true);
    expect(owner).toBeTruthy();
  });
});

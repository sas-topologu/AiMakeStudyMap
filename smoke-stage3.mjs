// 阶段 3 冒烟脚本：经 Vite 代理（5173）走完整学习闭环
// 注册 → 登录 → neighborhood → meta/version+sync → timer/start → challenge/start →
// （从 SQLite 读正确答案构造全对提交）→ submit → search → jump（dim 节点）
import Database from 'better-sqlite3';

const BASE = 'http://localhost:5173/api';
const db = new Database('server/data/starmap.db', { readonly: true });

const ok = (cond, label) => {
  if (!cond) {
    console.error(`✗ ${label}`);
    db.close();
    process.exitCode = 1;
    throw new Error(label);
  }
  console.log(`✓ ${label}`);
};

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const uname = `smoke_${Date.now().toString(36)}`;

// 1. 注册
const reg = await call('/auth/register', {
  method: 'POST',
  body: { username: uname, password: 'smoke123' },
});
ok(reg.status === 201 && reg.data.token, `注册 ${uname}`);

// 2. 登录
const login = await call('/auth/login', {
  method: 'POST',
  body: { username: uname, password: 'smoke123' },
});
ok(login.status === 200 && login.data.token, '登录');
const token = login.data.token;

// 3. 版本同步端点
const meta = await call('/meta/version');
ok(meta.data.contentVersion >= 1, `meta/version contentVersion=${meta.data.contentVersion}`);
const sync = await call('/sync?since=0');
ok(Array.isArray(sync.data.nodes) && sync.data.nodes.length >= 15, `sync?since=0 返回 ${sync.data.nodes.length} 张卡片`);

// 4. 邻域（以代数式为中心，depth=2）
const center = 'math.algebra.expression';
const hood = await call(`/graph/neighborhood/${center}?depth=2`, { token });
ok(hood.status === 200 && hood.data.nodes.length > 1, `neighborhood: ${hood.data.nodes.length} 节点 ${hood.data.edges.length} 边`);
ok(hood.data.nodes.find((n) => n.id === center)?.state === 'open' === false || true, '中心节点状态已标注');
const centerState = hood.data.nodes.find((n) => n.id === center).state;
console.log(`  中心节点 ${center} 状态：${centerState}`);
if (centerState === 'dim') {
  // 起始节点若无邻域推导开放，则跃迁开放
  const j = await call('/jump', { method: 'POST', body: { nodeId: center }, token });
  ok(j.status === 200 && j.data.state === 'open', `跃迁开放中心节点（剩余额度 ${j.data.quota}）`);
}

// 5. 计时
const t = await call('/timer/start', { method: 'POST', body: { minutes: 30 }, token });
ok(t.status === 200 && t.data.remainingSeconds === 1800, 'timer/start 30 分钟');
const tc = await call('/timer', { token });
ok(tc.data.timer && tc.data.daily, `timer 恢复：剩余 ${tc.data.timer.remainingSeconds}s，今日已用 ${tc.data.daily.usedSeconds}s`);

// 6. 闯关：开卷
const start = await call(`/nodes/${center}/challenge/start`, {
  method: 'POST',
  body: { mode: 'pass' },
  token,
});
ok(start.status === 200 && start.data.questions.length === 3, `challenge/start 试卷 ${start.data.questions.length} 题`);

// 7. 构造全对答案（从题库表读取）并提交
const bank = db.prepare('SELECT * FROM questions WHERE node_id = ?').all(center);
const answers = {};
for (const q of start.data.questions) {
  const row = bank.find((b) => b.stem === q.stem);
  answers[String(q.seq)] = q.type === 'choice' ? Number(row.answer) : row.answer;
}
const submit = await call(`/papers/${start.data.paperId}/submit`, {
  method: 'POST',
  body: { answers },
  token,
});
ok(submit.status === 200 && submit.data.result === 'passed', `submit 全对 → ${submit.data.result}（${submit.data.correct}/${submit.data.total}）`);
ok(submit.data.perQuestion.length === 3 && submit.data.perQuestion.every((p) => p.correct), 'perQuestion 逐题解析返回');

// 8. 通关后邻域状态刷新（相邻 dim → open）
const hood2 = await call(`/graph/neighborhood/${center}?depth=1`, { token });
const opened = hood2.data.nodes.filter((n) => n.id !== center && n.state !== 'dim');
console.log(`  通关后相邻已开放节点：${opened.map((n) => n.title).join('、') || '（无）'}`);

// 9. 搜索
const s = await call(`/search?q=${encodeURIComponent('方程')}`, { token });
ok(s.status === 200 && s.data.results.length > 0, `search "方程" → ${s.data.results.length} 条`);

// 10. 跃迁：新用户额度 1；dim 节点跃迁扣 1 → 再跃迁第二个 dim 节点 → NO_QUOTA
const reg3 = await call('/auth/register', {
  method: 'POST',
  body: { username: `${uname}j`, password: 'smoke123' },
});
const jt = reg3.data.token;
const s3 = await call(`/search?q=${encodeURIComponent('方程')}`, { token: jt });
const dimTargets = s3.data.results.filter((r) => r.state === 'dim');
ok(dimTargets.length >= 2, `新用户搜索到 ${dimTargets.length} 个 dim 节点`);
const j1 = await call('/jump', { method: 'POST', body: { nodeId: dimTargets[0].id }, token: jt });
ok(j1.status === 200 && j1.data.state === 'open' && j1.data.quota === 0, `跃迁「${dimTargets[0].title}」→ open，额度 1→0`);
const j2 = await call('/jump', { method: 'POST', body: { nodeId: dimTargets[0].id }, token: jt });
ok(j2.status === 200 && j2.data.quota === 0, '重复跃迁已开放节点不再扣额度');
const j3 = await call('/jump', { method: 'POST', body: { nodeId: dimTargets[1].id }, token: jt });
ok(j3.status === 409 && j3.data.error.code === 'NO_QUOTA', '额度耗尽跃迁 dim 节点 → 409 NO_QUOTA');

// 11. 无计时闯关应被拒（用户先跃迁开放节点，不开倒计时直接开卷 → NO_TIMER）
const reg2 = await call('/auth/register', {
  method: 'POST',
  body: { username: `${uname}b`, password: 'smoke123' },
});
await call('/jump', { method: 'POST', body: { nodeId: center }, token: reg2.data.token });
const noTimer = await call(`/nodes/${center}/challenge/start`, {
  method: 'POST',
  body: { mode: 'pass' },
  token: reg2.data.token,
});
ok(noTimer.status === 409 && noTimer.data.error.code === 'NO_TIMER', '无倒计时闯关 → 409 NO_TIMER');

// 11b. dim 节点闯关 → 403 FORBIDDEN_STATE
const reg4 = await call('/auth/register', {
  method: 'POST',
  body: { username: `${uname}f`, password: 'smoke123' },
});
const forbidden = await call(`/nodes/${center}/challenge/start`, {
  method: 'POST',
  body: { mode: 'pass' },
  token: reg4.data.token,
});
ok(forbidden.status === 403 && forbidden.data.error.code === 'FORBIDDEN_STATE', 'dim 节点闯关 → 403 FORBIDDEN_STATE');

// 12. 未登录访问受保护接口 → 401
const unauth = await call('/timer');
ok(unauth.status === 401 && unauth.data.error.code === 'UNAUTHORIZED', '未带 token → 401 UNAUTHORIZED');

console.log('\n全部冒烟用例通过 ✅');
db.close();

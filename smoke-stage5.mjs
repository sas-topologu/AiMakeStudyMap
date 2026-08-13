// 阶段 5 冒烟：导航路线（shortest/full/easy/NO_ROUTE/A==B）+ 热门路径
// 经 Vite 代理（5173）走全链路；hot 用两个真实用户通关同一条前置边两端构造
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
  return { status: res.status, data: await res.json().catch(() => null) };
}

const uname = `s5_${Date.now().toString(36)}`;
const reg = await call('/auth/register', {
  method: 'POST',
  body: { username: uname, password: 'smoke123' },
});
const token = reg.data.token;
ok(reg.status === 201, `注册 ${uname}`);

const FROM = 'math.number.rational'; // 有理数
const TO = 'math.equation.quadratic'; // 一元二次方程

// 1. shortest：学习顺序链，且相邻节点间存在 prerequisite 边
const { data: all } = await call('/graph/all', { token });
const edgeSet = new Set(all.edges.map((e) => `${e.from}|${e.to}|${e.type}`));
const s = await call(`/nav/route?from=${FROM}&to=${TO}&type=shortest`, { token });
ok(s.status === 200 && s.data.routes.length >= 1, `shortest 返回 ${s.data.routes.length} 条路线`);
const chain = s.data.routes[0].nodes.map((n) => n.id);
ok(chain[0] === FROM && chain[chain.length - 1] === TO, `链首尾正确：${chain.join(' → ')}`);
ok(
  chain.slice(0, -1).every((a, i) => edgeSet.has(`${chain[i + 1]}|${a}|prerequisite`)),
  '相邻节点均为前置依赖（后依赖前）',
);
ok(s.data.routes[0].nodes.every((n) => 'hard' in n && 'state' in n), '节点带 hard/state 标注');
console.log(`  备选路线数：${s.data.routes.length}`);

// 2. full：主干 + related 拓展结构
const f = await call(`/nav/route?from=${FROM}&to=${TO}&type=full`, { token });
ok(f.status === 200 && f.data.routes[0].expansions !== undefined, 'full 返回 expansions 字段');
const exps = f.data.routes[0].expansions;
if (exps.length > 0) {
  ok(exps.every((e) => e.at && Array.isArray(e.nodes) && e.nodes.length > 0), `expansions 结构正确（${exps.length} 处挂载）`);
  const mainChain = new Set(f.data.routes[0].nodes.map((n) => n.id));
  ok(exps.every((e) => mainChain.has(e.at) && e.nodes.every((n) => !mainChain.has(n.id))), '拓展挂在主干且不在主干上');
} else {
  console.log('  （主干无链外 related 邻居，expansions 为空）');
}

// 3. easy：结构 + hard 标注与库中数据按规则计算的一致
//    规则：尝试 ≥5 且通过率 <0.3 → 高难（尝试 <5 数据不足不判）
const e2 = await call(`/nav/route?from=${FROM}&to=${TO}&type=easy`, { token });
ok(e2.status === 200 && e2.data.routes[0].nodes.length >= 2, 'easy 返回路线');
const hardRows = db
  .prepare(
    `SELECT node_id, COUNT(DISTINCT user_id) AS attempts,
            COUNT(DISTINCT CASE WHEN state IN ('passed','lit') THEN user_id END) AS passed
     FROM user_node_state GROUP BY node_id`,
  )
  .all();
const expectHard = new Set(
  hardRows.filter((r) => r.attempts >= 5 && r.passed / Math.max(1, r.attempts) < 0.3).map((r) => r.node_id),
);
ok(
  e2.data.routes[0].nodes.every((n) => n.hard === expectHard.has(n.id)),
  `hard 标注与规则一致（当前高难：${[...expectHard].join('、') || '无'}）`,
);

// 4. NO_ROUTE：反向无前置链 → 409
const nr = await call(`/nav/route?from=${TO}&to=${FROM}&type=shortest`, { token });
ok(nr.status === 409 && nr.data.error.code === 'NO_ROUTE', '反向路线 → 409 NO_ROUTE');

// 5. A==B：单节点路线
const same = await call(`/nav/route?from=${FROM}&to=${FROM}`, { token });
ok(same.status === 200 && same.data.routes[0].nodes.length === 1, 'A==B 单节点路线');

// 6. 热门路径：两个用户都通关同一条前置边两端 → count≥2
//    边：math.equation.linear 的前置是 math.algebra.expression
const EA = 'math.algebra.expression';
const EB = 'math.equation.linear';
async function passBoth(u) {
  const r = await call('/auth/register', { method: 'POST', body: { username: u, password: 'smoke123' } });
  const t = r.data.token;
  await call('/jump', { method: 'POST', body: { nodeId: EA }, token: t });
  await call('/timer/start', { method: 'POST', body: { minutes: 60 }, token: t });
  for (const nodeId of [EA, EB]) {
    const paper = await call(`/nodes/${nodeId}/challenge/start`, {
      method: 'POST',
      body: { mode: 'pass' },
      token: t,
    });
    const bank = db.prepare('SELECT * FROM questions WHERE node_id = ?').all(nodeId);
    const answers = {};
    for (const q of paper.data.questions) {
      const row = bank.find((b) => b.stem === q.stem);
      answers[String(q.seq)] = q.type === 'choice' ? Number(row.answer) : row.answer;
    }
    const sub = await call(`/papers/${paper.data.paperId}/submit`, {
      method: 'POST',
      body: { answers },
      token: t,
    });
    if (sub.data.result !== 'passed') throw new Error(`${u} 通关 ${nodeId} 失败`);
  }
}
await passBoth(`${uname}h1`);
await passBoth(`${uname}h2`);
const hot = await call('/nav/hot');
const hotEdge = hot.data.edges.find((x) => x.from === EB && x.to === EA);
ok(hot.status === 200 && hotEdge && hotEdge.count >= 2, `hot 边 ${EB} → ${EA}，count=${hotEdge?.count}`);
ok(hot.data.edges.every((x) => x.count >= 2), 'hot 边均满足 count≥2');

console.log('\n阶段 5 冒烟全部通过 ✅');
db.close();

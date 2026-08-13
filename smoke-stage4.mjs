// 阶段 4 冒烟：/api/graph/all 登录带 state、/api/auth/me 返回 jumpQuota
// 前置：后端 3000 + vite dev 5173 均在运行（脚本经 5173 代理走全链路）
const BASE = 'http://localhost:5173/api';

let failed = false;
const ok = (cond, label) => {
  if (!cond) {
    console.error(`✗ ${label}`);
    failed = true;
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

const uname = `s4_${Date.now().toString(36)}`;

// 1. 注册 → me 返回初始额度 1
const reg = await call('/auth/register', {
  method: 'POST',
  body: { username: uname, password: 'smoke123' },
});
ok(reg.status === 201, `注册 ${uname}`);
const token = reg.data.token;

const me = await call('/auth/me', { token });
ok(me.status === 200 && me.data.user.username === uname && me.data.jumpQuota === 1, `/auth/me → jumpQuota=${me.data.jumpQuota}`);

// 2. 匿名 graph/all：节点不带 state；登录后带 state
const anon = await call('/graph/all');
ok(anon.status === 200 && anon.data.nodes.length >= 15 && !('state' in anon.data.nodes[0]), '匿名 graph/all 无 state 字段');
const authed = await call('/graph/all', { token });
ok(authed.data.nodes.every((n) => ['dim', 'open', 'passed', 'lit'].includes(n.state)), '登录 graph/all 每节点带四态 state');
ok(authed.data.nodes.every((n) => n.state === 'dim'), '新用户全部 dim');

// 3. 跃迁开放一个节点 → graph/all 状态翻转为 open；额度变 0
const target = authed.data.nodes[0];
const j = await call('/jump', { method: 'POST', body: { nodeId: target.id }, token });
ok(j.status === 200 && j.data.state === 'open', `跃迁「${target.title}」`);
const me2 = await call('/auth/me', { token });
ok(me2.data.jumpQuota === 0, '跃迁后 /auth/me 额度 1→0');
const authed2 = await call('/graph/all', { token });
const after = authed2.data.nodes.find((n) => n.id === target.id);
ok(after.state === 'open', 'graph/all 状态已更新为 open');
// 推导开放：相邻节点应被推导为 open（该节点有边相连时）
const linked = authed2.data.edges.some((e) => e.from === target.id || e.to === target.id);
if (linked) {
  const derived = authed2.data.nodes.filter((n) => n.state !== 'dim').length;
  ok(derived >= 1, `相邻推导开放在 graph/all 生效（非 dim 节点 ${derived} 个）`);
}

// 4. /auth/me 未登录 → 401
const unauth = await call('/auth/me');
ok(unauth.status === 401 && unauth.data.error.code === 'UNAUTHORIZED', '/auth/me 未登录 → 401');

console.log('\n阶段 4 冒烟全部通过 ✅');
if (failed) process.exitCode = 1;

// 阶段 7 冒烟：勘误提交/我的勘误/审核队列新形状/采纳带备注/重复 409/更新日志公开
// 经 Vite 代理（5173）；admin = 库中 is_admin=1 的用户（smoke 系列密码 smoke123）
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

// ---- 0. 账号 ----
const adminRow = db.prepare('SELECT username FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1').get();
const adminLogin = await call('/auth/login', {
  method: 'POST',
  body: { username: adminRow.username, password: 'smoke123' },
});
ok(adminLogin.status === 200, `管理员登录（${adminRow.username}）`);
const adminToken = adminLogin.data.token;

const uname = `s7_${Date.now().toString(36)}`;
const reg = await call('/auth/register', { method: 'POST', body: { username: uname, password: 'smoke123' } });
const token = reg.data.token;
ok(reg.status === 201, `注册 ${uname}`);

const NODE = 'math.geometry.pythagorean';

// ---- 1. 提交勘误（任意节点状态，登录即可）----
const c1 = await call(`/nodes/${NODE}/corrections`, {
  method: 'POST',
  body: { body: '【勾股定理】正文第二段「直角边」应为「直角边长」，建议修正表述。' },
  token,
});
ok(c1.status === 201 && c1.data.status === 'pending', '提交勘误 201 pending');

// 重复提交 → 409 VALIDATION
const dup = await call(`/nodes/${NODE}/corrections`, {
  method: 'POST',
  body: { body: '重复提交同节点勘误测试。' },
  token,
});
ok(dup.status === 409 && dup.data.error.code === 'VALIDATION', '重复提交 → 409 VALIDATION（勿重复提交）');

// 过短 → 400
const short = await call(`/nodes/${NODE}/corrections`, { method: 'POST', body: { body: '错' }, token });
ok(short.status === 400, '过短勘误 → 400');

// 未登录 → 401
const anon = await call(`/nodes/${NODE}/corrections`, { method: 'POST', body: { body: '未登录提交测试' } });
ok(anon.status === 401, '未登录提交 → 401');

// ---- 2. 我的勘误 ----
const mine1 = await call('/corrections/mine', { token });
const myCorr = mine1.data.corrections.find((c) => c.id === c1.data.id);
ok(myCorr && myCorr.status === 'pending' && myCorr.nodeTitle, `mine 出现该勘误（节点「${myCorr?.nodeTitle}」pending）`);

// ---- 3. admin 队列新形状 + 采纳带备注 ----
const queue = await call('/admin/review-queue', { token: adminToken });
ok(
  queue.status === 200 && Array.isArray(queue.data.creations) && Array.isArray(queue.data.corrections),
  '审核队列为新形状（creations + corrections）',
);
ok(queue.data.corrections.some((c) => c.id === c1.data.id), '勘误在 admin 队列中');

const approve = await call(`/admin/review/corrections/${c1.data.id}`, {
  method: 'POST',
  body: { action: 'approve', note: '确认无误，已列入 v2 修订' },
  token: adminToken,
});
ok(approve.status === 200 && approve.data.status === 'approved', '采纳勘误');

const mine2 = await call('/corrections/mine', { token });
const reviewed = mine2.data.corrections.find((c) => c.id === c1.data.id);
ok(
  reviewed.status === 'approved' && reviewed.reviewNote === '确认无误，已列入 v2 修订' && reviewed.reviewedAt,
  'mine 状态 approved 且 reviewNote 正确',
);

// 已处理再审核 → 404
const again = await call(`/admin/review/corrections/${c1.data.id}`, {
  method: 'POST',
  body: { action: 'approve' },
  token: adminToken,
});
ok(again.status === 404, '重复审核 → 404');

// ---- 4. 驳回路径 ----
const c2 = await call(`/nodes/math.function.linear/corrections`, {
  method: 'POST',
  body: { body: '建议补充一次函数与正比例函数的关系说明。' },
  token,
});
ok(c2.status === 201, '第二条勘误提交');
await call(`/admin/review/corrections/${c2.data.id}`, {
  method: 'POST',
  body: { action: 'reject' },
  token: adminToken,
});
const mine3 = await call('/corrections/mine', { token });
const rejected = mine3.data.corrections.find((c) => c.id === c2.data.id);
ok(rejected.status === 'rejected' && rejected.reviewNote === null, '驳回状态正确（无备注）');

// ---- 5. 更新日志（公开）----
const version = 9000 + Math.floor(Math.random() * 900);
const put = await call('/admin/changelog', {
  method: 'POST',
  body: { version, summary: '阶段 7 冒烟测试版本', detail: '新增勘误审核流与更新日志。' },
  token: adminToken,
});
ok(put.status === 200 && put.data.version === version, `admin 写入更新日志 v${version}`);
const cl = await call('/changelog?limit=50'); // 不带 token
ok(cl.status === 200 && Array.isArray(cl.data.logs), 'changelog 公开可读');
const entry = cl.data.logs.find((l) => l.version === version);
ok(entry && entry.summary === '阶段 7 冒烟测试版本' && entry.detail.includes('勘误') && entry.createdAt, '日志条目字段完整');
ok(
  cl.data.logs.every((l, i) => i === 0 || cl.data.logs[i - 1].version >= l.version),
  '日志按版本倒序',
);

console.log('\n阶段 7 冒烟全部通过 ✅');
db.close();

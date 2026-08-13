// 阶段 6 冒烟：讨论区/纪念碑/速通榜/二创审核/星图分享/管理端
// 经 Vite 代理（5173）；admin = 库中 is_admin=1 的用户（首个注册用户，smoke 系列密码均为 smoke123）
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

async function register(u) {
  const r = await call('/auth/register', { method: 'POST', body: { username: u, password: 'smoke123' } });
  if (r.status !== 201) throw new Error(`注册失败 ${u}: ${JSON.stringify(r.data)}`);
  return r.data.token;
}

// 全对闯关（pass/exam），返回 result
async function challenge(token, nodeId, mode) {
  const paper = await call(`/nodes/${nodeId}/challenge/start`, { method: 'POST', body: { mode }, token });
  if (paper.status !== 200) throw new Error(`开卷失败 ${nodeId}/${mode}: ${JSON.stringify(paper.data)}`);
  const bank = db.prepare('SELECT * FROM questions WHERE node_id = ?').all(nodeId);
  const answers = {};
  for (const q of paper.data.questions) {
    const row = bank.find((b) => b.stem === q.stem);
    answers[String(q.seq)] = q.type === 'choice' ? Number(row.answer) : row.answer;
  }
  const sub = await call(`/papers/${paper.data.paperId}/submit`, { method: 'POST', body: { answers }, token });
  return sub.data;
}

// ---- 0. admin 登录（库中首个 is_admin 用户）----
const adminRow = db.prepare('SELECT username FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1').get();
ok(adminRow, `库中存在管理员（${adminRow?.username}）`);
const adminLogin = await call('/auth/login', {
  method: 'POST',
  body: { username: adminRow.username, password: 'smoke123' },
});
ok(adminLogin.status === 200, '管理员登录');
const adminToken = adminLogin.data.token;
const meAdmin = await call('/auth/me', { token: adminToken });
ok(meAdmin.data.user.is_admin === true, '/auth/me 管理员 is_admin=true');

// ---- 1. 用户 U：通关 + 点亮 math.algebra.expression ----
const uname = `s6_${Date.now().toString(36)}`;
const token = await register(uname);
const me = await call('/auth/me', { token });
ok(me.data.user.is_admin === false && me.data.jumpQuota === 1, '普通用户 is_admin=false，额度 1');

const NODE = 'math.algebra.expression';
await call('/jump', { method: 'POST', body: { nodeId: NODE }, token });
await call('/timer/start', { method: 'POST', body: { minutes: 90 }, token });
ok((await challenge(token, NODE, 'pass')).result === 'passed', 'U 通关');
ok((await challenge(token, NODE, 'exam')).result === 'lit', 'U 点亮');

// ---- 2. 速通榜 ----
const sr = await call(`/nodes/${NODE}/speedrun`);
ok(sr.status === 200 && Array.isArray(sr.data.ranks), '速通榜返回 ranks');
const myRank = sr.data.ranks.find((r) => r.username === uname);
ok(myRank && myRank.seconds > 0 && myRank.litAt, `U 上榜：#${myRank?.rank}，${myRank?.seconds}s`);
ok(sr.data.ranks.every((r, i) => i === 0 || sr.data.ranks[i - 1].seconds <= r.seconds), '榜按用时升序');

// ---- 3. 纪念碑：新鲜点亮未满半小时 → 非拓荒者 → 403 ----
const m403 = await call(`/nodes/${NODE}/monument`, {
  method: 'POST',
  body: { message: '抢个沙发' },
  token,
});
ok(m403.status === 403 && m403.data.error.code === 'FORBIDDEN', '非拓荒者留言 → 403 FORBIDDEN');
const monument = await call(`/nodes/${NODE}/monument`);
ok(monument.status === 200 && Array.isArray(monument.data.pioneers), `纪念碑可读（pioneers=${monument.data.pioneers.length}）`);

// ---- 4. 讨论区：发帖/回复/列表字段/权限 ----
const post1 = await call(`/nodes/${NODE}/posts`, {
  method: 'POST',
  body: { title: '代数式学习心得', body: '合并同类项关键是字母与指数都相同。' },
  token,
});
ok(post1.status === 201 && post1.data.id, 'passed 用户发帖 201');

const list = await call(`/nodes/${NODE}/posts`);
ok(list.status === 200 && list.data.posts.length >= 1, '帖子列表可读');
const item = list.data.posts.find((p) => p.id === post1.data.id);
ok(
  item && 'pinned' in item && 'authorRank' in item && 'isPioneer' in item && 'replyCount' in item && item.excerpt,
  `列表字段齐全（pinned/authorRank/isPioneer/replyCount/excerpt）`,
);
ok(
  item.authorRank === myRank.rank,
  `作者速通角标与榜一致（authorRank=${item.authorRank}，榜 #${myRank.rank}）`,
);

const reply = await call(`/posts/${post1.data.id}/replies`, { method: 'POST', body: { body: '赞，补充一个例子。' }, token });
ok(reply.status === 201, '回复 201');
const detail = await call(`/posts/${post1.data.id}`);
ok(detail.data.replies.length === 1 && detail.data.replies[0].body.includes('补充'), '帖子详情含回复（正序）');

const dimUser = await register(`${uname}d`);
const forbidden = await call(`/nodes/${NODE}/posts`, {
  method: 'POST',
  body: { title: '潜水', body: '未通关尝试发言' },
  token: dimUser,
});
ok(forbidden.status === 403 && forbidden.data.error.code === 'FORBIDDEN_STATE', '未通关发帖 → 403 FORBIDDEN_STATE');

// ---- 5. 二创：上传 → 待审核不可见 → 管理员通过 → 可见；再拒绝一条 ----
const up1 = await call(`/nodes/${NODE}/creations`, {
  method: 'POST',
  body: { type: 'mindmap', title: '整式思维导图', content: '{"root":"整式"}' },
  token,
});
ok(up1.status === 201 && up1.data.status === 'pending', 'lit 用户上传二创 → pending');
let cre = await call(`/nodes/${NODE}/creations`);
ok(!cre.data.creations.some((c) => c.id === up1.data.id), '待审核二创不在公开列表');

const queue1 = await call('/admin/review-queue', { token: adminToken });
ok(queue1.status === 200 && queue1.data.creations.some((c) => c.id === up1.data.id), 'admin 审核队列可见该二创');
const queue403 = await call('/admin/review-queue', { token });
ok(queue403.status === 403, '非 admin 访问审核队列 → 403');

const approve = await call(`/admin/review/creations/${up1.data.id}`, {
  method: 'POST',
  body: { action: 'approve' },
  token: adminToken,
});
ok(approve.status === 200 && approve.data.status === 'approved', '审核通过');
cre = await call(`/nodes/${NODE}/creations`);
ok(cre.data.creations.some((c) => c.id === up1.data.id && c.type === 'mindmap'), '通过后公开可见');

const up2 = await call(`/nodes/${NODE}/creations`, {
  method: 'POST',
  body: { type: 'game', title: '合并同类项小游戏', content: 'https://example.com/game' },
  token,
});
await call(`/admin/review/creations/${up2.data.id}`, { method: 'POST', body: { action: 'reject' }, token: adminToken });
cre = await call(`/nodes/${NODE}/creations`);
ok(!cre.data.creations.some((c) => c.id === up2.data.id), '拒绝后不可见');

// 未点亮用户上传 → 403
const up403 = await call(`/nodes/${NODE}/creations`, {
  method: 'POST',
  body: { type: 'summary', title: '总结', content: '文本' },
  token: dimUser,
});
ok(up403.status === 403 && up403.data.error.code === 'FORBIDDEN_STATE', '未点亮上传 → 403');

// ---- 6. 星图分享：创建（草稿）→ 公开读取 ----
const share = await call('/share', {
  method: 'POST',
  body: { config: { theme: 'warm', collapseRelated: true } },
  token,
});
ok(share.status === 201 && share.data.url === `/share/${share.data.shareId}`, `创建分享 ${share.data.shareId}`);
const pub = await call(`/share/${share.data.shareId}`); // 不带 token，公开可读
ok(pub.status === 200 && pub.data.owner === uname, '公开读取 owner 正确');
ok(pub.data.config.theme === 'warm' && pub.data.config.collapseRelated === true, 'config 原样返回');
ok(
  pub.data.nodes.length >= 1 && pub.data.nodes.every((n) => n.state === 'passed' || n.state === 'lit'),
  `分享节点均为 passed/lit（${pub.data.nodes.length} 个）`,
);
ok(pub.data.nodes.some((n) => n.id === NODE && n.state === 'lit'), '点亮节点在分享中');
const noShare = await call('/share/not-exist-id');
ok(noShare.status === 404, '未知分享 → 404');

console.log('\n阶段 6 冒烟全部通过 ✅');
db.close();

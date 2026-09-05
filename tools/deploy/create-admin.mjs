// 初始化/加固管理员（在服务器上直接用，绕开"首个注册成管理员"的抢注风险）
// 用法：node tools/deploy/create-admin.mjs <用户名> <密码> [邮箱]
// 效果：若库中还没有该用户则注册并置 is_admin=1；若已有管理员则保持不变。
// 部署时先执行本脚本建好你的管理员，再对外放行，陌生人注册只能是普通用户。
import { openDatabase } from '../../server/src/db/connection.js';
import bcrypt from 'bcryptjs';

const [, , username, password, email] = process.argv;
if (!username || !password) {
  console.error('用法：node tools/deploy/create-admin.mjs <用户名> <密码> [邮箱]');
  process.exit(1);
}

const db = openDatabase();
const existing = db.prepare('SELECT id, is_admin FROM users WHERE username = ?').get(username);
if (existing) {
  if (existing.is_admin === 1) {
    console.log(`用户 ${username} 已是管理员，无需处理。`);
  } else {
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(existing.id);
    console.log(`已把 ${username} 提升为管理员。`);
  }
} else {
  const month = new Date().toISOString().slice(0, 7);
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare(
      "INSERT INTO users (username, password_hash, created_at, quota_month, is_admin, email) VALUES (?, ?, datetime('now'), ?, 1, ?)"
    )
    .run(username, hash, month, email || null);
  console.log(`管理员账号已建立：${username}（id=${info.lastInsertRowid}）`);
}
db.close();

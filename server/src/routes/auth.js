// 认证：注册 / 登录（JWT 7 天）
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { errors, parseBody } from '../errors.js';
import { authRequired, quotaRefresher } from '../middleware/auth.js';
import { getQuota } from '../services/quotaService.js';

const credentialSchema = z.object({
  username: z
    .string()
    .regex(/^[\w一-龥-]{3,20}$/, '用户名须为 3~20 位字母、数字、下划线、中文或短横线'),
  password: z.string().min(6, '密码至少 6 位'),
});

export function authRouter({ db, secret }) {
  const router = Router();

  router.post('/register', (req, res) => {
    const { username, password } = parseBody(credentialSchema, req.body);
    const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
    if (exists) throw errors.validation('用户名已被注册');

    const hash = bcrypt.hashSync(password, 10);
    // quota_month 置为当前月份：初始 1 点额度即本月赠额，避免次请求再触发月赠
    const month = new Date().toISOString().slice(0, 7);
    // 第一个注册的用户自动成为管理员（后续管理员需在库中手动置 is_admin=1）
    const isAdmin = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0 ? 1 : 0;
    const info = db
      .prepare(
        "INSERT INTO users (username, password_hash, created_at, quota_month, is_admin) VALUES (?, ?, datetime('now'), ?, ?)"
      )
      .run(username, hash, month, isAdmin);
    const user = { id: info.lastInsertRowid, username };
    const token = jwt.sign({ uid: user.id, username }, secret, { expiresIn: '7d' });
    res.status(201).json({ token, user });
  });

  router.post('/login', (req, res) => {
    const { username, password } = parseBody(credentialSchema, req.body);
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      throw errors.unauthorized('用户名或密码错误');
    }
    const token = jwt.sign({ uid: row.id, username: row.username }, secret, { expiresIn: '7d' });
    res.json({ token, user: { id: row.id, username: row.username } });
  });

  // 当前用户信息 + 跃迁额度（前端登录后刷新展示；is_admin 供管理端入口判断）
  router.get('/me', authRequired(secret), quotaRefresher(db), (req, res) => {
    const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.user.id);
    res.json({
      user: { id: req.user.id, username: req.user.username, is_admin: row?.is_admin === 1 },
      jumpQuota: getQuota(db, req.user.id),
    });
  });

  return router;
}

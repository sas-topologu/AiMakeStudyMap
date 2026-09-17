// 认证：注册（含邮箱，可找回密码）/ 登录 / 改密 / 邮箱验证码
// 账号标准模板：用户名 + 邮箱（唯一、可选）+ 密码（≥8 位含字母数字）。
// 找回密码：邮箱验证码（15 分钟有效）；邮件发送默认 console + 留档（单机无邮件服务也能用），
// 若要真实发信，可自行安装 nodemailer 并在 server/config/mail.json 配置后替换 sendMail 实现。
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
  password: z.string().min(8, '密码至少 8 位').regex(/[A-Za-z]/, '密码须含字母').regex(/\d/, '密码须含数字'),
});

const registerSchema = credentialSchema.extend({
  email: z.string().email('邮箱格式不正确').optional().or(z.literal('')),
});

const nowIso = () => new Date().toISOString();
const shortCode = () => String(Math.floor(100000 + Math.random() * 900000));

// 发送验证码：默认 console + 留档（码已存 email_codes 表）；接入 SMTP 后可替换为真实发信
function sendMail(to, subject, text) {
  console.log(`[mail] → ${to} | ${subject} | ${text}`);
  return Promise.resolve();
}

export function authRouter({ db, secret, adminKey }) {
  const router = Router();

  router.post('/register', (req, res) => {
    const { username, password, email } = parseBody(registerSchema, req.body);
    const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
    if (exists) throw errors.validation('用户名已被注册');
    if (email && db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      throw errors.validation('该邮箱已被绑定');
    }
    const hash = bcrypt.hashSync(password, 10);
    const month = new Date().toISOString().slice(0, 7);
    // 两级管理员：admin_level 1=终端管理员(owner) / 2=二级管理员。
    // 注册时带对「终端引导密钥」(STARMAP_ADMIN_KEY) → 直接成为终端管理员；
    // 二级管理员不在此产生（由 owner 设置授权密钥后，登录用 promote-admin 提升）。
    // 未配置引导密钥（开发/测试兼容）时回退：首个注册自动成为终端管理员。
    const adminKeyInput = String(req.body?.adminKey ?? '').trim();
    const adminLevel = adminKey
      ? adminKeyInput && adminKeyInput === adminKey
        ? 1
        : 0
      : db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0
        ? 1
        : 0;
    const info = db
      .prepare(
        'INSERT INTO users (username, password_hash, created_at, quota_month, is_admin, admin_level, email) VALUES (?, ?, datetime(\'now\'), ?, ?, ?, ?)'
      )
      .run(username, hash, month, adminLevel >= 1 ? 1 : 0, adminLevel, email || null);
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

  // 认领「终端管理员」：仅允许来自本机（loopback）的请求 —— 即"在终端本地登录就是管理员"。
  // 云端部署时，可在服务器上对本机 3000 端口发起该请求来认领（无需密钥）。
  router.post('/claim-owner', authRequired(secret), (req, res) => {
    const ip = req.ip || req.socket?.remoteAddress || '';
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (!isLocal) throw errors.forbidden('只能在本机（终端所在机器）认领终端管理员');
    db.prepare('UPDATE users SET is_admin = 1, admin_level = 1 WHERE id = ?').run(req.user.id);
    res.json({ ok: true, adminLevel: 1, message: '已认领终端管理员（完全权限）' });
  });

  // 用「授权密钥」开启二级管理员（owner 在终端设置里配置；客户端持密钥登录后调用）
  router.post('/promote-admin', authRequired(secret), (req, res) => {
    const keyInput = String(req.body?.adminKey ?? req.body?.key ?? '').trim();
    if (!keyInput) throw errors.validation('请提供授权密钥');
    const stored = db.prepare("SELECT value FROM meta WHERE key = 'access_key'").get()?.value;
    const isOwnerKey = adminKey && keyInput === adminKey;
    const isAccessKey = stored && keyInput === stored;
    if (!isOwnerKey && !isAccessKey) throw errors.forbidden('授权密钥不正确');
    const level = isOwnerKey ? 1 : 2;
    db.prepare('UPDATE users SET is_admin = 1, admin_level = ? WHERE id = ?').run(level, req.user.id);
    res.json({
      ok: true,
      adminLevel: level,
      message: level === 1 ? '已开启终端管理员权限' : '已开启二级管理员权限',
    });
  });

  router.get('/me', authRequired(secret), quotaRefresher(db), (req, res) => {
    const row = db.prepare('SELECT is_admin, admin_level, email FROM users WHERE id = ?').get(req.user.id);
    const adminLevel = row?.admin_level ?? 0;
    res.json({
      user: {
        id: req.user.id,
        username: req.user.username,
        is_admin: adminLevel >= 1,
        adminLevel,
        isOwner: adminLevel === 1,
        email: row?.email || null,
      },
      jumpQuota: getQuota(db, req.user.id),
    });
  });

  // 请求找回密码：向绑定邮箱发验证码（15 分钟有效）
  router.post('/forgot', (req, res) => {
    const email = String(req.body?.email ?? '').toLowerCase().trim();
    if (!email) throw errors.validation('请提供邮箱');
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!row) throw errors.notFound('该邮箱未绑定任何账号');
    const code = shortCode();
    db.prepare(
      'INSERT INTO email_codes (email, code, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(email, code, 'reset', new Date(Date.now() + 15 * 60 * 1000).toISOString(), nowIso());
    sendMail(email, '智点星谱 · 找回密码', `验证码：${code}（15 分钟内有效）`);
    res.json({ ok: true, message: '验证码已发送（若未配置邮件服务，验证码见服务端控制台）' });
  });

  // 用验证码重置密码
  router.post('/reset-password', (req, res) => {
    const { email, code, password } = parseBody(
      z.object({
        email: z.string().email(),
        code: z.string().min(6).max(8),
        password: z.string().min(8, '密码至少 8 位').regex(/[A-Za-z]/).regex(/\d/),
      }),
      req.body
    );
    const stored = db
      .prepare(
        "SELECT * FROM email_codes WHERE email = ? AND purpose='reset' AND used = 0 AND expires_at > ? ORDER BY id DESC LIMIT 1"
      )
      .get(email.toLowerCase().trim(), nowIso());
    if (!stored || stored.code !== code) throw errors.validation('验证码错误或已过期');
    db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(bcrypt.hashSync(password, 10), email.toLowerCase().trim());
    db.prepare('UPDATE email_codes SET used = 1 WHERE id = ?').run(stored.id);
    res.json({ ok: true, message: '密码已重置，请用新密码登录' });
  });

  // 修改密码（登录后）
  router.post('/change-password', authRequired(secret), (req, res) => {
    const { oldPassword, newPassword } = parseBody(
      z.object({
        oldPassword: z.string().min(1),
        newPassword: z.string().min(8).regex(/[A-Za-z]/).regex(/\d/),
      }),
      req.body
    );
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(oldPassword, row.password_hash)) throw errors.unauthorized('原密码错误');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), req.user.id);
    res.json({ ok: true, message: '密码已更新' });
  });

  return router;
}

// 数据源信息与配置：供个人端识别库、owner 管理「授权密钥」。
// - GET  /api/terminal/info    公开：库名称/内容版本/是否已设授权密钥（个人端连上后可读）
// - POST /api/terminal/access-key 仅库管理员(owner)：设置/轮换授权密钥（二级管理员凭它提升）
import { Router } from 'express';
import crypto from 'node:crypto';
import { errors } from '../errors.js';
import { authRequired } from '../middleware/auth.js';
import { getContentVersion } from '../db/contentRepo.js';
import { getPolicy, setPolicy } from '../services/policyService.js';

const TERMINAL_NAME = '智点星谱库';

// 数据源身份指纹：首次运行生成并持久化（meta.terminal_id）。
// 个人端可记住该指纹 —— 若域名被他人夺走、换成另一台服务器，指纹必然不同，个人端即可识别"这不是原来的库"。
export function terminalId(db) {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'terminal_id'").get();
  if (row?.value) return row.value;
  const id = crypto.randomBytes(16).toString('hex');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('terminal_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(id);
  return id;
}
export function fingerprint(db) {
  return crypto.createHash('sha256').update(terminalId(db)).digest('hex').slice(0, 32);
}

export function terminalRouter({ db, secret }) {
  const router = Router();
  const levelOf = (userId) =>
    db.prepare('SELECT admin_level FROM users WHERE id = ?').get(userId)?.admin_level ?? 0;
  const getKey = () => db.prepare("SELECT value FROM meta WHERE key = 'access_key'").get()?.value || '';
  const setKey = (v) =>
    db
      .prepare(
        "INSERT INTO meta (key, value) VALUES ('access_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run(v);

  // 数据源身份信息（公开；不含密钥本身）
  router.get('/terminal/info', (req, res) => {
    res.json({
      name: TERMINAL_NAME,
      contentVersion: getContentVersion(db),
      hasAccessKey: Boolean(getKey()),
      fingerprint: fingerprint(db),
    });
  });

  // 设置/轮换授权密钥（仅 owner）
  router.post('/terminal/access-key', authRequired(secret), (req, res) => {
    if (levelOf(req.user.id) !== 1) {
      throw errors.forbidden('仅库管理员可设置授权密钥');
    }
    const action = String(req.body?.action ?? 'set');
    if (action === 'clear') {
      setKey('');
      return res.json({ ok: true, hasAccessKey: false });
    }
    let key = String(req.body?.key ?? '').trim();
    if (!key) key = crypto.randomBytes(16).toString('hex'); // 未提供则自动生成
    if (key.length < 8) throw errors.validation('授权密钥至少 8 位');
    setKey(key);
    res.json({ ok: true, hasAccessKey: true, key });
  });

  // 查看当前授权密钥（仅 owner，用于把密钥交给二级管理员）
  router.get('/terminal/access-key', authRequired(secret), (req, res) => {
    if (levelOf(req.user.id) !== 1) {
      throw errors.forbidden('仅库管理员可查看授权密钥');
    }
    res.json({ key: getKey() });
  });

  // 学习策略：公开读 —— 个人端据此显示或隐藏「计时 / 跃迁额度」入口
  router.get('/terminal/policy', (req, res) => {
    res.json({ policy: getPolicy(db) });
  });

  // 修改学习策略（仅 owner）：这些是「约束」，可以调、也可以整个关掉
  router.post('/terminal/policy', authRequired(secret), (req, res) => {
    if (levelOf(req.user.id) !== 1) {
      throw errors.forbidden('仅库管理员可修改学习策略');
    }
    const body = req.body ?? {};
    const patch = {};
    if (typeof body.timerEnabled === 'boolean') patch.timerEnabled = body.timerEnabled;
    if (typeof body.jumpQuotaEnabled === 'boolean') patch.jumpQuotaEnabled = body.jumpQuotaEnabled;
    if (body.dailyLimitMinutes !== undefined) patch.dailyLimitMinutes = body.dailyLimitMinutes;
    res.json({ policy: setPolicy(db, patch) });
  });

  return router;
}

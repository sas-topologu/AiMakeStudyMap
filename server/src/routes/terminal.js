// 终端信息与配置：供客户端识别终端、owner 管理「授权密钥」。
// - GET  /api/terminal/info    公开：终端名称/内容版本/是否已设授权密钥（客户端连上后可读）
// - POST /api/terminal/access-key 仅终端管理员(owner)：设置/轮换授权密钥（二级管理员凭它提升）
import { Router } from 'express';
import crypto from 'node:crypto';
import { errors } from '../errors.js';
import { authRequired } from '../middleware/auth.js';
import { getContentVersion } from '../db/contentRepo.js';

const TERMINAL_NAME = '智点星谱终端';

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

  // 终端身份信息（公开；不含密钥本身）
  router.get('/terminal/info', (req, res) => {
    res.json({
      name: TERMINAL_NAME,
      contentVersion: getContentVersion(db),
      hasAccessKey: Boolean(getKey()),
    });
  });

  // 设置/轮换授权密钥（仅 owner）
  router.post('/terminal/access-key', authRequired(secret), (req, res) => {
    if (levelOf(req.user.id) !== 1) {
      throw errors.forbidden('仅终端管理员可设置授权密钥');
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
      throw errors.forbidden('仅终端管理员可查看授权密钥');
    }
    res.json({ key: getKey() });
  });

  return router;
}

// 上传通道：评论/二创等需要图片或附件时使用。
// 设计：仍走 JSON（保持"信息通道统一"），文件以 base64 放在 JSON 字段里；
// 格式由「可配置白名单」控制，大小有上限，落盘到 content/assets/uploads/。
// - POST /api/upload           上传（需登录）：{ name, data(base64) } → { url }
// - GET  /api/terminal/formats 查看允许的格式（公开）
// - POST /api/terminal/formats 修改允许的格式（仅终端管理员）
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Router } from 'express';
import { errors } from '../errors.js';
import { authRequired } from '../middleware/auth.js';
import { getAllowedFormats, setAllowedFormats, isAllowed } from '../services/formatService.js';

const MAX_BYTES = 5 * 1024 * 1024; // 单文件 5MB 上限（base64 前）

export function uploadRouter({ db, secret, assetsDir }) {
  const router = Router();
  const levelOf = (userId) =>
    db.prepare('SELECT admin_level FROM users WHERE id = ?').get(userId)?.admin_level ?? 0;

  router.get('/terminal/formats', (req, res) => {
    res.json({ formats: getAllowedFormats(db) });
  });

  router.post('/terminal/formats', authRequired(secret), (req, res) => {
    if (levelOf(req.user.id) !== 1) throw errors.forbidden('仅终端管理员可修改允许的文件格式');
    const list = setAllowedFormats(db, req.body?.formats);
    res.json({ ok: true, formats: list });
  });

  router.post('/upload', authRequired(secret), (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    let data = String(req.body?.data ?? '');
    if (!data) throw errors.validation('缺少文件内容');
    // 允许带 data URL 前缀
    const m = data.match(/^data:[^;]*;base64,(.*)$/s);
    if (m) data = m[1];

    const ext = path.extname(name).toLowerCase().replace(/^\./, '');
    if (!ext) throw errors.validation('文件缺少扩展名');
    if (!isAllowed(db, ext)) {
      throw errors.validation(`不允许的文件格式 .${ext}（可在终端设置中放开）`);
    }
    let buf;
    try {
      buf = Buffer.from(data, 'base64');
    } catch {
      throw errors.validation('文件内容不是合法的 base64');
    }
    if (!buf.length) throw errors.validation('文件内容为空');
    if (buf.length > MAX_BYTES) throw errors.validation('文件过大（上限 5MB）');

    const dir = path.join(assetsDir, 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    const fileName = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(dir, fileName), buf);
    res.status(201).json({ ok: true, url: `/api/assets/uploads/${fileName}`, ext, size: buf.length });
  });

  return router;
}

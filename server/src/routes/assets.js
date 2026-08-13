// 媒体资产服务：GET /api/assets/* → content/assets/ 下的文件
// 防目录穿越（resolve 后必须仍在 assets 目录内）；扩展名白名单；长缓存
import path from 'node:path';
import fs from 'node:fs';
import { Router } from 'express';
import { errors } from '../errors.js';

const CONTENT_TYPES = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export function assetsRouter({ assetsDir }) {
  const router = Router();

  router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let rel;
    try {
      rel = decodeURIComponent(req.path).replace(/^\/+/, '');
    } catch {
      return next(errors.validation('非法的资产路径'));
    }
    const filePath = path.resolve(assetsDir, rel);
    // 穿越防护：必须仍在 assets 目录内
    if (filePath !== assetsDir && !filePath.startsWith(assetsDir + path.sep)) {
      return next(errors.notFound('资产不存在'));
    }
    const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()];
    if (!type || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return next(errors.notFound('资产不存在'));
    }
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(filePath);
  });

  return router;
}

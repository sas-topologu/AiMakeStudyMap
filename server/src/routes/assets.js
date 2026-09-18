// 媒体资产服务：GET /api/assets/* → content/assets/ 下的文件
// 防目录穿越（resolve 后必须仍在 assets 目录内）；扩展名按「可配置白名单」判定；长缓存
import path from 'node:path';
import fs from 'node:fs';
import { Router } from 'express';
import { errors } from '../errors.js';
import { isAllowed, contentTypeOf } from '../services/formatService.js';

export function assetsRouter({ db, assetsDir }) {
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
    const ext = path.extname(filePath).toLowerCase();
    // 格式白名单（可配置）：放开了才可被访问
    if (!isAllowed(db, ext.replace(/^\./, ''))) return next(errors.notFound('资产不存在'));
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return next(errors.notFound('资产不存在'));
    }
    res.setHeader('Content-Type', contentTypeOf(ext));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // SVG 可能内嵌脚本：直接访问时用 CSP 禁掉脚本，避免被当作网页执行
    if (ext === '.svg') {
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
      res.setHeader('Content-Disposition', 'inline');
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(filePath);
  });

  return router;
}

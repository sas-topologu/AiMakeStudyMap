// JWT 认证中间件
// 注意：默认 'dev-secret' 仅供开发；生产环境必须通过环境变量 STARMAP_SECRET 覆盖
import jwt from 'jsonwebtoken';
import { errors } from '../errors.js';
import { refreshQuota } from '../services/quotaService.js';

function parseToken(req, secret) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  try {
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
}

// 必须登录：解析失败 → 401
export function authRequired(secret) {
  return (req, res, next) => {
    const payload = parseToken(req, secret);
    if (!payload) return next(errors.unauthorized());
    req.user = { id: payload.uid, username: payload.username };
    next();
  };
}

// 可选登录：能解析则挂 req.user，用于 search/graph 标注状态
export function authOptional(secret) {
  return (req, res, next) => {
    const payload = parseToken(req, secret);
    if (payload) req.user = { id: payload.uid, username: payload.username };
    next();
  };
}

// 轻量中间件：登录用户每次请求执行一次额度月赠检查
export function quotaRefresher(db) {
  return (req, res, next) => {
    if (req.user) {
      const user = db
        .prepare('SELECT id, jump_quota, quota_month FROM users WHERE id = ?')
        .get(req.user.id);
      if (user) refreshQuota(db, user);
    }
    next();
  };
}

// 管理员校验：未登录 401，非管理员 403
export function adminRequired(secret, db) {
  return (req, res, next) => {
    const payload = parseToken(req, secret);
    if (!payload) return next(errors.unauthorized());
    const user = db
      .prepare('SELECT id, username, is_admin FROM users WHERE id = ?')
      .get(payload.uid);
    if (!user) return next(errors.unauthorized());
    if (!user.is_admin) return next(errors.forbidden('需要管理员权限'));
    req.user = { id: user.id, username: user.username };
    next();
  };
}

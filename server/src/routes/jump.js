// 跃迁：模糊搜索 + 额度扣减
import { Router } from 'express';
import { z } from 'zod';
import { errors, parseBody } from '../errors.js';
import { authRequired, authOptional, quotaRefresher } from '../middleware/auth.js';
import { effectiveState, setState } from '../services/stateService.js';
import { getQuota, consumeQuota } from '../services/quotaService.js';

const jumpSchema = z.object({ nodeId: z.string().min(1) });

export function jumpRouter({ db, secret }) {
  const router = Router();

  // 模糊匹配 title/summary/id（大小写不敏感），返回 ≤20 条并标注该用户有效状态
  router.get('/search', authOptional(secret), (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.json({ results: [] });
    const like = `%${q.toLowerCase()}%`;
    const rows = db
      .prepare(
        `SELECT id, title, subject, difficulty FROM nodes
         WHERE lower(title) LIKE ? OR lower(summary) LIKE ? OR lower(id) LIKE ?
         ORDER BY id LIMIT 20`
      )
      .all(like, like, like);
    // 搜索日志：供空洞节点统计（高频无结果词 = 内容缺口信号）
    db.prepare('INSERT INTO search_logs (query, matched, created_at) VALUES (?, ?, ?)').run(
      q,
      rows.length,
      new Date().toISOString()
    );
    const userId = req.user?.id ?? null;
    res.json({
      results: rows.map((n) => ({ ...n, state: effectiveState(db, userId, n.id) })),
    });
  });

  // 跃迁：dim → 扣 1 额度转 open；已开放/通关/点亮免费放行
  router.post('/jump', authRequired(secret), quotaRefresher(db), (req, res) => {
    const { nodeId } = parseBody(jumpSchema, req.body);
    const exists = db.prepare('SELECT 1 FROM nodes WHERE id = ?').get(nodeId);
    if (!exists) throw errors.notFound('节点不存在');

    const userId = req.user.id;
    const state = effectiveState(db, userId, nodeId);
    if (state !== 'dim') {
      return res.json({ state, quota: getQuota(db, userId) });
    }
    if (getQuota(db, userId) <= 0) {
      throw errors.noQuota(`跃迁额度不足（当前 0，每月赠 1、上限 2）`);
    }
    db.transaction(() => {
      consumeQuota(db, userId);
      setState(db, userId, nodeId, 'open');
    })();
    res.json({ state: 'open', quota: getQuota(db, userId) });
  });

  return router;
}

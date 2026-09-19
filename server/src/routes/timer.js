// 倒计时：开启（不可取消）与查询
import { Router } from 'express';
import { z } from 'zod';
import { parseBody } from '../errors.js';
import { authRequired, quotaRefresher } from '../middleware/auth.js';

const startSchema = z.object({
  minutes: z.number().int().min(1, '至少 1 分钟').max(1440, '单次最多 1440 分钟'),
});

export function timerRouter({ db, secret, timerService }) {
  const router = Router();
  router.use(authRequired(secret), quotaRefresher(db));

  // 开启倒计时：策略开启时开启即累计当日额度，超额 → 409 DAILY_LIMIT；策略关闭时不设上限
  router.post('/start', (req, res) => {
    const { minutes } = parseBody(startSchema, req.body);
    res.json(timerService.start(req.user.id, minutes));
  });

  // 当前计时与当日额度
  router.get('/', (req, res) => {
    res.json({ timer: timerService.current(req.user.id), daily: timerService.dailyStatus(req.user.id) });
  });

  return router;
}

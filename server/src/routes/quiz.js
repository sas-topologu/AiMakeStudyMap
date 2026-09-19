// 闯关与考核：开卷 / 提交判分
import { Router } from 'express';
import { z } from 'zod';
import { parseBody } from '../errors.js';
import { authRequired, quotaRefresher } from '../middleware/auth.js';

const startSchema = z.object({ mode: z.enum(['pass', 'exam', 'practice']) });
const submitSchema = z.object({
  answers: z.record(z.string(), z.union([z.number(), z.string()])).default({}),
});

export function quizRouter({ db, secret, quizService }) {
  const router = Router();
  const guard = [authRequired(secret), quotaRefresher(db)];

  // 开卷：要求节点 open 及以上 + 进行中的倒计时
  router.post('/nodes/:id/challenge/start', ...guard, (req, res) => {
    const { mode } = parseBody(startSchema, req.body);
    res.json(quizService.startChallenge(req.user.id, req.params.id, mode));
  });

  // 提交：服务内核判分，全对落状态
  router.post('/papers/:paperId/submit', ...guard, (req, res) => {
    const { answers } = parseBody(submitSchema, req.body);
    res.json(quizService.submit(req.user.id, req.params.paperId, answers));
  });

  return router;
}

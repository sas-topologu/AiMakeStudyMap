// 成果上报：个人端**离线**完成的成果，联网后上传到这里（docs/概念模型.md §4）。
// 规则：
// - 一律接收，不做准入判断（节点不存在就跳过，不报错、不回退、不指责）
// - 上传来的成果**不盖认证章**（certified=0）—— 库当时不在场
// - 只升不降：不会把已有的更高状态改低
// - **点亮不接受上传**：点亮必须联网由库当场见证，这样才能进稀缺荣誉
import { Router } from 'express';
import { z } from 'zod';
import { parseBody } from '../errors.js';
import { authRequired, quotaRefresher } from '../middleware/auth.js';
import { STATE_LEVEL, effectiveState, setState } from '../services/stateService.js';

const itemSchema = z.object({
  nodeId: z.string().min(1),
  state: z.enum(['open', 'passed']),
  passSeconds: z.number().int().min(0).max(86400).nullish(),
  at: z.string().optional(),
});
const uploadSchema = z.object({ items: z.array(itemSchema).max(500).default([]) });

export function achievementsRouter({ db, secret }) {
  const router = Router();
  const nodeExists = db.prepare('SELECT 1 FROM nodes WHERE id = ?');

  // 上报离线成果；返回权威状态供个人端覆盖本地显示
  router.post('/achievements', authRequired(secret), quotaRefresher(db), (req, res) => {
    const { items } = parseBody(uploadSchema, req.body ?? {});
    const userId = req.user.id;
    let accepted = 0;
    let skipped = 0;
    const states = {};

    for (const item of items) {
      if (!nodeExists.get(item.nodeId)) {
        skipped += 1;
        continue;
      }
      const current = effectiveState(db, userId, item.nodeId);
      if (STATE_LEVEL[item.state] <= STATE_LEVEL[current]) {
        skipped += 1; // 已有同级或更高状态：不动（只升不降）
        states[item.nodeId] = current;
        continue;
      }
      setState(db, userId, item.nodeId, item.state, {
        passSeconds: item.passSeconds ?? null,
        certified: false, // 上传来的成果没有库见证
      });
      accepted += 1;
      states[item.nodeId] = effectiveState(db, userId, item.nodeId);
    }

    res.json({ accepted, skipped, states });
  });

  return router;
}

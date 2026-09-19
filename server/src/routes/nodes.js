// 节点详情：完整知识卡（不含题库）+ 该用户有效状态 + 邻接关系
import { Router } from 'express';
import { errors } from '../errors.js';
import { getNode, edgesOf } from '../db/contentRepo.js';
import { effectiveState } from '../services/stateService.js';
import { authOptional } from '../middleware/auth.js';

export function nodesRouter({ db, secret }) {
  const router = Router();

  router.get('/nodes/:id', authOptional(secret), (req, res) => {
    const node = getNode(db, req.params.id);
    if (!node) throw errors.notFound('节点不存在');
    // 题库不随节点详情下发（试卷由闯关接口单独生成，判分在服务内核）
    const { questionBank, ...card } = node.content;
    res.json({
      card,
      state: effectiveState(db, req.user?.id ?? null, node.id),
      edges: edgesOf(db, node.id), // { prerequisites, successors, related }
    });
  });

  return router;
}

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  addWrongQuestion,
  dueQueue,
  reviewAnswer,
  reviewStats,
  clearReview,
  loadReview,
  REVIEW_INTERVALS_MS,
  GRADUATE_LEVEL,
} from '../reviewStore.js';

// vitest node 环境无 localStorage → 内存 mock
const memStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: (k) => memStore.delete(k),
  clear: () => memStore.clear(),
};

const Q = (seq) => ({
  nodeId: 'math.1',
  nodeTitle: '有理数',
  seq,
  type: 'choice',
  stem: `第 ${seq} 题`,
  options: ['对', '错'],
  answer: 0,
  explanation: '解析',
  difficulty: 2,
});

describe('错题复习：间隔重复调度', () => {
  beforeEach(() => localStorage.clear());

  it('新错题立即到期，可用 dueQueue 取到', () => {
    addWrongQuestion(Q(1));
    expect(reviewStats().total).toBe(1);
    expect(reviewStats().due).toBe(1);
    expect(dueQueue().map((q) => q.seq)).toEqual([1]);
  });

  it('答对升阶：间隔按 10 分钟 → 1 天 → 3 天 递增，未到期就不再出现', () => {
    addWrongQuestion(Q(1));
    const t0 = Date.now();

    const r1 = reviewAnswer('math.1', 1, true, t0);
    expect(r1.level).toBe(1);
    expect(r1.dueAt).toBe(t0 + REVIEW_INTERVALS_MS[0]);
    expect(dueQueue(20, t0)).toHaveLength(0); // 刚答对 → 还没到期
    expect(dueQueue(20, t0 + REVIEW_INTERVALS_MS[0] + 1)).toHaveLength(1);

    const t1 = t0 + REVIEW_INTERVALS_MS[0] + 1;
    expect(reviewAnswer('math.1', 1, true, t1).level).toBe(2);
    const t2 = t1 + REVIEW_INTERVALS_MS[1] + 1;
    expect(reviewAnswer('math.1', 1, true, t2).level).toBe(3);
    expect(reviewStats(t2).nextDueAt).toBe(t2 + REVIEW_INTERVALS_MS[2]);
  });

  it('答错回到起点：等级清零、立即再次到期、错误次数累计', () => {
    addWrongQuestion(Q(1));
    reviewAnswer('math.1', 1, true, Date.now());
    reviewAnswer('math.1', 1, true, Date.now() + REVIEW_INTERVALS_MS[0] + 1);

    const r = reviewAnswer('math.1', 1, false, Date.now() + 999999);
    expect(r.level).toBe(0);
    expect(r.intervalLabel).toBe('10 分钟');
    const item = loadReview()[0];
    expect(item.wrongCount).toBe(2); // 入列时 1 次 + 这次答错
    expect(item.dueAt).toBe(r.dueAt);
  });

  it('连续答对到顶即毕业（移出队列）', () => {
    addWrongQuestion(Q(1));
    let t = Date.now();
    for (let i = 0; i < GRADUATE_LEVEL - 1; i += 1) {
      const r = reviewAnswer('math.1', 1, true, t);
      expect(r.graduated).toBe(false);
      t = r.dueAt + 1;
    }
    const last = reviewAnswer('math.1', 1, true, t);
    expect(last.graduated).toBe(true);
    expect(last.intervalLabel).toBe('已掌握');
    expect(reviewStats().total).toBe(0);
    expect(dueQueue()).toHaveLength(0);
  });

  it('到期队列按等得最久的先来；界面上限生效', () => {
    addWrongQuestion(Q(1));
    addWrongQuestion(Q(2));
    addWrongQuestion(Q(3));
    // 让第 2 题先到期（把它的 dueAt 调到更早）
    const list = loadReview().map((q) => (q.seq === 2 ? { ...q, dueAt: 1 } : q));
    localStorage.setItem('starmap:review', JSON.stringify(list));
    expect(dueQueue().map((q) => q.seq)).toEqual([2, 1, 3]);
    expect(dueQueue(2).map((q) => q.seq)).toEqual([2, 1]);
  });

  it('旧数据（没有调度字段）也能正常读取与复习', () => {
    localStorage.setItem(
      'starmap:review',
      JSON.stringify([{ ...Q(9), wrongCount: 1, lastWrongAt: 1000, collectedAt: 1000 }])
    );
    expect(dueQueue().map((q) => q.seq)).toEqual([9]); // 按 lastWrongAt 视为到期
    const r = reviewAnswer('math.1', 9, true);
    expect(r.level).toBe(1);
  });

  it('clearReview 清空', () => {
    addWrongQuestion(Q(1));
    clearReview();
    expect(reviewCountSafe()).toBe(0);
  });
});

function reviewCountSafe() {
  return loadReview().length;
}

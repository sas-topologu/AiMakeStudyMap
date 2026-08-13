// 错题复盘存储测试：入列/去重累计/答对移除/随机队列/上限
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadReview,
  addWrongQuestion,
  removeReviewQuestion,
  reviewQueue,
  reviewCount,
  clearReview,
} from '../reviewStore.js';

// vitest node 环境无 localStorage → 提供内存 mock
const memStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: (k) => memStore.delete(k),
};

const Q = {
  nodeId: 'math.1',
  nodeTitle: '有理数',
  seq: 2,
  type: 'choice',
  stem: '1+1=?',
  options: ['1', '2', '3'],
  answer: 1,
  explanation: '1+1=2',
  difficulty: 1,
};

describe('reviewStore 错题复盘', () => {
  beforeEach(() => clearReview());

  it('答错入列；再次答错累计 wrongCount 且不重复', () => {
    addWrongQuestion(Q);
    addWrongQuestion(Q);
    const list = loadReview();
    expect(list.length).toBe(1);
    expect(list[0].wrongCount).toBe(2);
    expect(list[0].nodeTitle).toBe('有理数');
    expect(reviewCount()).toBe(1);
  });

  it('不同题各自入列', () => {
    addWrongQuestion(Q);
    addWrongQuestion({ ...Q, seq: 3, stem: '2+2=?', answer: 2 });
    expect(loadReview().length).toBe(2);
  });

  it('重练答对 → 从队列移除', () => {
    addWrongQuestion(Q);
    removeReviewQuestion('math.1', 2);
    expect(reviewCount()).toBe(0);
  });

  it('reviewQueue 返回随机顺序且不超过 limit', () => {
    for (let i = 1; i <= 20; i += 1) addWrongQuestion({ ...Q, seq: i, stem: `q${i}` });
    const q = reviewQueue(10);
    expect(q.length).toBe(10);
    // 随机性：多次抽取顺序不完全一致（极小概率全同）
    const order = JSON.stringify(q.map((x) => x.seq));
    let allSame = true;
    for (let k = 0; k < 5 && allSame; k += 1) {
      if (JSON.stringify(reviewQueue(10).map((x) => x.seq)) !== order) allSame = false;
    }
    expect(allSame).toBe(false);
  });

  it('超过上限时保留最近 200 条', () => {
    for (let i = 1; i <= 220; i += 1) addWrongQuestion({ ...Q, seq: i, stem: `q${i}` });
    expect(loadReview().length).toBe(200);
  });
});

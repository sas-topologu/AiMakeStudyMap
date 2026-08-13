// 分层抽题测试：题型均匀覆盖 / 不重复 / 数量约束 / 题型不足补足
import { describe, it, expect } from 'vitest';
import { pickQuestions } from '../src/services/quizService.js';

const makeBank = () => [
  ...Array.from({ length: 8 }, (_, i) => ({ type: 'choice', stem: `c${i}`, answer: 0 })),
  ...Array.from({ length: 8 }, (_, i) => ({ type: 'fill', stem: `f${i}`, answer: 'x' })),
];

describe('pickQuestions 分层抽题', () => {
  it('抽取数量正确且不重复', () => {
    const picked = pickQuestions(makeBank(), 6);
    expect(picked.length).toBe(6);
    expect(new Set(picked.map((q) => q.stem)).size).toBe(6);
  });

  it('题型均匀覆盖：多题型时每类至少 1 道（多次抽取验证）', () => {
    for (let k = 0; k < 20; k += 1) {
      const picked = pickQuestions(makeBank(), 6);
      const types = new Set(picked.map((q) => q.type));
      expect(types.has('choice')).toBe(true);
      expect(types.has('fill')).toBe(true);
    }
  });

  it('题型不足时随机补足且不重复', () => {
    const single = makeBank().filter((q) => q.type === 'choice');
    const picked = pickQuestions(single, 5);
    expect(picked.length).toBe(5);
    expect(picked.every((q) => q.type === 'choice')).toBe(true);
    expect(new Set(picked.map((q) => q.stem)).size).toBe(5);
  });

  it('题库少于需求时返回全部', () => {
    const picked = pickQuestions(makeBank().slice(0, 4), 10);
    expect(picked.length).toBe(4);
  });

  it('空题库返回空数组', () => {
    expect(pickQuestions([], 3)).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { localPaper, gradeLocal, questionCount, pickQuestions } from '../localQuiz.js';

// 离线出卷与判分：规则与库侧一致，成果先记本地（未认证）
function makeCard(over = {}) {
  return {
    id: 't.a',
    difficulty: 4,
    questionBank: [1, 2, 3, 4]
      .map((n) => ({
        id: `q${n}`,
        type: 'choice',
        stem: `选择题 ${n}`,
        options: ['对', '错'],
        answer: 0,
        explanation: `解析${n}`,
        difficulty: 1,
      }))
      .concat([
        { id: 'q5', type: 'fill', stem: '填空 5', answer: '42', explanation: '解析5', difficulty: 1 },
        { id: 'q6', type: 'fill', stem: '填空 6', answer: '42', explanation: '解析6', difficulty: 2 },
      ]),
    ...over,
  };
}

const correctFor = (paper) =>
  Object.fromEntries(paper.questions.map((q, i) => [String(i + 1), paper.answers[i]]));

describe('离线出卷（题量与抽题）', () => {
  it('题量：练习 5、闯关 3、考核按难度 clamp 后取题库上限', () => {
    const card = makeCard();
    expect(questionCount(card, 'practice')).toBe(5);
    expect(questionCount(card, 'pass')).toBe(3);
    expect(questionCount(card, 'exam')).toBe(6); // clamp(22-4*4,4,20)=6，题库恰好 6
    expect(questionCount({ difficulty: 1, questionBank: card.questionBank }, 'exam')).toBe(6); // 上限为题库容量
  });

  it('题库为空时不出卷', () => {
    expect(localPaper({ id: 'x', questionBank: [] }, 'pass')).toBeNull();
    expect(localPaper({ id: 'x' }, 'pass')).toBeNull();
  });

  it('抽题不重复，且题型不会单一', () => {
    const bank = makeCard().questionBank;
    const picked = pickQuestions(bank, 4);
    expect(picked).toHaveLength(4);
    expect(new Set(picked.map((q) => q.id)).size).toBe(4);
    expect(new Set(picked.map((q) => q.type)).size).toBe(2);
  });

  it('试卷本地标记为 local，答案不下发到题面', () => {
    const paper = localPaper(makeCard(), 'pass');
    expect(paper.local).toBe(true);
    expect(paper.paperId.startsWith('local-')).toBe(true);
    expect(paper.questions).toHaveLength(3);
    for (const q of paper.questions) expect(q.answer).toBeUndefined();
  });
});

describe('离线判分', () => {
  it('全对 → 通关；错一题 → 未通过', () => {
    const paper = localPaper(makeCard(), 'pass');
    const allRight = gradeLocal(paper, correctFor(paper));
    expect(allRight.correct).toBe(allRight.total);
    expect(allRight.result).toBe('passed');
    expect(allRight.local).toBe(true);
    expect(allRight.perQuestion.every((p) => p.correct)).toBe(true);

    const wrong = { ...correctFor(paper) };
    const first = paper.questions[0];
    wrong['1'] = first.type === 'choice' ? 1 : '错';
    const failed = gradeLocal(paper, wrong);
    expect(failed.result).toBe('failed');
    expect(failed.perQuestion[0].correct).toBe(false);
    expect(failed.perQuestion[0].answer).toBe(paper.answers[0]); // 答案与解析回传给出结果页
  });

  it('填空去首尾空白后比较', () => {
    const card = makeCard({ questionBank: [{ id: 'f1', type: 'fill', stem: 's', answer: '42', explanation: 'e', difficulty: 1 }] });
    const paper = localPaper(card, 'practice');
    expect(paper.questions[0].type).toBe('fill');
    expect(gradeLocal(paper, { 1: '  42  ' }).result).toBe('practice');
    expect(gradeLocal(paper, { 1: ' 42 ' }).correct).toBe(1);
  });

  it('练习模式不算通关（不改状态）', () => {
    const paper = localPaper(makeCard(), 'practice');
    const r = gradeLocal(paper, correctFor(paper));
    expect(r.result).toBe('practice');
  });
});

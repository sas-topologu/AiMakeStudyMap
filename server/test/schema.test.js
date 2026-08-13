import { describe, it, expect } from 'vitest';
import { knowledgeCardSchema } from '../../content/schema/knowledge-card.schema.js';

// 最小合法旧格式卡（无 stage-1a 新字段）
function oldCard() {
  return {
    id: 't.a',
    title: '旧卡',
    subject: '数学',
    category: '自然科学',
    credibility: 'verified',
    difficulty: 1,
    summary: '摘要',
    sections: [{ heading: '概念', body: '正文[[甲]]。' }],
    terms: { 甲: '定义甲' },
    relations: { prerequisites: [], related: [] },
    questionBank: [1, 2, 3, 4, 5, 6].map((n) => ({
      id: `q${n}`,
      type: 'fill',
      stem: `题 ${n}`,
      answer: '42',
      explanation: '解析',
      difficulty: 1,
    })),
    version: 1,
  };
}

describe('知识卡 schema 扩展（向后兼容）', () => {
  it('旧格式卡（无新字段）通过，且新字段取默认值', () => {
    const r = knowledgeCardSchema.safeParse(oldCard());
    expect(r.success).toBe(true);
    expect(r.data.objectives).toEqual([]);
    expect(r.data.media).toEqual([]);
    expect(r.data.examples).toEqual([]);
    expect(r.data.pitfalls).toEqual([]);
    expect(r.data.emblems).toEqual([]);
    expect(r.data.sections[0].tier).toBe('core'); // tier 默认 core
  });

  it('新字段全量卡通过', () => {
    const card = {
      ...oldCard(),
      objectives: ['目标一'],
      sections: [
        { heading: '概念', body: '正文。', tier: 'core' },
        { heading: '推导', body: '推导。', tier: 'detail' },
        { heading: '拓展', body: '拓展。', tier: 'extended' },
      ],
      media: [
        { id: 'm1', type: 'image', src: 'quadratic/parabola-roots.svg', caption: '图', core: true },
        { id: 'm2', type: 'animation', src: 'https://example.com/a.gif' },
      ],
      examples: [
        { id: 'ex1', title: '例 1', problem: '题面', steps: ['第一步', '第二步'], answer: '答案' },
      ],
      pitfalls: ['易错点一'],
      emblems: [
        { type: 'formula', content: 'x=1', caption: '公式' },
        { type: 'image', content: 'm1', caption: '图' },
      ],
    };
    const r = knowledgeCardSchema.safeParse(card);
    expect(r.success).toBe(true);
    expect(r.data.media[1].core).toBe(false); // 默认 false
  });

  it('tier 非法值拒绝', () => {
    const card = oldCard();
    card.sections[0].tier = 'advanced';
    const r = knowledgeCardSchema.safeParse(card);
    expect(r.success).toBe(false);
  });

  it('emblems 引用不存在的 media id 拒绝', () => {
    const card = oldCard();
    card.emblems = [{ type: 'image', content: 'no-such-media' }];
    const r = knowledgeCardSchema.safeParse(card);
    expect(r.success).toBe(false);
    expect(r.error.issues[0].message).toContain('no-such-media');
  });

  it('media id 重复拒绝；examples id 重复拒绝', () => {
    const card = oldCard();
    card.media = [
      { id: 'm1', type: 'image', src: 'a.svg' },
      { id: 'm1', type: 'image', src: 'b.svg' },
    ];
    expect(knowledgeCardSchema.safeParse(card).success).toBe(false);

    const card2 = oldCard();
    card2.examples = [
      { id: 'e1', title: 'a', problem: 'p', steps: ['s'], answer: 'a' },
      { id: 'e1', title: 'b', problem: 'p', steps: ['s'], answer: 'a' },
    ];
    expect(knowledgeCardSchema.safeParse(card2).success).toBe(false);
  });

  it('example 缺 steps 拒绝；emblem formula 无需 media 即通过', () => {
    const card = oldCard();
    card.examples = [{ id: 'e1', title: 'a', problem: 'p', steps: [], answer: 'a' }];
    expect(knowledgeCardSchema.safeParse(card).success).toBe(false);

    const card2 = oldCard();
    card2.emblems = [{ type: 'formula', content: 'a²+b²=c²' }];
    expect(knowledgeCardSchema.safeParse(card2).success).toBe(true);
  });
});

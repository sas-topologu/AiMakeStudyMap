// profileDoc 单测：个人知识画像文档生成（纯函数）
import { describe, it, expect } from 'vitest';
import { buildProfileDoc, fmtTime, fmtMinutes } from '../profileDoc.js';

function sampleData(overrides = {}) {
  return {
    generatedAt: '2026-08-20T10:00:00.000Z',
    user: { id: 1, username: '小明', createdAt: '2026-07-01T00:00:00.000Z' },
    nodes: [
      { id: 'm1', title: '有理数', subject: '数学', difficulty: 1, state: 'lit', passSeconds: 300, litAt: '2026-08-01T08:00:00.000Z' },
      { id: 'm2', title: '一元一次方程', subject: '数学', difficulty: 2, state: 'passed', passSeconds: 900, litAt: null },
      { id: 'm3', title: '函数的概念', subject: '数学', difficulty: 2, state: 'open', passSeconds: null, litAt: null },
      { id: 'p1', title: '牛顿定律', subject: '物理', difficulty: 3, state: null, passSeconds: null, litAt: null },
    ],
    usage: { daily: [
      { day: '2026-08-01', seconds: 1800 },
      { day: '2026-08-02', seconds: 900 },
    ] },
    posts: [
      {
        id: 1, nodeId: 'm1', nodeTitle: '有理数', title: '我的笔记', body: '负数引入的动机梳理。',
        created_at: '2026-08-01T09:00:00.000Z',
        replies: [{ id: 1, body: '补充例子', created_at: '2026-08-01T10:00:00.000Z', username: '同学', isMine: false }],
      },
    ],
    replies: [{ id: 2, postId: 9, postTitle: '他人帖', nodeId: 'p1', nodeTitle: '牛顿定律', body: '我评他人', created_at: '2026-08-02T09:00:00.000Z' }],
    monument: [{ nodeId: 'm1', nodeTitle: '有理数', message: '拓荒纪念', created_at: '2026-08-01T08:00:00.000Z' }],
    creations: [{ nodeId: 'm1', nodeTitle: '有理数', type: 'summary', title: '我的总结', content: 'x'.repeat(600), status: 'approved', created_at: '2026-08-01T11:00:00.000Z' }],
    corrections: [{ nodeId: 'm1', nodeTitle: '有理数', body: '建议调整表述', status: 'pending', created_at: '2026-08-01T12:00:00.000Z' }],
    shares: [{ id: 'abc', createdAt: '2026-08-01T13:00:00.000Z' }],
    ...overrides,
  };
}

describe('fmtTime / fmtMinutes', () => {
  it('ISO 时间格式化为 YYYY-MM-DD HH:mm；空值返回占位', () => {
    expect(fmtTime('2026-08-01T08:05:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(fmtTime(null)).toBe('—');
  });

  it('秒数转中文时长（分钟/小时）', () => {
    expect(fmtMinutes(300)).toBe('5 分钟');
    expect(fmtMinutes(7200)).toBe('2 小时 0 分钟');
    expect(fmtMinutes(null)).toBe('—');
  });
});

describe('buildProfileDoc', () => {
  it('包含画像速览 / 学习投入 / 学科掌握 / 内容原文 / 兴趣画像五节', () => {
    const md = buildProfileDoc(sampleData());
    expect(md).toContain('# 个人知识画像 · 小明');
    expect(md).toContain('## 一、画像速览');
    expect(md).toContain('## 二、学习投入');
    expect(md).toContain('## 三、知识掌握（按学科）');
    expect(md).toContain('## 四、公开发布内容');
    expect(md).toContain('## 五、兴趣画像（AI 参考）');
  });

  it('统计正确：掌握率 / 主攻学科 / 学习时长', () => {
    const md = buildProfileDoc(sampleData());
    expect(md).toContain('掌握率 50%'); // 4 节点中 2 个通关/点亮
    expect(md).toContain('主攻学科'); // 数学 > 物理
    expect(md).toContain('45 分钟'); // 2700 秒
  });

  it('状态中文与明细行', () => {
    const md = buildProfileDoc(sampleData());
    expect(md).toContain('| 数学 | 3 | 0 | 1 | 1 | 1 |'); // 学科统计行
    expect(md).toContain('已点亮');
    expect(md).toContain('| 有理数 | 1 | 已点亮 | 5 分钟 |'); // 明细行
    expect(md).toContain('学习中节点明细');
    expect(md).toContain('| 函数的概念 | 2 |');
  });

  it('公开发布内容原文完整呈现', () => {
    const md = buildProfileDoc(sampleData());
    expect(md).toContain('《我的笔记》');
    expect(md).toContain('负数引入的动机梳理。');
    expect(md).toContain('补充例子');
    expect(md).toContain('我评他人');
    expect(md).toContain('拓荒纪念');
    expect(md).toContain('建议调整表述');
  });

  it('长二创内容截断并注明字数', () => {
    const md = buildProfileDoc(sampleData());
    expect(md).toContain('…（全文 600 字，站内可查看）');
    expect(md).toContain('[summary] 我的总结');
  });

  it('空数据（全新账号）仍输出完整骨架', () => {
    const md = buildProfileDoc(sampleData({ nodes: [], posts: [], replies: [], monument: [], creations: [], corrections: [], shares: [], usage: { daily: [] } }));
    expect(md).toContain('掌握率 0%');
    expect(md).toContain('（暂无）');
    expect(md).not.toContain('undefined');
  });
});

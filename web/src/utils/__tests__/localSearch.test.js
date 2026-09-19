import { describe, it, expect } from 'vitest';
import { searchCachedCards } from '../localSearch.js';

// 离线搜索：只在本地缓存里找 —— 规则与库侧一致，但可能落后于库现状
const CARDS = {
  'math.1': { id: 'math.1', title: '有理数', subject: '数学', summary: '整数与分数', difficulty: 2 },
  'math.2': { id: 'math.2', title: '无理数', subject: '数学', summary: '无限不循环小数', difficulty: 3 },
  'cs.1': { id: 'cs.1', title: '联邦学习', subject: '计算机', summary: '数据不出本地', difficulty: 5 },
};

describe('离线搜索（本地缓存）', () => {
  it('匹配标题 / 简介 / 编号，且不区分大小写', () => {
    expect(searchCachedCards('有理', CARDS).map((x) => x.id)).toEqual(['math.1']);
    expect(searchCachedCards('不循环', CARDS).map((x) => x.id)).toEqual(['math.2']);
    expect(searchCachedCards('CS.1', CARDS).map((x) => x.id)).toEqual(['cs.1']);
  });

  it('空查询返回空，不做全量罗列', () => {
    expect(searchCachedCards('', CARDS)).toEqual([]);
    expect(searchCachedCards('   ', CARDS)).toEqual([]);
    expect(searchCachedCards('无此内容', CARDS)).toEqual([]);
  });

  it('结果按 id 排序、条数受 limit 限制，且只带必要字段', () => {
    const many = {};
    for (let i = 0; i < 30; i += 1) {
      many[`n.${String(i).padStart(2, '0')}`] = { id: `n.${String(i).padStart(2, '0')}`, title: '测试', difficulty: 1 };
    }
    const hit = searchCachedCards('测试', many, { limit: 5 });
    expect(hit).toHaveLength(5);
    expect(hit.map((x) => x.id)).toEqual(['n.00', 'n.01', 'n.02', 'n.03', 'n.04']);
    expect(Object.keys(hit[0]).sort()).toEqual(['difficulty', 'id', 'subject', 'title']);
  });

  it('缓存为空时不炸', () => {
    expect(searchCachedCards('任意', {})).toEqual([]);
    expect(searchCachedCards('任意', null)).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { buildProgressFile, parseProgressFile, progressFileName, FILE_KIND } from '../progressFile.js';

// 个人进度文件：能带走、能带回来、坏文件要说人话
describe('个人进度文件', () => {
  const server = [
    { nodeId: 't.a', state: 'lit', passSeconds: 100, litAt: '2026-01-01T00:00:00.000Z', certified: true },
    { nodeId: 't.b', state: 'open', passSeconds: null, litAt: null, certified: true },
  ];
  const local = [
    { nodeId: 't.b', state: 'passed', passSeconds: 30 }, // 比库侧高 → 采用本地
    { nodeId: 't.c', state: 'open', passSeconds: null }, // 库里没有 → 带上
    { nodeId: 't.a', state: 'open' }, // 比库侧低 → 忽略
  ];

  it('导出：库侧与本地成果取高者，本地成果不带认证', () => {
    const file = buildProgressFile({ source: { fingerprint: 'abc' }, states: server, local }, '2026-09-19T00:00:00.000Z');
    expect(file.kind).toBe(FILE_KIND);
    expect(file.version).toBe(1);
    expect(file.exportedAt).toBe('2026-09-19T00:00:00.000Z');
    expect(file.states).toEqual([
      { nodeId: 't.a', state: 'lit', passSeconds: 100, litAt: '2026-01-01T00:00:00.000Z', certified: true },
      { nodeId: 't.b', state: 'passed', passSeconds: 30, litAt: null, certified: false },
      { nodeId: 't.c', state: 'open', passSeconds: null, litAt: null, certified: false },
    ]);
  });

  it('导出→导入 往返一致', () => {
    const file = buildProgressFile({ states: server, local }, '2026-09-19T00:00:00.000Z');
    const back = parseProgressFile(JSON.stringify(file));
    expect(back.ok).toBe(true);
    expect(back.data.states).toEqual(file.states);
    expect(back.data.exportedAt).toBe('2026-09-19T00:00:00.000Z');
  });

  it('坏文件：每种情况都给出人话原因，不抛异常', () => {
    expect(parseProgressFile('不是 json').error).toContain('JSON');
    expect(parseProgressFile('[]').error).toContain('进度对象');
    expect(parseProgressFile('{"kind":"别的"}').error).toContain('个人进度文件');
    expect(parseProgressFile(`{"kind":"${FILE_KIND}"}`).error).toContain('states');
    expect(parseProgressFile(`{"kind":"${FILE_KIND}","states":[]}`).error).toContain('可导入');
  });

  it('导入：过滤掉非法条目，容错缺失字段', () => {
    const text = JSON.stringify({
      kind: FILE_KIND,
      states: [
        { nodeId: 't.a', state: 'lit' },
        { nodeId: 't.b', state: 'dim' }, // dim 不是成果 → 丢弃
        { state: 'passed' }, // 缺 nodeId → 丢弃
        { nodeId: 't.c', state: '乱写' }, // 非法状态 → 丢弃
      ],
    });
    const r = parseProgressFile(text);
    expect(r.ok).toBe(true);
    expect(r.data.states).toEqual([
      { nodeId: 't.a', state: 'lit', passSeconds: null, litAt: null, certified: false },
    ]);
  });

  it('文件名按导出日期', () => {
    expect(progressFileName('2026-09-19T12:34:56.000Z')).toBe('starmap-progress-2026-09-19.json');
  });
});

import { describe, it, expect } from 'vitest';
import {
  detectCycles,
  detectIslands,
  validateGraph,
} from '../src/services/structureCheck.js';

const pre = (from, to) => ({ from_id: from, to_id: to, type: 'prerequisite' });
const rel = (a, b) => ({ from_id: a, to_id: b, type: 'related' });

describe('detectCycles', () => {
  it('无环图（DAG）返回空数组', () => {
    const nodes = ['a', 'b', 'c', 'd'];
    const edges = [pre('b', 'a'), pre('c', 'b'), pre('d', 'b')];
    expect(detectCycles(nodes, edges)).toEqual([]);
  });

  it('检出简单环', () => {
    const nodes = ['a', 'b', 'c'];
    const edges = [pre('a', 'b'), pre('b', 'c'), pre('c', 'a')];
    const cycles = detectCycles(nodes, edges);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].sort()).toEqual(['a', 'b', 'c']);
  });

  it('检出自环与多个环', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e'];
    const edges = [pre('a', 'a'), pre('b', 'c'), pre('c', 'b'), pre('d', 'e')];
    const cycles = detectCycles(nodes, edges);
    expect(cycles).toHaveLength(2);
    const flat = cycles.map((c) => [...c].sort());
    expect(flat).toContainEqual(['a']);
    expect(flat).toContainEqual(['b', 'c']);
  });

  it('related 边不参与环检测', () => {
    const nodes = ['a', 'b'];
    expect(detectCycles(nodes, [rel('a', 'b'), rel('b', 'a')])).toEqual([]);
  });
});

describe('detectIslands', () => {
  it('全连通时无孤岛', () => {
    const nodes = ['a', 'b', 'c'];
    const edges = [pre('b', 'a'), rel('c', 'b')];
    expect(detectIslands(nodes, edges)).toEqual([]);
  });

  it('主网络外的孤立对与孤点都被返回', () => {
    // 主网络 a-b-c；孤岛对 d-e；孤点 f
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f'];
    const edges = [pre('b', 'a'), pre('c', 'b'), rel('d', 'e')];
    const islands = detectIslands(nodes, edges);
    expect(islands).toHaveLength(2);
    const sorted = islands.map((g) => [...g].sort());
    expect(sorted).toContainEqual(['d', 'e']);
    expect(sorted).toContainEqual(['f']);
  });

  it('related 边参与连通（前置+相关构成无向图）', () => {
    const nodes = ['a', 'b', 'c'];
    const edges = [rel('a', 'c'), pre('b', 'a')];
    expect(detectIslands(nodes, edges)).toEqual([]);
  });
});

describe('validateGraph', () => {
  it('健康图无 errors 也无 warnings', () => {
    const nodes = ['a', 'b', 'c'];
    const edges = [pre('b', 'a'), pre('c', 'b'), rel('a', 'c')];
    expect(validateGraph(nodes, edges)).toEqual({ errors: [], warnings: [] });
  });

  it('dangling 引用计入 errors', () => {
    const nodes = ['a', 'b'];
    const edges = [pre('b', 'ghost')];
    const { errors } = validateGraph(nodes, edges);
    expect(errors.some((e) => e.includes('ghost'))).toBe(true);
  });

  it('环计入 errors', () => {
    const nodes = ['a', 'b'];
    const edges = [pre('a', 'b'), pre('b', 'a')];
    const { errors } = validateGraph(nodes, edges);
    expect(errors.some((e) => e.includes('环'))).toBe(true);
  });

  it('related 自环计入 errors', () => {
    const nodes = ['a', 'b'];
    const edges = [pre('b', 'a'), rel('a', 'a')];
    const { errors } = validateGraph(nodes, edges);
    expect(errors.some((e) => e.includes('自环'))).toBe(true);
  });

  it('孤岛计入 warnings 而非 errors', () => {
    const nodes = ['a', 'b', 'x'];
    const edges = [pre('b', 'a')];
    const { errors, warnings } = validateGraph(nodes, edges);
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.includes('x'))).toBe(true);
  });
});

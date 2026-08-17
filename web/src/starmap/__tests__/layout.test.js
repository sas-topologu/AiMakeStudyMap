// 中心视图布局单测：前置/后续向中轴线靠拢、导航锚点（后续指向导航终点）、角度均分
import { describe, it, expect } from 'vitest';
import { computeLayout, distributeAngles, SECTORS } from '../layout.js';

const N = (id) => ({ id, title: id, subject: '数学' });
// from 的前置是 to（与 content 边语义一致）
const PRE = (from, to) => ({ from, to, type: 'prerequisite' });
const REL = (from, to) => ({ from, to, type: 'related' });

describe('中心视图：前置/后续向中轴线靠拢', () => {
  // C 为中心；S 依赖 C（后续）；P 是 C 的前置；R 与 C 相关
  const nodes = [N('C'), N('S'), N('P'), N('R')];
  const edges = [PRE('S', 'C'), PRE('C', 'P'), REL('R', 'C')];

  it('后续在上、前置在下、相关在左右', () => {
    const { pos } = computeLayout({ centerId: 'C', nodes, edges, ringStep: 160 });
    expect(pos.get('S').sector).toBe('top');
    expect(pos.get('P').sector).toBe('bottom');
    expect(['left', 'right']).toContain(pos.get('R').sector);
  });

  it('扇区收窄：前置/后续角度落在以中轴线为中心的窄扇区内', () => {
    expect(SECTORS.top.lo).toBeGreaterThanOrEqual(230);
    expect(SECTORS.top.hi).toBeLessThanOrEqual(310);
    expect(SECTORS.bottom.lo).toBeGreaterThanOrEqual(50);
    expect(SECTORS.bottom.hi).toBeLessThanOrEqual(130);
    // 单节点时正落在中轴（后续 270°，前置 90°）
    const { pos } = computeLayout({ centerId: 'C', nodes, edges, ringStep: 160 });
    expect(pos.get('S').angle).toBeCloseTo(270, 5);
    expect(pos.get('P').angle).toBeCloseTo(90, 5);
  });

  it('多后续围绕中轴线对称展开（向导航终点方向聚拢）', () => {
    const ns = [N('C'), N('S1'), N('S2')];
    const es = [PRE('S1', 'C'), PRE('S2', 'C')];
    const { pos } = computeLayout({ centerId: 'C', nodes: ns, edges: es, ringStep: 160 });
    const a1 = pos.get('S1').angle;
    const a2 = pos.get('S2').angle;
    expect(Math.abs(a1 - 270)).toBeLessThan(30);
    expect(Math.abs(a2 - 270)).toBeLessThan(30);
  });
});

describe('中心视图：导航锚点（后续指向导航终点）', () => {
  it('下一节点钉在正上方(270°)、上一节点钉在正下方(90°)', () => {
    const nodes = [N('C'), N('P'), N('S')];
    const edges = [PRE('S', 'C'), PRE('C', 'P')];
    const { pos } = computeLayout({
      centerId: 'C',
      nodes,
      edges,
      ringStep: 160,
      nav: { nextId: 'S', prevId: 'P' },
    });
    expect(pos.get('S').angle).toBeCloseTo(270, 5);
    expect(pos.get('P').angle).toBeCloseTo(90, 5);
  });

  it('走回头路：下一节点本是前置（下方），导航时强制转到上方指向终点', () => {
    // C 的前置是 P（本应在下方），导航要求把 P 作为下一步 → 应转到上方
    const nodes = [N('C'), N('P')];
    const edges = [PRE('C', 'P')];
    const { pos } = computeLayout({
      centerId: 'C',
      nodes,
      edges,
      ringStep: 160,
      nav: { nextId: 'P', prevId: null },
    });
    expect(pos.get('P').sector).toBe('top');
    expect(pos.get('P').angle).toBeCloseTo(270, 5);
  });

  it('无导航时不改变原始排布（前置仍在下）', () => {
    const nodes = [N('C'), N('P')];
    const edges = [PRE('C', 'P')];
    const { pos } = computeLayout({ centerId: 'C', nodes, edges, ringStep: 160 });
    expect(pos.get('P').sector).toBe('bottom');
    expect(pos.get('P').angle).toBeCloseTo(90, 5);
  });
});

describe('distributeAngles', () => {
  it('无锚点时整段均分', () => {
    const a = distributeAngles(3, 0, 90, []);
    expect(a.length).toBe(3);
    expect(a[0]).toBeCloseTo(0);
    expect(a[1]).toBeCloseTo(45);
    expect(a[2]).toBeCloseTo(90);
  });

  it('锚点两侧对称分配其余节点', () => {
    const a = distributeAngles(2, 248, 292, [270]);
    expect(a.length).toBe(2);
    expect(a[0]).toBeLessThan(270);
    expect(a[1]).toBeGreaterThan(270);
  });

  it('空 count 返回空数组', () => {
    expect(distributeAngles(0, 0, 90, [])).toEqual([]);
  });
});

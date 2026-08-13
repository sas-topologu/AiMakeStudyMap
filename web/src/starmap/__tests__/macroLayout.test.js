// macroLayout 单测：星座布局（DAG 分层/确定性/环兜底）、宇宙布局、聚合桶、合成数据
import { describe, it, expect } from 'vitest';
import {
  layoutUniverse,
  layoutConstellation,
  layoutWorld,
  bucketize,
  bucketKeyOf,
  makeSyntheticGraph,
} from '../macroLayout.js';

const N = (id) => ({ id, title: id, subject: '数学' });
const PRE = (from, to) => ({ from, to, type: 'prerequisite' }); // from 的前置是 to
const REL = (from, to) => ({ from, to, type: 'related' });

describe('layoutConstellation', () => {
  it('按 prerequisite 最长路径分层（链 A→B→C）', () => {
    // C 的前置是 B，B 的前置是 A → A 第 0 层，B 第 1 层，C 第 2 层
    const pos = layoutConstellation([N('A'), N('B'), N('C')], [PRE('B', 'A'), PRE('C', 'B')]);
    expect(pos.get('A').layer).toBe(0);
    expect(pos.get('B').layer).toBe(1);
    expect(pos.get('C').layer).toBe(2);
    // 层越高越靠上（y 负方向）
    expect(pos.get('C').y).toBeLessThan(pos.get('B').y);
    expect(pos.get('B').y).toBeLessThan(pos.get('A').y);
  });

  it('菱形依赖取最长路径：D 的第 2 层', () => {
    const pos = layoutConstellation(
      [N('A'), N('B'), N('C'), N('D')],
      [PRE('B', 'A'), PRE('C', 'A'), PRE('D', 'B'), PRE('D', 'C')],
    );
    expect(pos.get('D').layer).toBe(2);
  });

  it('related 边不参与定位', () => {
    const withRel = layoutConstellation([N('A'), N('B'), N('C')], [PRE('B', 'A'), REL('C', 'A')]);
    expect(withRel.get('C').layer).toBe(0); // C 无前置，与 A 同层
  });

  it('坐标确定性：同数据同结果（与输入顺序无关）', () => {
    const nodes = [N('A'), N('B'), N('C'), N('D')];
    const edges = [PRE('B', 'A'), PRE('C', 'A'), PRE('D', 'B')];
    const p1 = layoutConstellation(nodes, edges);
    const p2 = layoutConstellation([...nodes].reverse(), [...edges].reverse());
    for (const id of ['A', 'B', 'C', 'D']) {
      expect(p2.get(id)).toEqual(p1.get(id));
    }
  });

  it('同层节点 x 居中均布且不重叠', () => {
    const pos = layoutConstellation([N('A'), N('B'), N('C')], []);
    const xs = [pos.get('A').x, pos.get('B').x, pos.get('C').x].sort((a, b) => a - b);
    expect(xs[1] - xs[0]).toBeCloseTo(xs[2] - xs[1]); // 等距
    expect(xs[0] + xs[2]).toBeCloseTo(0); // 居中
  });

  it('环兜底：不挂死且给出有限坐标', () => {
    const pos = layoutConstellation([N('A'), N('B')], [PRE('A', 'B'), PRE('B', 'A')]);
    expect(Number.isFinite(pos.get('A').x)).toBe(true);
    expect(Number.isFinite(pos.get('B').y)).toBe(true);
  });
});

describe('layoutWorld', () => {
  const nodes = [
    N('M1'), N('M2'), N('M3'), N('M4'), N('M5'), N('M6'),
    { id: 'P1', title: 'P1', subject: '物理' },
    { id: 'P2', title: 'P2', subject: '物理' },
  ];
  const edges = [
    PRE('M2', 'M1'), PRE('M3', 'M2'), PRE('M4', 'M3'), PRE('M5', 'M4'), PRE('M6', 'M5'),
    PRE('P2', 'P1'),
  ];
  const subjects = [
    { subject: '数学', count: 6 },
    { subject: '物理', count: 2 },
  ];

  it('所有节点都有全局坐标且坐标有限', () => {
    const { pos } = layoutWorld(subjects, nodes, edges);
    expect(pos.size).toBe(nodes.length);
    for (const n of nodes) {
      const p = pos.get(n.id);
      expect(p).toBeDefined();
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('节点聚集在所属星系锚点附近（嵌入世界坐标）', () => {
    const { galaxies, pos } = layoutWorld(subjects, nodes, edges);
    const math = galaxies.find((g) => g.subject === '数学');
    const phys = galaxies.find((g) => g.subject === '物理');
    expect(math).toBeDefined();
    expect(phys).toBeDefined();
    expect(Math.hypot(math.x - phys.x, math.y - phys.y)).toBeGreaterThan(100); // 两星系分开
    for (const n of nodes.slice(0, 6)) {
      const p = pos.get(n.id);
      const d = Math.hypot(p.x - math.x, p.y - math.y);
      expect(d).toBeLessThan(400); // 学科内相对星系锚点偏移有限
    }
  });

  it('相邻星系中心距 ≥ 学科对角 + 边距（不重叠）', () => {
    const { galaxies } = layoutWorld(subjects, nodes, edges);
    // 两学科：相距应不小于两者半径和
    const d = Math.hypot(galaxies[0].x - galaxies[1].x, galaxies[0].y - galaxies[1].y);
    expect(d).toBeGreaterThan(galaxies[0].r + galaxies[1].r + 100);
  });

  it('确定性：同数据同结果', () => {
    const a = layoutWorld(subjects, nodes, edges);
    const b = layoutWorld(
      [...subjects].reverse(),
      [...nodes].reverse(),
      [...edges].reverse(),
    );
    for (const n of nodes) {
      expect(b.pos.get(n.id)).toEqual(a.pos.get(n.id));
    }
  });
});

describe('layoutUniverse', () => {
  it('确定性且各星系锚点互不相同', () => {
    const subjects = [
      { subject: '数学', count: 9 },
      { subject: '物理', count: 6 },
      { subject: '化学', count: 1 },
    ];
    const a = layoutUniverse(subjects);
    const b = layoutUniverse([...subjects].reverse());
    const anchors = [...a.values()].map((g) => `${g.x},${g.y}`);
    expect(new Set(anchors).size).toBe(3);
    for (const s of subjects) expect(b.get(s.subject)).toEqual(a.get(s.subject));
  });

  it('单星系居中；节点越多星系越大', () => {
    const one = layoutUniverse([{ subject: '数学', count: 100 }]);
    expect(one.get('数学')).toMatchObject({ x: 0, y: 0 });
    const two = layoutUniverse([
      { subject: '数学', count: 100 },
      { subject: '物理', count: 1 },
    ]);
    expect(two.get('数学').r).toBeGreaterThan(two.get('物理').r);
  });
});

describe('bucketize', () => {
  it('桶计数正确，质心为桶内均值', () => {
    const items = [
      { id: 'a', x: 1, y: 1 },
      { id: 'b', x: 3, y: 3 },
      { id: 'c', x: 11, y: 1 },
      { id: 'd', x: -1, y: -1 },
    ];
    const buckets = bucketize(items, 10);
    expect(buckets.size).toBe(3); // (0,0) 两枚、(1,0) 一枚、(-1,-1) 一枚
    const b00 = buckets.get(bucketKeyOf(1, 1, 10));
    expect(b00.count).toBe(2);
    expect(b00.ids).toEqual(['a', 'b']);
    expect(b00.cx).toBeCloseTo(2);
    expect(b00.cy).toBeCloseTo(2);
    expect(buckets.get(bucketKeyOf(11, 1, 10)).count).toBe(1);
    expect(buckets.get(bucketKeyOf(-1, -1, 10)).count).toBe(1);
  });

  it('空输入返回空桶', () => {
    expect(bucketize([], 10).size).toBe(0);
  });
});

describe('makeSyntheticGraph', () => {
  it('确定性且 prerequisite 为 DAG（同余列向前取边）', () => {
    const g1 = makeSyntheticGraph(500, { subjectCount: 4, seed: 7 });
    const g2 = makeSyntheticGraph(500, { subjectCount: 4, seed: 7 });
    expect(g1).toEqual(g2);
    const idx = new Map(g1.nodes.map((n, i) => [n.id, i]));
    for (const e of g1.edges) {
      if (e.type !== 'prerequisite') continue;
      expect(idx.get(e.to)).toBeLessThan(idx.get(e.from));
      expect(g1.nodes[idx.get(e.to)].subject).toBe(g1.nodes[idx.get(e.from)].subject);
    }
    // 合成数据在星座布局下可正常分层
    const pos = layoutConstellation(g1.nodes, g1.edges);
    expect(pos.size).toBe(500);
  });
});

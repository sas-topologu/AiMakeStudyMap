// macroLayout 单测：星座布局（DAG 分层/确定性/环兜底）、宇宙布局、聚合桶、合成数据
import { describe, it, expect } from 'vitest';
import {
  layoutUniverse,
  layoutConstellation,
  layoutWorld,
  longestChain,
  bucketize,
  bucketKeyOf,
  makeSyntheticGraph,
} from '../macroLayout.js';

const N = (id) => ({ id, title: id, subject: '数学' });
const PRE = (from, to) => ({ from, to, type: 'prerequisite' }); // from 的前置是 to
const REL = (from, to) => ({ from, to, type: 'related' });

describe('layoutConstellation', () => {
  it('按 prerequisite 最长路径分层（链 A→B→C），层越深离中心越远（蛛网）', () => {
    // C 的前置是 B，B 的前置是 A → A 第 0 层，B 第 1 层，C 第 2 层
    const pos = layoutConstellation([N('A'), N('B'), N('C')], [PRE('B', 'A'), PRE('C', 'B')]);
    expect(pos.get('A').layer).toBe(0);
    expect(pos.get('B').layer).toBe(1);
    expect(pos.get('C').layer).toBe(2);
    // 蛛网：基础靠近中心，前沿靠外
    const r = (id) => Math.hypot(pos.get(id).x, pos.get(id).y);
    expect(r('C')).toBeGreaterThan(r('B'));
    expect(r('B')).toBeGreaterThan(r('A'));
    expect(r('A')).toBeCloseTo(0); // 单基础节点在圆心
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

  it('同层基础节点在中心小圆上角度均布', () => {
    const pos = layoutConstellation([N('A'), N('B'), N('C')], []);
    const rs = ['A', 'B', 'C'].map((id) => Math.hypot(pos.get(id).x, pos.get(id).y));
    const as = ['A', 'B', 'C']
      .map((id) => Math.atan2(pos.get(id).y, pos.get(id).x))
      .sort((a, b) => a - b);
    expect(rs[0]).toBeCloseTo(rs[1]);
    expect(rs[1]).toBeCloseTo(rs[2]);
    expect(rs[0]).toBeGreaterThan(0); // 多基础在小圆上而非圆心
    expect(as[1] - as[0]).toBeCloseTo(as[2] - as[1], 5); // 角度均布
  });

  it('子节点角度继承主父扇区（连线短不交叉）', () => {
    // A 有两个子 B、C（同层），二者应聚在 A 的角度附近
    const pos = layoutConstellation([N('A'), N('B'), N('C')], [PRE('B', 'A'), PRE('C', 'A')]);
    const aA = Math.atan2(pos.get('A').y, pos.get('A').x);
    const aB = Math.atan2(pos.get('B').y, pos.get('B').x);
    const aC = Math.atan2(pos.get('C').y, pos.get('C').x);
    const diff = (a) => Math.abs(((a - aA + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    expect(diff(aB)).toBeLessThan(Math.PI / 2 + 1e-6);
    expect(diff(aC)).toBeLessThan(Math.PI / 2 + 1e-6);
  });

  it('环兜底：不挂死且给出有限坐标', () => {
    const pos = layoutConstellation([N('A'), N('B')], [PRE('A', 'B'), PRE('B', 'A')]);
    expect(Number.isFinite(pos.get('A').x)).toBe(true);
    expect(Number.isFinite(pos.get('B').y)).toBe(true);
  });

  it('最小间距：同层节点两两距离 ≥ minDist（节点多时环半径自适应放大）', () => {
    // 一个父 + 24 个子 → 同层弧长若按固定环半径会被压到远小于 40，新逻辑放大半径
    const nodes = [N('A'), ...Array.from({ length: 24 }, (_, i) => N(`C${String(i).padStart(2, '0')}`))];
    const edges = Array.from({ length: 24 }, (_, i) => PRE(`C${String(i).padStart(2, '0')}`, 'A'));
    const pos = layoutConstellation(nodes, edges, { ringStep: 60, minDist: 40 });
    const cs = Array.from({ length: 24 }, (_, i) => pos.get(`C${String(i).padStart(2, '0')}`));
    for (let i = 0; i < cs.length; i += 1) {
      for (let j = i + 1; j < cs.length; j += 1) {
        const d = Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y);
        expect(d).toBeGreaterThanOrEqual(40 * 0.98);
      }
    }
    // 且子节点与中心父节点保持径向间距 ≥ ringStep
    for (const c of cs) {
      expect(Math.hypot(c.x, c.y)).toBeGreaterThanOrEqual(60 * 0.98);
    }
  });

  it('Voronoi 组扇区：多个父节点时组间不重叠（节点分散均匀而非聚簇）', () => {
    // 两个父（角度相对）+ 各 3 个子；子组应落在各自父角度一侧且互不侵入
    const nodes = [
      N('P1'), N('P2'), N('Q1'), N('Q2'), N('Q3'), N('Q4'), N('Q5'), N('Q6'),
    ];
    const edges = [
      PRE('Q1', 'P1'), PRE('Q2', 'P1'), PRE('Q3', 'P1'),
      PRE('Q4', 'P2'), PRE('Q5', 'P2'), PRE('Q6', 'P2'),
    ];
    const pos = layoutConstellation(nodes, edges, { ringStep: 70, minDist: 40 });
    const aP1 = Math.atan2(pos.get('P1').y, pos.get('P1').x);
    const aP2 = Math.atan2(pos.get('P2').y, pos.get('P2').x);
    const nearP1 = ['Q1', 'Q2', 'Q3'].map((id) => Math.abs(
      ((Math.atan2(pos.get(id).y, pos.get(id).x) - aP1 + Math.PI * 3) % (Math.PI * 2)) - Math.PI,
    ));
    const nearP2 = ['Q4', 'Q5', 'Q6'].map((id) => Math.abs(
      ((Math.atan2(pos.get(id).y, pos.get(id).x) - aP2 + Math.PI * 3) % (Math.PI * 2)) - Math.PI,
    ));
    for (const d of nearP1) expect(d).toBeLessThan(Math.PI / 2);
    for (const d of nearP2) expect(d).toBeLessThan(Math.PI / 2);
  });
});

describe('longestChain', () => {
  it('返回学科内最长前置链（学习顺序：根 → 叶）', () => {
    // D 前置 C，C 前置 B，B 前置 A → A→B→C→D
    const chain = longestChain(
      [N('A'), N('B'), N('C'), N('D')],
      [PRE('B', 'A'), PRE('C', 'B'), PRE('D', 'C')],
    );
    expect(chain).toEqual(['A', 'B', 'C', 'D']);
  });

  it('菱形依赖取最长链，并列按 id 确定性打破', () => {
    // D 依赖 B 与 C；B、C 依赖 A → 最长链 A→B→D（B < C）
    const chain = longestChain(
      [N('A'), N('B'), N('C'), N('D')],
      [PRE('B', 'A'), PRE('C', 'A'), PRE('D', 'B'), PRE('D', 'C')],
    );
    expect(chain).toEqual(['A', 'B', 'D']);
  });

  it('无前置边退化为字典序最小的单个节点', () => {
    const chain = longestChain([N('A'), N('B')], []);
    expect(chain.length).toBe(1);
    expect(chain[0]).toBe('A');
  });

  it('related 边不影响主干链', () => {
    const chain = longestChain([N('A'), N('B'), N('C')], [PRE('B', 'A'), REL('C', 'A')]);
    expect(chain).toEqual(['A', 'B']);
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
      expect(d).toBeLessThanOrEqual(math.r); // 节点不超出所属团半径
    }
  });

  it('团不相交：中心距 ≥ 半径和 + 间隙（圆堆积不重叠）', () => {
    const { galaxies } = layoutWorld(subjects, nodes, edges);
    const GAP = 70;
    for (let i = 0; i < galaxies.length; i += 1) {
      for (let j = i + 1; j < galaxies.length; j += 1) {
        const d = Math.hypot(
          galaxies[i].x - galaxies[j].x,
          galaxies[i].y - galaxies[j].y,
        );
        expect(d).toBeGreaterThanOrEqual(galaxies[i].r + galaxies[j].r + GAP - 1e-6);
      }
    }
  });

  it('贪心贴边：每个后续团与某个已放团恰好相切（紧凑堆积）', () => {
    const { galaxies } = layoutWorld(subjects, nodes, edges);
    const GAP = 70;
    for (let i = 1; i < galaxies.length; i += 1) {
      let touching = false;
      for (let j = 0; j < i; j += 1) {
        const d = Math.hypot(
          galaxies[i].x - galaxies[j].x,
          galaxies[i].y - galaxies[j].y,
        );
        if (Math.abs(d - (galaxies[i].r + galaxies[j].r + GAP)) < 0.01) touching = true;
      }
      expect(touching).toBe(true);
    }
  });

  it('自适应：不同规模下布局均不相交且坐标有限', () => {
    // 模拟未来内容增长：更多学科、更多节点（含单节点学科）
    const bigSubjects = [
      { subject: '数学', count: 30 },
      { subject: '物理', count: 22 },
      { subject: '计算机', count: 15 },
      { subject: '化学', count: 6 },
      { subject: '地理', count: 4 },
      { subject: '生物', count: 4 },
      { subject: '历史', count: 1 },
      { subject: '艺术', count: 1 },
    ];
    const bigNodes = [];
    let seq = 0;
    for (const s of bigSubjects) {
      for (let i = 0; i < s.count; i += 1) {
        bigNodes.push({ id: `n${seq}`, title: `n${seq}`, subject: s.subject });
        seq += 1;
      }
    }
    const bigEdges = [];
    // 每个学科一条链，链长随节点数增长（自动拉大团半径）
    let base = 0;
    for (const s of bigSubjects) {
      for (let i = 1; i < s.count; i += 1) {
        bigEdges.push({ from: `n${base + i}`, to: `n${base + i - 1}`, type: 'prerequisite' });
      }
      base += s.count;
    }
    const { galaxies, pos } = layoutWorld(bigSubjects, bigNodes, bigEdges);
    expect(galaxies.length).toBe(8);
    expect(pos.size).toBe(bigNodes.length);
    const GAP = 70;
    for (let i = 0; i < galaxies.length; i += 1) {
      for (let j = i + 1; j < galaxies.length; j += 1) {
        const d = Math.hypot(
          galaxies[i].x - galaxies[j].x,
          galaxies[i].y - galaxies[j].y,
        );
        expect(d).toBeGreaterThanOrEqual(galaxies[i].r + galaxies[j].r + GAP - 1e-6);
      }
    }
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

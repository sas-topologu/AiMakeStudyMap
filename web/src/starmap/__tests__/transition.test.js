// transition.js 单测：计划分类 / 屏外起终点 / 弹簧 settle / 碰撞分离 / 降级
import { describe, it, expect } from 'vitest';
import { planTransition, SpringSim, TRANSITION } from '../transition.js';

const VIEW = { width: 800, height: 600, scale: 1 };
const OFF = (Math.hypot(800, 600) / 2) * TRANSITION.OFFSCREEN_RATIO; // 600

const P = (x, y, angle = null) => ({ x, y, angle });

describe('planTransition', () => {
  const oldPos = new Map([
    ['A', P(0, 0)],
    ['B', P(160, 0, 0)],
    ['C', P(0, 160, 90)],
  ]);
  const newPos = new Map([
    ['B', P(0, 0)],
    ['A', P(-160, 0, 180)],
    ['D', P(0, -160, 270)],
  ]);

  it('分类：保留 / 进入 / 离开', () => {
    const plan = planTransition(oldPos, newPos, 'B', VIEW);
    expect(plan.nodes.get('A').kind).toBe('keep');
    expect(plan.nodes.get('B').kind).toBe('keep');
    expect(plan.nodes.get('C').kind).toBe('leave');
    expect(plan.nodes.get('D').kind).toBe('enter');
  });

  it('进入节点起点在屏外（沿新象限方向），离开节点终点在屏外（沿旧象限方向）', () => {
    const plan = planTransition(oldPos, newPos, 'B', VIEW);
    const dIn = plan.nodes.get('D').from;
    expect(Math.hypot(dIn.x, dIn.y)).toBeCloseTo(OFF, 1);
    expect(dIn.y).toBeLessThan(0); // D 在上方区（angle 270°）
    const cOut = plan.nodes.get('C').to;
    expect(Math.hypot(cOut.x, cOut.y)).toBeCloseTo(OFF, 1);
    expect(cOut.y).toBeGreaterThan(0); // C 旧位置在下方
  });

  it('新旧中心都在计划中（旧中心让位、新中心被拉到原点）', () => {
    const plan = planTransition(oldPos, newPos, 'B', VIEW);
    expect(plan.nodes.has('A')).toBe(true);
    expect(plan.nodes.has('B')).toBe(true);
    expect(plan.nodes.get('B').to).toEqual({ x: 0, y: 0 });
  });

  it('降级：enabled=false / 超节点上限 / 无旧布局 → null', () => {
    expect(planTransition(oldPos, newPos, 'B', VIEW, { enabled: false })).toBeNull();
    expect(planTransition(oldPos, newPos, 'B', VIEW, { maxNodes: 2 })).toBeNull();
    expect(planTransition(new Map(), newPos, 'B', VIEW)).toBeNull();
    expect(planTransition(null, newPos, 'B', VIEW)).toBeNull();
  });
});

describe('SpringSim', () => {
  it('典型 20 节点切换在有限帧内 settle', () => {
    const oldPos = new Map();
    const newPos = new Map();
    oldPos.set('c0', P(0, 0));
    for (let i = 0; i < 19; i += 1) {
      const a = (i * 360) / 19;
      oldPos.set(`n${i}`, P(Math.cos((a * Math.PI) / 180) * 200, Math.sin((a * Math.PI) / 180) * 200, a));
    }
    newPos.set('n0', P(0, 0)); // n0 成为新中心
    newPos.set('c0', P(-200, 0, 180));
    for (let i = 1; i < 19; i += 1) {
      const a = (i * 360) / 19;
      newPos.set(`n${i}`, P(Math.cos((a * Math.PI) / 180) * 180, Math.sin((a * Math.PI) / 180) * 180, a));
    }
    newPos.set('new1', P(0, -180, 270)); // 进入
    oldPos.set('old1', P(0, 380, 90)); // 离开
    const plan = planTransition(oldPos, newPos, 'n0', VIEW);
    const sim = new SpringSim(plan);
    let frames = 0;
    while (!sim.settled && frames < 600) {
      sim.step(1 / 60);
      frames += 1;
    }
    console.log(`[transition] 20 节点 settle 帧数：${frames}`);
    expect(sim.settled).toBe(true);
    expect(frames).toBeLessThan(150);
    // settle 后位置即目标
    const pos = sim.positions();
    expect(pos.get('n0').x).toBeCloseTo(0, 0);
    expect(pos.get('n0').y).toBeCloseTo(0, 0);
  });

  it('碰撞排斥：同点出发的两个节点在飞行中分离', () => {
    const oldPos = new Map([
      ['a', P(0, 0)],
      ['b', P(0, 0)],
    ]);
    const newPos = new Map([
      ['a', P(-150, 0, 180)],
      ['b', P(150, 0, 0)],
    ]);
    const sim = new SpringSim(planTransition(oldPos, newPos, 'a', VIEW));
    for (let i = 0; i < 30; i += 1) sim.step(1 / 60);
    const pos = sim.positions();
    const d = Math.hypot(pos.get('a').x - pos.get('b').x, pos.get('a').y - pos.get('b').y);
    // 30 帧后已明显分离（大于最小间距），无重叠穿插、无 NaN
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(TRANSITION.MIN_DIST);
  });

  it('alpha：进入淡入、离开淡出、保留恒 1', () => {
    const oldPos = new Map([['a', P(0, 100, 90)]]);
    const newPos = new Map([['b', P(0, -100, 270)]]);
    const sim = new SpringSim(planTransition(oldPos, newPos, 'b', VIEW));
    expect(sim.alphaOf('b')).toBe(0); // 屏外起点
    expect(sim.alphaOf('a')).toBe(1); // 尚未离开
    for (let i = 0; i < 600 && !sim.settled; i += 1) sim.step(1 / 60);
    expect(sim.settled).toBe(true);
    expect(sim.alphaOf('b')).toBeGreaterThan(0.95); // 进入到位 ≈1
    expect(sim.alphaOf('a')).toBeLessThan(0.05); // 离开淡出 ≈0
  });
});

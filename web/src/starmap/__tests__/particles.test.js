// 粒子系统单测：图像范围生成 / 落入眼位 / 未落位消失 / 90% 显现 / 20s 生命周期 / 速度 0 / 降级
import { describe, it, expect } from 'vitest';
import { ParticleSystem, DEGRADE_FPS, CYCLE_TOTAL } from '../particles.js';
const EMBLEM = {
  paths: [[{ x: -30, y: 0 }, { x: 30, y: 0 }]], // 一条横线（星座连线）
  slots: [
    { x: -30, y: 0 }, { x: -15, y: 0 }, { x: 0, y: 0 }, { x: 15, y: 0 }, { x: 30, y: 0 },
  ], // 5 个眼位
  offset: { x: 80, y: 0 },
  caption: '测试',
};

function makePs(opts = {}) {
  const ps = new ParticleSystem({ maxFlying: 30, ...opts });
  ps.setEmblems([{ ...EMBLEM }]);
  return ps;
}

describe('ParticleSystem 眼位填充', () => {
  it('星星在以节点为中心的大范围内随机生成', () => {
    const ps = makePs();
    const g = ps.groups[0];
    for (let i = 0; i < 20; i += 1) {
      const p = ps._spawnFlying(g);
      const d = Math.hypot(p.pos.x, p.pos.y);
      expect(d).toBeGreaterThanOrEqual(80);
      expect(d).toBeLessThanOrEqual(240);
    }
  });

  it('星星落入眼位：flying→slotting→locked 并计数', () => {
    const ps = makePs({ maxFlying: 1 });
    const g = ps.groups[0];
    const p = ps._spawnFlying(g);
    p.pos = { x: 80, y: 0 }; // 正好在眼位 (0,0)+offset(80,0) 上
    p.state = 'flying';
    g.particles = [p];
    ps.tick(1 / 60);
    expect(p.state).toBe('slotting'); // 捕获眼位
    for (let i = 0; i < 120; i += 1) ps.tick(1 / 60); // 落定
    expect(p.state).toBe('locked');
    expect(g.filled).toBe(1);
  });

  it('未落入眼位的星星飘出范围后消失', () => {
    const ps = makePs();
    const g = ps.groups[0];
    const p = ps._spawnFlying(g);
    p.state = 'flying';
    p.age = 0;
    p.pos = { x: 500, y: 500 }; // 远离所有眼位且超出生成范围
    g.particles = [p];
    ps.tick(1 / 60);
    expect(g.particles.includes(p)).toBe(false); // 已消失
  });

  it('初始完全透明；眼位填充达 90% 后图像显现', () => {
    const ps = makePs();
    const g = ps.groups[0];
    expect(ps.renderState().paths[0].alpha).toBe(0); // 初始完全透明
    for (const s of g.slots) s.occupied = true;
    g.filled = g.slots.length; // 100% ≥ 90%
    ps.tick(1 / 60);
    expect(g.reveal).toBe(true);
    expect(ps.renderState().paths[0].alpha).toBeGreaterThan(0.5); // 显现
  });

  it('生命周期满 20 秒后重置循环（重新透明、眼位清空）', () => {
    const ps = makePs({ maxFlying: 1 });
    const g = ps.groups[0];
    for (const s of g.slots) s.occupied = true;
    g.filled = g.slots.length;
    g.reveal = true;
    g.cycle = CYCLE_TOTAL - 0.001;
    ps.tick(1 / 60);
    expect(g.cycle).toBe(0); // 已重置
    expect(g.reveal).toBe(false);
    expect(g.filled).toBe(0); // 新星星一帧内尚未落定
    expect(g.particles.every((p) => p.state !== 'locked')).toBe(true);
  });

  it('速度 0 时完全不推进（不生成星星）', () => {
    const ps = makePs();
    ps.setSpeed(0);
    for (let i = 0; i < 60; i += 1) expect(ps.tick(1 / 60)).toBe(false);
    expect(ps.groups[0].particles.length).toBe(0);
  });

  it('renderState 返回路径/眼位/星星结构', () => {
    const ps = makePs();
    ps.tick(1 / 60);
    const st = ps.renderState();
    expect(Array.isArray(st.paths)).toBe(true);
    expect(Array.isArray(st.slots)).toBe(true);
    expect(Array.isArray(st.points)).toBe(true);
    expect(st.slots.length).toBe(5);
  });
});

describe('性能降级', () => {
  it('首次低帧率减半星星，再次低帧率自动关闭', () => {
    const ps = makePs({ maxFlying: 40 });
    ps._evaluate(DEGRADE_FPS - 5);
    expect(ps.degradeStage).toBe(1);
    expect(ps.maxFlying).toBe(20);
    ps._evaluate(DEGRADE_FPS - 5);
    expect(ps.degradeStage).toBe(2);
    expect(ps.autoOff).toBe(true);
    expect(ps.tick(1 / 60)).toBe(false);
  });

  it('帧率正常不降级；notePerformance 按窗口求值', () => {
    const ps = makePs();
    ps._evaluate(60);
    expect(ps.degradeStage).toBe(0);
    for (let i = 0; i < 100; i += 1) ps.notePerformance(0.02);
    expect(ps.degradeStage).toBe(0);
    for (let i = 0; i < 40; i += 1) ps.notePerformance(0.05);
    expect(ps.degradeStage).toBe(1);
    expect(ps.maxFlying).toBe(15);
  });
});

describe('随机序列（随机性优化）', () => {
  const spawnSeq = (ps, n) => {
    ps.setEmblems([{ ...EMBLEM }]);
    return Array.from({ length: n }, () => {
      const p = ps._spawnFlying(ps.groups[0]);
      return [p.pos.x, p.pos.y, p.phase, p.r];
    });
  };

  it('固定种子可复现：同 seed 生成序列相同', () => {
    const a = new ParticleSystem({ maxFlying: 8, seed: 123 });
    const b = new ParticleSystem({ maxFlying: 8, seed: 123 });
    expect(spawnSeq(a, 8)).toEqual(spawnSeq(b, 8));
  });

  it('不同种子生成序列不同', () => {
    const a = new ParticleSystem({ maxFlying: 8, seed: 123 });
    const b = new ParticleSystem({ maxFlying: 8, seed: 456 });
    expect(spawnSeq(a, 8)).not.toEqual(spawnSeq(b, 8));
  });

  it('setEmblems 重置随机序列（固定种子两次进入序列相同）', () => {
    const ps = new ParticleSystem({ maxFlying: 4, seed: 99 });
    expect(spawnSeq(ps, 4)).toEqual(spawnSeq(ps, 4));
  });

  it('默认无种子：每次 setEmblems 生成全新随机序列（每次进入特效不重复）', () => {
    const ps = new ParticleSystem({ maxFlying: 4 });
    expect(spawnSeq(ps, 4)).not.toEqual(spawnSeq(ps, 4));
  });
});

// 特效中心点选取测试：会话内稳定 / 刷新重随机 / 距离与避让约束
import { describe, it, expect } from 'vitest';
import {
  pickEmblemOffsets,
  DIST_MIN,
  DIST_MAX,
  GROUP_GAP,
  NODE_CLASH,
} from '../emblemOffsets.js';

function makeRenderer(others = {}) {
  const pos = new Map();
  for (const [id, p] of Object.entries(others)) pos.set(id, p);
  return { layout: { pos } };
}

describe('pickEmblemOffsets', () => {
  it('同一 centerId + 相同盐 → 结果稳定（会话内不跳变）', () => {
    const r = makeRenderer({ 'n.1': { x: 400, y: 0 } });
    const a = pickEmblemOffsets(r, 'math.1', 3, 777);
    const b = pickEmblemOffsets(r, 'math.1', 3, 777);
    expect(a).toEqual(b);
  });

  it('不同盐 → 分布不同（刷新页面后重新随机）', () => {
    const r = makeRenderer({});
    const a = pickEmblemOffsets(r, 'math.1', 3, 111);
    const b = pickEmblemOffsets(r, 'math.1', 3, 222);
    expect(a).not.toEqual(b);
  });

  it('不同 centerId → 分布不同', () => {
    const r = makeRenderer({});
    const a = pickEmblemOffsets(r, 'math.1', 3, 42);
    const b = pickEmblemOffsets(r, 'math.2', 3, 42);
    expect(a).not.toEqual(b);
  });

  it('所有中心点距节点在 DIST_MIN~DIST_MAX 内', () => {
    const r = makeRenderer({});
    const pts = pickEmblemOffsets(r, 'math.1', 4, 5);
    expect(pts.length).toBe(4);
    for (const p of pts) {
      const d = Math.hypot(p.x, p.y);
      expect(d).toBeGreaterThanOrEqual(DIST_MIN - 1e-9);
      expect(d).toBeLessThanOrEqual(DIST_MAX + 1e-9);
    }
  });

  it('组间互距 ≥ GROUP_GAP', () => {
    const r = makeRenderer({});
    const pts = pickEmblemOffsets(r, 'math.1', 3, 42);
    for (let i = 0; i < pts.length; i += 1) {
      for (let j = i + 1; j < pts.length; j += 1) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
        expect(d).toBeGreaterThanOrEqual(GROUP_GAP - 1e-9);
      }
    }
  });

  it('避开邻节点（距邻节点 ≥ NODE_CLASH）', () => {
    const r = makeRenderer({ 'n.1': { x: 130, y: 0 }, 'n.2': { x: -150, y: 0 } });
    const pts = pickEmblemOffsets(r, 'center', 3, 7);
    const others = [r.layout.pos.get('n.1'), r.layout.pos.get('n.2')];
    for (const p of pts) {
      for (const o of others) {
        expect(Math.hypot(p.x - o.x, p.y - o.y)).toBeGreaterThanOrEqual(NODE_CLASH - 1e-9);
      }
    }
  });

  it('邻节点过多时兜底仍返回 count 个点', () => {
    const others = {};
    for (let i = 0; i < 40; i += 1) {
      const a = (i / 40) * Math.PI * 2;
      others[`n.${i}`] = { x: Math.cos(a) * 140, y: Math.sin(a) * 140 };
    }
    const r = makeRenderer(others);
    expect(pickEmblemOffsets(r, 'center', 3, 8).length).toBe(3);
  });
});

// 矢量化模块纯函数单测：二值化 / Zhang-Suen 细化 / 骨架追踪 / 眼位提取 / 归一化
import { describe, it, expect } from 'vitest';
import { binarize, zhangSuenThin, traceSkeleton, extractSlots, toWorld } from '../emblemVector.js';

describe('binarize', () => {
  it('按亮度阈值二值化', () => {
    // 2x2 像素：亮 / 暗 / 透明 / 亮
    const rgba = new Uint8Array([
      255, 255, 255, 255, // 白
      10, 10, 10, 255, // 暗
      0, 0, 0, 0, // 透明
      200, 200, 200, 255, // 灰亮
    ]);
    const bin = binarize(rgba, 2, 2);
    expect(bin[0]).toBe(1);
    expect(bin[1]).toBe(0); // 暗
    expect(bin[2]).toBe(0); // 透明
    expect(bin[3]).toBe(1);
  });
});

describe('zhangSuenThin', () => {
  it('3 像素粗横线细化为 1 像素骨架', () => {
    const w = 12;
    const h = 10;
    const bin = new Uint8Array(w * h);
    for (let x = 1; x < w - 1; x += 1) {
      for (let y = 4; y <= 6; y += 1) bin[y * w + x] = 1; // 3 行粗横线（避开边界）
    }
    const skel = zhangSuenThin(bin, w, h);
    // 骨架为 1px 厚（每列最多 1 个骨架像素，未塌成 3px）
    for (let x = 1; x < w - 1; x += 1) {
      let col = 0;
      for (let y = 0; y < h; y += 1) col += skel[y * w + x];
      expect(col).toBeLessThanOrEqual(1);
    }
    // 线主体保留（端点可能被轻微侵蚀，属 Zhang-Suen 已知特性）
    const total = skel.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(5);
  });
});

describe('traceSkeleton', () => {
  it('水平骨架追踪为一条折线', () => {
    const w = 6;
    const h = 3;
    const skel = new Uint8Array(w * h);
    for (let x = 0; x < w; x += 1) skel[1 * w + x] = 1; // 一行横线
    const paths = traceSkeleton(skel, w, h);
    expect(paths.length).toBe(1);
    expect(paths[0].length).toBe(w); // 6 个点
  });
});

describe('extractSlots', () => {
  it('提取 L 形路径的端点与角点作为眼位', () => {
    // 路径坐标放大（> 去重半径 3），保证端点和角点不被合并
    const path = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 20, y: 20 },
    ];
    const slots = extractSlots([path], 40);
    expect(slots.length).toBeGreaterThanOrEqual(2); // 至少端点
    expect(slots.some((s) => Math.hypot(s.x - 0, s.y - 0) < 1)).toBe(true); // 起点
    expect(slots.some((s) => Math.hypot(s.x - 20, s.y - 20) < 1)).toBe(true); // 终点
    expect(slots.some((s) => Math.hypot(s.x - 20, s.y - 0) < 1)).toBe(true); // 角点
  });

  it('眼位过多时稀疏到上限', () => {
    const path = Array.from({ length: 100 }, (_, i) => ({ x: i, y: 0 }));
    const slots = extractSlots([path], 20);
    expect(slots.length).toBeLessThanOrEqual(20);
  });
});

describe('toWorld', () => {
  it('图像坐标归一化到 EMBLEM_BOX（中心原点）', () => {
    const pts = toWorld([{ x: 0, y: 0 }, { x: 100, y: 50 }], 100, 50);
    // scale = 150 / max(100,50) = 1.5
    expect(pts[0].x).toBeCloseTo(-75);
    expect(pts[0].y).toBeCloseTo(-37.5);
    expect(pts[1].x).toBeCloseTo(75);
    expect(pts[1].y).toBeCloseTo(37.5);
  });
});

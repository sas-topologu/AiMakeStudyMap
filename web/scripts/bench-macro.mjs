// 宏观视图压测（Node 端）：2000 合成节点，stub Canvas 2D 上下文，
// 测量渲染器每帧 JS 侧开销（场景计算 + 绘制命令发射；不含浏览器 GPU 光栅）。
// 用法：node web/scripts/bench-macro.mjs [节点数] [帧数]
import { MacroRenderer, LOD, lodWeights } from '../src/starmap/macroRenderer.js';
import { layoutConstellation, makeSyntheticGraph } from '../src/starmap/macroLayout.js';

const N = Number(process.argv[2]) || 2000;
const FRAMES = Number(process.argv[3]) || 200;

// ---- stub canvas / ctx ----
const gradient = { addColorStop() {} };
const stubCtx = new Proxy(
  {},
  {
    get: (t, p) => {
      if (p === 'createRadialGradient' || p === 'createLinearGradient') return () => gradient;
      return () => {};
    },
    set: () => true,
  },
);
const stubCanvas = { width: 0, height: 0, getContext: () => stubCtx };

// ---- 数据 ----
const tLayout0 = performance.now();
const g = makeSyntheticGraph(N, { subjectCount: 1 });
const pos = layoutConstellation(g.nodes, g.edges);
const tLayout = performance.now() - tLayout0;

const renderer = new MacroRenderer(stubCanvas);
renderer.resize(1280, 800, 1);
renderer.setConstellation({ nodes: g.nodes, edges: g.edges, pos });

// 视野适配（与 MapView 同逻辑）
let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
for (const p of pos.values()) {
  x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
  x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
}
const fitScale = Math.min(1280 / (x1 - x0 + 240), 800 / (y1 - y0 + 240));

function runBand(name, scale) {
  renderer.camera.x = (x0 + x1) / 2;
  renderer.camera.y = (y0 + y1) / 2;
  renderer.camera.scale = scale;
  // 预热
  for (let i = 0; i < 5; i += 1) renderer.render();
  const t0 = performance.now();
  for (let i = 0; i < FRAMES; i += 1) {
    // 帧间小幅平移，模拟真实交互（裁剪集合随之变化）
    renderer.camera.x += Math.sin(i / 20) * 6;
    renderer.camera.y += Math.cos(i / 25) * 4;
    renderer.render();
  }
  const ms = (performance.now() - t0) / FRAMES;
  const w = lodWeights(scale);
  const lod = w.cluster > 0.5 ? '星团档' : w.node > 0.5 ? '节点档' : '过渡档';
  console.log(
    `${name}（scale=${scale.toFixed(2)}，${lod}）：平均 ${ms.toFixed(3)} ms/帧 ≈ ${Math.min(999, Math.round(1000 / ms))} fps（JS 侧）`,
  );
  return ms;
}

console.log(`合成数据：${N} 节点 / ${g.edges.length} 边；布局耗时 ${tLayout.toFixed(1)} ms；fitScale=${fitScale.toFixed(3)}`);
console.log(`LOD 阈值：星团档 scale<${LOD.CLUSTER}，节点档 scale>${LOD.NODE}`);
const bands = [
  ['远', Math.max(0.05, fitScale * 0.8)],
  ['中', (LOD.CLUSTER + LOD.NODE) / 2],
  ['近', LOD.NODE * 1.6],
];
const results = bands.map(([name, s]) => runBand(name, s));
const worst = Math.max(...results);
console.log(`\n最差档 ${worst.toFixed(3)} ms/帧 → 约 ${Math.round(1000 / worst)} fps（>60fps 视为达标）`);

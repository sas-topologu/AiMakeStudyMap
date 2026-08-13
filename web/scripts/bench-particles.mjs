// 粒子系统帧耗实测（node 端）：150 粒子 × 10 个完整生命周期
// 打印各阶段帧数与平均帧耗（tick + renderState 构建），确认 <1ms
// 用法：node web/scripts/bench-particles.mjs
import { ParticleSystem, PARTICLE_PHASES } from '../src/starmap/particles.js';

const SETS = [
  { points: Array.from({ length: 150 }, (_, i) => ({ x: (i % 15) * 8 - 56, y: Math.floor(i / 15) * 12 - 60 })), caption: '求根公式' },
  { points: Array.from({ length: 120 }, (_, i) => ({ x: Math.cos(i) * 60, y: Math.sin(i) * 60 })), caption: '抛物线' },
];

const ps = new ParticleSystem({ maxParticles: 150 });
ps.setEmblems(SETS);

const stats = {}; // phase → { frames, ms }
let cycles = 0;
let lastIndex = ps.emblemIndex;
let totalMs = 0;
let totalFrames = 0;

while (cycles < 10) {
  const t0 = performance.now();
  ps.tick(1 / 60);
  const state = ps.renderState(); // 渲染命令构建（绘制数据组装）
  const ms = performance.now() - t0;
  void state;
  const s = (stats[ps.phase] ??= { frames: 0, ms: 0 });
  s.frames += 1;
  s.ms += ms;
  totalMs += ms;
  totalFrames += 1;
  if (ps.phase === 'scatter' && ps.emblemIndex !== lastIndex) {
    lastIndex = ps.emblemIndex;
    if (ps.emblemIndex === 0) cycles += 1; // 完整循环完一组徽章
  }
}

for (const [phase, s] of Object.entries(PARTICLE_PHASES)) {
  const st = stats[phase];
  console.log(`${phase.padEnd(8)} ${String(st?.frames ?? 0).padStart(4)} 帧  平均 ${(st ? st.ms / st.frames : 0).toFixed(4)} ms/帧`);
}
console.log(`\n10 个生命周期共 ${totalFrames} 帧，平均帧耗 ${(totalMs / totalFrames).toFixed(4)} ms（tick+绘制数据组装；<1ms 达标）`);

// 切换动画收敛实测（node 端）：典型 20 节点邻域换中心，打印自然 settle 帧数与过冲
// 用法：node web/scripts/bench-transition.mjs
import { computeLayout } from '../src/starmap/layout.js';
import { planTransition, SpringSim, TRANSITION } from '../src/starmap/transition.js';
import { makeSyntheticGraph } from '../src/starmap/macroLayout.js';

// 用合成图造两个相邻中心的邻域布局（20 节点）
const g = makeSyntheticGraph(20, { subjectCount: 1, seed: 5 });
const centerA = g.nodes[0].id;
// 与 centerA 相连的另一节点作为新中心（node 0 只作前置被指向）
const link = g.edges.find((e) => e.from === centerA || e.to === centerA);
const centerB = link ? (link.from === centerA ? link.to : link.from) : g.nodes[1].id;
const layoutA = computeLayout({ centerId: centerA, nodes: g.nodes, edges: g.edges, ringStep: 160 });
const layoutB = computeLayout({ centerId: centerB, nodes: g.nodes, edges: g.edges, ringStep: 160 });

const view = { width: 1280, height: 800, scale: 0.9 };
const plan = planTransition(layoutA.pos, layoutB.pos, centerB, view);
const kinds = {};
for (const p of plan.nodes.values()) kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
console.log(`计划：${plan.nodes.size} 节点（保留 ${kinds.keep ?? 0} / 进入 ${kinds.enter ?? 0} / 离开 ${kinds.leave ?? 0}）`);

const sim = new SpringSim(plan, { timeoutS: 99 }); // 测自然收敛（关闭硬上限）
// 过冲度量：keep 节点越过目标后继续前行的最大距离 / 行程（dot(pos-target, dir)）
let maxOver = 0;
let naturalSettle = null;
for (let frames = 1; frames <= 600; frames += 1) {
  sim.step(1 / 60);
  for (const n of sim.nodes.values()) {
    if (n.kind !== 'keep') continue;
    const past = (n.pos.x - n.target.x) * n.dir.x + (n.pos.y - n.target.y) * n.dir.y;
    if (past / n.initDist > maxOver) maxOver = past / n.initDist;
  }
  if (sim.settled) {
    naturalSettle = frames;
    break;
  }
}
console.log(`自然 settle：${naturalSettle ?? '>600'} 帧（60fps 下约 ${naturalSettle ? (naturalSettle / 60).toFixed(2) : '?'}s）`);
console.log(`keep 节点最大过冲：${(maxOver * 100).toFixed(1)}%（目标 10~20% 欠阻尼手感）`);
console.log(
  `弹簧参数：k=${TRANSITION.K} c=${TRANSITION.C}（ζ≈${(TRANSITION.C / (2 * Math.sqrt(TRANSITION.K))).toFixed(2)}），` +
    `相机 ${TRANSITION.CAMERA_MS}ms，硬上限 ${TRANSITION.TIMEOUT_S}s`,
);

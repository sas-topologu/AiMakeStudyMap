// 中心视图切换动画（优化方案 3.1）：纯逻辑，可单测
// 语义：切换中心节点时，旧中心平滑让位、新中心被"拉"到屏幕中心；
//      保留节点被牵引到新位置（允许中途离开象限），离开节点甩出屏幕，进入节点从屏外拉入。
// 模型：每节点弹簧-阻尼（半隐式欧拉，欠阻尼 → 惯性+弹性手感）+ 节点对碰撞排斥（恢复系数）。
// 全部 settle（速度+偏移双阈值）后调用方回落到精确布局坐标。
const DEG = Math.PI / 180;

export const TRANSITION = {
  K: 110, // 弹簧刚度（ω≈10.5，自由飞行收敛 ~50 帧）
  C: 10.5, // 阻尼（ζ≈0.50 → 自由飞行过冲约 16%，欠阻尼手感）
  RESTITUTION: 0.4, // 碰撞恢复系数
  REST_EPS: 15, // 相对速度低于该值时用 0 恢复系数（消除静止接触的微弹跳极限环）
  MAX_IMPULSE: 320, // 单次碰撞冲量上限（防高速飞行节点把保留节点踢飞）
  MIN_DIST: 46, // 最小间距（世界单位），小于则排斥
  SETTLE_VEL: 3, // settle 速度阈值（世界单位/秒）
  SETTLE_OFF: 0.6, // settle 偏移阈值（世界单位）
  LEAVE_PROGRESS: 0.85, // 离开节点飞出该进度即视为完成（已在视口外，不再参与判定）
  VMAX: 900, // 速度钳制（世界单位/秒）：屏外进出的长行程弹簧会积累高速，限制碰撞能量
  TIMEOUT_S: 1.0, // 动画硬上限：到点把滞留节点吸附到目标，保证 settle（UI 动画不允许多体卡死）
  CAMERA_MS: 600, // 相机过渡时长
  MAX_NODES: 80, // 性能红线：超过则退化为瞬排（防御，当前深度 3 邻域远达不到）
  OFFSCREEN_RATIO: 1.2, // 屏外距离 = 视口半对角线（世界单位）× 1.2
  DT_CLAMP: 1 / 30, // dt 上限（防后台切回大跳）
};

// 节点在布局中的方位角（优先布局角度，退回位置向量角；原点回退 0°）
function dirAngleOf(p) {
  if (Number.isFinite(p?.angle)) return p.angle * DEG;
  return Math.atan2(p?.y ?? 0, p?.x ?? 1);
}

// oldPos/newPos: Map<id, {x, y, angle?}>；view: { width, height, scale }
// 返回 { nodes: Map<id, { from, to, kind: 'keep'|'enter'|'leave' }> }；不做动画返回 null
export function planTransition(
  oldPos,
  newPos,
  centerId,
  view,
  { enabled = true, maxNodes = TRANSITION.MAX_NODES } = {},
) {
  if (!enabled || !oldPos || !newPos || oldPos.size === 0) return null;
  const ids = new Set([...oldPos.keys(), ...newPos.keys()]);
  if (ids.size > maxNodes) return null;

  const off = ((Math.hypot(view.width, view.height) / 2) * TRANSITION.OFFSCREEN_RATIO) / (view.scale || 1);
  const nodes = new Map();
  for (const id of ids) {
    const o = oldPos.get(id);
    const n = newPos.get(id);
    if (o && n) {
      nodes.set(id, { from: { x: o.x, y: o.y }, to: { x: n.x, y: n.y }, kind: 'keep' });
    } else if (n) {
      // 进入：沿新象限方向从视口对角线外 20% 处拉入
      const a = dirAngleOf(n);
      nodes.set(id, {
        from: { x: Math.cos(a) * off, y: Math.sin(a) * off },
        to: { x: n.x, y: n.y },
        kind: 'enter',
      });
    } else {
      // 离开：沿旧象限方向甩出屏外（到达后调用方不再绘制）
      const a = dirAngleOf(o);
      nodes.set(id, {
        from: { x: o.x, y: o.y },
        to: { x: Math.cos(a) * off, y: Math.sin(a) * off },
        kind: 'leave',
      });
    }
  }
  return { nodes, centerId };
}

export class SpringSim {
  constructor(plan, opts = {}) {
    this.k = opts.k ?? TRANSITION.K;
    this.c = opts.c ?? TRANSITION.C;
    this.restitution = opts.restitution ?? TRANSITION.RESTITUTION;
    this.minDist = opts.minDist ?? TRANSITION.MIN_DIST;
    this.settleVel = opts.settleVel ?? TRANSITION.SETTLE_VEL;
    this.settleOff = opts.settleOff ?? TRANSITION.SETTLE_OFF;
    this.leaveProgress = opts.leaveProgress ?? TRANSITION.LEAVE_PROGRESS;
    this.vmax = opts.vmax ?? TRANSITION.VMAX;
    this.restEps = opts.restEps ?? TRANSITION.REST_EPS;
    this.maxImpulse = opts.maxImpulse ?? TRANSITION.MAX_IMPULSE;
    this.timeoutS = opts.timeoutS ?? TRANSITION.TIMEOUT_S;
    this.elapsed = 0;
    this.settled = false;
    this.nodes = new Map();
    for (const [id, p] of plan.nodes) {
      const initDist = Math.max(1, Math.hypot(p.to.x - p.from.x, p.to.y - p.from.y));
      this.nodes.set(id, {
        pos: { ...p.from },
        vel: { x: 0, y: 0 },
        target: p.to,
        kind: p.kind,
        initDist,
        dir: { x: (p.to.x - p.from.x) / initDist, y: (p.to.y - p.from.y) / initDist }, // 初始方向
      });
    }
  }

  step(dt) {
    dt = Math.min(Math.max(dt, 0), TRANSITION.DT_CLAMP);
    if (dt === 0 || this.settled) return;
    this.elapsed += dt;

    // 硬上限：到点把滞留节点吸附到目标（离开节点直接视为飞出完成）
    if (this.elapsed >= this.timeoutS) {
      for (const n of this.nodes.values()) {
        n.pos.x = n.target.x;
        n.pos.y = n.target.y;
        n.vel.x = 0;
        n.vel.y = 0;
      }
      this.settled = true;
      return;
    }

    // 弹簧-阻尼（半隐式欧拉：先速度后位置）+ 速度钳制
    for (const n of this.nodes.values()) {
      const ax = -this.k * (n.pos.x - n.target.x) - this.c * n.vel.x;
      const ay = -this.k * (n.pos.y - n.target.y) - this.c * n.vel.y;
      n.vel.x += ax * dt;
      n.vel.y += ay * dt;
      const speed = Math.hypot(n.vel.x, n.vel.y);
      if (speed > this.vmax) {
        n.vel.x *= this.vmax / speed;
        n.vel.y *= this.vmax / speed;
      }
      n.pos.x += n.vel.x * dt;
      n.pos.y += n.vel.y * dt;
    }

    // 碰撞排斥（O(n²)，n 仅几十）：重叠时法向冲量（恢复系数）+ 软排斥力（有界，不泵能）
    const arr = [...this.nodes.values()];
    for (let i = 0; i < arr.length; i += 1) {
      for (let j = i + 1; j < arr.length; j += 1) {
        const a = arr[i];
        const b = arr[j];
        let dx = b.pos.x - a.pos.x;
        let dy = b.pos.y - a.pos.y;
        let d = Math.hypot(dx, dy);
        if (d >= this.minDist) continue;
        if (d < 1e-6) {
          dx = 1;
          dy = 0;
          d = 1; // 完全重叠：沿 x 轴确定性分离
        }
        const nx = dx / d;
        const ny = dy / d;
        const overlap = this.minDist - d;
        // 法向相对速度冲量（仅相互接近时；低速接触用 0 恢复系数消除微弹跳，冲量限幅防踢飞）
        const vrel = (b.vel.x - a.vel.x) * nx + (b.vel.y - a.vel.y) * ny;
        if (vrel < 0) {
          const e = -vrel < this.restEps ? 0 : this.restitution;
          const imp = Math.min((-(1 + e) * vrel) / 2, this.maxImpulse);
          a.vel.x -= imp * nx;
          a.vel.y -= imp * ny;
          b.vel.x += imp * nx;
          b.vel.y += imp * ny;
        }
        // 位置分离：低强度 + slop（只修正超出 0.5 的重叠，防穿插且不向静止接触泵能）
        const corr = (Math.max(overlap - 0.5, 0) * 0.4) / 2;
        if (corr > 0) {
          a.pos.x -= nx * corr;
          a.pos.y -= ny * corr;
          b.pos.x += nx * corr;
          b.pos.y += ny * corr;
        }
      }
    }

    // settle 判定：保留/进入节点看速度+偏移双阈值；离开节点飞出视口（进度≥阈值）即算完成
    this.settled = [...this.nodes.values()].every((n) => {
      if (n.kind === 'leave') return this._progress(n) >= this.leaveProgress;
      return (
        Math.hypot(n.vel.x, n.vel.y) < this.settleVel &&
        Math.hypot(n.pos.x - n.target.x, n.pos.y - n.target.y) < this.settleOff
      );
    });
  }

  _progress(n) {
    return Math.min(
      1,
      Math.max(0, 1 - Math.hypot(n.pos.x - n.target.x, n.pos.y - n.target.y) / n.initDist),
    );
  }

  // 当前动态坐标（渲染层读取；leave 节点 settle 前始终在图中）
  positions() {
    const out = new Map();
    for (const [id, n] of this.nodes) out.set(id, { x: n.pos.x, y: n.pos.y });
    return out;
  }

  // 淡入淡出：进入 0→1，离开 1→0，保留恒 1
  alphaOf(id) {
    const n = this.nodes.get(id);
    if (!n) return 1;
    const progress = this._progress(n);
    if (n.kind === 'enter') return progress;
    if (n.kind === 'leave') return 1 - progress;
    return 1;
  }
}

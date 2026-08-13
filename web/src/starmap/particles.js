// 星座眼位填充粒子系统
//   1. 图像/公式矢量化：浅色细线（paths）+ 关键点（slots 眼位），以中心坐标 offset 为原点
//   2. 两段引力：大范围弱引力（远处中心=图像中心，缓慢牵引）→ 图像邻域内转向目标切换为最近空眼位 →
//      小范围强引力（STRONG_R 内，中心=眼位，强力吸入），与眼位重合（< 0.8）才停止（locked）
//   3. 星星在以节点为中心的大范围内随机生成；完整生命周期 20s：填充 ≥90% 显现 → 保持 → 重置
//   4. 星星带呼吸闪烁（明暗渐变）
// 性能红线：速度 0 / autoOff 时 tick 不推进；FPS 采样自动降级（星星减半→自动关闭）
import { mulberry32 } from './macroLayout.js';

export const MAX_GROUPS = 3; // 同时拼形的特效组数上限
export const MAX_FLYING = 16; // 每组活跃星星数（≈ 眼位数）
export const FLY_SPEED = 52; // 星星飞行速度（世界/秒；5s 内可飞行 ~260，覆盖到最远生成区）
export const WEAK_R = 260; // 大范围弱引力半径（覆盖整个生成区 240，所有星星被缓慢牵引向图像）
export const WEAK_TURN = 1.5; // 远处弱引力转向速率（rad/s，速度方向缓慢转向图像中心）
export const IMAGE_R = 95; // 图像邻域半径：进入后弱引力转向目标从图像中心切换为最近空眼位（眼位在图像内容上，中心=眼位）
export const TURN_NEAR = 3.2; // 图像邻域内转向速率（更快对准最近空眼位，保证进入强引力区）
export const STRONG_R = 40; // 小范围强引力半径（眼位，中心=眼位）
export const STRONG_G = 140; // 强引力加速度
export const STRONG_DAMP = 3.2; // 强引力阻尼（收敛，接近眼位减速）
export const FLY_TIMEOUT = 8; // 未落位超时（秒）→ 消失（含转向飞行时间）
export const REVEAL_RATIO = 0.9; // 眼位填充比例达此值 → 图像显现
export const CYCLE_TOTAL = 20; // 完整生命周期（秒）
export const DISMISS_S = 1.2; // 生命周期结束后的消散时长（星星淡出 → 重组，避免瞬间重置）
export const DEGRADE_FPS = 30;
export const DEGRADE_WINDOW_S = 2;

const SPAWN_R_MIN = 80; // 星星生成范围：以节点为中心，内半径
const SPAWN_R_MAX = 240; // 生成范围外半径（大范围，与图像分布上限一致）
const AIM_WEIGHT = 0.7; // 生成方向偏向本组图像中心的比例（其余随机）

// 不可预测种子（时间戳 + 熵）：无 seed 注入时每次 setEmblems 都得到全新随机序列
export function randomSeed() {
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}

export class ParticleSystem {
  constructor({ maxFlying = MAX_FLYING, seed = null } = {}) {
    this.maxFlying = maxFlying;
    this.baseMax = maxFlying;
    this.seed = seed; // 固定种子=可复现（测试用）；null=每次 setEmblems 用新随机序列
    this.speed = 1; // 0 | 0.5 | 1 | 2（0=完全关闭）
    this.groups = []; // [{ em, slots:[{x,y,occupied}], filled, reveal, cycle, box, particles }]
    this.time = 0;
    this.autoOff = false;
    this.degradeStage = 0;
    this._fpsT = 0;
    this._fpsFrames = 0;
    this.rand = mulberry32(seed ?? randomSeed());
  }

  // 设置星座组并重启（每次进入节点都使用全新随机序列，特效不重复）
  setEmblems(list) {
    this.groups = (list ?? [])
      .filter((e) => e.slots?.length)
      .slice(0, MAX_GROUPS)
      .map((em) => ({
        em,
        slots: em.slots.map((s) => ({ x: s.x, y: s.y, occupied: false })),
        filled: 0,
        reveal: false,
        cycle: 0,
        dismissing: false, // 消散相：星星淡出后重组
        dismissT: 0,
        particles: [],
      }));
    this.time = 0;
    this.rand = mulberry32(this.seed ?? randomSeed()); // 重置随机序列
  }

  setSpeed(v) {
    this.speed = v;
  }

  _resetGroup(g) {
    g.cycle = 0;
    g.filled = 0;
    g.reveal = false;
    g.dismissing = false;
    g.dismissT = 0;
    for (const s of g.slots) s.occupied = false;
    g.particles = []; // 重新生成
  }

  // 最近的空眼位（世界坐标）
  _nearestEmpty(g, pos) {
    const ox = g.em.offset.x;
    const oy = g.em.offset.y;
    let best = null;
    let bd = Infinity;
    for (const s of g.slots) {
      if (s.occupied) continue;
      const d = Math.hypot(s.x + ox - pos.x, s.y + oy - pos.y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return { slot: best, dist: bd };
  }

  // 在以节点为中心的大范围内随机生成一颗星星；方向偏向本组图像中心（带随机扰动）
  _spawnFlying(g) {
    const a = this.rand() * Math.PI * 2;
    const r = SPAWN_R_MIN + this.rand() * (SPAWN_R_MAX - SPAWN_R_MIN);
    const pos = { x: Math.cos(a) * r, y: Math.sin(a) * r };
    const ox = g.em.offset.x;
    const oy = g.em.offset.y;
    let ang = this.rand() * Math.PI * 2;
    if (this.rand() < AIM_WEIGHT) {
      const aim = Math.atan2(oy - pos.y, ox - pos.x);
      ang = aim + (this.rand() - 0.5) * 1.6; // 朝图像中心 + ±0.8 rad 扰动
    }
    return {
      pos,
      vel: { x: Math.cos(ang) * FLY_SPEED, y: Math.sin(ang) * FLY_SPEED },
      state: 'flying', // flying → slotting(引力) → locked
      age: 0,
      alpha: 0,
      phase: this.rand() * Math.PI * 2, // 明暗渐变相位（错开）
      group: g,
      slot: null,
      r: 1.6 + this.rand() * 0.6,
    };
  }

  _findNearSlot(g, pos, radius = STRONG_R) {
    const ox = g.em.offset.x;
    const oy = g.em.offset.y;
    let best = null;
    let bd = radius;
    for (const s of g.slots) {
      if (s.occupied) continue;
      const d = Math.hypot(s.x + ox - pos.x, s.y + oy - pos.y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  _inRange(pos) {
    // 生成范围上限一致：离节点过远视为出界消失
    return Math.hypot(pos.x, pos.y) <= SPAWN_R_MAX + 60;
  }

  // 推进一帧；返回是否活跃
  tick(rawDt) {
    if (this.speed === 0 || this.autoOff || this.groups.length === 0) return false;
    const dt = Math.min(rawDt, 1 / 30) * this.speed;
    this.time += dt;

    for (const g of this.groups) {
      // 消散相：星星淡出，结束再真正重置（重组）
      if (g.dismissing) {
        g.dismissT -= dt;
        for (const p of g.particles) p.alpha = Math.max(0, p.alpha - dt * 2.5);
        if (g.dismissT <= 0) this._resetGroup(g);
        continue;
      }
      g.cycle += dt;
      if (g.cycle >= CYCLE_TOTAL) {
        // 生命周期结束 → 进入消散相（星星淡出后重组，不瞬间消失）
        g.dismissing = true;
        g.dismissT = DISMISS_S;
        continue;
      }

      // 补足星星
      while (g.particles.length < this.maxFlying) g.particles.push(this._spawnFlying(g));

      // 更新星星
      for (let i = g.particles.length - 1; i >= 0; i -= 1) {
        const p = g.particles[i];
        p.age += dt;
        if (p.state === 'flying') {
          p.pos.x += p.vel.x * dt;
          p.pos.y += p.vel.y * dt;
          // 两段弱引力转向：远处（大范围）中心=图像中心；进入图像邻域后中心=最近空眼位
          const cdx = g.em.offset.x - p.pos.x;
          const cdy = g.em.offset.y - p.pos.y;
          const dc = Math.hypot(cdx, cdy);
          let tx = g.em.offset.x;
          let ty = g.em.offset.y;
          let turnRate = WEAK_TURN;
          if (dc < IMAGE_R) {
            // 进入图像邻域：对准最近空眼位（保证进入强引力捕获区）
            const ne = this._nearestEmpty(g, p.pos);
            if (ne.slot) {
              tx = ne.slot.x + g.em.offset.x;
              ty = ne.slot.y + g.em.offset.y;
              turnRate = TURN_NEAR;
            }
          }
          if (dc > 0.01 && dc < WEAK_R) {
            const aimAng = Math.atan2(ty - p.pos.y, tx - p.pos.x);
            const curAng = Math.atan2(p.vel.y, p.vel.x);
            let da = aimAng - curAng;
            while (da > Math.PI) da -= Math.PI * 2;
            while (da < -Math.PI) da += Math.PI * 2;
            const turn = Math.max(-turnRate * dt, Math.min(turnRate * dt, da));
            const na = curAng + turn;
            const sp = Math.hypot(p.vel.x, p.vel.y);
            p.vel.x = Math.cos(na) * sp;
            p.vel.y = Math.sin(na) * sp;
          }
          // 小范围强引力（中心=眼位）：进入 STRONG_R 内的空眼位 → 强力吸入
          const strong = this._findNearSlot(g, p.pos, STRONG_R);
          if (strong) {
            p.state = 'slotting';
            p.slot = strong;
            strong.occupied = true;
          } else if (p.age > FLY_TIMEOUT || !this._inRange(p.pos)) {
            g.particles.splice(i, 1); // 未落位 → 消失
            continue;
          } else {
            p.alpha = Math.min(0.5, p.alpha + dt * 2);
          }
        } else if (p.state === 'slotting') {
          // 小范围强引力：向眼位强力吸入，与眼位重合才停止
          const sx = p.slot.x + g.em.offset.x;
          const sy = p.slot.y + g.em.offset.y;
          const dx = sx - p.pos.x;
          const dy = sy - p.pos.y;
          p.vel.x += dx * STRONG_G * dt;
          p.vel.y += dy * STRONG_G * dt;
          p.vel.x *= 1 - STRONG_DAMP * dt;
          p.vel.y *= 1 - STRONG_DAMP * dt;
          p.pos.x += p.vel.x * dt;
          p.pos.y += p.vel.y * dt;
          p.alpha = Math.min(0.95, p.alpha + dt * 3);
          if (Math.hypot(dx, dy) < 0.8) {
            p.state = 'locked'; // 与眼位重合 → 停止
            g.filled += 1;
          } else if (p.slotAge === undefined) {
            p.slotAge = 0;
          } else {
            p.slotAge += dt;
            // 收敛保险：长时间未到重合（数值振荡）→ 直接落位，避免卡死占用眼位
            if (p.slotAge > 2.5) {
              p.pos.x = sx;
              p.pos.y = sy;
              p.state = 'locked';
              g.filled += 1;
            }
          }
        }
        // locked：停留在眼位
      }

      // 显现判定
      if (!g.reveal && g.slots.length > 0 && g.filled / g.slots.length >= REVEAL_RATIO) {
        g.reveal = true;
      }
    }
    return true;
  }

  // 渲染状态：星座连线（细线）+ 眼位 + 星星
  renderState() {
    const paths = [];
    const captions = [];
    const slots = [];
    const points = [];
    for (const g of this.groups) {
      const ox = g.em.offset.x;
      const oy = g.em.offset.y;
      // 消散相：星座线与标题随星星一起淡出（1 → 0）
      const dismissK = g.dismissing ? Math.max(0, g.dismissT / DISMISS_S) : 1;
      const lineAlpha = g.reveal ? 0.7 * dismissK : 0; // 初始完全透明，填满后显现
      for (const path of g.em.paths) {
        paths.push({
          points: path.map((pt) => ({ x: pt.x + ox, y: pt.y + oy })),
          alpha: lineAlpha,
        });
      }
      for (const s of g.slots) {
        slots.push({ x: s.x + ox, y: s.y + oy, occupied: s.occupied });
      }
      if (g.em.caption) {
        captions.push({ text: g.em.caption, alpha: g.reveal ? 0.75 * dismissK : 0, x: ox, y: oy + 92 });
      }
    }
    for (const g of this.groups) {
      for (const p of g.particles) {
        // 明暗渐变：呼吸闪烁，相位错开
        const twinkle = 0.75 + 0.25 * Math.sin(this.time * 3 + p.phase * 6);
        points.push({ x: p.pos.x, y: p.pos.y, alpha: p.alpha * twinkle, r: p.r, state: p.state });
      }
    }
    return { paths, captions, slots, points };
  }

  // 性能采样：调用方传未缩放的原始 dt；返回当前降级阶段
  notePerformance(rawDt) {
    if (this.autoOff) return this.degradeStage;
    this._fpsT += rawDt;
    this._fpsFrames += 1;
    if (this._fpsT >= DEGRADE_WINDOW_S) {
      const fps = this._fpsFrames / this._fpsT;
      this._fpsT = 0;
      this._fpsFrames = 0;
      this._evaluate(fps);
    }
    return this.degradeStage;
  }

  _evaluate(fps) {
    if (fps >= DEGRADE_FPS || this.autoOff) return this.degradeStage;
    if (this.degradeStage === 0) {
      this.degradeStage = 1;
      this.maxFlying = Math.ceil(this.maxFlying / 2);
      for (const g of this.groups) g.particles.length = Math.min(g.particles.length, this.maxFlying);
    } else {
      this.degradeStage = 2;
      this.autoOff = true;
    }
    return this.degradeStage;
  }
}

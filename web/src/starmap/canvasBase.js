// Canvas 共享基座：相机变换（pan/zoom、toWorld/toScreen）、星空背景、视口计算、星点绘制
// 中心视图（renderer.js）与宏观视图（macroRenderer.js）共用；
// 阶段 5 的路线高亮、阶段 6 的分享导出也应基于本类扩展。

export const STATE_STYLE = {
  dim: { fill: '#454b5e', alpha: 0.9, glow: 0, glowColor: 'transparent' },
  open: { fill: '#8fb4ec', alpha: 1, glow: 9, glowColor: 'rgba(143,180,236,0.55)' },
  passed: { fill: '#f4d58d', alpha: 1, glow: 14, glowColor: 'rgba(244,213,141,0.6)' },
  lit: { fill: '#fff7cf', alpha: 1, glow: 26, glowColor: 'rgba(255,240,180,0.85)' },
};

export const CRED_STROKE = {
  verified: '#34d399',
  disputed: '#fbbf24',
};

// 是否移动端（触摸优先 / 小屏）——用于性能降级
export function isMobileLike() {
  try {
    const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
    const small = Math.min(window.innerWidth || 9999, window.innerHeight || 9999) <= 820;
    return Boolean(coarse || small);
  } catch {
    return false;
  }
}

// 画布像素比上限：手机常见 3x，画布面积是 2x 的 2.25 倍，是卡顿主因；
// 限制到 1.5（移动）/ 2（桌面）可显著降低填充压力，肉眼几乎无差别。
export function cappedDpr() {
  const raw = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  return Math.min(raw, isMobileLike() ? 1.5 : 2);
}

// 动画帧间隔（毫秒）：移动端 20fps、桌面 30fps，控制 CPU/GPU 占用
export function frameIntervalMs() {
  return isMobileLike() ? 50 : 33;
}

// 四角星路径（星空星星样貌：上下左右四个尖角，内凹在 k·r 处）
export function star4Path(ctx, x, y, r, k = 0.32) {
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * k, y - r * k);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x + r * k, y + r * k);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r * k, y + r * k);
  ctx.lineTo(x - r, y);
  ctx.lineTo(x - r * k, y - r * k);
  ctx.closePath();
}

// 十字星芒（星空星光样貌）：核心亮点 + 上下左右四条细长星芒
export function drawSparkleStar(ctx, x, y, r, { arm = 4, core = 1, fill = '#eef3ff' } = {}) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  // 水平星芒
  ctx.moveTo(x - r * arm, y);
  ctx.lineTo(x, y - r * core);
  ctx.lineTo(x + r * arm, y);
  ctx.lineTo(x, y + r * core);
  ctx.closePath();
  ctx.fill();
  // 垂直星芒
  ctx.beginPath();
  ctx.moveTo(x, y - r * arm);
  ctx.lineTo(x - r * core, y);
  ctx.lineTo(x, y + r * arm);
  ctx.lineTo(x + r * core, y);
  ctx.closePath();
  ctx.fill();
  // 核心亮点
  ctx.beginPath();
  ctx.arc(x, y, r * 0.9, 0, Math.PI * 2);
  ctx.fill();
}

export class CanvasStage {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = { x: 0, y: 0, scale: 1, rot: 0 }; // x/y：屏幕中心对应的世界坐标；rot：视口旋转角（弧度）
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.stars = [];
    this._makeStars();
  }

  resize(w, h, dpr) {
    this.width = w;
    this.height = h;
    this.dpr = dpr || 1;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // 屏幕恒定文字：位置给世界坐标，自动转屏幕空间——
  // 视口旋转时文字始终保持水平（toScreen 已含旋转位置，此处不再反向旋转），字号恒定为屏幕像素。
  // 关键：先复位到屏幕空间（仅保留 dpr 缩放），否则在世界变换里 translate 会二次缩放/偏移，
  // 导致放大时字号膨胀、文字跑出视口（缩小看极小、放大后消失）；再旋转会随视口一起转。
  drawScreenText(txt, wx, wy, { font, fill, align = 'center', baseline = 'middle' } = {}) {
    const p = this.toScreen(wx, wy);
    const { ctx } = this;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.translate(p.x, p.y);
    ctx.font = font;
    ctx.fillStyle = fill;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(txt, 0, 0);
    ctx.restore();
  }

  // ---- 坐标变换 ----
  toWorld(sx, sy) {    const { x, y, scale, rot = 0 } = this.camera;
    const dx = sx - this.width / 2;
    const dy = sy - this.height / 2;
    const c = Math.cos(-rot);
    const s = Math.sin(-rot);
    return { x: (dx * c - dy * s) / scale + x, y: (dx * s + dy * c) / scale + y };
  }

  toScreen(wx, wy) {
    const { x, y, scale, rot = 0 } = this.camera;
    const dx = (wx - x) * scale;
    const dy = (wy - y) * scale;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return { x: dx * c - dy * s + this.width / 2, y: dx * s + dy * c + this.height / 2 };
  }

  // 当前视口的世界坐标范围（视口裁剪用；pad 为世界单位余量；旋转时取四角轴对齐包围盒）
  visibleWorldRect(pad = 0) {
    const corners = [
      this.toWorld(0, 0),
      this.toWorld(this.width, 0),
      this.toWorld(this.width, this.height),
      this.toWorld(0, this.height),
    ];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of corners) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  }

  _makeStars() {
    // 幂律大小分层：85% 暗小星 / 12% 中星 / 3% 亮大星（星空层次感）；每颗星独立闪烁相位与周期
    // 移动端减少背景星数量（性能优先）
    const COUNT = isMobileLike() ? 120 : 240;
    this.stars = Array.from({ length: COUNT }, () => {
      const tier = Math.random();
      const r =
        tier < 0.85
          ? 0.3 + Math.random() * 0.7
          : tier < 0.97
            ? 1.0 + Math.random() * 0.7
            : 1.7 + Math.random() * 0.8;
      return {
        x: Math.random(),
        y: Math.random(),
        r,
        p: Math.random() * 0.5 + 0.1, // 视差系数
        a: Math.random() * 0.5 + 0.25, // 基础亮度
        twPhase: Math.random() * Math.PI * 2, // 呼吸闪烁相位（错开）
        twSpeed: 0.4 + Math.random() * 1.4, // 闪烁角速度（0.4~1.8 rad/s）
      };
    });
  }

  // 深空背景 + 视差星空（屏幕空间；星星随时间呼吸闪烁，仅在有渲染循环时可见，静止零开销）
  drawBackground() {
    const { ctx, camera, width: w, height: h } = this;
    const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.75);
    bg.addColorStop(0, '#101736');
    bg.addColorStop(1, '#070a18');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const t = performance.now() / 1000;
    for (const s of this.stars) {
      const sx = (((s.x * w - camera.x * s.p * 0.3) % w) + w) % w;
      const sy = (((s.y * h - camera.y * s.p * 0.3) % h) + h) % h;
      const tw = 0.72 + 0.28 * Math.sin(t * s.twSpeed + s.twPhase); // 呼吸闪烁 0.72~1.0
      ctx.globalAlpha = Math.min(1, s.a * tw);
      ctx.fillStyle = '#cdd8ff';
      ctx.beginPath();
      ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // 进入世界坐标系（调用方负责 restore）
  beginWorld() {
    const { ctx, camera, width: w, height: h } = this;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    if (camera.rot) ctx.rotate(camera.rot); // 视口旋转（默认 0 无影响）
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(-camera.x, -camera.y);
  }

  // 星点：四态亮度 + 光晕 + lit 外环 + 可信度描边（verified 绿 / disputed 黄）
  // 主体为四角星形（星空星星样貌），光晕/外环/可信度描边保留圆形光环
  drawStarNode(node, x, y, r, { hover = false, center = false, alphaScale = 1 } = {}) {
    const { ctx } = this;
    const st = STATE_STYLE[node.state] ?? STATE_STYLE.dim;

    ctx.save();
    ctx.globalAlpha = st.alpha * alphaScale;
    if (st.glow > 0) {
      ctx.shadowColor = st.glowColor;
      ctx.shadowBlur = (center ? st.glow * 1.6 : st.glow) * Math.min(1.4, this.camera.scale);
    }
    ctx.fillStyle = st.fill;
    ctx.beginPath();
    star4Path(ctx, x, y, r);
    ctx.fill();
    ctx.shadowBlur = 0;

    if (node.state === 'lit') {
      ctx.strokeStyle = 'rgba(255,240,180,0.5)';
      ctx.lineWidth = 1.5 / this.camera.scale;
      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    const cred = CRED_STROKE[node.credibility];
    if (cred) {
      ctx.strokeStyle = cred;
      ctx.globalAlpha = (node.state === 'dim' ? 0.55 : 0.95) * alphaScale;
      ctx.lineWidth = (center ? 2.2 : 1.4) / Math.sqrt(this.camera.scale);
      ctx.beginPath();
      ctx.arc(x, y, r + 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (hover && !center) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.2 / this.camera.scale;
      ctx.beginPath();
      ctx.arc(x, y, r + 3.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

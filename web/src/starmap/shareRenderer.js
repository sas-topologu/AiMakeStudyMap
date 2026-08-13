// 星图分享渲染器：只读星座图（passed/lit 节点 + 其间边），支持主题滤镜与相关线折叠
// 复用 CanvasStage 的相机/resize/星空；配色由主题注入（区别于学习视图的 STATE_STYLE）
import { CanvasStage } from './canvasBase.js';

export const SHARE_THEMES = {
  default: {
    label: '默认',
    bg: ['#101736', '#070a18'],
    star: '#cdd8ff',
    edge: 'rgba(110,168,255,0.55)',
    related: 'rgba(196,141,255,0.4)',
    label: 'rgba(226,232,255,0.9)',
    passed: '#f4d58d',
    lit: '#fff7cf',
    passedGlow: 'rgba(244,213,141,0.6)',
    litGlow: 'rgba(255,240,180,0.85)',
  },
  warm: {
    label: '暖金',
    bg: ['#2b1e0e', '#120b05'],
    star: '#ffe3b0',
    edge: 'rgba(255,190,110,0.55)',
    related: 'rgba(255,150,120,0.38)',
    label: '#ffe9c9',
    passed: '#ffb85e',
    lit: '#fff1cf',
    passedGlow: 'rgba(255,184,94,0.6)',
    litGlow: 'rgba(255,230,170,0.9)',
  },
  ice: {
    label: '冰蓝',
    bg: ['#0c2135', '#050e18'],
    star: '#cdeaff',
    edge: 'rgba(110,220,255,0.5)',
    related: 'rgba(150,200,255,0.35)',
    label: '#dcf3ff',
    passed: '#8fd8f4',
    lit: '#eefcff',
    passedGlow: 'rgba(143,216,244,0.55)',
    litGlow: 'rgba(220,245,255,0.9)',
  },
  paper: {
    label: '素白',
    bg: ['#f6f7fb', '#e6e9f2'],
    star: '#aab2cc',
    edge: 'rgba(70,90,150,0.5)',
    related: 'rgba(120,110,170,0.4)',
    label: '#2a3252',
    passed: '#c98f1b',
    lit: '#5b4cd6',
    passedGlow: 'rgba(201,143,27,0.4)',
    litGlow: 'rgba(91,76,214,0.45)',
  },
};

export class ShareRenderer extends CanvasStage {
  constructor(canvas) {
    super(canvas);
    this.data = null; // { nodesById, edges, pos }
    this.themeKey = 'default';
    this.collapseRelated = false;
  }

  setData({ nodes, edges, pos, theme = 'default', collapseRelated = false }) {
    this.data = { nodesById: Object.fromEntries(nodes.map((n) => [n.id, n])), edges, pos };
    this.themeKey = SHARE_THEMES[theme] ? theme : 'default';
    this.collapseRelated = collapseRelated;
  }

  get theme() {
    return SHARE_THEMES[this.themeKey];
  }

  bounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of this.data?.pos.values() ?? []) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    return { x0, y0, x1, y1 };
  }

  render() {
    const { ctx, camera, width: w, height: h } = this;
    const t = this.theme;
    ctx.clearRect(0, 0, w, h);

    // 主题背景 + 星空
    const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.75);
    bg.addColorStop(0, t.bg[0]);
    bg.addColorStop(1, t.bg[1]);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = t.star;
    for (const s of this.stars) {
      const sx = (((s.x * w - camera.x * s.p * 0.3) % w) + w) % w;
      const sy = (((s.y * h - camera.y * s.p * 0.3) % h) + h) % h;
      ctx.globalAlpha = s.a;
      ctx.beginPath();
      ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (!this.data) return;
    this.beginWorld();

    // 边：prerequisite 实线；related 虚线（可折叠不画）
    for (const e of this.data.edges) {
      if (e.type === 'related' && this.collapseRelated) continue;
      const a = this.data.pos.get(e.from);
      const b = this.data.pos.get(e.to);
      if (!a || !b) continue;
      ctx.save();
      if (e.type === 'prerequisite') {
        ctx.strokeStyle = t.edge;
        ctx.lineWidth = 1.4 / camera.scale;
      } else {
        ctx.strokeStyle = t.related;
        ctx.lineWidth = 1 / camera.scale;
        ctx.setLineDash([4 / camera.scale, 4 / camera.scale]);
      }
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    }

    // 节点：passed 中亮 / lit 高亮（主题配色）
    for (const [id, p] of this.data.pos) {
      const node = this.data.nodesById[id];
      if (!node) continue;
      const lit = node.state === 'lit';
      ctx.save();
      ctx.shadowColor = lit ? t.litGlow : t.passedGlow;
      ctx.shadowBlur = (lit ? 22 : 12) * Math.min(1.4, camera.scale);
      ctx.fillStyle = lit ? t.lit : t.passed;
      ctx.beginPath();
      ctx.arc(p.x, p.y, lit ? 8 : 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 标题（屏幕恒定字号）
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `${11 / camera.scale}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = t.label;
    for (const [id, p] of this.data.pos) {
      ctx.fillText(this.data.nodesById[id]?.title ?? id, p.x, p.y + 10 / camera.scale);
    }
    ctx.restore();

    ctx.restore();
  }
}

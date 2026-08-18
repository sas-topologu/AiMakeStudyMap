// 星光拼形矢量化模块：把 emblem（公式/图像）转为星座矢量
// 输出：paths（浅色细线描绘的骨架折线，世界坐标）+ slots（眼位关键点，世界坐标）
// 流程：渲染到位图 → 二值化 → Zhang-Suen 细化（骨架）→ 折线追踪 → 眼位提取 → 归一化到 EMBLEM_BOX
// 效果类似星座图：细线连成轮廓，星星落在关键眼位

const SAMPLE_W = 320; // 渲染位图宽
const SAMPLE_H = 160; // 渲染位图高
const EMBLEM_BOX = 150; // 归一化后图形最大边长（世界单位）
const SLOT_MAX = 16; // 每组眼位上限（稀疏优雅，类星座）
const PATH_MIN_LEN = 6; // 过滤过短碎段（孤立文字/杂点）
const cache = new Map(); // `${nodeId}#${index}` → { paths, slots, caption, bounds }

// 墨迹包围盒（世界坐标，相对徽章中心）；无路径时返回全 0
export function computeBounds(paths) {
  const b = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  if (!paths?.length) return b;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of paths) {
    for (const pt of p) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
  }
  if (minX !== Infinity) {
    b.minX = minX;
    b.maxX = maxX;
    b.minY = minY;
    b.maxY = maxY;
  }
  return b;
}


// ---- 纯函数（可单测）----

// 二值化：alpha 与亮度双阈值
export function binarize(rgba, width, height, { alphaMin = 40, lumMin = 60 } = {}) {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const j = i * 4;
    if (rgba[j + 3] < alphaMin) continue;
    const lum = 0.2126 * rgba[j] + 0.7152 * rgba[j + 1] + 0.0722 * rgba[j + 2];
    if (lum >= lumMin) out[i] = 1;
  }
  return out;
}

// Zhang-Suen 细化：返回单像素骨架（1=骨架）
export function zhangSuenThin(bin, w, h) {
  const img = new Uint8Array(bin);
  const tmp = new Uint8Array(bin);
  let changed = true;
  while (changed) {
    changed = false;
    // 步骤 1
    tmp.set(img);
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = y * w + x;
        if (!img[i]) continue;
        const p2 = img[i - w], p3 = img[i - w + 1], p4 = img[i + 1];
        const p5 = img[i + w + 1], p6 = img[i + w], p7 = img[i + w - 1];
        const p8 = img[i - 1], p9 = img[i - w - 1];
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const A =
          (p2 === 0 && p3 === 1 ? 1 : 0) + (p3 === 0 && p4 === 1 ? 1 : 0) +
          (p4 === 0 && p5 === 1 ? 1 : 0) + (p5 === 0 && p6 === 1 ? 1 : 0) +
          (p6 === 0 && p7 === 1 ? 1 : 0) + (p7 === 0 && p8 === 1 ? 1 : 0) +
          (p8 === 0 && p9 === 1 ? 1 : 0) + (p9 === 0 && p2 === 1 ? 1 : 0);
        if (A !== 1) continue;
        if (p2 * p4 * p6 !== 0) continue;
        if (p4 * p6 * p8 !== 0) continue;
        tmp[i] = 0;
        changed = true;
      }
    }
    img.set(tmp);
    // 步骤 2
    tmp.set(img);
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = y * w + x;
        if (!img[i]) continue;
        const p2 = img[i - w], p3 = img[i - w + 1], p4 = img[i + 1];
        const p5 = img[i + w + 1], p6 = img[i + w], p7 = img[i + w - 1];
        const p8 = img[i - 1], p9 = img[i - w - 1];
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const A =
          (p2 === 0 && p3 === 1 ? 1 : 0) + (p3 === 0 && p4 === 1 ? 1 : 0) +
          (p4 === 0 && p5 === 1 ? 1 : 0) + (p5 === 0 && p6 === 1 ? 1 : 0) +
          (p6 === 0 && p7 === 1 ? 1 : 0) + (p7 === 0 && p8 === 1 ? 1 : 0) +
          (p8 === 0 && p9 === 1 ? 1 : 0) + (p9 === 0 && p2 === 1 ? 1 : 0);
        if (A !== 1) continue;
        if (p2 * p4 * p8 !== 0) continue;
        if (p2 * p6 * p8 !== 0) continue;
        tmp[i] = 0;
        changed = true;
      }
    }
    img.set(tmp);
  }
  return img;
}

// 骨架折线追踪：沿 8 邻域把骨架像素连成折线路径（分支只走一条，其余由后续起点补）
export function traceSkeleton(img, w, h) {
  const visited = new Uint8Array(w * h);
  const paths = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (!img[i] || visited[i]) continue;
      const pts = [];
      let cx = x;
      let cy = y;
      while (true) {
        visited[cy * w + cx] = 1;
        pts.push({ x: cx, y: cy });
        let nx = -1;
        let ny = -1;
        for (const [dx, dy] of dirs) {
          const px = cx + dx;
          const py = cy + dy;
          if (px < 0 || py < 0 || px >= w || py >= h) continue;
          const pi = py * w + px;
          if (img[pi] && !visited[pi]) {
            nx = px;
            ny = py;
            break;
          }
        }
        if (nx < 0) break;
        cx = nx;
        cy = ny;
      }
      if (pts.length >= 2) paths.push(pts);
    }
  }
  return paths;
}

// 眼位提取：路径端点 + 曲率角点；不相容半径去重（眼位间必须保持 minGap 距离）；
// 不足时沿路径均匀补点；过多时稀疏到 maxSlots
export function extractSlots(paths, maxSlots = SLOT_MAX, minGap = 14) {
  const cand = [];
  for (const path of paths) {
    if (path.length >= 2) {
      cand.push({ x: path[0].x, y: path[0].y });
      cand.push({ x: path[path.length - 1].x, y: path[path.length - 1].y });
    }
    for (let i = 1; i < path.length - 1; i += 1) {
      const a = Math.atan2(path[i].y - path[i - 1].y, path[i].x - path[i - 1].x);
      const b = Math.atan2(path[i + 1].y - path[i].y, path[i + 1].x - path[i].x);
      let da = Math.abs(a - b);
      if (da > Math.PI) da = Math.PI * 2 - da;
      if (da > Math.PI / 5) cand.push({ x: path[i].x, y: path[i].y });
    }
  }
  // 不相容半径去重：眼位间距离 < minGap 只保留先到者（均匀分散）
  const slots = [];
  for (const s of cand) {
    if (!slots.some((o) => Math.hypot(o.x - s.x, o.y - s.y) < minGap)) slots.push(s);
  }
  // 不足时沿路径间隔补点（仍遵守不相容半径）
  const want = Math.max(8, Math.min(maxSlots, 14));
  if (slots.length < want) {
    outer: for (const path of paths) {
      for (let i = 0; i < path.length; i += 3) {
        const p = path[i];
        if (!slots.some((o) => Math.hypot(o.x - p.x, o.y - p.y) < minGap)) slots.push({ x: p.x, y: p.y });
        if (slots.length >= want) break outer;
      }
    }
  }
  // 过多 → 均匀稀疏
  if (slots.length > maxSlots) {
    const stride = slots.length / maxSlots;
    const thinned = [];
    for (let i = 0; i < maxSlots; i += 1) thinned.push(slots[Math.floor(i * stride)]);
    return thinned;
  }
  return slots;
}

// 归一化：图像坐标 → 世界坐标（中心原点，缩放进 EMBLEM_BOX，保持纵横比）
export function toWorld(pts, w, h) {
  const scale = EMBLEM_BOX / Math.max(w, h);
  return pts.map((p) => ({ x: (p.x - w / 2) * scale, y: (p.y - h / 2) * scale }));
}

// ---- 浏览器侧矢量化 ----
export async function vectorizeEmblem(nodeId, index, emblem, mediaById = {}, maxSlots = SLOT_MAX) {
  const key = `${nodeId}#${index}`;
  if (cache.has(key)) return cache.get(key);
  const empty = { paths: [], slots: [], caption: emblem?.caption ?? '', bounds: computeBounds([]) };
  let result = empty;
  try {
    if (typeof document !== 'undefined') {
      if (emblem?.type === 'formula') result = vectorizeFormula(emblem.content, maxSlots);
      else if (emblem?.type === 'image') result = await vectorizeImage(emblem.content, mediaById, maxSlots);
    }
  } catch {
    result = empty; // 失败静默：无拼形
  }
  cache.set(key, result);
  return result;
}

function vectorizeFormula(text, maxSlots) {
  const cv = document.createElement('canvas');
  cv.width = SAMPLE_W;
  cv.height = SAMPLE_H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  let size = 72;
  ctx.font = `700 ${size}px "Times New Roman", serif`;
  const w = ctx.measureText(text).width;
  if (w > SAMPLE_W - 16) size = Math.max(24, Math.floor((size * (SAMPLE_W - 16)) / w));
  ctx.font = `700 ${size}px "Times New Roman", serif`;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, SAMPLE_W / 2, SAMPLE_H / 2);
  const d = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
  return vectorizeData(d, SAMPLE_W, SAMPLE_H, text, maxSlots);
}

async function vectorizeImage(mediaId, mediaById, maxSlots) {
  const media = mediaById[mediaId];
  if (!media?.src) return { paths: [], slots: [], caption: '' };
  const src = /^https?:\/\//.test(media.src) ? media.src : `/api/assets/${media.src}`;
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });
  const cv = document.createElement('canvas');
  cv.width = SAMPLE_W;
  cv.height = SAMPLE_H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const s = Math.min(SAMPLE_W / img.width, SAMPLE_H / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, (SAMPLE_W - dw) / 2, (SAMPLE_H - dh) / 2, dw, dh);
  const d = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
  return vectorizeData(d, SAMPLE_W, SAMPLE_H, media.caption ?? mediaId, maxSlots);
}

function vectorizeData(rgba, w, h, caption, maxSlots) {
  const bin = binarize(rgba, w, h);
  const skel = zhangSuenThin(bin, w, h);
  const rawPaths = traceSkeleton(skel, w, h);
  // 过滤过短碎段（孤立文字笔画/杂点），保留主轮廓线条
  const imgPaths = rawPaths.filter((p) => p.length >= PATH_MIN_LEN);
  const paths = imgPaths.map((p) => toWorld(p, w, h));
  const slotPts = extractSlots(imgPaths, maxSlots);
  const slots = toWorld(slotPts, w, h);
  return { paths, slots, caption, bounds: computeBounds(paths) };
}

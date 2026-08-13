// 星光特效中心点选取：在节点周边空白处随机散布（避开中心节点本体、邻节点与彼此）
// 随机性策略：种子 = hashStr(centerId) ^ 会话盐
//   - 同一会话内反复进入同一节点 → 位置稳定不跳变（不会每次进入都换位置）
//   - 刷新页面（会话盐变化）→ 分布重新随机（保留每次不同的惊喜感）
import { mulberry32, hashStr } from './macroLayout.js';

export const NODE_CLASH = 90; // 邻节点距拼形中心的最小安全距离
export const GROUP_GAP = 135; // 各拼形中心之间的最小间距（图形 150 半宽 75，留余量）
export const DIST_MIN = 115; // 中心坐标到节点的最小距离
export const DIST_MAX = 170; // 最大距离（保证散布，不都挤在中间）

// 会话盐：页面加载时生成一次（不可预测）
const sessionSalt = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;

export function pickEmblemOffsets(renderer, centerId, count, salt = sessionSalt) {
  const rand = mulberry32((hashStr(centerId) ^ salt) >>> 0);
  const others = [];
  if (renderer?.layout?.pos) {
    for (const [id, p] of renderer.layout.pos) if (id !== centerId) others.push(p);
  }
  const result = [];
  let tries = 0;
  while (result.length < count && tries < 300) {
    tries += 1;
    const a = rand() * Math.PI * 2;
    const dist = DIST_MIN + rand() * (DIST_MAX - DIST_MIN);
    const ox = Math.cos(a) * dist;
    const oy = Math.sin(a) * dist;
    const clashNode = others.some((o) => Math.hypot(o.x - ox, o.y - oy) < NODE_CLASH);
    const clashGroup = result.some((r) => Math.hypot(r.x - ox, r.y - oy) < GROUP_GAP);
    if (!clashNode && !clashGroup) result.push({ x: ox, y: oy });
  }
  // 兜底：随机方向补足（避免全部落在中心）
  while (result.length < count) {
    const a = rand() * Math.PI * 2;
    const dist = DIST_MIN + rand() * (DIST_MAX - DIST_MIN);
    result.push({ x: Math.cos(a) * dist, y: Math.sin(a) * dist });
  }
  return result;
}

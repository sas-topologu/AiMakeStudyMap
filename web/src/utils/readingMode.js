// 阅读模式与分层折叠的纯逻辑（便于单测）
// 三档：glance 速览（已掌握）/ standard 标准（默认）/ full 完整
// section tier：core 核心（旧卡无 tier 视为 core）/ detail 推导详解 / extended 拓展阅读
export const READING_MODES = [
  { key: 'glance', label: '速览' },
  { key: 'standard', label: '标准' },
  { key: 'full', label: '完整' },
];

export const TIER_LABEL = { detail: '推导详解', extended: '拓展阅读' };

const normTier = (tier) => (tier === 'detail' || tier === 'extended' ? tier : 'core');

// 该 tier 在本模式下是否出现在列表中
export function isSectionListed(tier, mode) {
  if (mode === 'glance') return normTier(tier) === 'core'; // 速览只列 core 节标题
  return true;
}

// 该 tier 在本模式下的默认展开状态（用户手动折叠/展开在组件内覆盖）
export function isSectionDefaultOpen(tier, mode) {
  if (mode === 'full') return true; // 完整：全部展开
  if (mode === 'glance') return false; // 速览：core 也默认收起，点标题临时展开
  return normTier(tier) === 'core'; // 标准：core 展开，detail/extended 折叠可点
}

// 例题：速览只显示题目标题；标准起显示题干；完整默认展开解析与答案
export const isExampleProblemShown = (mode) => mode !== 'glance';
export const isStepsDefaultOpen = (mode) => mode === 'full';
export const isAnswerDefaultOpen = (mode) => mode === 'full';

// 速览隐藏的非正文区块（pitfalls/media 图集）
export const isSupplementShown = (mode) => mode !== 'glance';

// media.src：http(s) 直接用，否则拼后端静态资源路径
export function mediaSrc(src) {
  return /^https?:\/\//.test(src) ? src : `/api/assets/${src}`;
}

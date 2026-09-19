// 离线搜索：在本地缓存的知识卡里模糊匹配。
// 规则与库侧 /api/search 一致（title / summary / id，不区分大小写，≤20 条），
// 但**只覆盖本地缓存过的节点** —— 结果可能与库现状有出入（库可能已改名、删卡、增卡）。
export function searchCachedCards(query, cards, { limit = 20 } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const hits = [];
  for (const card of Object.values(cards || {})) {
    if (!card?.id) continue;
    const inTitle = String(card.title || '').toLowerCase().includes(q);
    const inSummary = String(card.summary || '').toLowerCase().includes(q);
    const inId = String(card.id).toLowerCase().includes(q);
    if (!inTitle && !inSummary && !inId) continue;
    hits.push({ id: card.id, title: card.title, subject: card.subject, difficulty: card.difficulty });
  }
  hits.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return hits.slice(0, limit);
}

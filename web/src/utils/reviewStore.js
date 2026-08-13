// 错题复盘存储（localStorage `starmap:review`）：
//   答题答错的题自动入列；重练答对即移除；同一题多次答错累计 wrongCount
// 纯函数 + localStorage，可在浏览器/测试中运行
const KEY = 'starmap:review';
const MAX_ITEMS = 200;

export function loadReview() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function save(list) {
  const trimmed = [...list]
    .sort((a, b) => (b.lastWrongAt ?? 0) - (a.lastWrongAt ?? 0))
    .slice(0, MAX_ITEMS);
  localStorage.setItem(KEY, JSON.stringify(trimmed));
  return trimmed;
}

export function reviewCount() {
  return loadReview().length;
}

// 记录一道错题：同题再次答错 → wrongCount++、lastWrongAt 更新；新题入列
export function addWrongQuestion({ nodeId, nodeTitle, seq, type, stem, options, answer, explanation, difficulty }) {
  const list = loadReview();
  const now = Date.now();
  const idx = list.findIndex((q) => q.nodeId === nodeId && q.seq === seq);
  if (idx >= 0) {
    list[idx].wrongCount = (list[idx].wrongCount ?? 0) + 1;
    list[idx].lastWrongAt = now;
  } else {
    list.push({
      nodeId,
      nodeTitle,
      seq,
      type,
      stem,
      options,
      answer,
      explanation,
      difficulty,
      wrongCount: 1,
      lastWrongAt: now,
      collectedAt: now,
    });
  }
  return save(list);
}

// 重练答对 → 从队列移除
export function removeReviewQuestion(nodeId, seq) {
  return save(loadReview().filter((q) => !(q.nodeId === nodeId && q.seq === seq)));
}

// 复习队列：随机顺序，最多 limit 条
export function reviewQueue(limit = 10) {
  const list = loadReview();
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, limit);
}

export function clearReview() {
  localStorage.removeItem(KEY);
}

// 错题复盘存储（localStorage `starmap:review`）
// 「稳步前进」的机制在这里：答错的题自动入列，并按**间隔重复**安排下次复习时间；
// 连续答对若干次即"毕业"（移出队列），答错则回到起点重新走一遍。
// 纯函数 + localStorage，可在浏览器/测试中运行。
const KEY = 'starmap:review';
const MAX_ITEMS = 200;

// 间隔阶梯：10 分钟 → 1 天 → 3 天 → 7 天 → 16 天 → 35 天；答对到顶即毕业
export const REVIEW_INTERVALS_MS = [
  10 * 60 * 1000,
  24 * 60 * 60 * 1000,
  3 * 24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
  16 * 24 * 60 * 60 * 1000,
  35 * 24 * 60 * 60 * 1000,
];
export const GRADUATE_LEVEL = REVIEW_INTERVALS_MS.length; // 答对满 6 次 → 已掌握
export const INTERVAL_LABEL = ['10 分钟', '1 天', '3 天', '7 天', '16 天', '35 天'];

// 旧数据补齐调度字段：没有 dueAt 的按"现在就到期"处理
function normalize(q) {
  return {
    ...q,
    level: q.level ?? 0,
    rightStreak: q.rightStreak ?? 0,
    dueAt: q.dueAt ?? q.lastWrongAt ?? Date.now(),
  };
}

export function loadReview() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(arr) ? arr.map(normalize) : [];
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

const keyOf = (nodeId, seq) => `${nodeId}#${seq}`;

export function reviewCount() {
  return loadReview().length;
}

// 记录一道错题：同题再次答错 → wrongCount++ 且**回到起点**；新题入列（立即到期）
export function addWrongQuestion({ nodeId, nodeTitle, seq, type, stem, options, answer, explanation, difficulty }) {
  const list = loadReview();
  const now = Date.now();
  const idx = list.findIndex((q) => keyOf(q.nodeId, q.seq) === keyOf(nodeId, seq));
  if (idx >= 0) {
    list[idx].wrongCount = (list[idx].wrongCount ?? 0) + 1;
    list[idx].lastWrongAt = now;
    list[idx].level = 0; // 又错了：从第一阶重来
    list[idx].rightStreak = 0;
    list[idx].dueAt = now;
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
      level: 0,
      rightStreak: 0,
      dueAt: now, // 新错题：现在就复习
    });
  }
  return save(list);
}

// 重练答对 → 从队列移除（不参与调度，用于「已掌握」手动清理）
export function removeReviewQuestion(nodeId, seq) {
  return save(loadReview().filter((q) => keyOf(q.nodeId, q.seq) !== keyOf(nodeId, seq)));
}

// 复习队列：随机顺序，最多 limit 条（不计调度 —— 想刷就刷）
export function reviewQueue(limit = 10) {
  const list = loadReview();
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, limit);
}

// 到期的错题：等得最久的先来
export function dueQueue(limit = 20, now = Date.now()) {
  return loadReview()
    .filter((q) => (q.dueAt ?? 0) <= now)
    .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
    .slice(0, limit);
}

// 复习结果：答对升一阶（到顶即毕业移出），答错回到起点
// 返回 { graduated: boolean, level, dueAt, intervalLabel }
export function reviewAnswer(nodeId, seq, correct, now = Date.now()) {
  const list = loadReview();
  const idx = list.findIndex((q) => keyOf(q.nodeId, q.seq) === keyOf(nodeId, seq));
  if (idx < 0) return null;
  const item = list[idx];

  if (!correct) {
    item.level = 0;
    item.rightStreak = 0;
    item.wrongCount = (item.wrongCount ?? 0) + 1;
    item.lastWrongAt = now;
    item.dueAt = now;
    save(list);
    return { graduated: false, level: 0, dueAt: now, intervalLabel: INTERVAL_LABEL[0] };
  }

  const nextLevel = (item.level ?? 0) + 1;
  item.rightStreak = (item.rightStreak ?? 0) + 1;
  if (nextLevel >= GRADUATE_LEVEL) {
    save(list.filter((q) => keyOf(q.nodeId, q.seq) !== keyOf(nodeId, seq)));
    return { graduated: true, level: GRADUATE_LEVEL, dueAt: null, intervalLabel: '已掌握' };
  }
  const interval = REVIEW_INTERVALS_MS[nextLevel - 1];
  item.level = nextLevel;
  item.dueAt = now + interval;
  save(list);
  return { graduated: false, level: nextLevel, dueAt: item.dueAt, intervalLabel: INTERVAL_LABEL[nextLevel - 1] };
}

// 复习概览：总数 / 到期数 / 下次到期时间
export function reviewStats(now = Date.now()) {
  const list = loadReview();
  const due = list.filter((q) => (q.dueAt ?? 0) <= now).length;
  const future = list.map((q) => q.dueAt ?? 0).filter((t) => t > now);
  return {
    total: list.length,
    due,
    nextDueAt: future.length ? Math.min(...future) : null,
  };
}

export function clearReview() {
  localStorage.removeItem(KEY);
}

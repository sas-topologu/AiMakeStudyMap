// 本地出卷与判分（离线学习用）：规则与库侧 quizService 保持一致，结果进同一套状态机。
// 用途：库不可达（断网）时个人端仍能刷题与闯关 —— **全功能、少限制**。
// 这样产出的成果是「未认证」的：联网后经 /api/achievements 上报（见 docs/概念模型.md §4）。
// 注意：点亮（exam）不接受离线完成 —— 点亮必须由库当场见证，才能进稀缺荣誉。
export const PRACTICE_COUNT = 5;
export const PASS_COUNT = 3;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// 分层抽题：按题型轮询随机抽取（题型覆盖均匀），不足时随机补足
export function pickQuestions(bank, count) {
  const byType = new Map();
  bank.forEach((q, i) => {
    if (!byType.has(q.type)) byType.set(q.type, []);
    byType.get(q.type).push(i);
  });
  const types = [...byType.keys()];
  const picked = [];
  const used = new Set();

  let progressed = true;
  while (picked.length < count && progressed) {
    progressed = false;
    for (const type of types) {
      if (picked.length >= count) break;
      const available = byType.get(type).filter((i) => !used.has(i));
      if (available.length === 0) continue;
      const pick = available[Math.floor(Math.random() * available.length)];
      used.add(pick);
      picked.push(bank[pick]);
      progressed = true;
    }
  }
  if (picked.length < count) {
    for (const q of shuffle(bank.filter((_, i) => !used.has(i)))) {
      if (picked.length >= count) break;
      picked.push(q);
    }
  }
  return picked;
}

// 题量：练习 5 题；闯关 3 题；考核 clamp(22-4*难度, 4, 20)，再取题库容量上限
export function questionCount(card, mode) {
  const size = Array.isArray(card?.questionBank) ? card.questionBank.length : 0;
  if (size === 0) return 0;
  if (mode === 'practice') return Math.min(PRACTICE_COUNT, size);
  if (mode === 'pass') return Math.min(PASS_COUNT, size);
  return Math.min(clamp(22 - 4 * (card?.difficulty ?? 4), 4, 20), size);
}

// 出一份本地试卷；答案只留在内存（不下发、不持久化）
export function localPaper(card, mode) {
  const bank = Array.isArray(card?.questionBank) ? card.questionBank : [];
  const count = questionCount(card, mode);
  if (count === 0) return null;
  const picked = pickQuestions(bank, count);
  return {
    paperId: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    nodeId: card.id,
    mode,
    local: true, // 本地卷：由个人端判分，成果未认证
    questions: picked.map((q, i) => ({
      seq: i + 1,
      type: q.type,
      stem: q.stem,
      ...(q.type === 'choice' ? { options: q.options } : {}),
      difficulty: q.difficulty,
    })),
    answers: picked.map((q) => (q.type === 'choice' ? Number(q.answer) : String(q.answer ?? ''))),
    explanations: picked.map((q) => q.explanation ?? ''),
    createdAt: Date.now(),
  };
}

// 判分：choice 比下标；fill 去首尾空白后比字符串（与库侧同规则）
export function gradeLocal(paper, given) {
  const total = paper.questions.length;
  let correct = 0;
  const perQuestion = paper.questions.map((q, i) => {
    const seq = i + 1;
    const raw = given?.[String(seq)] ?? given?.[seq];
    const expected = paper.answers[i];
    const ok =
      q.type === 'choice'
        ? Number(raw) === Number(expected)
        : typeof raw === 'string' && raw.trim() === expected;
    if (ok) correct += 1;
    return { seq, correct: ok, answer: expected, explanation: paper.explanations[i] };
  });

  const elapsedSeconds = Math.max(0, Math.round((Date.now() - paper.createdAt) / 1000));
  const allCorrect = total > 0 && correct === total;
  let result = paper.mode === 'practice' ? 'practice' : 'failed';
  if (paper.mode === 'pass' && allCorrect) result = 'passed';
  return { result, correct, total, elapsedSeconds, perQuestion, local: true };
}

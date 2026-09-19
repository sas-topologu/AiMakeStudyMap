// 闯关、考核与刷题练习
// - pass：闯关，试卷恰好 3 题，全对 → passed
// - exam：考核点亮，题数 clamp(22 - 4*difficulty, 4, 20) 再取题库容量上限，全对 → lit
// - practice：刷题练习，5 题，不计时、不占时间、不落状态，可无限重复（反复考核/刷题）
// 试卷存内存（paperId → 快照），下发不带答案，提交时服务内核判分；正式模式计时到期后提交一律拒绝
import crypto from 'node:crypto';
import { errors } from '../errors.js';
import { getNode } from '../db/contentRepo.js';
import { assertCanChallenge, effectiveState, setState } from './stateService.js';
import { onNodeLit } from './pioneerService.js';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const PRACTICE_COUNT = 5; // 刷题练习题数

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 分层抽题：按题型轮询随机抽取（保证题型覆盖均匀，避免全抽到同一题型）；不足时随机补足
export function pickQuestions(bank, count) {
  const byType = new Map(); // type -> 索引数组
  bank.forEach((q, i) => {
    if (!byType.has(q.type)) byType.set(q.type, []);
    byType.get(q.type).push(i);
  });
  const types = [...byType.keys()];
  const picked = [];
  const used = new Set();

  // 轮询：每轮每个题型最多取 1 道（组内随机），直到凑满或取尽
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
  // 题型太少不足额时，从剩余题库随机补足
  if (picked.length < count) {
    const rest = shuffle(bank.filter((_, i) => !used.has(i)));
    for (const q of rest) {
      if (picked.length >= count) break;
      picked.push(q);
    }
  }
  return picked;
}

export function createQuizService(db, timerService) {
  const papers = new Map(); // paperId -> { userId, nodeId, mode, questions, createdAt, timerEndsAt }

  // 开卷：状态校验 → 计时校验（练习模式跳过）→ 抽题
  function startChallenge(userId, nodeId, mode) {
    const node = getNode(db, nodeId);
    if (!node) throw errors.notFound('节点不存在');
    assertCanChallenge(db, userId, nodeId);
    const practice = mode === 'practice';
    const timer = practice ? null : timerService.requireActiveTimer(userId);

    const bank = db
      .prepare('SELECT * FROM questions WHERE node_id = ? ORDER BY seq')
      .all(nodeId);
    if (bank.length === 0) throw errors.notFound('该节点题库为空');

    const count = practice
      ? Math.min(PRACTICE_COUNT, bank.length)
      : mode === 'pass'
        ? Math.min(3, bank.length)
        : Math.min(clamp(22 - 4 * node.difficulty, 4, 20), bank.length);
    const selected = pickQuestions(bank, count);

    const paperId = crypto.randomUUID();
    papers.set(paperId, {
      userId,
      nodeId,
      mode,
      questions: selected,
      createdAt: Date.now(),
      // 关闭计时约束时 requireActiveTimer 返回 null → 不设交卷截止
      timerEndsAt: practice || !timer ? Infinity : timer.endsAt,
    });

    return {
      paperId,
      mode,
      questions: selected.map((q, i) => ({
        seq: i + 1,
        type: q.type,
        stem: q.stem,
        // fill 题无 options 字段
        ...(q.options_json ? { options: JSON.parse(q.options_json) } : {}),
        difficulty: q.difficulty,
      })),
    };
  }

  // 判分：choice 比下标；fill 去首尾空白后比字符串
  function grade(question, given) {
    if (given == null) return false;
    if (question.type === 'choice') return Number(given) === Number(question.answer);
    return typeof given === 'string' && given.trim() === question.answer;
  }

  function submit(userId, paperId, answers) {
    const paper = papers.get(paperId);
    if (!paper || paper.userId !== userId) throw errors.notFound('试卷不存在或已提交');
    const practice = paper.mode === 'practice';
    if (!practice && Date.now() >= paper.timerEndsAt) {
      papers.delete(paperId);
      throw errors.noTimer('倒计时已结束，本次作答无效');
    }
    papers.delete(paperId); // 一次性试卷（练习模式可重新开卷，无限刷题）

    const elapsedSeconds = Math.max(0, Math.round((Date.now() - paper.createdAt) / 1000));
    const total = paper.questions.length;
    let correct = 0;
    const perQuestion = paper.questions.map((q, i) => {
      const seq = i + 1;
      const given = answers?.[String(seq)] ?? answers?.[seq];
      const ok = grade(q, given);
      if (ok) correct += 1;
      return {
        seq,
        correct: ok,
        answer: q.type === 'choice' ? Number(q.answer) : q.answer,
        explanation: q.explanation,
      };
    });

    const allCorrect = correct === total;
    let result = practice ? 'practice' : 'failed';
    if (!practice && allCorrect && paper.mode === 'pass') {
      setState(db, userId, paper.nodeId, 'passed', { passSeconds: elapsedSeconds });
      result = 'passed';
    } else if (!practice && allCorrect && paper.mode === 'exam') {
      // 点亮：记录本卷耗时（秒，至少 1）与点亮时间
      const passSeconds = Math.max(1, elapsedSeconds);
      setState(db, userId, paper.nodeId, 'lit', {
        passSeconds,
        litAt: new Date().toISOString(),
      });
      onNodeLit(db, userId, paper.nodeId); // 拓荒者候选挂钩
      result = 'lit';
    }

    return {
      result,
      correct,
      total,
      elapsedSeconds,
      state: effectiveState(db, userId, paper.nodeId),
      perQuestion,
    };
  }

  return { startChallenge, submit };
}

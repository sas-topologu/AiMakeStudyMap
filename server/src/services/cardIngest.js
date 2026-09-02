// 知识卡"投稿-审核"管线中心化：校验 / 入库 / 创建投稿与审核任务。
// 供 ①POST /agent/cards（投稿：校验→存待审→建 card_review 任务）与
//   ②POST /ai-tasks/:id/result（管理 Agent 回写 approve→入库）复用，避免两处重复。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { allEdges } from '../db/contentRepo.js';
import { DEFAULT_DB_PATH } from '../db/connection.js';
import * as repo from '../db/contentRepo.js';
import { checkCards } from '../../../content/tools/import.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const ASSETS_DIR = path.resolve(PROJECT_ROOT, 'content/assets');
const CARDS_DIR = path.resolve(PROJECT_ROOT, 'content/cards');
const STAGING_DIR = path.resolve(PROJECT_ROOT, 'content/staging');
const dbPath = () => process.env.STARMAP_DB || DEFAULT_DB_PATH;

const shortId = () => crypto.randomBytes(8).toString('hex');
const nowIso = () => new Date().toISOString();

// schema + 结构校验（并入当前库现有节点图，避免悬空误报）；返回 { ok, errors }
export function validateCards(db, cards) {
  const inDir = path.join(STAGING_DIR, `.validate-${Date.now()}`);
  fs.mkdirSync(inDir, { recursive: true });
  try {
    for (const card of cards) {
      fs.writeFileSync(path.join(inDir, `${card.id}.json`), JSON.stringify(card, null, 2));
    }
    const withDb = typeof db?.name === 'string' ? db.name : dbPath();
    const result = checkCards({ dir: inDir, withDb, assetsDir: ASSETS_DIR });
    return { ok: result.ok, errors: result.errors };
  } finally {
    fs.rmSync(inDir, { recursive: true, force: true });
  }
}

// 入库（直接在服务 db 上 upsert + 增量加边 + 版本号 + changelog），不整体替换边
export function insertCards(db, cards) {
  const edgeInsert = db.prepare('INSERT OR IGNORE INTO edges (from_id, to_id, type) VALUES (?, ?, ?)');
  const created = [];
  const updated = [];
  db.transaction(() => {
    for (const card of cards) {
      const s = repo.upsertNode(db, card);
      if (s === 'created') created.push(card.id);
      else if (s === 'updated') updated.push(card.id);
      repo.replaceQuestions(db, card.id, card.questionBank);
      for (const pre of card.relations.prerequisites) edgeInsert.run(card.id, pre, 'prerequisite');
      const relSeen = new Set();
      for (const rel of card.relations.related ?? []) {
        const [a, b] = [card.id, rel].sort();
        const key = `${a}|${b}`;
        if (relSeen.has(key)) continue;
        relSeen.add(key);
        edgeInsert.run(a, b, 'related');
      }
    }
    if (created.length || updated.length) {
      const newVersion = repo.bumpContentVersion(db);
      const parts = [];
      if (created.length) parts.push(`新增：${created.join('、')}`);
      if (updated.length) parts.push(`更新：${updated.join('、')}`);
      db.prepare(
        'INSERT INTO changelogs (version, summary, detail, created_at) VALUES (?, ?, ?, ?)'
      ).run(
        newVersion,
        `新增 ${created.length} / 更新 ${updated.length} / 删除 0`,
        parts.join('\n'),
        nowIso()
      );
    }
  })();
  // 持久化内容源：写入 content/cards/
  for (const card of cards) {
    fs.writeFileSync(path.join(CARDS_DIR, `${card.id}.json`), JSON.stringify(card, null, 2));
  }
  return { ok: true, created, updated, newVersion: repo.getContentVersion(db) };
}

// 投稿：写待审卡 + 建 card_review 任务；返回 { submissionId, taskId }
export function createSubmission(db, userId, cards) {
  const submissionId = shortId();
  const taskId = shortId();
  const t = new Date().toISOString();
  // 投稿需登录；校验通过后存待审（未过审不入主库）
  db.prepare(
    `INSERT INTO card_submissions (id, node_id, user_id, card_json, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`
  ).run(submissionId, cards[0].id, userId, JSON.stringify(cards), t);
  db.prepare(
    `INSERT INTO ai_tasks (id, type, role, status, subject_id, created_at)
     VALUES (?, 'card_review', 'operator', 'pending', ?, ?)`
  ).run(taskId, submissionId, t);
  return { submissionId, taskId };
}

export { CARDS_DIR, nowIso };

// ---- 审核状态机辅助 ----
const REVIEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 公示窗口 7 天
export const REVIEW_WINDOW = REVIEW_WINDOW_MS;

// 一审通过 → 进入公示（ai_reviewed），设置到期时间；不立即入库
export function markAiReviewed(db, submissionId, reason = '') {
  const due = new Date(Date.now() + REVIEW_WINDOW_MS).toISOString();
  db.prepare(
    "UPDATE card_submissions SET status='ai_reviewed', reason=?, review_due_at=?, reviewed_at=? WHERE id=?"
  ).run(reason, due, nowIso(), submissionId);
  return due;
}

// 终审通过：入库（复用 insertCards），投稿标记 approved
export function finalize(db, submissionId, cards) {
  const r = insertCards(db, cards);
  db.prepare("UPDATE card_submissions SET status='approved', reviewed_at=? WHERE id=?").run(nowIso(), submissionId);
  return r;
}

// 打回 / 社区异议 → reopened（回到待重审标记）
export function markReopened(db, submissionId, reason) {
  db.prepare("UPDATE card_submissions SET status='reopened', reason=?, reviewed_at=? WHERE id=?").run(reason ?? '', nowIso(), submissionId);
}

// 公示到期自动通过：把 review_due_at 已过且 status=ai_reviewed 的投稿入库
export function settleExpired(db) {
  const expired = db
    .prepare("SELECT * FROM card_submissions WHERE status='ai_reviewed' AND review_due_at IS NOT NULL AND review_due_at <= ? ORDER BY review_due_at")
    .all(nowIso());
  const settled = [];
  for (const sub of expired) {
    try {
      finalize(db, sub.id, JSON.parse(sub.card_json));
      settled.push(sub.id);
    } catch (e) {
      // 入库失败（如悬空）→ 打回
      db.prepare("UPDATE card_submissions SET status='rejected', reason=?, reviewed_at=? WHERE id=?").run('公示期满入库失败：' + e.message, nowIso(), sub.id);
    }
  }
  return settled;
}

// 功能冻结：查本周拒次 → 达阈值冻结。返回 { frozen, remaining, waitMinutes }
// freezeBase 冻结时长（分钟），随当周拒绝次数递增（最低 2 小时），每周一清零。
export function checkFreeze(db, userId) {
  const weekStart = weeklyStart();
  const rejectedCount = db
    .prepare(
      "SELECT COUNT(*) c FROM card_submissions WHERE user_id=? AND status='rejected' AND created_at >= ?"
    )
    .get(userId, weekStart).c;
  if (rejectedCount < 3) return { frozen: false, rejectedCount };
  const k = rejectedCount - 2; // 第 3 次起触发
  const waitMinutes = 120 * 2 ** (k - 1); // 最低 2 小时，随次数翻倍
  // 找本期最近一次拒绝时刻，计算冻结剩余
  const last = db
    .prepare("SELECT created_at, reviewed_at FROM card_submissions WHERE user_id=? AND status='rejected' ORDER BY created_at DESC LIMIT 1")
    .get(userId);
  const ref = last?.reviewed_at ?? last?.created_at ?? nowIso();
  const freezeUntil = new Date(new Date(ref).getTime() + waitMinutes * 60 * 1000).getTime();
  const remainMin = Math.max(0, Math.ceil((freezeUntil - Date.now()) / 60000));
  return { frozen: remainMin > 0, rejectedCount, waitMinutes, remainMinutes: remainMin, freezeWait: `上限 ${Math.ceil(waitMinutes / 60)} 小时（拒${rejectedCount}次，每周重置）` };
}

// 自然周起点（周一 00:00 本地）
function weeklyStart() {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // 周一=0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.toISOString();
}

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

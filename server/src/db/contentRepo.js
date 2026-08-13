// 节点 / 边 / 题库的读写封装，导入工具与后续 API 共用

// upsert 一张知识卡；返回 'created' | 'updated' | false（无变化）
export function upsertNode(db, card) {
  const contentJson = JSON.stringify(card);
  const existing = db.prepare('SELECT content_json FROM nodes WHERE id = ?').get(card.id);
  if (existing && existing.content_json === contentJson) return false;

  // import 在全部 upsert 完成后才 bump 版本，故本节点的新版本号即当前版本 +1
  const nextVersion = getContentVersion(db) + 1;
  db.prepare(
    `INSERT INTO nodes (id, title, subject, category, credibility, difficulty, summary,
                        content_json, version, created_at, updated_at, updated_version)
     VALUES (@id, @title, @subject, @category, @credibility, @difficulty, @summary,
             @content_json, @version, datetime('now'), datetime('now'), @nextVersion)
     ON CONFLICT(id) DO UPDATE SET
       title = @title, subject = @subject, category = @category,
       credibility = @credibility, difficulty = @difficulty, summary = @summary,
       content_json = @content_json, version = @version, updated_at = datetime('now'),
       updated_version = @nextVersion`
  ).run({ ...card, content_json: contentJson, nextVersion });
  return existing ? 'updated' : 'created';
}

// 按 id 读取节点，content 为解析后的完整卡片
export function getNode(db, id) {
  const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
  if (!row) return null;
  const { content_json, ...rest } = row;
  return { ...rest, content: JSON.parse(content_json) };
}

// 全部节点（不含完整卡片正文）
export function listNodes(db) {
  return db
    .prepare(
      'SELECT id, title, subject, category, credibility, difficulty, summary, version, updated_at FROM nodes ORDER BY id'
    )
    .all();
}

// 某节点的邻接关系；successors（后续）由 prerequisite 边反向推导
export function edgesOf(db, nodeId) {
  const prerequisites = db
    .prepare("SELECT to_id AS id FROM edges WHERE from_id = ? AND type = 'prerequisite'")
    .all(nodeId)
    .map((r) => r.id);
  const successors = db
    .prepare("SELECT from_id AS id FROM edges WHERE to_id = ? AND type = 'prerequisite'")
    .all(nodeId)
    .map((r) => r.id);
  const related = db
    .prepare(
      `SELECT CASE WHEN from_id = ? THEN to_id ELSE from_id END AS id
       FROM edges WHERE type = 'related' AND (from_id = ? OR to_id = ?)`
    )
    .all(nodeId, nodeId, nodeId)
    .map((r) => r.id);
  return { prerequisites, successors, related };
}

// 全量边（related 每对一行，查询时双向匹配）
export function allEdges(db) {
  return db.prepare('SELECT from_id, to_id, type FROM edges ORDER BY from_id, to_id, type').all();
}

const edgeKey = (e) => `${e.from_id}${e.to_id}${e.type}`;

// 用期望边集整体替换现有边（幂等）；返回是否有变化
export function syncEdges(db, desiredEdges) {
  const current = allEdges(db);
  const curSet = new Set(current.map(edgeKey));
  const newSet = new Set(desiredEdges.map(edgeKey));
  const same = curSet.size === newSet.size && [...curSet].every((k) => newSet.has(k));
  if (same) return false;

  db.prepare('DELETE FROM edges').run();
  const insert = db.prepare('INSERT INTO edges (from_id, to_id, type) VALUES (?, ?, ?)');
  for (const e of desiredEdges) insert.run(e.from_id, e.to_id, e.type);
  return true;
}

// 某节点题库（按 seq 排序）
export function questionsOf(db, nodeId) {
  return db.prepare('SELECT * FROM questions WHERE node_id = ? ORDER BY seq').all(nodeId);
}

// 用卡片题库整体替换某节点题目（幂等）；返回是否有变化
export function replaceQuestions(db, nodeId, questions) {
  const desired = questions.map((q, i) => ({
    id: q.id,
    node_id: nodeId,
    seq: i + 1,
    type: q.type,
    stem: q.stem,
    options_json: q.type === 'choice' ? JSON.stringify(q.options) : null,
    answer: String(q.answer),
    explanation: q.explanation,
    difficulty: q.difficulty,
  }));
  const current = questionsOf(db, nodeId);
  if (JSON.stringify(current) === JSON.stringify(desired)) return false;

  db.prepare('DELETE FROM questions WHERE node_id = ?').run(nodeId);
  const insert = db.prepare(
    `INSERT INTO questions (id, node_id, seq, type, stem, options_json, answer, explanation, difficulty)
     VALUES (@id, @node_id, @seq, @type, @stem, @options_json, @answer, @explanation, @difficulty)`
  );
  for (const q of desired) insert.run(q);
  return true;
}

// 节点库全局版本号（未初始化时为 0）
export function getContentVersion(db) {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'content_version'").get();
  return row ? Number(row.value) : 0;
}

// 版本号 +1，返回新版本号
export function bumpContentVersion(db) {
  const next = getContentVersion(db) + 1;
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('content_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(next));
  return next;
}

// 版本同步：返回 updated_version 大于 since 的节点（含完整卡片）
export function listNodesUpdatedSince(db, since) {
  return db
    .prepare('SELECT * FROM nodes WHERE updated_version > ? ORDER BY id')
    .all(since)
    .map((row) => ({ ...JSON.parse(row.content_json), updated_version: row.updated_version }));
}

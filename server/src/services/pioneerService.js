// 前十纪念碑 / 拓荒者
// 规则：点亮节点时若该节点**已认证**点亮人数 <10 → 记候选（check_at = +30min）；
// 到期复核人数仍 <10 → 成为拓荒者（永久标记），可在纪念碑留言（永久 + 讨论区置顶）。
// 名额只认已认证的点亮：稀缺荣誉不接受未认证成果（见 docs/概念模型.md §4.3）。
// 提升采用懒模式：纪念碑/帖子读取路径与每次新 lit 时调用 promotePioneers，
// 另由 app 启动时挂 60s 定时器兜底。
const PIONEER_LIMIT = 10;
const CANDIDATE_WINDOW_MS = 30 * 60 * 1000;

// 已认证的点亮人数（名额判定只看这个）
export function litCount(db, nodeId) {
  return db
    .prepare(
      "SELECT COUNT(*) AS n FROM user_node_state WHERE node_id = ? AND state = 'lit' AND certified = 1"
    )
    .get(nodeId).n;
}

// 点亮成功钩子（quizService 落 lit 处调用）
export function onNodeLit(db, userId, nodeId) {
  promotePioneers(db); // 顺手做一次懒提升
  const count = litCount(db, nodeId);
  if (count < PIONEER_LIMIT) {
    const now = new Date();
    db.prepare(
      `INSERT OR IGNORE INTO pioneer_candidates (node_id, user_id, lit_count_at_grant, grant_at, check_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      nodeId,
      userId,
      count,
      now.toISOString(),
      new Date(now.getTime() + CANDIDATE_WINDOW_MS).toISOString()
    );
  }
}

// 到期候选复核：人数仍 <10 → 写入 pioneers；无论成败都删候选
export function promotePioneers(db, now = new Date()) {
  const due = db
    .prepare('SELECT * FROM pioneer_candidates')
    .all()
    .filter((c) => c.check_at <= now.toISOString());
  if (due.length === 0) return 0;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO pioneers (node_id, user_id, message, created_at)
     VALUES (?, ?, '', ?)`
  );
  const del = db.prepare(
    'DELETE FROM pioneer_candidates WHERE node_id = ? AND user_id = ?'
  );
  db.transaction(() => {
    for (const c of due) {
      if (litCount(db, c.node_id) < PIONEER_LIMIT) {
        insert.run(c.node_id, c.user_id, now.toISOString());
      }
      del.run(c.node_id, c.user_id);
    }
  })();
  return due.length;
}

export function isPioneer(db, nodeId, userId) {
  return !!db
    .prepare('SELECT 1 FROM pioneers WHERE node_id = ? AND user_id = ?')
    .get(nodeId, userId);
}

// 纪念碑名单（含留言）；certified 来自该用户在本节点的成果是否有库见证
export function listPioneers(db, nodeId) {
  return db
    .prepare(
      `SELECT p.user_id, u.username, p.message, p.created_at,
              COALESCE(s.certified, 0) AS certified
       FROM pioneers p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN user_node_state s ON s.user_id = p.user_id AND s.node_id = p.node_id
       WHERE p.node_id = ? ORDER BY p.created_at`
    )
    .all(nodeId);
}

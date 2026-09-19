// 迁移框架：schema_migrations 记录已应用版本，启动时按版本号升序应用
const migrations = [
  {
    version: 1,
    name: '001_init',
    sql: `
      -- 节点库全局元数据（content_version 等）
      CREATE TABLE meta (
        key   TEXT PRIMARY KEY,
        value TEXT
      );

      -- 知识节点；content_json 存完整卡片 JSON
      CREATE TABLE nodes (
        id           TEXT PRIMARY KEY,
        title        TEXT NOT NULL,
        subject      TEXT NOT NULL,
        category     TEXT NOT NULL,
        credibility  TEXT NOT NULL,
        difficulty   INTEGER NOT NULL,
        summary      TEXT NOT NULL,
        content_json TEXT NOT NULL,
        version      INTEGER NOT NULL,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );

      -- 边：prerequisite 语义为 from_id 的前置是 to_id；related 无向，每对只存一行
      CREATE TABLE edges (
        from_id TEXT NOT NULL,
        to_id   TEXT NOT NULL,
        type    TEXT NOT NULL CHECK (type IN ('prerequisite', 'related')),
        PRIMARY KEY (from_id, to_id, type)
      );

      -- 题库（随卡入库）
      CREATE TABLE questions (
        id            TEXT NOT NULL,
        node_id       TEXT NOT NULL,
        seq           INTEGER NOT NULL,
        type          TEXT NOT NULL,
        stem          TEXT NOT NULL,
        options_json  TEXT,
        answer        TEXT NOT NULL,
        explanation   TEXT NOT NULL,
        difficulty    INTEGER NOT NULL,
        PRIMARY KEY (node_id, seq)
      );

      -- 用户；jump_quota 跃迁额度，quota_month 记录上次发放月份 YYYY-MM
      CREATE TABLE users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        settings_json TEXT NOT NULL DEFAULT '{}',
        jump_quota    INTEGER NOT NULL DEFAULT 1,
        quota_month   TEXT
      );

      -- 节点状态机：暗淡 dim → 开放 open → 通关 passed → 点亮 lit
      CREATE TABLE user_node_state (
        user_id      INTEGER NOT NULL,
        node_id      TEXT NOT NULL,
        state        TEXT NOT NULL CHECK (state IN ('dim', 'open', 'passed', 'lit')),
        pass_seconds INTEGER,
        lit_at       TEXT,
        updated_at   TEXT NOT NULL,
        PRIMARY KEY (user_id, node_id)
      );

      -- 防沉迷计时（按自然日累计秒数）
      CREATE TABLE daily_usage (
        user_id INTEGER NOT NULL,
        day     TEXT NOT NULL,
        seconds INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, day)
      );
    `,
  },
  {
    version: 2,
    name: '002_nodes_updated_version',
    // 版本同步：节点内容变化时更新为该次导入的新 content_version
    sql: `ALTER TABLE nodes ADD COLUMN updated_version INTEGER NOT NULL DEFAULT 0`,
  },
  {
    version: 3,
    name: '003_social',
    // 社交系统：讨论区 / 回复 / 二创 / 拓荒者 / 星图分享
    sql: `
      ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE posts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id    TEXT NOT NULL,
        user_id    INTEGER NOT NULL,
        title      TEXT NOT NULL,
        body       TEXT NOT NULL,
        is_pioneer INTEGER NOT NULL DEFAULT 0,
        pinned     INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_posts_node ON posts (node_id, created_at);

      CREATE TABLE replies (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id    INTEGER NOT NULL,
        user_id    INTEGER NOT NULL,
        body       TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_replies_post ON replies (post_id);

      CREATE TABLE creations (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id     TEXT NOT NULL,
        user_id     INTEGER NOT NULL,
        type        TEXT NOT NULL CHECK (type IN ('mindmap', 'game', 'summary')),
        title       TEXT NOT NULL,
        content     TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        created_at  TEXT NOT NULL,
        reviewed_at TEXT
      );

      -- 拓荒者候选：点亮时人数 <10 授予，check_at（+30min）到期复核
      CREATE TABLE pioneer_candidates (
        node_id            TEXT NOT NULL,
        user_id            INTEGER NOT NULL,
        lit_count_at_grant INTEGER NOT NULL,
        grant_at           TEXT NOT NULL,
        check_at           TEXT NOT NULL,
        PRIMARY KEY (node_id, user_id)
      );

      -- 拓荒者：标记永久；留言落此表后永久置顶展示
      CREATE TABLE pioneers (
        node_id    TEXT NOT NULL,
        user_id    INTEGER NOT NULL,
        message    TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        PRIMARY KEY (node_id, user_id)
      );

      CREATE TABLE shares (
        id          TEXT PRIMARY KEY,
        user_id     INTEGER NOT NULL,
        config_json TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );
    `,
  },
  {
    version: 4,
    name: '004_maintenance',
    // 维护与审核：勘误任务 / 搜索日志（空洞信号）/ 更新日志
    sql: `
      CREATE TABLE corrections (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id     TEXT NOT NULL,
        user_id     INTEGER NOT NULL,
        body        TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        review_note TEXT,
        created_at  TEXT NOT NULL,
        reviewed_at TEXT
      );
      CREATE INDEX idx_corrections_status ON corrections (status);

      CREATE TABLE search_logs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        query      TEXT NOT NULL,
        matched    INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_search_logs_created ON search_logs (created_at);

      -- version 对应节点库 content_version；同版本仅一行（可人工修订）
      CREATE TABLE changelogs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        version    INTEGER NOT NULL UNIQUE,
        summary    TEXT NOT NULL,
        detail     TEXT,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 5,
    name: '005_ai_tasks',
    // AI 任务桥：群体端管理 Agent（外部执行者）通过任务队列接入。
    // ai_tasks：任务（类型/状态/结论/模型指纹）；card_submissions：待审投稿卡（未过审不入主库）。
    // 管理与普通执行者由凭证角色区分，见 routes/aiTasks.js。
    sql: `
      CREATE TABLE ai_tasks (
        id          TEXT PRIMARY KEY,
        type        TEXT NOT NULL CHECK (type IN ('card_review', 'correction_review', 'report_review', 'legal_action')),
        role        TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('operator', 'member')),
        status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
        subject_id  TEXT,
        verdict     TEXT,
        result_json TEXT,
        model       TEXT,
        created_at  TEXT NOT NULL,
        done_at     TEXT
      );
      CREATE INDEX idx_ai_tasks_status ON ai_tasks (role, status);

      CREATE TABLE card_submissions (
        id          TEXT PRIMARY KEY,
        node_id     TEXT NOT NULL,
        user_id     INTEGER NOT NULL,
        card_json   TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        reason      TEXT,
        created_at  TEXT NOT NULL,
        reviewed_at TEXT
      );
      CREATE INDEX idx_card_submissions_status ON card_submissions (status);
    `,
  },
  {
    version: 6,
    name: '006_submission_review',
    // 投稿审核状态机扩展：一审通过 → ai_reviewed（公示窗口，review_due_at 到期自动通过 / 第三方终审提前通过），
    // 社区有效勘误 → reopened；功能冻结依据 card_submissions 拒次计数。
    sql: `
      DROP TABLE IF EXISTS card_submissions;
      CREATE TABLE card_submissions (
        id            TEXT PRIMARY KEY,
        node_id       TEXT NOT NULL,
        user_id       INTEGER NOT NULL,
        card_json     TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'ai_reviewed', 'approved', 'rejected', 'reopened')),
        reason        TEXT,
        review_due_at TEXT,
        created_at    TEXT NOT NULL,
        reviewed_at   TEXT
      );
      CREATE INDEX idx_card_submissions_status ON card_submissions (status);
      CREATE INDEX idx_card_submissions_user ON card_submissions (user_id, created_at);
    `,
  },
  {
    version: 7,
    name: '007_account_email',
    // 账号标准模板：注册绑定邮箱（唯一，用于找回密码/通知）+ 邮箱验证码表。
    // email 允许为空（不强制邮箱注册）；提供找回密码与改密，密码规则提升到 8 位含字母数字。
    sql: `
      ALTER TABLE users ADD COLUMN email TEXT;
      CREATE UNIQUE INDEX idx_users_email ON users (email) WHERE email IS NOT NULL AND email != '';

      CREATE TABLE email_codes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        email      TEXT NOT NULL,
        code       TEXT NOT NULL,
        purpose    TEXT NOT NULL CHECK (purpose IN ('reset')),
        expires_at TEXT NOT NULL,
        used       INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_email_codes_email ON email_codes (email, purpose);
    `,
  },
  {
    version: 8,
    name: '008_reports',
    // 举报/滥用流程：举报表 + 内容「隐藏」标志（管理 AI 判 remove 后不展示）。
    // 举报由任务桥 report_review 处理（AI 初审 → actioned(隐藏/下架)/dismissed）。保留内容原文以便复核。
    sql: `
      CREATE TABLE reports (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        target_type TEXT NOT NULL CHECK (target_type IN ('post', 'reply', 'creation', 'monument', 'node')),
        target_id   TEXT NOT NULL,
        reporter_id INTEGER NOT NULL,
        reason      TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'actioned', 'dismissed')),
        verdict     TEXT,
        created_at  TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE INDEX idx_reports_status ON reports (status);

      ALTER TABLE posts      ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE replies    ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE creations  ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE pioneers   ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 9,
    name: '009_admin_level',
    // 两级管理员：admin_level 0=普通 / 1=库管理员（本机认领，完全权限，可设授权密钥）
    //                              2=二级管理员（凭库授权密钥，可审核/投稿/举报，不可设密钥/管库）
    sql: `
      ALTER TABLE users ADD COLUMN admin_level INTEGER NOT NULL DEFAULT 0;
      UPDATE users SET admin_level = 1 WHERE is_admin = 1;
    `,
  },
];

export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version)
  );
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(
        m.version,
        m.name
      );
    })();
  }
}

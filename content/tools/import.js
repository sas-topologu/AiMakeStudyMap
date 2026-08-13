// 知识卡导入工具
// CLI：node content/tools/import.js [--dir content/cards] [--db <path>]
//      [--check 只校验不写库] [--with-db <path> 校验时把库中现有节点并入图]
// 流程：读取 JSON → zod 校验 → validateGraph 结构检测 → 事务写入 → 内容变化时版本号 +1 并写 changelog
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { openDatabase } from '../../server/src/db/connection.js';
import * as repo from '../../server/src/db/contentRepo.js';
import { validateGraph } from '../../server/src/services/structureCheck.js';
import { knowledgeCardSchema, extractTerms } from '../schema/knowledge-card.schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 媒体资产目录：content/assets/
const DEFAULT_ASSETS_DIR = path.resolve(__dirname, '../assets');

// 读取目录内全部知识卡并逐张校验；返回 { cards, errors }
// media.src 非 http(s) 时必须是 assetsDir 下存在的文件（防穿越同样在此拦截）
export function loadCards(dir, assetsDir = DEFAULT_ASSETS_DIR) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const cards = [];
  const errors = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      errors.push(`${file}: JSON 解析失败：${e.message}`);
      continue;
    }
    const result = knowledgeCardSchema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push(`${file}: ${issue.path.join('.') || '(根)'} ${issue.message}`);
      }
      continue;
    }
    const card = result.data;
    // sections 中出现的每个 [[术语]] 必须在本卡 terms 中有定义
    const used = new Set(card.sections.flatMap((s) => extractTerms(s.body)));
    for (const t of used) {
      if (!(t in card.terms)) errors.push(`${file}: 术语 [[${t}]] 未在本卡 terms 中定义`);
    }
    // media 资产：相对路径必须落在 assetsDir 内且文件存在
    for (const m of card.media) {
      if (/^https?:\/\//.test(m.src)) continue;
      const p = path.resolve(assetsDir, m.src);
      if (!p.startsWith(assetsDir + path.sep) || !fs.existsSync(p)) {
        errors.push(`${file}: media「${m.id}」引用的资产文件不存在：${m.src}`);
      }
    }
    cards.push(card);
  }

  // id 唯一性
  const seen = new Set();
  for (const card of cards) {
    if (seen.has(card.id)) errors.push(`节点 id 重复：${card.id}`);
    seen.add(card.id);
  }

  return { cards, errors };
}

// 由卡片汇总边列表：prerequisite 语义为 from 的前置是 to；related 去重只存一行
export function buildEdges(cards) {
  const edges = [];
  const relatedSeen = new Set();
  for (const card of cards) {
    for (const pre of card.relations.prerequisites) {
      edges.push({ from_id: card.id, to_id: pre, type: 'prerequisite' });
    }
    for (const rel of card.relations.related) {
      const [a, b] = [card.id, rel].sort();
      const key = `${a} ${b}`;
      if (relatedSeen.has(key)) continue;
      relatedSeen.add(key);
      edges.push({ from_id: a, to_id: b, type: 'related' });
    }
  }
  return edges;
}

const edgeKey = (e) => `${e.from_id}${e.to_id}${e.type}`;

// 只读打开现有库，取出节点 id 与边（--with-db 用；不触发迁移、不写库）
function readGraphFromDb(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const nodes = db.prepare('SELECT id FROM nodes').all().map((r) => r.id);
    const edges = repo.allEdges(db);
    return { nodes, edges };
  } finally {
    db.close();
  }
}

// 只校验不写库（--check）：zod 校验 + 结构检测；--with-db 时把库中现有节点并入图
// 返回 { ok, errors, warnings, checked }
export function checkCards({ dir, withDb, assetsDir }) {
  const { cards, errors } = loadCards(dir, assetsDir ?? DEFAULT_ASSETS_DIR);
  if (cards.length === 0 && errors.length === 0) {
    errors.push(`目录 ${dir} 中没有知识卡 JSON 文件`);
  }

  const cardIds = new Set(cards.map((c) => c.id));
  let nodes = [...cardIds];
  const edgeMap = new Map(buildEdges(cards).map((e) => [edgeKey(e), e]));

  if (withDb) {
    const existing = readGraphFromDb(withDb);
    // 卡片优先（视为对库中同 id 节点的覆盖），库中其余节点与边并入图校验
    nodes = nodes.concat(existing.nodes.filter((id) => !cardIds.has(id)));
    for (const e of existing.edges) {
      if (!edgeMap.has(edgeKey(e))) edgeMap.set(edgeKey(e), e);
    }
  }

  const { errors: graphErrors, warnings } = validateGraph(nodes, [...edgeMap.values()]);
  return {
    ok: errors.length === 0 && graphErrors.length === 0,
    errors: [...errors, ...graphErrors],
    warnings,
    checked: cards.length,
  };
}

// 执行导入；成功返回 { ok, changed, oldVersion, newVersion, nodeCount, edgeCount, questionCount, created, updated, warnings }
// 校验/结构检测失败返回 { ok: false, errors, warnings }
export function runImport({ dir, dbPath, assetsDir }) {
  const { cards, errors: cardErrors } = loadCards(dir, assetsDir ?? DEFAULT_ASSETS_DIR);
  if (cardErrors.length > 0) return { ok: false, errors: cardErrors };
  if (cards.length === 0) return { ok: false, errors: [`目录 ${dir} 中没有知识卡 JSON 文件`] };

  const nodeIds = cards.map((c) => c.id);
  const edges = buildEdges(cards);
  const { errors, warnings } = validateGraph(nodeIds, edges);
  if (errors.length > 0) return { ok: false, errors, warnings };

  const db = openDatabase(dbPath);
  let result;
  db.transaction(() => {
    const oldVersion = repo.getContentVersion(db);
    let changed = false;
    let questionCount = 0;
    const created = [];
    const updated = [];

    for (const card of cards) {
      const status = repo.upsertNode(db, card);
      if (status === 'created') created.push(card.id);
      else if (status === 'updated') updated.push(card.id);
      if (status) changed = true;
      if (repo.replaceQuestions(db, card.id, card.questionBank)) changed = true;
      questionCount += card.questionBank.length;
    }
    if (repo.syncEdges(db, edges)) changed = true;

    // 仅内容有变化时才迭代版本号（幂等），并写一条更新日志
    let newVersion = oldVersion;
    if (changed) {
      newVersion = repo.bumpContentVersion(db);
      const summary = `新增 ${created.length} / 更新 ${updated.length} / 删除 0`;
      const detailParts = [];
      if (created.length) detailParts.push(`新增：${created.join('、')}`);
      if (updated.length) detailParts.push(`更新：${updated.join('、')}`);
      db.prepare(
        'INSERT INTO changelogs (version, summary, detail, created_at) VALUES (?, ?, ?, ?)'
      ).run(newVersion, summary, detailParts.join('\n'), new Date().toISOString());
    }
    result = {
      ok: true,
      changed,
      oldVersion,
      newVersion,
      nodeCount: cards.length,
      edgeCount: edges.length,
      questionCount,
      created,
      updated,
      warnings,
    };
  })();
  db.close();
  return result;
}

// CLI 入口
function main() {
  const args = process.argv.slice(2);
  let dir = path.resolve(__dirname, '../cards');
  let dbPath = process.env.STARMAP_DB;
  let check = false;
  let withDb = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--dir') dir = path.resolve(args[++i]);
    else if (args[i] === '--db') dbPath = args[++i];
    else if (args[i] === '--check') check = true;
    else if (args[i] === '--with-db') withDb = path.resolve(args[++i]);
  }

  if (check) {
    const result = checkCards({ dir, withDb });
    for (const w of result.warnings) console.warn(`  ⚠ ${w}`);
    if (!result.ok) {
      console.error('校验未通过：');
      for (const e of result.errors) console.error(`  ✗ ${e}`);
      process.exit(1);
    }
    console.log(
      `校验通过：${result.checked} 张卡${withDb ? `（已并入 ${withDb} 现有节点图检测）` : ''}，未写库`
    );
    return;
  }

  const result = runImport({ dir, dbPath });
  if (!result.ok) {
    console.error('导入中止，存在以下错误：');
    for (const e of result.errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  for (const w of result.warnings) console.warn(`  ⚠ ${w}`);
  console.log(
    `已导入 ${result.nodeCount} 个节点、${result.edgeCount} 条边、${result.questionCount} 道题`
  );
  if (result.changed) {
    console.log(`内容版本：${result.oldVersion} → ${result.newVersion}（已写更新日志）`);
  } else {
    console.log(`内容无变化，版本保持 ${result.newVersion}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

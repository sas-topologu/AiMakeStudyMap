// 维护扫描工具：node content/tools/scan.js [--db <path>]
// 输出维护报告：结构健康 / 孤岛检测 / 空洞节点 / 待办积压 / 版本信息
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { detectIslands, detectCycles } from '../../server/src/services/structureCheck.js';
import {
  findHollowQueries,
  loadGraph,
  pendingBacklog,
} from '../../server/src/services/maintenanceService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB = path.resolve(__dirname, '../../server/data/starmap.db');

export function buildReport(db) {
  const lines = [];
  const { nodes, edges } = loadGraph(db);
  const questionCount = db.prepare('SELECT COUNT(*) AS n FROM questions').get().n;
  const cycles = detectCycles(nodes, edges);
  const islands = detectIslands(nodes, edges);
  const subjects = db
    .prepare('SELECT subject, COUNT(*) AS n FROM nodes GROUP BY subject ORDER BY n DESC')
    .all();
  const hollow = findHollowQueries(db);
  const backlog = pendingBacklog(db);
  const version = db.prepare("SELECT value FROM meta WHERE key = 'content_version'").get();
  const lastLog = db
    .prepare('SELECT version, summary, created_at FROM changelogs ORDER BY version DESC LIMIT 1')
    .get();

  lines.push('===== 智点星谱维护报告 =====');
  lines.push('');
  lines.push('【结构健康】');
  lines.push(`  节点 ${nodes.length} / 边 ${edges.length} / 题目 ${questionCount}`);
  lines.push(`  环检测：${cycles.length === 0 ? '0 个（正常）' : `${cycles.length} 个！${cycles.map((c) => c.join('->')).join('；')}`}`);
  lines.push(`  学科分布：${subjects.map((s) => `${s.subject} ${s.n}`).join(' / ') || '无'}`);
  lines.push('');
  lines.push('【孤岛检测】');
  if (islands.length === 0) {
    lines.push('  无孤岛，全部节点均在主网络中');
  } else {
    for (const group of islands) lines.push(`  孤岛节点群（${group.length} 个）：${group.join('、')}`);
  }
  lines.push('');
  lines.push('【空洞节点】（近 7 天 ≥3 次搜索无结果）');
  if (hollow.length === 0) {
    lines.push('  无');
  } else {
    for (const h of hollow) lines.push(`  「${h.query}」${h.count} 次（最近 ${h.last_at}）`);
  }
  lines.push('');
  lines.push('【待办积压】');
  lines.push(
    `  待处理勘误 ${backlog.corrections.count} 条${backlog.corrections.oldest ? `（最老 ${backlog.corrections.oldest}）` : ''}`
  );
  lines.push(
    `  待审核二创 ${backlog.creations.count} 条${backlog.creations.oldest ? `（最老 ${backlog.creations.oldest}）` : ''}`
  );
  lines.push('');
  lines.push('【版本信息】');
  lines.push(`  content_version = ${version ? version.value : 0}`);
  lines.push(
    lastLog
      ? `  最近日志：v${lastLog.version} ${lastLog.summary}（${lastLog.created_at}）`
      : '  最近日志：无'
  );
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  let dbPath = process.env.STARMAP_DB || DEFAULT_DB;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--db') dbPath = path.resolve(args[++i]);
  }
  if (!fs.existsSync(dbPath)) {
    console.error(`数据库不存在：${dbPath}（先跑 npm run import）`);
    process.exit(1);
  }
  const db = new Database(dbPath, { readonly: true });
  try {
    console.log(buildReport(db));
  } finally {
    db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

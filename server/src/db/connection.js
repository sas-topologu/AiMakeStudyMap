import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 默认库文件：server/data/starmap.db，可用环境变量 STARMAP_DB 覆盖
export const DEFAULT_DB_PATH = path.resolve(__dirname, '../../data/starmap.db');

// 打开数据库：自动建目录、开启 WAL 与外键、按序应用迁移
export function openDatabase(dbPath = process.env.STARMAP_DB || DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

// 进程级单例（API 服务用）
let instance = null;
export function getDb() {
  if (!instance) instance = openDatabase();
  return instance;
}

export { runMigrations };

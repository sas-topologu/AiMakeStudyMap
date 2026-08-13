import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runImport } from '../../content/tools/import.js';
import { openDatabase } from '../src/db/connection.js';
import { getContentVersion, listNodes, allEdges } from '../src/db/contentRepo.js';

// 造一张最小合法卡（含 6 题）
function makeCard(id, { prerequisites = [], related = [], title = id } = {}) {
  return {
    id,
    title,
    subject: '数学',
    category: '自然科学',
    credibility: 'verified',
    difficulty: 1,
    summary: `${title} 的摘要`,
    sections: [
      { heading: '概念', body: `本节介绍[[甲术语]]与[[乙术语]]。` },
      { heading: '性质', body: `[[丙术语]]的基本性质。` },
      { heading: '应用', body: '简单应用。' },
    ],
    terms: { 甲术语: '定义甲', 乙术语: '定义乙', 丙术语: '定义丙' },
    relations: { prerequisites, related },
    questionBank: [1, 2, 3, 4].map((n) => ({
      id: `q${n}`,
      type: 'choice',
      stem: `选择题 ${n}`,
      options: ['A', 'B'],
      answer: 0,
      explanation: '解析',
      difficulty: 1,
    })).concat([
      { id: 'q5', type: 'fill', stem: '填空题 5', answer: '42', explanation: '解析', difficulty: 1 },
      { id: 'q6', type: 'fill', stem: '填空题 6', answer: '43', explanation: '解析', difficulty: 2 },
    ]),
    version: 1,
  };
}

function writeCard(dir, card) {
  fs.writeFileSync(path.join(dir, `${card.id}.json`), JSON.stringify(card, null, 2));
}

describe('导入工具', () => {
  let tmp;
  let dir;
  let dbPath;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starmap-import-'));
    dir = path.join(tmp, 'cards');
    fs.mkdirSync(dir);
    dbPath = path.join(tmp, 'test.db');
    writeCard(dir, makeCard('math.a'));
    writeCard(dir, makeCard('math.b', { prerequisites: ['math.a'] }));
    writeCard(dir, makeCard('math.c', { prerequisites: ['math.b'], related: ['math.a'] }));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('首次导入版本 0→1，写入节点/边/题目', () => {
    const result = runImport({ dir, dbPath });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.oldVersion).toBe(0);
    expect(result.newVersion).toBe(1);

    const db = openDatabase(dbPath);
    expect(getContentVersion(db)).toBe(1);
    expect(listNodes(db)).toHaveLength(3);
    expect(allEdges(db)).toHaveLength(3); // 2 条 prerequisite + 1 条 related
    const q = db.prepare('SELECT COUNT(*) AS n FROM questions').get();
    expect(q.n).toBe(18);
    db.close();
  });

  it('重复导入幂等：版本不变', () => {
    runImport({ dir, dbPath });
    const again = runImport({ dir, dbPath });
    expect(again.ok).toBe(true);
    expect(again.changed).toBe(false);
    expect(again.newVersion).toBe(1);
  });

  it('修改一张卡后再导入版本 →2', () => {
    runImport({ dir, dbPath });
    const card = makeCard('math.a');
    card.summary = '修改后的摘要';
    writeCard(dir, card);

    const result = runImport({ dir, dbPath });
    expect(result.ok).toBe(true);
    expect(result.oldVersion).toBe(1);
    expect(result.newVersion).toBe(2);
  });

  it('dangling 引用时中止且不写库', () => {
    runImport({ dir, dbPath });
    // b 的前置改为不存在的节点
    writeCard(dir, makeCard('math.b', { prerequisites: ['math.ghost'] }));

    const result = runImport({ dir, dbPath });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('math.ghost'))).toBe(true);

    // 库保持导入前状态
    const db = openDatabase(dbPath);
    expect(getContentVersion(db)).toBe(1);
    const b = db.prepare('SELECT content_json FROM nodes WHERE id = ?').get('math.b');
    expect(JSON.parse(b.content_json).relations.prerequisites).toEqual(['math.a']);
    db.close();
  });

  it('sections 中未定义术语导致校验失败', () => {
    const card = makeCard('math.a');
    card.sections[0].body = '引用了[[未定义术语]]。';
    writeCard(dir, card);

    const result = runImport({ dir, dbPath });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('未定义术语'))).toBe(true);
    expect(fs.existsSync(dbPath)).toBe(false); // 未建库
  });
});

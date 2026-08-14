import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { runImport } from '../../content/tools/import.js';
import { openDatabase } from '../src/db/connection.js';
import { createApp } from '../src/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const CARDS_DIR = path.join(REPO_ROOT, 'content/cards');

function makeCard(id, extra = {}) {
  return {
    id,
    title: `${id} 标题`,
    subject: '数学',
    category: '自然科学',
    credibility: 'verified',
    difficulty: 1,
    summary: `${id} 摘要`,
    sections: [
      { heading: '概念', body: `[[甲]]。` },
      { heading: '性质', body: `[[乙]]。` },
      { heading: '应用', body: '应用。' },
    ],
    terms: { 甲: '定义甲', 乙: '定义乙' },
    relations: { prerequisites: [], related: [] },
    questionBank: [1, 2, 3, 4]
      .map((n) => ({
        id: `q${n}`,
        type: 'choice',
        stem: `题 ${n}`,
        options: ['对', '错'],
        answer: 0,
        explanation: '解析',
        difficulty: 1,
      }))
      .concat([
        { id: 'q5', type: 'fill', stem: '填空 5', answer: '42', explanation: '解析', difficulty: 1 },
        { id: 'q6', type: 'fill', stem: '填空 6', answer: '42', explanation: '解析', difficulty: 2 },
      ]),
    version: 1,
    ...extra,
  };
}

describe('媒体资产管线', () => {
  let tmp;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starmap-assets-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('import：media src 文件缺失 → error 中止；存在 → 通过', () => {
    const dir = path.join(tmp, 'cards');
    const assetsDir = path.join(tmp, 'assets');
    fs.mkdirSync(dir);
    fs.mkdirSync(assetsDir);
    const dbPath = path.join(tmp, 't.db');

    // 缺失文件 → 中止且不写库
    fs.writeFileSync(
      path.join(dir, 't.a.json'),
      JSON.stringify(
        makeCard('t.a', {
          media: [{ id: 'm1', type: 'image', src: 'pics/missing.svg' }],
        })
      )
    );
    let result = runImport({ dir, dbPath, assetsDir });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('pics/missing.svg'))).toBe(true);
    expect(fs.existsSync(dbPath)).toBe(false);

    // 补齐文件 → 通过；http(s) 地址不做文件检查
    fs.mkdirSync(path.join(assetsDir, 'pics'), { recursive: true });
    fs.writeFileSync(path.join(assetsDir, 'pics/missing.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    fs.writeFileSync(
      path.join(dir, 't.a.json'),
      JSON.stringify(
        makeCard('t.a', {
          media: [
            { id: 'm1', type: 'image', src: 'pics/missing.svg' },
            { id: 'm2', type: 'animation', src: 'https://example.com/anim.gif' },
          ],
        })
      )
    );
    result = runImport({ dir, dbPath, assetsDir });
    expect(result.ok).toBe(true);
    expect(result.newVersion).toBe(1);
  });

  it('升级后的真实卡库导入成功（含 quadratic 的 SVG 资产校验）', () => {
    const dbPath = path.join(tmp, 'real.db');
    const result = runImport({ dir: CARDS_DIR, dbPath });
    const cardCount = fs.readdirSync(CARDS_DIR).filter((f) => f.endsWith('.json')).length;
    expect(result.ok).toBe(true);
    expect(result.nodeCount).toBe(cardCount);
    expect(result.created).toHaveLength(cardCount);
    expect(result.newVersion).toBe(1);
    // 重复导入幂等
    const again = runImport({ dir: CARDS_DIR, dbPath });
    expect(again.changed).toBe(false);
  });

  it('assets 路由：存在的 svg → 200 + content-type + 长缓存；穿越与不存在 → 404', async () => {
    const assetsDir = path.join(tmp, 'assets');
    fs.mkdirSync(path.join(assetsDir, 'quadratic'), { recursive: true });
    fs.writeFileSync(
      path.join(assetsDir, 'quadratic', 'p.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    );
    fs.writeFileSync(path.join(tmp, 'secret.txt'), 'secret'); // assets 之外

    const db = openDatabase(':memory:');
    const agent = request(
      createApp(db, { secret: 's', pioneerTimer: false, staticDir: null, assetsDir })
    );

    const ok = await agent.get('/api/assets/quadratic/p.svg');
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toContain('image/svg');
    expect(ok.headers['cache-control']).toContain('immutable');

    // 目录穿越（编码形式）→ 404/400，读不到 secret.txt
    const trav = await agent.get('/api/assets/%2e%2e%2fsecret.txt');
    expect([400, 404]).toContain(trav.status);
    expect(trav.text).not.toContain('secret');

    // 不存在 → 404；非白名单扩展名 → 404
    expect((await agent.get('/api/assets/quadratic/nope.svg')).status).toBe(404);
    fs.writeFileSync(path.join(assetsDir, 'x.exe'), 'bin');
    expect((await agent.get('/api/assets/x.exe')).status).toBe(404);

    db.close();
  });
});

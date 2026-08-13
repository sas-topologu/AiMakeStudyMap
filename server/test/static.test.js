import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { openDatabase } from '../src/db/connection.js';
import { createApp } from '../src/app.js';

// 静态托管：假 dist 目录验证 SPA 回退与缓存头
describe('静态托管与 SPA 回退', () => {
  let tmp, distDir, db;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starmap-static-'));
    distDir = path.join(tmp, 'dist');
    fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
    fs.writeFileSync(
      path.join(distDir, 'index.html'),
      '<!doctype html><html><body><div id="app">假 index.html</div></body></html>'
    );
    fs.writeFileSync(path.join(distDir, 'assets', 'app-abc123.js'), 'console.log("app")');
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('SPA 回退与缓存头', async () => {
    const agent = request(createApp(db, { secret: 's', pioneerTimer: false, staticDir: distDir }));

    // 根路径 → index.html，no-cache
    const root = await agent.get('/');
    expect(root.status).toBe(200);
    expect(root.text).toContain('假 index.html');
    expect(root.headers['cache-control']).toContain('no-cache');

    // SPA 前端路由 → 回退到 index.html
    const spa = await agent.get('/share/abc123');
    expect(spa.status).toBe(200);
    expect(spa.text).toContain('假 index.html');
    const admin = await agent.get('/admin');
    expect(admin.status).toBe(200);
    expect(admin.text).toContain('假 index.html');

    // 带 hash 的静态资源 → immutable 长缓存 + 正确内容类型
    const asset = await agent.get('/assets/app-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');
    expect(asset.headers['content-type']).toContain('javascript');

    // API 不被回退拦截
    const health = await agent.get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ ok: true });
    // 未匹配的 /api 路径走 API 404 而非回退
    const api404 = await agent.get('/api/no-such-route');
    expect(api404.text).not.toContain('假 index.html');
  });

  it('dist 不存在（staticDir=null）时根路径返回构建提示', async () => {
    const agent = request(createApp(db, { secret: 's', pioneerTimer: false, staticDir: null }));
    const res = await agent.get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('npm run build');
  });
});

// 应用组装：createApp(db) 供入口与测试共用
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { errorHandler } from './errors.js';
import { getContentVersion } from './db/contentRepo.js';
import { createTimerService } from './services/timerService.js';
import { createQuizService } from './services/quizService.js';
import { authRouter } from './routes/auth.js';
import { nodesRouter } from './routes/nodes.js';
import { graphRouter } from './routes/graph.js';
import { quizRouter } from './routes/quiz.js';
import { timerRouter } from './routes/timer.js';
import { jumpRouter } from './routes/jump.js';
import { navRouter } from './routes/nav.js';
import { postsRouter } from './routes/posts.js';
import { creationsRouter, adminRouter } from './routes/creations.js';
import { correctionsRouter } from './routes/corrections.js';
import { assetsRouter } from './routes/assets.js';
import { shareRouter } from './routes/share.js';
import { profileRouter } from './routes/profile.js';
import { promotePioneers } from './services/pioneerService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 默认前端产物目录：<仓库根>/web/dist
const DEFAULT_STATIC_DIR = path.resolve(__dirname, '../../web/dist');
// 默认媒体资产目录：<仓库根>/content/assets
const DEFAULT_ASSETS_DIR = path.resolve(__dirname, '../../content/assets');

// 生产静态托管：SPA（history 路由）回退 + 缓存策略
// - assets/ 下为带内容 hash 的构建产物 → immutable 长缓存
// - index.html → no-cache（保证发版即生效）
// - 除 /api 前缀外的 GET（且接受 html）一律回退到 index.html
function mountStatic(app, distDir) {
  const indexHtml = path.join(distDir, 'index.html');
  app.use(
    express.static(distDir, {
      index: false, // 根路径交给 SPA 回退统一处理
      setHeaders(res, filePath) {
        if (filePath.split(path.sep).includes('assets')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    if (!req.accepts('html')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
}

export function createApp(
  db,
  {
    secret = process.env.STARMAP_SECRET || 'dev-secret',
    pioneerTimer = true,
    // 前端产物目录；传 null 显式关闭静态托管
    staticDir = DEFAULT_STATIC_DIR,
    // 媒体资产目录（content/assets）
    assetsDir = DEFAULT_ASSETS_DIR,
  } = {}
) {
  const app = express();
  app.use(express.json());

  const timerService = createTimerService(db);
  const quizService = createQuizService(db, timerService);
  const ctx = { db, secret, timerService, quizService, assetsDir };

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, contentVersion: getContentVersion(db) });
  });

  app.use('/api/auth', authRouter(ctx));
  app.use('/api', nodesRouter(ctx));
  app.use('/api', graphRouter(ctx));
  app.use('/api', quizRouter(ctx));
  app.use('/api/timer', timerRouter(ctx));
  app.use('/api', jumpRouter(ctx));
  app.use('/api', navRouter(ctx));
  app.use('/api', postsRouter(ctx));
  app.use('/api', creationsRouter(ctx));
  app.use('/api', correctionsRouter(ctx));
  app.use('/api/assets', assetsRouter(ctx));
  app.use('/api', adminRouter(ctx));
  app.use('/api', shareRouter(ctx));
  app.use('/api', profileRouter(ctx));

  // 静态托管（在 API 路由之后、错误处理之前挂载）
  if (staticDir && fs.existsSync(staticDir)) {
    mountStatic(app, staticDir);
  } else {
    app.get('/', (req, res) => {
      res
        .type('text/plain; charset=utf-8')
        .send('知识星图：前端尚未构建，请先运行 npm run build（产物目录 web/dist 不存在）');
    });
  }

  app.use(errorHandler);

  // 拓荒者复核兜底定时器（读取路径已做懒提升；测试可传 pioneerTimer:false 关闭）
  if (pioneerTimer) {
    setInterval(() => promotePioneers(db), 60_000).unref();
  }

  return app;
}

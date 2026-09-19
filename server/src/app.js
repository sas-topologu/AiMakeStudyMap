// 应用组装：createApp(db) 供入口与测试共用
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { errorHandler, errors } from './errors.js';
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
import { agentRouter } from './routes/agent.js';
import { aiTasksRouter } from './routes/aiTasks.js';
import { reportsRouter } from './routes/reports.js';
import { terminalRouter } from './routes/terminal.js';
import { uploadRouter } from './routes/upload.js';
import { promotePioneers } from './services/pioneerService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 默认前端产物目录：<仓库根>/web/dist
const DEFAULT_STATIC_DIR = path.resolve(__dirname, '../../web/dist');
// 默认媒体资产目录：<仓库根>/content/assets
const DEFAULT_ASSETS_DIR = path.resolve(__dirname, '../../content/assets');

// 下载通道白名单：前端外壳只允许这些格式被下载。
// 作用：防止把站点当作"任意文件分发通道"（如可执行文件、压缩包等），
// 也防止 MIME 嗅探把静态文件当可执行内容。用户内容（图片/附件）走 /api/assets，另有可配置白名单。
const STATIC_EXTS = new Set([
  '.html', '.js', '.mjs', '.css', '.json', '.svg', '.png', '.jpg', '.jpeg',
  '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.txt', '.webmanifest',
]);

// 管理型界面（终端自有）：静态托管 server/public/admin，公开可访问（操作需管理员登录）。
const ADMIN_DIR = path.resolve(__dirname, '../public/admin');

// 公网访问根路径时展示的说明页（服务端不再对外提供学习端网页）
const PUBLIC_INFO_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>智点星谱 · 终端</title>
<style>body{margin:0;background:#070b16;color:#dfe6ff;font:15px/1.8 system-ui,"Microsoft YaHei",sans-serif;
display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.card{max-width:560px;border:1px solid #24304d;border-radius:14px;padding:26px 30px;background:#0c1426}
h1{font-size:19px;margin:0 0 12px}p{margin:8px 0;color:#9fb0d8}code{background:#131d33;padding:2px 6px;border-radius:5px}
a{color:#7aa2ff}</style></head><body><div class="card">
<h1>智点星谱 · 终端（服务端）</h1>
<p>本终端只提供 <b>数据接口</b> 与 <b>管理界面</b>，不再对外提供学习端网页。</p>
<p>学习端请使用 <b>PC 客户端</b> 或 <b>手机客户端</b>（在其"设置 → 终端"里指向本地址）。</p>
<p>管理界面：<a href="/admin">/admin</a></p>
</div></body></html>`;

// 判断请求是否来自本机（本机 = 运行终端的这台机器上跑的客户端，如 PC 客户端内置的终端）
function isLoopbackReq(req) {
  const ip = req.ip || req.socket?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// 静态托管：下载格式限制 + SPA（history 路由）回退 + 缓存策略
// 【服务端改造】学习端网页**只对本机开放**（供 PC 客户端内置终端使用）；
// 公网访问只给管理界面 /admin 与说明页 —— 服务端不再对外提供学习端网页。
function mountStatic(app, distDir) {
  const indexHtml = path.join(distDir, 'index.html');

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/admin')) return next();
    if (!isLoopbackReq(req)) {
      // 非本机：不提供学习端网页；根路径给说明页，其余 404
      if (req.path === '/' || req.path === '') {
        res.setHeader('Cache-Control', 'no-cache');
        return res.type('html').send(PUBLIC_INFO_HTML);
      }
      return next(errors.notFound('服务端仅提供接口与管理界面，学习端请使用客户端'));
    }
    const ext = path.extname(req.path).toLowerCase();
    if (ext && !STATIC_EXTS.has(ext)) return next(errors.notFound('不支持的下载格式'));
    return next();
  });
  app.use(
    express.static(distDir, {
      index: false, // 根路径交给 SPA 回退统一处理
      setHeaders(res, filePath) {
        res.setHeader('X-Content-Type-Options', 'nosniff'); // 防 MIME 嗅探
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
    if (!isLoopbackReq(req)) return next(); // 公网不回退学习端
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(indexHtml);
  });
}

export function createApp(
  db,
  {
    secret = process.env.STARMAP_SECRET || 'dev-secret',
    // 管理员密钥：配置后仅持有此密钥的注册用户/登录者才能成为管理员（消除"首个注册自动管理员"抢注）
    adminKey = process.env.STARMAP_ADMIN_KEY || '',
    pioneerTimer = true,
    // 前端产物目录；传 null 显式关闭静态托管
    staticDir = DEFAULT_STATIC_DIR,
    // 媒体资产目录（content/assets）
    assetsDir = DEFAULT_ASSETS_DIR,
  } = {}
) {
  const app = express();
  // 只信任本机（Nginx）作为代理：这样 req.ip 是 Nginx 记录的客户端真实 IP，
  // 且客户端伪造的 X-Forwarded-For 不会生效 —— 用于"仅本机可认领终端管理员"的判定。
  app.set('trust proxy', 'loopback');
  // 上传以 base64 放在 JSON 里（保持通道统一），故放宽 JSON 体积上限
  app.use(express.json({ limit: '8mb' }));

  // 去中心化：客户端可指向任意终端（跨域）。鉴权用 Authorization 头而非 Cookie，
  // 故放开跨域来源并允许 Authorization 头即可（不使用 cookie 凭证）。
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Vary', 'Origin');
    res.setHeader('X-Content-Type-Options', 'nosniff'); // 全局防 MIME 嗅探
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  });

  // 信息通道限制：带请求体的接口只接受 JSON，其余格式（multipart/octet-stream 等）一律拒绝。
  // 配合 assets 路由的图片白名单，确保通道内只流动"正常使用所需"的格式。
  app.use('/api', (req, res, next) => {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (ct && ct !== 'application/json') {
        return res.status(415).json({
          error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: '仅支持 application/json' },
        });
      }
    }
    return next();
  });

  const timerService = createTimerService(db);
  const quizService = createQuizService(db, timerService);
  const ctx = { db, secret, adminKey, timerService, quizService, assetsDir };

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
  app.use('/api', agentRouter(ctx));
  app.use('/api', aiTasksRouter(ctx));
  app.use('/api', reportsRouter(ctx));
  app.use('/api', terminalRouter(ctx));
  app.use('/api', uploadRouter(ctx));

  // 管理型界面（终端自有）：始终挂载，不依赖前端是否构建过
  app.use(
    '/admin',
    express.static(ADMIN_DIR, {
      index: 'index.html',
      setHeaders(res) {
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('X-Content-Type-Options', 'nosniff');
      },
    })
  );

  // 学习端静态资源：仅当构建产物存在时挂载（且只对本机开放，见 mountStatic 内守卫）
  if (staticDir && fs.existsSync(staticDir)) {
    mountStatic(app, staticDir);
  } else {
    app.get('/', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.type('html').send(PUBLIC_INFO_HTML);
    });
  }

  app.use(errorHandler);

  // 拓荒者复核兜底定时器（读取路径已做懒提升；测试可传 pioneerTimer:false 关闭）
  if (pioneerTimer) {
    setInterval(() => promotePioneers(db), 60_000).unref();
  }

  return app;
}

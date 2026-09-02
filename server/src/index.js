// 入口：打开数据库（内部跑迁移）→ 组装应用 → 监听
// JWT 密钥读 STARMAP_SECRET，默认开发值 'dev-secret'（见 app.js，生产必须覆盖）
import { getDb } from './db/connection.js';
import { createApp } from './app.js';

// 兜底：body-parser 对畸形 JSON 抛的异步错误可能逃逸成 uncaughtException，
// 若不加处理 Node 默认行为是打印后直接退出进程。这里只记录、不退出，
// 让单个坏请求（如外部脚本发的非法 JSON 登录）不会压垮整个服务。
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason && reason.message);
});

const db = getDb();
const app = createApp(db);

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`知识星图 API 已启动: http://localhost:${port}`);
});

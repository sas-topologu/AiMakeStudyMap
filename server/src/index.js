// 入口：打开数据库（内部跑迁移）→ 组装应用 → 监听
// JWT 密钥读 STARMAP_SECRET，默认开发值 'dev-secret'（见 app.js，生产必须覆盖）
import { getDb } from './db/connection.js';
import { createApp } from './app.js';

const db = getDb();
const app = createApp(db);

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`知识星图 API 已启动: http://localhost:${port}`);
});

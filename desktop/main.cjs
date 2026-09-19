// 智点星谱 · PC 个人端（Electron 主进程）
// 独立使用即全功能：内置本机库（Express + SQLite + 知识卡），启动后打开窗口指向本机服务。
// 数据（数据库、上传文件）放在用户目录，保证打包后的程序目录只读也能正常运行。
const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.STARMAP_PORT || 39700);
let mainWindow = null;

const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

async function startTerminal() {
  const userData = app.getPath('userData');
  const dbPath = path.join(userData, 'starmap.db');
  const assetsDir = path.join(userData, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  process.env.STARMAP_DB = dbPath;
  process.env.STARMAP_SECRET = process.env.STARMAP_SECRET || crypto.randomBytes(32).toString('hex');

  const { getDb } = await imp('server/src/db/connection.js');
  const { createApp } = await imp('server/src/app.js');
  const db = getDb();

  // 首次运行（知识库为空）：从随包内容 content/cards 导入
  const count = db.prepare('SELECT COUNT(*) AS c FROM nodes').get().c;
  if (count === 0) {
    try {
      const { runImport } = await imp('content/tools/import.js');
      const r = runImport({
        dir: path.join(ROOT, 'content/cards'),
        dbPath,
        assetsDir: path.join(ROOT, 'content/assets'),
      });
      if (!r?.ok) console.error('首次导入知识库未通过：', r?.errors);
    } catch (e) {
      console.error('首次导入知识库失败：', e);
    }
  }

  const expressApp = createApp(db, { staticDir: path.join(ROOT, 'web/dist'), assetsDir });
  await new Promise((resolve, reject) => {
    const srv = expressApp.listen(PORT, '127.0.0.1', resolve);
    srv.on('error', reject);
  });
  return `http://127.0.0.1:${PORT}`;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    title: '智点星谱',
    backgroundColor: '#060913',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // 外部链接交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  const url = await startTerminal();
  await mainWindow.loadURL(url);
}

app.whenReady().then(() => {
  createWindow().catch((e) => {
    dialog.showErrorBox('智点星谱启动失败', String((e && e.stack) || e));
    app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

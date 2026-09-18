#!/usr/bin/env bash
# 智点星谱 · 部署/更新脚本（服务器上执行）
# 从 GitHub 拉取最新代码 → 装依赖 → 构建前端 → 内容入库 → 重启服务
set -euo pipefail

APP_DIR="${1:-$(pwd)}"
cd "$APP_DIR"

# 丢弃服务器上由 npm install 产生的 lock 文件本地改动，避免 git pull 冲突
# （package-lock.json 是生成物，以仓库中的版本为准）
git checkout -- package-lock.json 2>/dev/null || true

echo "== git pull =="
git pull --ff-only

echo "== npm install =="
# 服务器不需要 Electron（PC 打包才用），跳过其二进制下载，避免拖慢部署与占空间
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install

echo "== build 前端 =="
npm run build

echo "== 内容入库 =="
npm run import

echo "== 重启服务 =="
pm2 restart starmap || pm2 start tools/deploy/ecosystem.config.js

echo "== 健康检查 =="
sleep 2
curl -sf http://127.0.0.1:3000/api/health && echo "" && echo "部署完成 ✅"

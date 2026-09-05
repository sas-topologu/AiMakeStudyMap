#!/usr/bin/env bash
# 知识星图 · 部署/更新脚本（服务器上执行）
# 从 GitHub 拉取最新代码 → 装依赖 → 构建前端 → 内容入库 → 重启服务
set -euo pipefail

APP_DIR="${1:-$(pwd)}"
cd "$APP_DIR"

echo "== git pull =="
git pull --ff-only

echo "== npm install =="
npm install

echo "== build 前端 =="
npm run build

echo "== 内容入库 =="
npm run import

echo "== 重启服务 =="
pm2 restart starmap || pm2 start tools/deploy/ecosystem.config.js

echo "== 健康检查 =="
sleep 2
curl -sf http://127.0.0.1:3000/api/health && echo "" && echo "部署完成 ✅"

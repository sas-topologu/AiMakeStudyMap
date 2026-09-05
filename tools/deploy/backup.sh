#!/usr/bin/env bash
# 知识星图 · 数据库备份脚本（SQLite 含 WAL）
# 用法：放入 crontab 每日执行，例如每天 03:00：
#   0 3 * * * /root/starmap/tools/deploy/backup.sh /root/starmap
# 会先安全 checkpoint（合并 WAL），再复制出单文件备份，保留最近 30 份。
set -euo pipefail

APP_DIR="${1:-$(pwd)}"
DB_DIR="$APP_DIR/server/data"
DB_FILE="$DB_DIR/starmap.db"
BACKUP_DIR="$APP_DIR/backups"
KEEP="${KEEP:-30}"

mkdir -p "$BACKUP_DIR"

# 用 better-sqlite3 安全 checkpoint（把 -wal 合并回主库），避免只备主文件丢数据
node -e "const D=require('$APP_DIR/node_modules/better-sqlite3'); const d=new D('$DB_FILE'); try{ d.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }catch(e){ console.error(e.message); } d.close();"

TS=$(date +%Y%m%d-%H%M%S)
cp "$DB_FILE" "$BACKUP_DIR/starmap-$TS.db"

# 保留最近 KEEP 份，删除更早的
ls -1t "$BACKUP_DIR"/starmap-*.db 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "备份完成：$BACKUP_DIR/starmap-$TS.db（保留最近 $KEEP 份）"

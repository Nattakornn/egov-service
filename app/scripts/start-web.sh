#!/usr/bin/env sh
# รันเว็บด้วย node ตรง (สำรองเมื่อไม่มี docker) · env เดียวกับ docker-compose.yml
#   TEST_MODE=1 ./scripts/start-web.sh
#   TEST_MODE=1 BUG_MODE=B03 PORT=3000 ./scripts/start-web.sh
#   DB_PATH=/abs/path/app.db ./scripts/start-web.sh     (ค่าเริ่มต้น <app>/data/app.db)
set -eu
cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
export PORT="${PORT:-3000}"
export DB_PATH="${DB_PATH:-$APP_DIR/data/app.db}"
export TEST_MODE="${TEST_MODE:-}"
export BUG_MODE="${BUG_MODE:-}"
mkdir -p "$(dirname "$DB_PATH")"
if [ ! -d node_modules ] || ! node -e "require('better-sqlite3')" >/dev/null 2>&1; then
  echo "[start-web] installing dependencies..."
  npm install --no-audit --no-fund
  npm rebuild better-sqlite3 >/dev/null 2>&1 || true
fi
echo "[start-web] PORT=$PORT TEST_MODE=${TEST_MODE:-off} BUG_MODE=${BUG_MODE:--} DB_PATH=$DB_PATH"
exec node src/server.js

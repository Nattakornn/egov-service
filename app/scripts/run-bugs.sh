#!/usr/bin/env bash
# รันชุด Playwright 51 TC กับเว็บถูกต้องและ BUG_MODE ทีละตัว ตาม BUGS.md §3 แล้วเทียบกับตาราง §2
#
#   scripts/run-bugs.sh                  ชุดเต็ม: ปกติ → ปกติซ้ำ (ไม่ restart) → B01..B12 → B03,B07 → B01,B05,B09 → ปกติอีกรอบ
#   scripts/run-bugs.sh normal           เฉพาะเว็บถูกต้อง 2 รอบติดกัน
#   scripts/run-bugs.sh B03 B07,B12      เฉพาะรหัสที่ระบุ (คั่นด้วยช่องว่าง · รวมหลายตัวในรอบเดียวด้วย ,)
#
#   RUNNER=docker (ค่าเริ่มต้นถ้ามี docker compose) : TEST_MODE=1 BUG_MODE=… docker compose up --build -d --wait web
#                                                   แล้ว docker compose --profile test run --rm e2e
#   RUNNER=local                                    : node src/server.js (PORT=3140 · DB ใน data/p14/) + เว็บไม่ตั้ง TEST_MODE (PORT+1)
#                                                   แล้ว cd e2e && npx playwright test (ตั้ง PW_EXECUTABLE_PATH ได้ถ้า browser ไม่ตรงเวอร์ชัน)
#
# ผล: reports/runs/<label>.json (Playwright JSON) · <label>.summary.json · <label>.txt (สรุป) · <label>.log (ผลรันเต็ม)
#     <label>.web.log (stdout ของเว็บระหว่างรอบ · TC-NFR-04 ค้น PII ในไฟล์นี้ผ่าน WEB_LOG_PATH)
# exit 0 = ทุกรอบตรงตามคาด · 1 = มีรอบที่ไม่ตรง
set -uo pipefail
cd "$(dirname "$0")/.."
APP="$(pwd)"
OUT="${OUT:-$APP/reports/runs}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"   # ทำเป็น absolute เพราะ run_suite cd เข้า e2e/

if [ -z "${RUNNER:-}" ]; then
  if docker compose version >/dev/null 2>&1 && docker info >/dev/null 2>&1; then RUNNER=docker; else RUNNER=local; fi
fi
PORT="${PORT:-3140}"
NOTEST_PORT="${NOTEST_PORT:-$((PORT + 1))}"
LOCAL_DIR="$APP/data/p14"
LOCAL_DB="$LOCAL_DIR/app.db"
BUILT=0
# เว็บ log ทุกคำขอ (METHOD path status ms) → TC-NFR-04 ตรวจ log ของเว็บได้ · ส่งให้ทั้ง up และ run (ค่าเดียวกัน compose จึงไม่ recreate web)
export LOG_REQUESTS="${LOG_REQUESTS:-1}"

# ---------------------------------------------------------------- ตาราง BUGS.md §2 / TEST-PLAN §18
must_fail() {
  case "$1" in
    B01) echo "TC-FEE-01" ;;
    B02) echo "TC-UPLOAD-01" ;;
    B03) echo "TC-SLA-01,TC-SLA-02" ;;
    B04) echo "TC-SLA-02" ;;
    B05) echo "TC-PAY-01" ;;
    B06) echo "TC-RBAC-01" ;;
    B07) echo "TC-RBAC-02" ;;
    B08) echo "TC-QUEUE-02" ;;
    B09) echo "TC-PDPA-02" ;;
    B10) echo "TC-DASH-02" ;;
    B11) echo "TC-PDPA-03,TC-AUDIT-01" ;;
    B12) echo "TC-WORKFLOW-04" ;;
    *) echo "" ;;
  esac
}
may_fail() {
  case "$1" in
    # B03: TC-NOTI-02 เพิ่มจากตาราง §2 (P14 triage) · ส่วน B ประเมินที่ ส.5 ธ.ค. → …000016/…000011 (กำหนด อ.8 ธ.ค.)
    #      "เหลือ 1" เพราะ 7 ธ.ค. เป็นวันหยุด · B03 นับ 7 ธ.ค. → เหลือ 2 = ปกติ → ไม่มีแจ้ง near (กลไกเดียวกับ TC-SLA-03 ส่วน B)
    B03) echo "TC-SLA-03,TC-RBAC-04,TC-NOTI-02" ;;
    B07) echo "TC-WORKFLOW-01" ;;
    B10) echo "TC-DASH-01,TC-DASH-03" ;;
    *) echo "" ;;
  esac
}
# union ของรหัสที่คั่นด้วย ,
union() { # $1 = must|may · $2 = "B03,B07"
  local fn="must_fail"; [ "$1" = may ] && fn="may_fail"
  local out="" code
  IFS=',' read -ra codes <<< "$2"
  for code in "${codes[@]}"; do
    [ -n "$code" ] || continue
    local v; v="$($fn "$code")"
    [ -n "$v" ] && out="${out:+$out,}$v"
  done
  echo "$out"
}

# ---------------------------------------------------------------- เปิดเว็บ
start_local() { # $1 = BUG_MODE
  for f in "$LOCAL_DIR/server.pid" "$LOCAL_DIR/notest.pid"; do
    if [ -f "$f" ]; then kill "$(cat "$f")" 2>/dev/null || true; rm -f "$f"; fi
  done
  sleep 1
  mkdir -p "$LOCAL_DIR/notest"
  TEST_MODE=1 BUG_MODE="$1" PORT="$PORT" DB_PATH="$LOCAL_DB" nohup node src/server.js > "$LOCAL_DIR/server.log" 2>&1 &
  echo $! > "$LOCAL_DIR/server.pid"
  TEST_MODE= BUG_MODE= PORT="$NOTEST_PORT" DB_PATH="$LOCAL_DIR/notest/app.db" nohup node src/server.js > "$LOCAL_DIR/notest.log" 2>&1 &
  echo $! > "$LOCAL_DIR/notest.pid"
  for _ in $(seq 1 50); do
    if curl -sf "http://localhost:$PORT/api/health" >/dev/null && curl -sf "http://localhost:$NOTEST_PORT/api/health" >/dev/null; then
      head -1 "$LOCAL_DIR/server.log"; return 0
    fi
    sleep 0.3
  done
  echo "[run-bugs] เว็บไม่ขึ้น"; cat "$LOCAL_DIR/server.log"; return 1
}
start_docker() { # $1 = BUG_MODE
  local build=""
  if [ "$BUILT" = 0 ]; then build="--build"; BUILT=1; fi
  TEST_MODE=1 BUG_MODE="$1" docker compose up $build -d --wait web || return 1
  docker compose logs web 2>/dev/null | grep -a "listening" | tail -1
}
start_web() {
  echo "[run-bugs] restart web · RUNNER=$RUNNER · TEST_MODE=1 · BUG_MODE=${1:--}"
  if [ "$RUNNER" = docker ]; then start_docker "$1"; else start_local "$1"; fi
}

# ---------------------------------------------------------------- รันชุดเต็ม
detect_exec() {
  if [ -z "${PW_EXECUTABLE_PATH:-}" ]; then
    local c
    c="$(ls -d /ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux*/chrome-headless-shell 2>/dev/null | tail -1)"
    [ -n "$c" ] && export PW_EXECUTABLE_PATH="$c"
  fi
}
run_suite() { # $1 = label · $2 = BUG_MODE
  local label="$1" bug="$2"
  rm -f "$APP/e2e/results/results.json"
  mkdir -p "$APP/e2e/results"
  if [ "$RUNNER" = docker ]; then
    # เก็บ stdout ของ web ต่อเนื่องระหว่างรอบ (ตั้งแต่เว็บเริ่ม) ลงไฟล์ที่ e2e container เห็นที่ /e2e/results/web.log
    local weblog="$APP/e2e/results/web.log" logpid
    rm -f "$weblog"
    docker compose logs --no-color --no-log-prefix -f web > "$weblog" 2>&1 &
    logpid=$!
    WEB_LOG_PATH=/e2e/results/web.log TEST_MODE=1 BUG_MODE="$bug" docker compose --profile test run --rm e2e > "$OUT/$label.log" 2>&1
    kill "$logpid" 2>/dev/null; wait "$logpid" 2>/dev/null
    cp "$weblog" "$OUT/$label.web.log" 2>/dev/null || true
  else
    detect_exec
    (cd "$APP/e2e" && BASE_URL="http://localhost:$PORT" BASE_URL_NO_TEST_MODE="http://localhost:$NOTEST_PORT" DB_PATH="$LOCAL_DB" \
      WEB_LOG_PATH="$LOCAL_DIR/server.log" npx playwright test > "$OUT/$label.log" 2>&1)
    cp "$LOCAL_DIR/server.log" "$OUT/$label.web.log" 2>/dev/null || true
  fi
  if [ ! -f "$APP/e2e/results/results.json" ]; then
    echo "[run-bugs] $label: ไม่มี results.json (ดู $OUT/$label.log)" | tee "$OUT/$label.txt"; return 1
  fi
  cp "$APP/e2e/results/results.json" "$OUT/$label.json"
  local must may
  must="$(union must "$bug")"; may="$(union may "$bug")"
  echo "== $label (BUG_MODE=${bug:--})" | tee "$OUT/$label.txt"
  node "$APP/scripts/pw-summary.js" "$OUT/$label.json" --expect "$must" --allow "$may" --json "$OUT/$label.summary.json" | tee -a "$OUT/$label.txt"
  return "${PIPESTATUS[0]}"
}

# ---------------------------------------------------------------- ลำดับรัน
PLAN=()
if [ $# -eq 0 ]; then
  PLAN=(normal B01 B02 B03 B04 B05 B06 B07 B08 B09 B10 B11 B12 "B03,B07" "B01,B05,B09" final)
else
  PLAN=("$@")
fi

FAILS=0
for item in "${PLAN[@]}"; do
  case "$item" in
    normal)
      start_web "" || exit 1
      run_suite normal-1 "" || FAILS=$((FAILS + 1))
      run_suite normal-2 "" || FAILS=$((FAILS + 1))   # ซ้ำทันที ไม่ restart (BUGS §3 ขั้น 2 · NFR-09)
      ;;
    final)
      start_web "" || exit 1
      run_suite normal-final "" || FAILS=$((FAILS + 1))
      ;;
    *)
      label="bug-$(echo "$item" | tr ',' '_')"
      start_web "$item" || exit 1
      run_suite "$label" "$item" || FAILS=$((FAILS + 1))
      ;;
  esac
done

# จบแล้วคืนเว็บเป็นโหมดถูกต้อง
start_web "" >/dev/null 2>&1 || true
echo "[run-bugs] เสร็จ · รอบที่ไม่ตรงตามคาด = $FAILS · ผลอยู่ใน $OUT"
[ "$FAILS" -eq 0 ]

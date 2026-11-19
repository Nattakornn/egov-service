#!/usr/bin/env bash
# พิสูจน์ว่าโหมดปกติ (ไม่ตั้ง TEST_MODE) ไม่ลบข้อมูลเมื่อ restart: docker compose up → ลงทะเบียนประชาชนใหม่ผ่าน API
# → docker compose restart web → ผู้ใช้ยังอยู่ → docker compose down (ไม่ -v) + up → ผู้ใช้ยังอยู่
#   scripts/restart-check.sh            ผลอยู่ใน reports/restart-check.txt (ปิด PII: แสดงเลขบัตร/เบอร์แค่ 4 ตัวท้าย)
# ⚠️ เขียนลง ./data/app.db จริง (เพิ่มประชาชน 1 คน) · DB รุ่นก่อน migration จะถูก baseline ตอนเริ่มครั้งแรก
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${OUT:-reports/restart-check.txt}"
BASE="http://localhost:${WEB_PORT:-3000}"
export TEST_MODE="" BUG_MODE="" LOG_REQUESTS=""
unset RESET_ON_START || true
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT
: > "$OUT"
log() { printf '%s\n' "$*" | tee -a "$OUT"; }
ts() { date '+%Y-%m-%d %H:%M:%S %z'; }

# เลขบัตรสมมติไม่ซ้ำ (checksum ถูกตาม BR-01) + เบอร์สมมติ
read -r ID MOB < <(node -e "
const base = '19' + String(Math.floor(Date.now() / 1000)).slice(-10);
let s = 0; for (let i = 0; i < 12; i++) s += Number(base[i]) * (13 - i);
console.log(base + ((11 - (s % 11)) % 10), '0899' + String(Date.now()).slice(-6));")
mask() { printf 'xxxxxxxxx%s' "${1: -4}"; }

dbsum() { # สรุปไฟล์ DB จริง (อ่านอย่างเดียว) + แถวของประชาชนที่ลงทะเบียน
  node -e "
const crypto = require('crypto');
const { loadConfig } = require('./src/core/config');
const { createCrypto } = require('./src/core/crypto');
const D = require('better-sqlite3');
const db = new D('data/app.db', { readonly: true, fileMustExist: true });
const c = createCrypto({ piiKey: loadConfig({}).piiKey });
const u = db.prepare('SELECT id, username, registered, consent_at, created_at FROM users WHERE id_hash = ?').get(c.hash(process.argv[1]));
const n = (t) => db.prepare('SELECT COUNT(*) n FROM ' + t).get().n;
const mig = db.prepare('SELECT id, substr(checksum,1,12) AS checksum, applied_at FROM schema_migrations ORDER BY rowid').all();
const meta = db.prepare('SELECT COUNT(*) n FROM meta').get().n;
console.log(JSON.stringify({ users: n('users'), cases: n('cases'), citizen: u || null, schema_migrations: mig, meta_rows: meta }));
" "$ID"
}

wait_health() {
  for _ in $(seq 1 60); do
    if [ "$(curl -s "$BASE/api/health" || true)" = '{"status":"ok"}' ]; then return 0; fi
    sleep 1
  done
  log "เว็บไม่ขึ้น"; docker compose logs web | tail -40 | tee -a "$OUT"; exit 1
}

api() { # method path [json]
  curl -s -c "$JAR" -b "$JAR" -X "$1" -H 'content-type: application/json' ${3:+-d "$3"} -w ' → HTTP %{http_code}' "$BASE$2"
}

login_again() { # ThaiD จำลองด้วยเลขบัตรเดิม → registered ต้องเป็น true · /api/me ต้องเป็น username เดิม
  : > "$JAR"
  log "  POST /api/auth/thaid/start   $(api POST /api/auth/thaid/start "{\"idNo\":\"$ID\"}")"
  log "  POST /api/auth/thaid/verify  $(api POST /api/auth/thaid/verify "{\"idNo\":\"$ID\",\"otp\":\"123456\"}")"
  log "  GET  /api/me                 $(api GET /api/me | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const [j,h]=s.split(' → ');const o=JSON.parse(j);console.log(JSON.stringify({username:o.username,role:o.role,registered:o.registered})+' → '+h)})")"
}

log "# restart-check · $(ts) · BASE=$BASE · เลขบัตรสมมติ $(mask "$ID") · เบอร์ $(mask "$MOB")"
log ""
log "## 1. docker compose up --build -d --wait web (ไม่ตั้ง TEST_MODE)"
docker compose up --build -d --wait web >/dev/null 2>&1
wait_health
log "  health: $(curl -s "$BASE/api/health") · POST /api/test/reset → HTTP $(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/test/reset")"
docker compose logs --no-color --no-log-prefix web 2>/dev/null | grep -a -E '\[migrate\]|listening' | sed 's/^/  log: /' | tee -a "$OUT"
log "  DB: $(dbsum)"
log ""
log "## 2. ลงทะเบียนประชาชนใหม่ผ่าน API (โหมดปกติ)"
log "  POST /api/auth/thaid/start   $(api POST /api/auth/thaid/start "{\"idNo\":\"$ID\"}")"
log "  POST /api/auth/thaid/verify  $(api POST /api/auth/thaid/verify "{\"idNo\":\"$ID\",\"otp\":\"123456\"}")"
log "  POST /api/auth/register      $(api POST /api/auth/register "{\"mobile\":\"$MOB\",\"consent\":true,\"email\":\"\"}")"
BEFORE="$(dbsum)"
log "  DB หลังลงทะเบียน: $BEFORE"
log ""
log "## 3. docker compose restart web · $(ts)"
docker compose restart web >/dev/null 2>&1
wait_health
docker compose logs --no-color --no-log-prefix web 2>/dev/null | grep -a -E '\[migrate\]|listening' | sed 's/^/  log (สะสมทั้งคอนเทนเนอร์): /' | tee -a "$OUT"
login_again
AFTER1="$(dbsum)"
log "  DB หลัง restart: $AFTER1"
log ""
log "## 4. docker compose down (ไม่ -v) แล้ว up -d --wait web · $(ts)"
docker compose down >/dev/null 2>&1
docker compose up -d --wait web >/dev/null 2>&1
wait_health
docker compose logs --no-color --no-log-prefix web 2>/dev/null | grep -a -E '\[migrate\]|listening' | sed 's/^/  log (คอนเทนเนอร์ใหม่): /' | tee -a "$OUT"
login_again
AFTER2="$(dbsum)"
log "  DB หลัง down/up: $AFTER2"
log ""
# เทียบ: users/citizen/schema_migrations ต้องเท่าเดิม
same() { node -e "const a=JSON.parse(process.argv[1]),b=JSON.parse(process.argv[2]);const k=x=>JSON.stringify([x.users,x.cases,x.citizen,x.schema_migrations]);process.exit(k(a)===k(b)?0:1)" "$1" "$2"; }
if same "$BEFORE" "$AFTER1" && same "$BEFORE" "$AFTER2" && node -e "process.exit(JSON.parse(process.argv[1]).citizen.registered===1?0:1)" "$AFTER2"; then
  log "RESULT: PASS · ผู้ใช้ที่ลงทะเบียนก่อน restart ยังอยู่ (registered=1) · users/cases/schema_migrations เท่าเดิมทั้งหลัง restart และหลัง down/up"
else
  log "RESULT: FAIL"; exit 1
fi

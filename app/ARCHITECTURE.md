# ARCHITECTURE · e-Service เทศบาลนครตัวอย่าง (หน่วยงานสมมติ)

> เจ้าของไฟล์นี้และ core: **P01** · ทุกบล็อกต้องอ่านไฟล์นี้ก่อนเขียนโมดูล
> stack: **Node 20 + Express 4 + better-sqlite3 + HTML render ฝั่งเซิร์ฟเวอร์ + JS ฝั่ง browser แบบ vanilla**
> สเปกที่ต้องตรง: `/workspace/egov-brief/` (REQUIREMENTS · CONTRACT · TEST-DATA · DECISIONS · BUGS)
> ห้ามใช้ชื่อ/ตรา/โลโก้หน่วยงานจริง · ThaiD / PromptPay / ลายเซ็น เป็นตัวจำลองทั้งหมด

---

## 1. วิธีรัน

| งาน | คำสั่ง (ในโฟลเดอร์ `app/`) |
|---|---|
| รันเว็บ (ปิด test hook) | `docker compose up --build -d` → http://localhost:3000 |
| โหมดทดสอบ | `TEST_MODE=1 docker compose up --build -d` |
| เปิดบั๊ก | `TEST_MODE=1 BUG_MODE=B03,B07 docker compose up --build -d` |
| Playwright ใน Docker | (หลังขึ้นเว็บด้วย TEST_MODE=1) `docker compose --profile test run --rm e2e` |
| ไม่มี docker | `TEST_MODE=1 ./scripts/start-web.sh` (node ตรง · env เดียวกัน) |
| unit test | `npm test` (ทุกไฟล์ `src/**/*.test.js` ด้วย `node:test`) · เฉพาะโฟลเดอร์: `npm test -- src/rules` |
| ดูสรุปข้อมูลใน DB | `DB_PATH=$PWD/data/app.db npm run seed:check` |
| เพิ่ม migration (เปลี่ยนโครงสร้างตาราง) | `npm run migrate:new -- <desc>` (core) · `npm run migrate:new -- <desc> --module <โฟลเดอร์>` (โมดูล) → ไฟล์ว่างเลขถัดไป (ดู §6.0) |

### ตัวแปรสภาพแวดล้อม

| env | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `PORT` | `3000` | พอร์ตของเว็บ (compose map เป็น `WEB_PORT` บนเครื่อง ค่าเริ่มต้น 3000) |
| `TEST_MODE` | ว่าง | `1` = เปิด `/api/test/*` + นาฬิกาแช่แข็งที่ `2026-12-01T09:00:00+07:00` + ล้างทุกตาราง รัน migration ทั้งหมดใหม่ และ seed ทุกครั้งที่เริ่มเครื่อง · ว่าง = `/api/test/*` ตอบ 404 ใช้เวลาจริง และ **ไม่ลบข้อมูล** (apply เฉพาะ migration ที่ค้าง · seed เฉพาะ DB ใหม่ที่ยังไม่มีผู้ใช้ · ดู §6.0) |
| `BUG_MODE` | ว่าง | `B01`–`B12` คั่น `,` (ดู §9) |
| `DB_PATH` | `<app>/data/app.db` · Docker `/data/app.db` | ไฟล์ SQLite (TC-NFR-04 อ่านไฟล์นี้) |
| `DATA_DIR` | โฟลเดอร์ของ `DB_PATH` | ที่เก็บข้อมูล |
| `UPLOAD_DIR` | `<DATA_DIR>/uploads` | เนื้อไฟล์แนบ (`seed/` ไฟล์ seed · `u/` ไฟล์อัปโหลด) |
| `PII_KEY` | คีย์ dev | hex 64 ตัว สำหรับ AES-256-GCM/HMAC ของข้อมูลส่วนบุคคล (production ต้องตั้ง) |
| `SIGN_KEY` | คีย์ทดสอบ | คีย์ HMAC ลายเซ็นเอกสาร (A-22) |
| `PUBLIC_BASE_URL` | ว่าง | ถ้าตั้ง ใช้แทน `<protocol>://<host>` ของ request ใน `ctx.ui.baseUrl(req)` (QR `/verify/…`) |
| `RESET_ON_START` | ว่าง | `1` = ล้างทุกตาราง รัน migration ทั้งหมดใหม่ และ seed ตอนเริ่ม (TEST_MODE ทำให้อยู่แล้ว) · **ห้ามตั้งกับข้อมูลจริง** |
| `STRICT_MODULES` | ว่าง | `1` = โมดูลที่ require/register ล้ม ทำให้เว็บไม่ขึ้น (ค่าเริ่มต้น: log แล้วข้ามโมดูลนั้น) |
| `LOG_REQUESTS` | ว่าง | `1` = log method/path/status (ไม่ log body) |

`docker-compose.yml`: service `web` (build `.` · `./data:/data` · healthcheck `/api/health`) และ service `e2e` (profile `test` · `mcr.microsoft.com/playwright:v1.49.1-jammy` · mount `./e2e:/e2e` และ `./data:/data:ro` · `BASE_URL=http://web:3000` `DB_PATH=/data/app.db` · รัน `npm install && npx playwright test`)

---

## 2. โครงโฟลเดอร์และเจ้าของ

```
app/
├─ package.json  package-lock.json      P01 (บล็อกอื่นห้ามแก้ · ต้องการ dependency เพิ่ม → เขียน NEEDS.md ในโมดูลตนเองให้ P14)
├─ Dockerfile  docker-compose.yml  .dockerignore                         P01
├─ scripts/start-web.sh                                                  P01 · scripts/run-bugs.sh = P14
├─ assets/fonts/NotoSansThai-{Regular,Bold}.ttf  (OFL 1.1)               P01 · ฟอนต์ไทยสำหรับ PDF
├─ src/
│  ├─ server.js                 P01 · โหลดโมดูลอัตโนมัติ (ห้ามแก้)
│  ├─ core/**                   P01 · helper กลาง migration seed test hook layout CSS
│  │    migrations/NNNN_<desc>.sql  โครงสร้างตารางกลาง (0001_init.sql = ตารางทั้งหมดตอนเริ่มโครงการ · §6.0)
│  ├─ rules/**                  P03 · ฟังก์ชันกฎตัวเลข (ไม่ใช่โมดูล ไม่ถูกโหลดอัตโนมัติ · require ตรง หรือ ctx.rules)
│  └─ modules/<ชื่อ>/           แต่ละบล็อก (ดู §3)
│        index.js               export { name, order, register(ctx) }
│        public/                → เสิร์ฟที่ /static/<ชื่อโฟลเดอร์>/
│        migrations/NNNN_<desc>.sql  (ถ้าจำเป็น) ตารางของโมดูล · core apply ให้อัตโนมัติ (§6.0)
│        *.test.js              unit test (node:test)
├─ e2e/**                       P12/P13 เท่านั้น (บล็อกเว็บห้ามแตะ)
├─ reports/**                   P14
└─ data/                        DB + uploads (ไม่เข้า image · bind mount)
```

โฟลเดอร์โมดูลตามแผน: `auth` (P02) · `apply` (P04) · `payment` (P05) · `cases` (P06) · `queue` + `notifications` (P07) · `workflow` (P08) · `documents` (P09) · `admin` + `audit` (P10) · `dashboard` (P11)

---

## 3. กติกาโมดูล (ต้องทำตามทุกข้อ)

1. **หนึ่งบล็อก = โฟลเดอร์ของตัวเอง** `src/modules/<ชื่อ>/index.js` ที่ export
   ```js
   module.exports = {
     name: 'queue',          // ชื่อโมดูล
     order: 50,              // ลำดับโหลด (น้อยก่อน · ไม่ระบุ = 100 · เท่ากันเรียงชื่อโฟลเดอร์)
     register(ctx) {         // sync หรือ async
       const { app, auth, ui } = ctx;
       app.get('/officer/queue', auth.page('officer', 'head'), (req, res) => ui.send(req, res, { title: 'คิวงาน', body: '<h1>คิวงาน</h1>…' }));
       app.get('/api/officer/queue', auth.api('officer', 'head'), (req, res) => res.json({ items: [] }));
     },
   };
   ```
   `server.js` โหลดทุกโฟลเดอร์ใน `src/modules` อัตโนมัติ (ข้ามโฟลเดอร์ที่ขึ้นต้นด้วย `_` หรือ `.`) → **ไม่มีใครแก้ไฟล์กลาง**
2. **ห้ามแก้ไฟล์ของบล็อกอื่น** รวม `src/core/**` `src/server.js` `package.json` · ต้องการอะไรเพิ่มจาก core/dependency → เขียน `src/modules/<ชื่อ>/NEEDS.md` ให้ P14
3. **ห้ามสร้างตารางนอก core** ถ้าจำเป็นจริง: เพิ่ม migration ของโมดูล `src/modules/<ชื่อ>/migrations/NNNN_<desc>.sql` ด้วย `npm run migrate:new -- <desc> --module <ชื่อ>` (กติกา §6.0 · **ห้ามแก้ไฟล์ migration ที่ apply แล้ว ให้เพิ่มไฟล์ใหม่เท่านั้น**) · ตารางโมดูลถูกลบ/สร้างใหม่ทุก reset ของโหมดทดสอบ · ข้อมูลตั้งต้นของตารางนั้นใส่ใน `ctx.hooks.onReset`
   - **ห้ามมีเลขบัตร/เบอร์โทรตัวอย่างในคอมเมนต์หรือ SQL ของไฟล์ migration** (SQLite เก็บข้อความ CREATE TABLE รวมคอมเมนต์ไว้ในไฟล์ DB → TC-NFR-04 เจอ · `src/core/test/migrate.test.js` ตรวจทุกไฟล์)
4. **เวลา: ห้าม `Date.now()` / `new Date()` ในกฎธุรกิจ** ใช้ `ctx.clock.now()` (Date) หรือ `ctx.clock.nowIso()` เท่านั้น
5. **บั๊ก BUG_MODE** ใส่เฉพาะจุดของบล็อกตนเองด้วย `if (ctx.bugs.on('B0x'))` ที่ตรรกะฝั่งเซิร์ฟเวอร์ ไม่เปลี่ยนข้อความ ไม่เปลี่ยน seed
6. **ข้อความ error ใช้ `ctx.errors`** (ข้อความตรงตัวตาม CONTRACT §5) ห้ามพิมพ์ข้อความเอง
7. **ข้อความสถานะ/ระดับ/บทบาท ใช้ `ctx.labels` / `ctx.ui.statusBadge` / `ctx.ui.slaBadge`** · วันที่/เงินใช้ `ctx.fmt` / `ctx.ui.time` / `ctx.ui.money`
8. **หน้าเว็บทุกหน้าใช้ `ctx.ui.send()`** (layout กลาง: lang=th · landmark · header testid · CSS) · ทุก `input/select/textarea` ต้องมี `<label for>` (ใช้ `ctx.ui.field` / `ctx.ui.select` ได้) · ตารางกว้างห่อด้วย `<div class="table-wrap">` (NFR-01)
9. **static** ไว้ที่ `src/modules/<ชื่อ>/public/` → URL `/static/<ชื่อโฟลเดอร์>/<ไฟล์>` แล้วส่งใน `ui.send(..., { scripts: ['/static/queue/queue.js'] })`
10. **กฎตัวเลขทำฝั่งเซิร์ฟเวอร์เท่านั้น** (ค่าธรรมเนียม SLA ระดับเตือน) หน้าเว็บเรียก API แล้วแสดงผล เพื่อให้ BUG_MODE เห็นบนจอ
11. **unit test** ชื่อ `*.test.js` ในโฟลเดอร์โมดูล ใช้ `node:test` + `node:assert/strict` · ถ้าต้องใช้ DB ให้สร้าง server/context ชั่วคราว (ดู §11)
12. **PDPA**: ห้ามเขียนเลขบัตร/เบอร์เต็มลง DB (นอกจากผ่าน `ctx.crypto.enc`) ลง log ลง Audit detail หรือใน JSON ของ API เจ้าหน้าที่ (ดู §10)

---

## 4. `ctx` ที่ทุกโมดูลได้รับ

| ชื่อ | คืออะไร / ใช้อย่างไร |
|---|---|
| `ctx.app` | Express app · ลงทะเบียน route ตรงนี้ |
| `ctx.db` | better-sqlite3 (synchronous) · `ctx.db.prepare(sql).get/all/run()` · `ctx.db.tx(() => {...})` = transaction (throw = rollback · ซ้อนได้) · **handler แบบ sync ทั้งก้อน = atomic** (Node thread เดียว) ใช้กันชนกันของ claim/ชำระพร้อมกันได้ |
| `ctx.clock` | `now()` → Date · `nowIso()` → `'2026-12-01T09:00:00+07:00'` · (เป็น singleton: โค้ดที่ไม่มี ctx เช่น `src/rules` ใช้ `require('../core/clock').clock`) |
| `ctx.bugs` | `on('B03')` → bool · `list()` · (singleton: `require('../core/bugs').bugs` · unit test สลับด้วย `bugs.set(['B01'])` / `bugs.set('')`) |
| `ctx.time` | เวลาไทย: `iso(x)` `ymd(x)` `ym(x)` `hhmm(x)` `parts(x)`→`{y,m,d,hh,mi,ss,dow}` `fromParts(y,m,d,hh,mi,ss)` `toDate(x)` (รับ Date/ISO/`'YYYY-MM-DD'`/`'YYYY-MM-DD HH:MM'` เวลาไทย) `parseIsoStrict(s)` `addDaysYmd(ymd,n)` `dowYmd(ymd)` `addMinutes` `addHours` `beYear(x)` `cmp(a,b)` |
| `ctx.fmt` | `money(1010)`→`฿1,010` · `dateTime(x)`→`4 ธ.ค. 2569 16:30` · `date(x)`→`2 ก.พ. 2570` · `iso(x)` · `pct(85.7)`→`85.7%` (null→`–`) · `idFull(id)`→`1-1017-00123-45-6` · `maskId(id)`→`X-XXXX-XXXXX-45-6` · `maskName('สมชาย ใจดี')`→`สมชาย ใ***` · `esc(s)` · `DASH` = `–` (U+2013) |
| `ctx.labels` | `STATUS_TH` `LEVEL_TH` `ROLE_TH` `DEPT_TH` `PAYMENT_STATUS_TH` `DOC_KEY_TH` `LANDING` `NAV` `TIMELINE_TH` `OPEN_STATUSES` (งานคงค้าง 5 สถานะ) `CLOSED_STATUSES` (`COMPLETED` `REJECTED`) |
| `ctx.errors` | `fail(code, extra?, message?)` throw · `send(res, code, extra?, message?)` · `AppError` · `message(code)` · `CATALOG` (ทุกรหัสใน CONTRACT §5 + `INVALID_TIME` `BAD_REQUEST`) |
| `ctx.crypto` | `enc(s)` / `dec(s)` AES-256-GCM · `hash(s)` HMAC-SHA256 hex (deterministic สำหรับ `WHERE id_hash = ?`) · `hashPassword(pw, username)` / `verifyPassword(pw, hash)` · `randomHex(n)` |
| `ctx.sign` | `signDoc(fields)` · `verifyDoc(row)` · `docCanonical(fields)` · `hmac(canonical)` (ดู §8) |
| `ctx.ids` | เลขรันใน transaction เดียวกับการสร้างรายการ: `caseNo(paidAt)`→`EG-2569-000031` (ปี พ.ศ. ของเวลาชำระ เริ่มใหม่ทุกปี) · `receiptNo(paidAt)` · `docNo(issuedAt)` · `draftId()`→`DR-0003` · `paymentRef()`→`PP-0002` · `fileId()`→`F-000051` · `citizenUsername()`→`cit-0005` · `verifyCode(existsFn)` `[A-Z0-9]{8}` · `next(name)` `peek(name)` |
| `ctx.catalog` | `service('SV-03')`→`{id,name,feeType,fee,feePerSqm,sla,approver,route,docs}` · `services()` · `holidays()`→`['2026-12-07',…]` · `holidaySet()` · `docName('plan')`→`แบบแปลน` (อ่าน DB ทุกครั้ง → ผู้ดูแลแก้แล้วมีผลทันที) |
| `ctx.audit` | `log({username, role, event, caseNo, fromStatus, toStatus, detail})` · `logReq(req, {...})` · `toJson(row)` · `EVENTS` (10 เหตุการณ์ BR-27) |
| `ctx.caseEvents` | เปลี่ยนสถานะ + ไทม์ไลน์ (+Audit) — §6 |
| `ctx.storage` | ไฟล์แนบ: `save(fileId, buffer)`→path สัมพัทธ์ (ใส่ `files.storage`) · `read(fileRow)`→Buffer · `remove(row)` · `exists(row)` · `detectType(buf)`→`{type:'pdf'|'jpg'|'png', mime, ext}`/`null` (magic bytes `%PDF` · `FF D8 FF` · `89 50 4E 47`) · `MAX_FILE_BYTES` = 5,242,880 · `MAX_FILES_PER_CASE` = 5 · `dir` |
| `ctx.upload` | multer (memoryStorage · limit 7 MB/ไฟล์ · 10 ไฟล์) เช่น `ctx.upload.single('file')` → `req.file.buffer` · ไฟล์ 5,242,881 ไบต์ถึง handler ได้ → โมดูลตอบ `FILE_TOO_LARGE` เอง · ใหญ่กว่า 7 MB core แปลงเป็น 400 `FILE_TOO_LARGE` (ไม่ใช่ 413) |
| `ctx.auth` | session + guard — §5 |
| `ctx.ui` | layout/HTML helper — §7 |
| `ctx.hooks` | จุดต่อ — §4.1 |
| `ctx.wrap(fn)` | ห่อ async handler: `app.get('/x', ctx.wrap(async (req,res)=>{...}))` (Express 4 ไม่จับ promise reject เอง) |
| `ctx.rules` | `require('src/rules')` ของ P03 (null ถ้ายังไม่มี) |
| `ctx.shared` | object กลางให้โมดูลแชร์ฟังก์ชันกันตอน runtime เช่น P04 ตั้ง `ctx.shared.apply = { missingDocs }` แล้ว P05 เรียก (หรือ `require('../apply/lib')` ตรงก็ได้) |
| `ctx.paths` | `appRoot` `dataDir` `uploadDir` `dbPath` `assets` `fonts.regular` `fonts.bold` (ฟอนต์ไทย PDF) |
| `ctx.config` | `testMode` `port` `dbPath` … (อย่าอ่าน `process.env` เอง) |
| `ctx.log(...)` | log ของระบบ (ห้ามใส่ข้อมูลส่วนบุคคล) |
| `ctx.reset()` | ล้างและ seed ใหม่ (ใช้ภายใน `/api/test/reset`) |

### 4.1 `ctx.hooks`

| hook | ใช้อย่างไร |
|---|---|
| `onRequest(priority, fn)` | `fn(req, ctx)` ทุก request ก่อนเข้า route **ยกเว้น `/api/test/*`** (CONTRACT §0 ข้อ 7) และ `/static/*` `/favicon.ico` · เรียงน้อย → มาก · `req.user` พร้อมแล้ว · error ถูก log แล้วข้าม · **ข้อตกลง priority: `10` = เปลี่ยนสถานะอัตโนมัติ (P06 ยกเลิกเมื่อเลย 168 ชม. · A-46) · `50` = ประเมินแจ้งเตือน (P07 · A-30)** · ทั้งคู่ต้อง idempotent (นาฬิกาแช่แข็ง เรียกซ้ำได้ผลเดิม) |
| `onReset(fn)` | `fn(ctx)` หลัง seed ทุกครั้ง (reset และเริ่มเครื่องที่ seed ใหม่) · ใช้ล้าง cache ในหน่วยความจำ/ใส่ข้อมูลตั้งต้นของตารางโมดูล · ตาราง core ถูกล้างให้แล้ว (sessions otp_attempts notifications audit ไฟล์อัปโหลด) |
| `testRoute(method, path, ...handlers)` | route ใต้ `/api/test/` เช่น `ctx.hooks.testRoute('post', '/api/test/payments/:ref/pay', handler)` (P05) · `('post', '/api/test/documents/:docNo/tamper', h)` (P09) · ไม่ตั้ง TEST_MODE → core ตอบ 404 ให้ทุก path |
| `bellCount(fn)` | `fn(user, ctx)` → จำนวนแจ้งเตือน → แสดงใน `bell-count` (P07 ลงทะเบียน) |
| `navItems(role, items)` | เมนูเพิ่ม `[{testid, href, label}]` (เมนูตาม CONTRACT §2.1 core ใส่ให้ครบแล้ว **ไม่ต้องลงซ้ำ**) |

---

## 5. Session · RBAC (FR-03 · CONTRACT §0 ข้อ 6 · §1)

- cookie `eg_sid` (HttpOnly · SameSite=Lax · Path=/) → ตาราง `sessions` · reset ลบทุก session (ต้องล็อกอินใหม่)
- `req.user` = `null` หรือ `{ id, username, name, role, dept, scope, registered, sid }` · `role/dept` เป็นค่า ณ ตอนล็อกอิน (admin เปลี่ยนบทบาท → มีผลครั้งถัดไป)
- `scope`: `'full'` ปกติ · `'register'` = ประชาชนยืนยัน ThaiD แล้วแต่ยังไม่ลงทะเบียน (cookie ใช้ได้เฉพาะหน้า/API ลงทะเบียน)

| ฟังก์ชัน | ผล |
|---|---|
| `auth.page(...roles)` | ไม่ล็อกอิน → 302 `/login` · scope register → 302 `/register` · บทบาทไม่ตรง → **HTTP 403 + `forbidden-msg` = `ไม่มีสิทธิ์เข้าถึงหน้านี้`** · ไม่ระบุบทบาท = ล็อกอินแล้วใครก็ได้ |
| `auth.api(...roles)` | ไม่ล็อกอิน/scope register → **401 `{"code":"UNAUTHENTICATED","message":"กรุณาเข้าสู่ระบบ"}`** · บทบาทไม่ตรง → **403 `{"code":"FORBIDDEN","message":"ไม่มีสิทธิ์ทำรายการนี้"}`** |
| `auth.pendingCitizen({api})` | เฉพาะ scope register (หน้า `/register` และ `POST /api/auth/register`) |
| `auth.createSession(res, userRow, {scope})` | สร้าง session + ตั้ง cookie (P02 เรียกหลัง OTP/รหัสผ่านถูก) |
| `auth.destroySession(req, res)` | ออกจากระบบ · core มี **`POST /logout`** (ปุ่ม `logout-btn` ในหัวเว็บ) → 303 `/login` · P02 ทำ `POST /api/auth/logout` (204) ด้วยฟังก์ชันนี้ |
| `auth.landingFor(user)` | หน้าตั้งต้น: citizen `/citizen` (scope register → `/register`) · officer `/officer/queue` · head `/head/approvals` · executive `/dashboard` · auditor `/audit` · admin `/admin/services` · ไม่ล็อกอิน `/login` |
| `auth.findCitizenByIdNo(idNo)` | หา user ประชาชนด้วย `id_hash` |
| `auth.citizenIdNo(userRowOrId)` | ถอดเลขบัตรเต็ม (ใช้กับเจ้าของ และ unmask เท่านั้น) |
| `auth.verifyPassword(pw, hash)` | ตรวจรหัสผ่านเจ้าหน้าที่ |

**route `/`** (core): ไม่ล็อกอิน → `/login` · ล็อกอินแล้ว → `landingFor`

### 5.1 ตาราง guard ที่แต่ละโมดูลต้องใส่ (CONTRACT §1 · TC-RBAC-03)

| Route | guard | โมดูล |
|---|---|---|
| `/login` | ไม่มี | auth |
| `/register` · `POST /api/auth/register` | `auth.pendingCitizen()` / `({api:true})` | auth |
| `/citizen` · `/citizen/new/:service` · `/citizen/cases/:caseNo` | `auth.page('citizen')` (ของคนอื่น/ไม่มี → `ui.notFound` 404) | cases · apply |
| `/officer/queue` · `/notifications` | `auth.page('officer','head')` | queue · notifications |
| `/officer/cases/:caseNo` | `auth.page('officer','head')` (ไม่มีเลข → 404) | workflow |
| `/head/approvals` | `auth.page('head')` | workflow |
| `/dashboard` | `auth.page('executive')` | dashboard |
| `/audit` | `auth.page('auditor')` | audit |
| `/admin/services` `/admin/holidays` `/admin/users` | `auth.page('admin')` | admin |
| `/verify/:code` · `GET /api/verify/:code` · `/api/health` | ไม่ต้องล็อกอิน · ไม่ขึ้นกับ TEST_MODE | documents · core |
| `/api/drafts*` `/api/payments/:ref` `POST /api/cases/:no/cancel|resubmit` | `auth.api('citizen')` (admin/เจ้าหน้าที่ → 403) | apply · payment · cases |
| `GET /api/cases/:caseNo` | `auth.api('citizen','officer','head')` · citizen ไม่ใช่เจ้าของ → 404 | cases |
| `/api/officer/*` `/api/notifications` | `auth.api('officer','head')` + ตรวจแผนก/ผู้ถือในโมดูล | queue · workflow · notifications |
| `POST /api/cases/:no/approve|reject` | `auth.api('officer','head')` + ตรวจอำนาจ (BR-21) | workflow |
| `/api/dashboard*` | `auth.api('executive')` | dashboard |
| `/api/audit*` | `auth.api('auditor')` (PUT/PATCH/DELETE → 405 ก่อน guard) | audit |
| `/api/admin/*` | `auth.api('admin')` | admin |

---

## 6. ฐานข้อมูล (`src/core/migrations/`) และข้อตกลงของข้อมูล

### 6.0 Migration แบบเพิ่มไฟล์ (`src/core/migrate.js`)

> **ห้ามแก้ไฟล์ migration ที่ apply แล้ว ให้เพิ่มไฟล์ใหม่เท่านั้น**

| เรื่อง | กติกา |
|---|---|
| ไฟล์ | core: `src/core/migrations/NNNN_<desc>.sql` · โมดูล: `src/modules/<โฟลเดอร์>/migrations/NNNN_<desc>.sql` · `NNNN` = เลข 4 หลักเริ่ม `0001` ห้ามซ้ำใน scope เดียวกัน · `desc` = `a-z 0-9 _` · ชื่อผิดรูปแบบ/เลขซ้ำ/`0000` = ไม่เริ่มระบบ · ไฟล์ `.md` และ dotfile ถูกข้าม |
| สร้างไฟล์ | `npm run migrate:new -- <desc>` หรือ `npm run migrate:new -- <desc> --module <โฟลเดอร์>` → ไฟล์ว่างเลขถัดไป แล้วเขียน SQL แบบเพิ่ม (`ALTER TABLE … ADD COLUMN` · `CREATE TABLE` · `CREATE INDEX` · `UPDATE` ข้อมูลที่จำเป็น) · ไม่ต้องมี `BEGIN/COMMIT` · ไฟล์ว่างที่ยังไม่ apply = ไม่เริ่มระบบจนกว่าจะใส่ SQL |
| ตารางบันทึก | `schema_migrations(id, checksum, applied_at)` · `id` = `core/0001_init.sql` หรือ `<โฟลเดอร์โมดูล>/<ไฟล์>` · `checksum` = sha256 ของเนื้อไฟล์ (ตัด BOM · CRLF นับเป็น LF) |
| ลำดับ | core ก่อน แล้วโมดูลตามลำดับโหลด (`order` แล้วชื่อโฟลเดอร์ · `server.js` require โมดูลก่อนสร้าง ctx) · ในแต่ละ scope เรียงตามเลข · ไฟล์ใหม่ต้องมีเลขมากกว่าตัวล่าสุดที่ apply แล้วของ scope นั้น · แต่ละไฟล์รันใน transaction ของตัวเองพร้อมแถว `schema_migrations` (SQL ผิด → rollback เฉพาะไฟล์นั้น แล้วไม่เริ่มระบบ) |
| เริ่มเครื่อง (โหมดปกติ) | ตรวจ checksum ของไฟล์ที่ apply แล้วทุกไฟล์ → apply เฉพาะไฟล์ที่ค้าง → seed **เฉพาะ DB ใหม่ที่ยังไม่มีผู้ใช้** · ไม่มีการลบตาราง/ข้อมูลในโหมดปกติ |
| ไฟล์ที่ apply แล้วถูกแก้/ลบ/เปลี่ยนชื่อ | **ไม่เริ่มระบบ** พร้อมข้อความบอกชื่อไฟล์และให้คืนไฟล์เดิมแล้วเพิ่ม migration ใหม่ · ไม่แตะข้อมูลใน DB |
| `TEST_MODE=1` · `RESET_ON_START=1` · `POST /api/test/reset` | ลบทุกตาราง (รวม `schema_migrations` และตารางโมดูล) → รัน migration ทั้งหมดใหม่ → seed (ใน transaction เดียว) |
| DB รุ่นก่อนมี migration | มีตาราง + key เดิมในตาราง `meta` แต่ไม่มี `schema_migrations` → ถ้าโครงสร้างตรงกับ `core/0001_init.sql` (เทียบ `sqlite_master` โดยไม่สนคอมเมนต์/ช่องว่าง) บันทึก `core/0001_init.sql` ว่า apply แล้วโดยไม่รัน (baseline) แล้วลบ key เดิมออก · ไม่ตรง หรือเป็น DB ที่ไม่รู้จัก → ไม่เริ่มระบบ (ไม่ลบอะไร) |
| ตัวอย่าง (สมมติ ไม่มีไฟล์นี้จริง) | `src/core/migrations/0002_users_nickname.sql`: `ALTER TABLE users ADD COLUMN nickname TEXT;` |
| unit test | `src/core/test/migrate.test.js` (DB ใหม่ · restart ข้อมูลอยู่ · เพิ่ม 0002 · แก้ไฟล์ที่ apply แล้ว · baseline DB รุ่นเดิม · TEST_MODE/reset · เลขซ้ำ/ผิดรูปแบบ · migrate:new · NFR-04) |

### 6.1 ตารางและคอลัมน์

**รูปแบบค่า**: เวลาทุกคอลัมน์เก็บเป็นข้อความ `'YYYY-MM-DDTHH:MM:SS+07:00'` (`ctx.time.iso` / `ctx.clock.nowIso`) → เปรียบเทียบ/เรียงด้วย string ได้ (`closed_at <= due_at`) และตัด `substr(x,1,7)` = เดือน `YYYY-MM` · วันที่ล้วน `'YYYY-MM-DD'` · เงินจำนวนเต็มบาท · JSON ที่ API ส่งออกใช้ ISO รูปแบบเดียวกัน

| ตาราง | คีย์ · คอลัมน์สำคัญ |
|---|---|
| `users` | `id` · `username` (เจ้าหน้าที่ `off.reg1` … · ประชาชน `cit-0001` …) · `password_hash` (scrypt) · `name` · `role` · `dept` (`registry`/`works`/NULL) · `id_enc` `id_hash` `mobile_enc` `mobile_hash` (NFR-04) · `email` · `registered` (0 = ยังไม่ลงทะเบียน) · `consent_at` · `active` |
| `services` | `id` · `name` · `fee_type` (`per_copy`/`fixed`/`area`) · `fee` (SV-01 ต่อฉบับ · SV-02 คงที่ · SV-03 ฐาน) · `fee_per_sqm` (SV-03) · `sla` · `approver` (`officer`/`head`) · `route` JSON · `docs` JSON `[{key,name,required,pdfOnly}]` เรียงตาม CONTRACT §4.3 |
| `holidays` | `date` · `name` |
| `drafts` | `id` `DR-0001` · `citizen_id` · `service_id` · `status` (`DRAFT`/`PENDING_PAYMENT`/`PAID`) · `qty` · `area_sqm` · `fee` · `locked_amount` (BR-11 ล็อกตอนเข้า PENDING_PAYMENT) · `case_no` (หลังชำระ) |
| `files` | `id` = fileId `F-000001` · `draft_id` / `case_no` · `doc_key` (`id-card` `map` `site-photo` `plan` `deed` `extra`) · `name` · `mime` (จากชนิดจริง) · `size` · `storage` (path ใต้ UPLOAD_DIR) · `seed` · `uploaded_by` · `uploaded_at` · **ตอนชำระสำเร็จให้ตั้ง `case_no` ของไฟล์ร่างนั้น** |
| `payments` | `ref` `PP-0001` · `draft_id` · `amount` · `status` (`PENDING`/`PAID`/`VOID`) · `qr_created_at` · `qr_expires_at` (+15:00) · `paid_at` · `case_no` · `receipt_no` · (EXPIRED คำนวณจากเวลา ไม่ต้องเก็บ) |
| `cases` | ดูตารางถัดไป |
| `case_timeline` | `case_no` `at` `event` `from_status` `to_status` `actor` `actor_name` `actor_role` `text` (ไทยที่แสดง) `detail` |
| `returns` | `case_no` `seq` `returned_at` `returned_by` `reason` `fix_deadline` `resubmitted_at` `paused_days` |
| `documents` | `doc_no` · `case_no` · `verify_code` · `applicant` (ชื่อเต็ม) · `service_id` · `issued_at` (ISO) · `valid_until` (`YYYY-MM-DD`) · `signer` (ชื่อแสดง) · `signer_username` · `signature` · `issued_by` |
| `notifications` | `username` `case_no` `level` (`near`/`overdue`) `text` `created_at` `read_at` · **UNIQUE(username, case_no, level)** → `INSERT OR IGNORE` = ไม่แจ้งซ้ำ (BR-15) |
| `audit` | `at` `username` `role` `event` `case_no` `from_status` `to_status` `detail` · **trigger กัน UPDATE/DELETE** (เพิ่มได้อย่างเดียว) |
| `sessions` | `sid` `user_id` `role` `dept` `scope` |
| `otp_attempts` | `id_hash` (= `crypto.hash(เลขบัตร)` ห้ามเก็บเลขตรง) `fail_count` `locked_until` `last_fail_at` `otp_sent_at` |
| `counters` | `name` `value` (ใช้ผ่าน `ctx.ids`) |
| `meta` | `key` `value` · ไม่มีโค้ดใช้แล้ว (คงไว้เพราะอยู่ใน `0001_init.sql` ซึ่งห้ามแก้) |
| `schema_migrations` | `id` `checksum` `applied_at` · core ดูแลเอง (§6.0) ห้ามโมดูลเขียน |

### 6.2 ตาราง `cases` · ความหมายของคอลัมน์ (seed ทำตามนี้ ทุกโมดูลต้องทำแบบเดียวกัน)

| คอลัมน์ | ความหมาย |
|---|---|
| `status` | ตาม CONTRACT §4.1 (ไม่มี DRAFT/PENDING_PAYMENT ในตารางนี้ — อยู่ใน `drafts`) |
| `step` | SV-03 เท่านั้น: 1 ทะเบียน · 2 โยธา · 3 หัวหน้า · บริการอื่น NULL (`case-step` แสดงเฉพาะ SV-03) |
| `dept` | คิวที่เรื่องอยู่: `registry` · `works` · `head` (PENDING_APPROVAL) · NULL (ปิด/ยกเลิก) |
| `owner` | username ผู้ถือเรื่อง (IN_REVIEW · NEED_FIX ยังเป็นผู้ถือเดิม) · ไม่มี = NULL |
| `issuer` | ผู้ออกเอกสาร (A-27) = **เจ้าหน้าที่ทะเบียนที่รับเรื่องขั้นแรก** (ตั้งตอน claim ที่ `dept='registry'` ถ้ายังว่าง) |
| `approved_by` `approved_at` | ผู้อนุมัติ = ผู้ลงนามเอกสาร (SV-01 เจ้าหน้าที่ · SV-02/03 head) |
| `paid_at` `due_at` | เวลาชำระ · กำหนดเสร็จ (คำนวณครั้งเดียวตอนชำระ + ขยายเมื่อส่งแก้ · seed เก็บตายตัว A-35 ห้ามคำนวณใหม่) |
| `return_count` `returned_at` `fix_deadline` | ตีกลับกี่ครั้ง · ครั้งล่าสุด · `returned_at + 168 ชม.` (มีค่าเฉพาะตอน NEED_FIX) |
| `closed_at` | เฉพาะ COMPLETED / REJECTED · `cancelled_at` เฉพาะ CANCELLED (ไม่ใช่ปิดงาน) |
| `receipt_no` `doc_no` `payment_ref` `draft_id` | ใบเสร็จ · เอกสาร · ref ชำระ · ร่างต้นทาง (seed = NULL) |

**การเปลี่ยนสถานะ (ข้อตกลงร่วม · seed ใช้กติกานี้):**

| เหตุการณ์ | ผลต่อแถว `cases` |
|---|---|
| ชำระสำเร็จ (P05) | INSERT: `status SUBMITTED` · `dept registry` · `step` 1 (SV-03) · `owner/issuer NULL` · `due_at` จาก rules · timeline `PAID` (from NULL → SUBMITTED) |
| รับเรื่อง (P07) | SUBMITTED → IN_REVIEW (หรือ IN_REVIEW ที่ไม่มีผู้ถือที่โยธา → IN_REVIEW) · `owner = ผู้รับ` · ถ้า `dept='registry'` และ `issuer` ว่าง → `issuer = ผู้รับ` |
| ส่งต่อ SV-03 ทะเบียน → โยธา (P08) | IN_REVIEW → IN_REVIEW · `step 2` · `dept works` · `owner NULL` |
| ส่งต่อถึงหัวหน้า (SV-02 จากทะเบียน · SV-03 จากโยธา) | → PENDING_APPROVAL · `dept head` · `owner NULL` · SV-03 `step 3` |
| อนุมัติ (SV-01 ผู้ถือ · SV-02/03 head) | → APPROVED · `approved_by/at` · `dept registry` · `owner NULL` (ผู้ออกเอกสาร = `issuer`) |
| ไม่อนุมัติ | → REJECTED · `closed_at` · `dept/owner NULL` |
| ออกเอกสาร (P09 · โดย `issuer`) | APPROVED → COMPLETED · `closed_at` · `doc_no` · `dept NULL` |
| ตีกลับ (P08) | IN_REVIEW → NEED_FIX · `owner` คงเดิม · `return_count+1` · `returned_at` · `fix_deadline` · แถวใหม่ใน `returns` |
| ส่งแก้ (P06) | NEED_FIX → IN_REVIEW · ผู้ถือเดิม (BR-18 เกิน 10 ได้) · `fix_deadline NULL` · `due_at` ขยายตาม BR-13 · อัปเดต `returns.resubmitted_at/paused_days` |
| ยกเลิกเอง (P06) | SUBMITTED ที่ `owner IS NULL` → CANCELLED · `cancelled_at` · `dept NULL` |
| ยกเลิกอัตโนมัติ (P06 · onRequest p10) | NEED_FIX ที่ `now ≥ fix_deadline` → CANCELLED · timeline `AUTO_CANCEL` |

**คิวตาม TEST-DATA §9**: คิวทะเบียน = `dept='registry' AND status IN ('SUBMITTED','IN_REVIEW','APPROVED')` เรียง `due_at, case_no` (17 แถว) · คิวโยธา = `dept='works' AND status IN ('SUBMITTED','IN_REVIEW')` (1 แถว) · `/head/approvals` = `status='PENDING_APPROVAL'` (2 แถว) · NEED_FIX/PENDING_APPROVAL ไม่อยู่ในคิวแผนก · งานในมือ = `status='IN_REVIEW' AND owner=?`
**แผนกที่เคยผ่าน (BR-29)**: ดูจาก `route` ของบริการ + `step`/`dept` ปัจจุบัน (เช่น SV-03 `step ≥ 2` = ผ่านทะเบียนแล้ว)

### 6.3 `ctx.caseEvents`

```js
// เปลี่ยนสถานะ + ไทม์ไลน์ (+ Audit) ใน transaction เดียว · from ไม่ตรง → 409 INVALID_STATE · ไม่มีเลข → 404 NOT_FOUND
const { from, row } = ctx.caseEvents.transition(caseNo, {
  from: 'SUBMITTED',                       // string | string[] (ไม่ส่ง = ไม่ตรวจ)
  to: 'IN_REVIEW',
  event: 'CLAIM',                          // รหัสไทม์ไลน์ (labels.TIMELINE_TH): PAID CLAIM RETURN RESUBMIT FORWARD APPROVE REJECT ISSUE CANCEL AUTO_CANCEL NOTE
  actor: req.user,                         // null = ระบบ
  set: { owner: req.user.username },       // คอลัมน์อื่นของ cases
  check: (row) => { if (row.owner) ctx.errors.fail('ALREADY_CLAIMED'); },   // ตรวจเพิ่มภายใน transaction
  text: 'รับเรื่องโดย เจ้าหน้าที่ทะเบียน 2', // ไม่ส่ง = ข้อความตั้งต้น
  detail: null,                            // เหตุผล/หมายเหตุ
  audit: true,                             // เขียน Audit event เดียวกัน (fromStatus/toStatus อัตโนมัติ) · หรือระบุชื่อ event · false = ไม่เขียน
  auditDetail: '',                         // ไม่ส่ง = detail
});
ctx.caseEvents.record(caseNo, { event: 'PAID', from: null, to: 'SUBMITTED', actor, text });   // ไทม์ไลน์ดิบ (คำขอใหม่)
ctx.caseEvents.note(caseNo, { event: 'NOTE', actor, text, detail });                         // ไม่เปลี่ยนสถานะ
ctx.caseEvents.timeline(caseNo);   // [{id, at, event, fromStatus, toStatus, actor, actorName, actorRole, text, detail}] เก่า → ใหม่
ctx.caseEvents.get(caseNo);        // แถว cases
```
บั๊กที่ต้อง "ข้ามการตรวจ" (B07 B08 B12) ทำในโมดูลโดยไม่ส่ง `check`/ขยาย `from` เมื่อ `ctx.bugs.on(...)`

---

## 7. หน้าเว็บ (`ctx.ui`) · CSS · JS ฝั่ง browser

```js
ctx.ui.send(req, res, { title: 'คิวงาน', body: html, scripts: ['/static/queue/queue.js'], styles: [], status: 200 });
```
layout กลางมีให้แล้ว (ห้ามทำซ้ำในโมดูล): `<html lang="th">` · skip link · `<header data-testid="app-header">` ที่มี **`user-name`** · **`user-role`** (`data-role`, officer มี `data-dept`) · **`logout-btn`** · **เมนู `nav-*` ตามบทบาท** (CONTRACT §2.1) · **`nav-bell` + `bell-count`** (officer/head · ตัวเลขจาก `hooks.bellCount`) · `<main id="main">` · `<footer>` · `/static/core/app.css` + `/static/core/app.js`
หน้าไม่ล็อกอิน (`/login` `/verify`) มีหัวเว็บแบบชื่อเว็บอย่างเดียว

| helper | ผล |
|---|---|
| `ui.forbidden(req,res)` | 403 + `<p data-testid="forbidden-msg">ไม่มีสิทธิ์เข้าถึงหน้านี้</p>` |
| `ui.notFound(req,res)` | 404 + `<p data-testid="not-found-msg">ไม่พบคำขอ</p>` (เลขไม่มีจริง = ของคนอื่น ข้อความเดียวกัน) · หรือ throw `errors.fail('NOT_FOUND')` ในหน้า → core แสดงหน้านี้ให้ |
| `ui.statusBadge('IN_REVIEW', {testid:'case-status'})` | `<span class="badge st st-IN_REVIEW" data-testid="case-status" data-status="IN_REVIEW">กำลังตรวจสอบ</span>` (ในแถวใช้ `testid:'row-status'`) |
| `ui.slaBadge('near', {testid:'sla-level'})` | `… data-level="near">ใกล้ครบกำหนด</span>` (แถว `row-sla-level`) |
| `ui.time(iso, {testid:'sla-due', prefix:'', dateOnly:false})` | `<time data-testid="sla-due" data-iso="2026-12-04T16:30:00+07:00" datetime="…">4 ธ.ค. 2569 16:30</time>` · `prefix:'หมดอายุ '` (qr-expires) · `dateOnly:true` กับ `'2027-02-02'` → `data-iso="2027-02-02"` ข้อความ `2 ก.พ. 2570` · ค่าว่าง → `–` |
| `ui.money(1010, {testid:'case-fee'})` | `<span data-testid="case-fee">฿1,010</span>` |
| `ui.messages({error, success})` | กล่อง `action-error` (role=alert) + `action-success` (role=status) — ใส่ **ครั้งเดียวต่อหน้า** (testid ซ้ำทำ Playwright strict mode ล้ม) |
| `ui.field({id,label,testid,type,value,required,hint,errorTestid,error,inputAttrs})` | `<label for>` + `<input>` + กล่อง error (เช่น `errorTestid:'reg-error-mobile'`) |
| `ui.select({id,label,testid,options,value})` | `<label for>` + `<select>` |
| `ui.attrs({...})` · `ui.esc(s)` | สร้างแอตทริบิวต์/escape HTML (**ค่าทุกตัวจากผู้ใช้/DB ต้อง escape**) |
| `ui.baseUrl(req)` | `http://web:3000` (ตาม host ที่ test เรียก) → ใช้กับ `doc-qr data-url` |

**CSS กลาง** (`src/core/public/app.css`, mobile-first, ไม่มี scroll แนวนอนที่ 375/768/1280, focus ring 3px + เงาเหลือง, สี AA): `.card` `.stack` `.row` `.actions` `.grid-2` `.kv` (`<dl>`) `.table-wrap` + `.tbl` `.btn` `.btn-primary` `.btn-danger` `.btn-ghost` `.btn-small` `.field` `.hint` `.field-error` `.check` `.msg` `.msg-error` `.msg-ok` `.msg-info` `.badge` `.muted` `.sr-only` `.wizard-step` `.qr-box` · ปุ่ม "ใช้ไม่ได้" = `disabled` · ปุ่ม "ต้องไม่มี" = ไม่ render (CONTRACT §0 ข้อ 5)

**JS กลาง** (`window.EG` จาก `/static/core/app.js` โหลดก่อนสคริปต์โมดูล):
`EG.api(method, url, body?)` → `{ok, status, data}` (JSON หรือ FormData · cookie อัตโนมัติ) · `EG.showError(msg)` / `EG.showSuccess(msg)` / `EG.clearMessages()` · `EG.money(n)` · `EG.dateTime(iso)` · `EG.date(iso)` · `EG.setTime(el, iso, prefix)` (ตั้ง data-iso ด้วย) · `EG.statusText` · `EG.levelText` · `EG.DASH`

**a11y (NFR-02/03)**: ทุกช่องมี label · ปุ่มเป็น `<button>`/ลิงก์เป็น `<a href>` (ใช้คีย์บอร์ดได้) · อย่าใช้ `autofocus` ที่ทำให้ลำดับ Tab สับสน · ข้อความ error ใช้ `role="alert"` · สถานะ/ระดับมีข้อความเสมอ (NFR-11) · หน้าเดียวมี `<h1>` 1 ตัว · อย่าใช้สีข้อความอ่อนกว่า `#4a5560` บนพื้นขาว

---

## 8. ข้อมูลส่วนบุคคล · ลายเซ็นเอกสาร

- **NFR-04**: เลขบัตรเก็บ `users.id_enc = crypto.enc(id)` + `users.id_hash = crypto.hash(id)` · เบอร์ `mobile_enc` + `mobile_hash` · ค้นด้วย hash · ถอดด้วย `crypto.dec` เฉพาะตอนแสดงให้เจ้าของ (`case-id-full` · `idNo` ของ `GET /api/cases/:no` ฝั่งประชาชน) หรือ unmask (P07) · ห้ามเก็บเลขในตารางอื่น/คอมเมนต์ใน migration/log/Audit · core มี unit test ค้นไฟล์ DB ว่าไม่มีเลขของ seed
- **BR-24**: จอ/API ของเจ้าหน้าที่ใช้ `fmt.maskId(id)` → `X-XXXX-XXXXX-45-6` เท่านั้น (ห้ามมี `idNo` หรือสตริง 13 หลัก/`d-dddd-ddddd-dd-d` ใน JSON) · ผู้บริหาร: หน้า dashboard/ไฟล์ส่งออกไม่มีชื่อผู้ยื่น เลข 13 หลัก หรือ `0\d{9}`
- **ลายเซ็น (CONTRACT §3 · A-22)**: `signature = HMAC-SHA256(SIGN_KEY, docNo|caseNo|applicant|serviceId|issuedAt|validUntil|signer)` — ใช้ `ctx.sign.signDoc({docNo, caseNo, applicant, serviceId, issuedAt, validUntil, signer})` · ตรวจด้วย `ctx.sign.verifyDoc(rowของ documents)` · `issuedAt` = ISO +07:00 · `validUntil` = `YYYY-MM-DD` · `applicant` = ชื่อ-สกุลเต็ม · `signer` = ชื่อแสดงผู้อนุมัติ · tamper = แก้ฟิลด์ใน `documents` โดยไม่คำนวณ `signature` ใหม่ → `verifyDoc` = false
- หน้า verify ปิดบังชื่อ `fmt.maskName('สมชาย ใจดี')` → `สมชาย ใ***`

---

## 9. Test hook · reset · BUG_MODE (FR-28 · CONTRACT §8)

| endpoint | ผล |
|---|---|
| `GET /api/health` | 200 `{"status":"ok"}` ตรงตัว · ไม่ต้องล็อกอิน · ทุกโหมด |
| `POST /api/test/reset` | ลบทุกตาราง (รวมตารางโมดูลและ `schema_migrations`) → รัน migration ทั้งหมดใหม่ (§6.0) → ล้าง `UPLOAD_DIR` → seed → นาฬิกา `2026-12-01T09:00:00+07:00` → `hooks.onReset` → 200 `{"ok":true,"now":"2026-12-01T09:00:00+07:00"}` · **session/OTP/ล็อก/แจ้งเตือน/Audit/ไฟล์อัปโหลดใหม่ หายหมด** · reset 2 ครั้งได้ข้อมูลเหมือนกัน (NFR-09 · มี unit test) |
| `GET /api/test/clock` | 200 `{"now":"…+07:00"}` |
| `PUT /api/test/clock` `{"now":"2026-12-01T16:30:00+07:00"}` | แช่แข็งนาฬิกา (A-37) · ไม่มี offset/รูปแบบผิด → 400 `INVALID_TIME` · ค่า `Z` ถูกแปลงเป็น +07:00 ในคำตอบ |
| `POST /api/test/payments/:ref/pay` | P05 ลงทะเบียนผ่าน `hooks.testRoute` |
| `POST /api/test/documents/:docNo/tamper` | P09 ลงทะเบียนผ่าน `hooks.testRoute` |
| ไม่ตั้ง `TEST_MODE` | ทุก `/api/test/*` → 404 |

**BUG_MODE parser** (`src/core/bugs.js`): `'B03, b7'` → `['B03','B07']` (ไม่สนตัวพิมพ์ · `B3` = `B03` · รหัสที่ไม่รู้จักถูก log เตือน) · ใช้ `ctx.bugs.on('B07')` · บั๊กกระทบเฉพาะการคำนวณ/ตรวจสิทธิ์ใหม่ ไม่กระทบ seed (seed เก็บค่าตายตัว ไม่เรียก rules)

| บั๊ก | โมดูลที่ใส่ |
|---|---|
| B01 B03 B04 | `src/rules` (P03) |
| B02 | apply (P04) |
| B05 | payment (P05) |
| B06 | cases (P06) |
| B07 B12 | workflow (P08) |
| B08 B09 B11 | queue (P07) |
| B10 | dashboard (P11) |

---

## 10. Seed (TEST-DATA §1–§12 · `src/core/seed/data.js`)

| เรื่อง | ค่า |
|---|---|
| ประชาชน | `cit-0001` สมชาย ใจดี · `cit-0002` สมหญิง รักไทย · `cit-0003` มานะ ตั้งใจ (**registered=0**, ไม่มีเบอร์) · `cit-0004` ปิติ มีสุข · ค้นด้วยเลขบัตรผ่าน `auth.findCitizenByIdNo` · อีเมลว่าง |
| เจ้าหน้าที่ | `off.reg1` `off.reg2` (registry) · `off.works1` (works) · `head1` · `exec1` · `audit1` · `admin1` · รหัสผ่าน `Test@1234` · ชื่อแสดงตาม CONTRACT §3 |
| บริการ | SV-01 fee 20/ฉบับ SLA 3 · SV-02 fee 500 SLA 10 · SV-03 ฐาน 1000 + 10/ตร.ม. SLA 15 |
| วันหยุด | 2026-12-07 · 2026-12-10 · 2026-12-31 · 2027-01-01 |
| คำขอ | 30 ใบ `EG-2569-000001`…`000030` ตาม §4.1 (สถานะ ผู้ถือ step dept issuer due_at closed_at ใบเสร็จ `RC-2569-0000NN`) + ไทม์ไลน์ครบทุกใบ (ไม่มีแถวใน Audit) · F01 (`…017`) NEED_FIX ตีกลับ 2 ครั้ง `fix_deadline 2026-12-04T14:00` · F02 (`…023`) IN_REVIEW ตีกลับ 2 ครั้ง · A01 (`…019`) APPROVED โดย head1 30 พ.ย. 15:00 issuer off.reg1 · W01 (`…010`) step 2 โยธาไม่มีผู้ถือ |
| ไฟล์แนบ | ทุกคำขอมี PDF จริงขนาดเล็กตามเอกสารบังคับ (`id-card.pdf` · `map.pdf` · `plan.pdf` · `deed.pdf`) = 48 ไฟล์ + ร่าง DR-0002 2 ไฟล์ · fileId `F-000001`…`F-000050` |
| ร่าง | `DR-0001` SV-01 DRAFT qty 2 ฿40 ไม่มีไฟล์ · `DR-0002` SV-02 PENDING_PAYMENT ฿500 (`locked_amount` 500) |
| ชำระค้าง | `PP-0001` (DR-0002 ฿500 สร้าง 08:55:00 หมดอายุ 09:10:00) |
| เอกสาร | `DOC-2569-000001` ของ `EG-2569-000005` verify `K7M2Q9XA` ใช้ได้ถึง `2027-02-02` ผู้ลงนาม `เจ้าหน้าที่ทะเบียน 1` · ลายเซ็นคำนวณจริงตอน seed |
| ว่าง | audit · notifications · sessions · otp_attempts |
| เลขถัดไป (§12) | `EG-2569-000031` · `EG-2570-000001` · `RC-2569-000031` · `DOC-2569-000002` · `DR-0003` · `PP-0002` · `F-000051` · `cit-0005` |

seed ตรวจตัวเองตอนสร้าง (จำลองเหตุการณ์ตามแผนภาพสถานะแล้วเทียบสถานะ/ผู้ถือ/เวลาปิดกับ TEST-DATA · ไม่ตรง = throw)

---

## 11. Unit test

- ชื่อไฟล์ `*.test.js` ที่ใดก็ได้ใต้ `src/` · `npm test` รันทุกไฟล์ (แต่ละไฟล์เป็น process แยก → singleton `clock`/`bugs` ไม่ชนกัน)
- ฟังก์ชันบริสุทธิ์ (rules): ทดสอบตรง ๆ · สลับบั๊กด้วย `require('../core/bugs').bugs.set(['B03'])` แล้วคืนค่า `bugs.set('')`
- ต้องการ DB/HTTP: สร้าง server ชั่วคราว
  ```js
  const { createServer } = require('../../server');          // path จากโฟลเดอร์ของไฟล์ test
  const { app, ctx } = await createServer({ env: { DB_PATH: '/tmp/x/app.db', TEST_MODE: '1' }, log: () => {} });
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  ```
  หรือเฉพาะ DB: `require('../../core').createContext(require('../../core/config').loadConfig({DB_PATH, TEST_MODE:'1'}))`
  สร้าง session ทดสอบได้ด้วยการ INSERT แถว `sessions` แล้วส่ง cookie `eg_sid=<sid>` (ดู `src/core/test/server.test.js`)
- ตัวอย่างที่มีแล้ว: `src/core/test/fmt.test.js` · `seed.test.js` · `server.test.js` (38 tests) · `migrate.test.js` (restart โหมดปกติด้วย `createServer({ env: { DB_PATH, TEST_MODE: '' }, coreMigrationsDir })` บน DB เดิม)

---

## 12. Checklist ก่อนส่งงานของแต่ละบล็อก

- [ ] โมดูลอยู่ใน `src/modules/<ชื่อ>/` เท่านั้น ไม่แก้ไฟล์ของคนอื่น
- [ ] ทุก route มี guard ตาม §5.1 · หน้าใช้ `ui.send` · API error ใช้ `ctx.errors`
- [ ] ข้อความ/`data-testid`/`data-*` ตรง CONTRACT ตัวอักษรต่อตัวอักษร
- [ ] เวลาใช้ `ctx.clock` · วันที่/เงินใช้ `ctx.fmt`/`ctx.ui.time`/`ctx.ui.money` (+ `data-iso`)
- [ ] เปลี่ยนสถานะผ่าน `ctx.caseEvents.transition` (ไทม์ไลน์ + Audit ครบ)
- [ ] ไม่มีเลขบัตร/เบอร์เต็มใน DB (นอก enc) · log · JSON ของเจ้าหน้าที่
- [ ] บั๊กของบล็อกตนเองอยู่หลัง `ctx.bugs.on()` และปิดแล้วเว็บถูกต้อง 100%
- [ ] `npm test` ผ่าน · เว็บขึ้นได้ด้วย `TEST_MODE=1 ./scripts/start-web.sh` โดยไม่มี error ใน log

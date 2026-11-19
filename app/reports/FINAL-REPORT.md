# FINAL-REPORT · P14 รวมระบบ + Playwright 51 TC + BUG_MODE B01–B12

> run `egov-eservice-20261115-222121` · บล็อก P14 · วันที่ 2026-11-16 · ผลทั้งหมดในไฟล์นี้มาจากการรันจริง ไฟล์ดิบอยู่ใน `reports/runs-docker/` (ทางหลัก) และ `reports/runs-local/` (รันด้วย node บนเครื่องโดยตรง)
> ทุกรอบรันด้วยสคริปต์ `scripts/run-bugs.sh` แล้วสรุปด้วย `scripts/pw-summary.js` · ตาราง docker สร้างจากผลดิบ (`<label>.summary.json` + `<label>.json`) · แก้ตามรีวิว `reports/REVIEW-P14.md` เมื่อ 2026-11-16 (§8)
> **ปรับล่าสุด 2026-11-19** หลังเปลี่ยนเป็น migration แบบเพิ่มไฟล์ (§11) · **ผล `npm test` และผล docker ทุกตาราง (§1 §3 §4) เป็นรอบใหม่หลังเปลี่ยน** (ชุดเต็ม `OUT=reports/runs-docker scripts/run-bugs.sh` · normal-1 เริ่ม 10:15:38 · final จบ ~10:39 · `run-bugs exit=0` ใน `reports/runs-docker/matrix.out`)

## 0. สรุปเกณฑ์เสร็จ

| เกณฑ์ | ผล | หลักฐาน |
|---|---|---|
| `docker compose up --build` คำสั่งเดียวขึ้นเว็บได้ | ✅ healthy · `/api/health` = `{"status":"ok"}` · ไม่ตั้ง TEST_MODE → `POST /api/test/reset` = 404 | §2 |
| โหมดปกติไม่ลบข้อมูลเมื่อ restart / โครงสร้างตารางเปลี่ยน (migration แบบเพิ่มไฟล์) | ✅ ผู้ใช้ที่ลงทะเบียนก่อน `docker compose restart web` และก่อน `down`/`up` ยังอยู่ (`RESULT: PASS`) · DB รุ่นเดิมบน Docker ถูก baseline ไม่ลบ · แก้ไฟล์ที่ apply แล้ว → ไม่เริ่มระบบ DB ไม่เปลี่ยนแม้แต่ไบต์เดียว | §11 |
| `npm test` ผ่าน | ✅ 196/196 pass (16 ไฟล์ · รวม `src/core/test/migrate.test.js` ใหม่ 12 tests · ตัวควบคุมบวก `test/pii-check.test.js` `test/pw-summary.test.js`) · image node 20: 184/184 (14 ไฟล์ใต้ `src/` · image ไม่มี `test/`) | §1 |
| TEST_MODE=1 ไม่มี BUG_MODE ผ่าน 51/51 สองรอบติดกัน | ✅ docker: 51/51 · 0 skipped / 51/51 · 0 skipped (ไม่ restart ระหว่างรอบ) · `pw-summary.js` นับ skip เป็น MISMATCH แล้ว (M1) | §3 |
| BUG_MODE=B01..B12 ทีละตัวล้มตรงตาราง BUGS §2 | ✅ 12/12 `RESULT: MATCH` (docker รอบใหม่หลัง §11 · ข้อความล้มทุก TC ตรงกับรอบก่อนเปลี่ยนตัวอักษรต่อตัวอักษร) · TC ที่ต้องล้มล้มทุกตัว ไม่มีผ่านหลอก · ล้มเกินตาราง 1 จุดคือ B03 → TC-NOTI-02 (triage §5.1) · B08 แสดงครบ 3 ส่วนในรอบเดียว (ส่วน 3 ล้มตาม BUGS §2) · B10 ล้ม TC-DASH-02 | §4 §5 |
| ชุดรวม B03,B07 และ B01,B05,B09 ล้มเท่า union | ✅ ทั้งสองชุด = union ของรายตัวพอดี (docker รอบใหม่หลัง §11 · §4.3) | §4.3 |
| ปิดบั๊กกลับมาผ่าน 51/51 | ✅ docker: 51/51 · 0 skipped | §4 |
| FR-01..FR-29 ครบตาม traceability REQUIREMENTS §5 | ✅ ทุก FR มี TC ที่ผ่าน + smoke check route/API 53/53 PASS | §6 |
| reports/FINAL-REPORT.md มีผลทุกขั้น + ตาราง triage BUGS §4 | ✅ ไฟล์นี้ | – |
| แก้ตามรีวิว REVIEW-P14 (M1 M2 M3 · ข้อสังเกต 1 8 9 10) | ✅ แก้ครบ 7 ข้อ พร้อมตัวควบคุมบวก | §8 |

## 1. ขั้น 1 · `npm test` (unit test + ตัวควบคุมบวกของเครื่องมือทดสอบ)

```text
$ npm test   (host · node v22.23.4 · ผลเต็ม reports/npm-test.txt · รันใหม่ 2026-11-19 หลังเปลี่ยนเป็น migration §11)
unit test 16 ไฟล์:
  src/core/test/fmt.test.js
  src/core/test/migrate.test.js ← ใหม่ (§11) migration แบบเพิ่มไฟล์ (a)–(f) + กรณีขอบ · 12 tests
  src/core/test/seed.test.js
  src/core/test/server.test.js
  src/modules/apply/apply.test.js
  src/modules/auth/auth.test.js
  src/modules/cases/cases.test.js
  src/modules/dashboard/dashboard.test.js
  src/modules/documents/documents.test.js
  src/modules/payment/payment.test.js
  src/modules/workflow/workflow.test.js
  src/rules/db.test.js
  src/rules/fee.test.js
  src/rules/sla.test.js
  test/pii-check.test.js        ← ใหม่ (REVIEW-P14 M2 + ข้อสังเกต 8) ตัวควบคุมบวกของตัวตรวจ PII ใน PDF / DB / log
  test/pw-summary.test.js       ← ใหม่ (REVIEW-P14 M1) skipped ≠ ผ่าน
# tests 196
# suites 1
# pass 196
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

`test/` ใช้ `pdf-parse` จาก `e2e/node_modules` (ตัวเดียวกับ e2e) และโค้ดสร้าง PDF ของเว็บ (`buildPdf`) จึงรันบนเครื่องที่มีโฟลเดอร์ `e2e/` · image ของเว็บไม่มีโฟลเดอร์ `test/` → ใน image รันเฉพาะ 14 ไฟล์ใต้ `src/` (ผลด้านล่าง)

```text
$ docker run --rm egov-eservice-web npm test   (image · node v20.20.2 · 2026-11-19)
unit test 14 ไฟล์:
# tests 184
# pass 184
# fail 0
```

## 2. ขั้น 2 · Docker compose

| รายการ | ค่า |
|---|---|
| Docker / Compose | Docker Engine 29.9.3 · Compose v5.7.0 |
| image เว็บ | `egov-eservice-web` (Dockerfile: `node:20-bookworm-slim` 2 stage · `npm ci --omit=dev` · ตรวจ better-sqlite3 ตอน build) |
| image e2e | `mcr.microsoft.com/playwright:v1.49.1-jammy` (ตรงกับ `@playwright/test` 1.49.1 ใน `e2e/package.json` → ไม่ต้อง override browser) |
| `docker compose up --build -d --wait` (ไม่ตั้ง TEST_MODE) | `app-web-1` healthy · log (2026-11-19): `[migrate] baseline core/0001_init.sql (DB รุ่นก่อน migration …)` แล้ว `listening on :3000 · TEST_MODE=off · BUG_MODE=- · DB_PATH=/data/app.db · modules=[auth, apply, cases, documents, payment, queue, workflow, admin, dashboard]` · `GET /api/health` → `{"status":"ok"}` · `POST /api/test/reset` → 404 · `GET /` → 302 ไป `/login` |
| `TEST_MODE=1 docker compose up --build -d` | log: `TEST_MODE=1 · BUG_MODE=- · clock=2026-12-01T09:00:00+07:00` (ล้างทุกตาราง + migration ทั้งหมดใหม่ + seed ทุกครั้งที่เริ่ม) |
| restart โหมดปกติ (`scripts/restart-check.sh`) | ลงทะเบียน `cit-0005` ผ่าน API → `docker compose restart web` → `down` + `up` → ผู้ใช้ยังอยู่ทั้งสองครั้ง · `RESULT: PASS` (§11.3 · `reports/restart-check.txt`) |
| `docker compose --profile test run --rm e2e` | ขึ้น `web-notest` (image เดียวกัน ไม่ตั้ง TEST_MODE · DB บน tmpfs) ให้ TC-NFR-03 ตรวจ 404 · mount `./data:/data:ro` ให้ TC-NFR-04 อ่านไฟล์ DB จริง (`DB_PATH=/data/app.db`) → **ไม่มี TC ถูก skip** |
| log ของเว็บสำหรับ TC-NFR-04 | `run-bugs.sh` ตั้ง `LOG_REQUESTS=1` แล้วเก็บ `docker compose logs -f web` ลง `e2e/results/web.log` ตลอดรอบ (e2e เห็นที่ `/e2e/results/web.log` ผ่าน `WEB_LOG_PATH`) · สำเนาต่อรอบ `reports/runs-docker/<label>.web.log` |

## 3. ขั้น 2–3 · ชุดเต็ม 51 TC กับเว็บถูกต้อง สองรอบติดกัน (NFR-09)

| รอบ | ที่รัน | ผล | เวลา |
|---|---|---|---|
| normal-1 | docker compose (`e2e` service) | 51 passed · 0 failed · 0 skipped ✅ | เริ่ม 2026-11-19 10:15:38 · 66.5 วินาที |
| normal-2 | docker compose (`e2e` service) | 51 passed · 0 failed · 0 skipped ✅ | เริ่ม 2026-11-19 10:16:46 · 64.5 วินาที |
| normal-final | docker compose (`e2e` service) | 51 passed · 0 failed · 0 skipped ✅ | เริ่ม 2026-11-19 10:38:05 · 69.4 วินาที |

> รอบ local (node + npx playwright) ในเวอร์ชันก่อนของรายงานรันก่อนแก้ตามรีวิว จึงไม่นับเป็นหลักฐานของโค้ดชุดนี้ (ดู §4.2)

รอบที่ 2 รันทันทีโดยไม่ restart เว็บ (ทุก TC เริ่มด้วย `POST /api/test/reset`) → ผลเท่ากัน แปลว่าไม่ได้ผ่านเพราะข้อมูลค้างจากรอบก่อน

## 4. ขั้น 4–6 · BUG_MODE ทีละตัว ชุดรวม และปิดบั๊ก

ทุกรอบ: restart เว็บด้วย `TEST_MODE=1 BUG_MODE=<รหัส>` แล้วรัน **ชุดเต็ม 51 TC** · "ผล" ✅ = ทุก TC ในคอลัมน์ "ต้องล้ม" ล้มจริง และ TC ที่ล้มทั้งหมดอยู่ใน "ต้องล้ม ∪ อาจล้ม" และครบ 51 TC

### 4.1 ตารางบันทึกผล (BUGS §4) · Docker compose (ทางหลัก)

| บั๊ก | TC ที่คาดว่าล้ม (BUGS §2) | TC ที่ล้มจริง | TC ล้มเกินที่คาด | TC ที่ควรล้มแต่ผ่าน | ผล | เริ่มรัน |
|---|---|---|---|---|---|---|
| (ปกติ) รอบ 1 | – | – | – | – | 51 passed · 0 failed · 0 skipped · `RESULT: MATCH` ✅ | 10:15:38 |
| (ปกติ) รอบ 2 ทันที | – | – | – | – | 51 passed · 0 failed · 0 skipped · `RESULT: MATCH` ✅ | 10:16:46 |
| B01 | TC-FEE-01 | TC-FEE-01 | – | – | 50 passed · 1 failed · 0 skipped · `RESULT: MATCH` ✅ | 10:17:58 |
| B02 | TC-UPLOAD-01 | TC-UPLOAD-01 | – | – | 50 passed · 1 failed · 0 skipped · `RESULT: MATCH` ✅ | 10:19:21 |
| B03 | TC-SLA-01 · TC-SLA-02 (อาจล้ม: TC-SLA-03 · TC-RBAC-04 · TC-NOTI-02) | TC-NOTI-02 · TC-RBAC-04 · TC-SLA-01 · TC-SLA-02 · TC-SLA-03 | – | – | 46 passed · 5 failed · 0 skipped · `RESULT: MATCH` ✅ | 10:20:44 |
| B04 | TC-SLA-02 | TC-SLA-02 | – | – | 50 passed · 1 failed · 0 skipped · `RESULT: MATCH` ✅ | 10:22:25 |
| B05 | TC-PAY-01 | TC-PAY-01 | – | – | 50 passed · 1 failed · 0 skipped · `RESULT: MATCH` ✅ | 10:23:49 |
| B06 | TC-RBAC-01 | TC-RBAC-01 | – | – | 50 passed · 1 failed · 0 skipped · `RESULT: MATCH` ✅ | 10:25:04 |
| B07 | TC-RBAC-02 (อาจล้ม: TC-WORKFLOW-01) | TC-RBAC-02 | – | – | 50 passed · 1 failed · 0 skipped · `RESULT: MATCH` ✅ | 10:26:21 |
| B08 | TC-QUEUE-02 | TC-QUEUE-02 | – | – | 50 passed · 1 failed · 0 skipped · `RESULT: MATCH` ✅ | 10:27:37 |
| B09 | TC-PDPA-02 | TC-PDPA-02 | – | – | 50 passed · 1 failed · 0 skipped · `RESULT: MATCH` ✅ | 10:28:54 |
| B10 | TC-DASH-02 (อาจล้ม: TC-DASH-01 · TC-DASH-03) | TC-DASH-01 · TC-DASH-02 · TC-DASH-03 | – | – | 48 passed · 3 failed · 0 skipped · `RESULT: MATCH` ✅ | 10:30:13 |
| B11 | TC-PDPA-03 · TC-AUDIT-01 | TC-AUDIT-01 · TC-PDPA-03 | – | – | 49 passed · 2 failed · 0 skipped · `RESULT: MATCH` ✅ | 10:32:00 |
| B12 | TC-WORKFLOW-04 | TC-WORKFLOW-04 | – | – | 50 passed · 1 failed · 0 skipped · `RESULT: MATCH` ✅ | 10:33:34 |
| B03,B07 | TC-SLA-01 · TC-SLA-02 · TC-RBAC-02 (อาจล้ม: TC-SLA-03 · TC-RBAC-04 · TC-NOTI-02 · TC-WORKFLOW-01) | TC-NOTI-02 · TC-RBAC-02 · TC-RBAC-04 · TC-SLA-01 · TC-SLA-02 · TC-SLA-03 | – | – | 45 passed · 6 failed · 0 skipped · `RESULT: MATCH` ✅ | 10:34:58 |
| B01,B05,B09 | TC-FEE-01 · TC-PAY-01 · TC-PDPA-02 | TC-FEE-01 · TC-PAY-01 · TC-PDPA-02 | – | – | 48 passed · 3 failed · 0 skipped · `RESULT: MATCH` ✅ | 10:36:41 |
| (ปิดบั๊ก) final | – | – | – | – | 51 passed · 0 failed · 0 skipped · `RESULT: MATCH` ✅ | 10:38:05 |

ผลดิบ: `reports/runs-docker/<label>.{json,summary.json,txt,log,web.log}` · ลำดับรันทั้งหมด `reports/runs-docker/matrix.out`

### 4.2 ตารางเดียวกัน · local (node `src/server.js` + `npx playwright test` บนเครื่อง) · **ก่อนแก้ตามรีวิว**

> ⚠️ ตารางนี้เป็นผลก่อนแก้ตามรีวิว REVIEW-P14 (โค้ด e2e และ `pw-summary.js` ชุดเดิม) **ไม่ได้รันซ้ำหลังแก้** เก็บไว้เป็นประวัติเท่านั้น · หลักฐานของโค้ดปัจจุบันคือ §3 และ §4.1 (docker) · รอบ local `normal-1/2` และ `B01–B08` รัน 09:25–09:37 ส่วน `B09`–`final` รัน 16:38–16:47

| บั๊ก | TC ที่คาดว่าล้ม (BUGS §2) | TC ที่ล้มจริง | TC ล้มเกินที่คาด | TC ที่ควรล้มแต่ผ่าน | ผล |
|---|---|---|---|---|---|
| (ปกติ) รอบ 1 | – | – | – | – | 51 passed · 0 failed ✅ |
| (ปกติ) รอบ 2 ทันที | – | – | – | – | 51 passed · 0 failed ✅ |
| B01 | TC-FEE-01 | TC-FEE-01 | – | – | 50 passed · 1 failed ✅ |
| B02 | TC-UPLOAD-01 | TC-UPLOAD-01 | – | – | 50 passed · 1 failed ✅ |
| B03 | TC-SLA-01 · TC-SLA-02 (อาจล้ม: TC-SLA-03 · TC-RBAC-04 · TC-NOTI-02) | TC-NOTI-02 · TC-RBAC-04 · TC-SLA-01 · TC-SLA-02 · TC-SLA-03 | – | – | 46 passed · 5 failed ✅ |
| B04 | TC-SLA-02 | TC-SLA-02 | – | – | 50 passed · 1 failed ✅ |
| B05 | TC-PAY-01 | TC-PAY-01 | – | – | 50 passed · 1 failed ✅ |
| B06 | TC-RBAC-01 | TC-RBAC-01 | – | – | 50 passed · 1 failed ✅ |
| B07 | TC-RBAC-02 (อาจล้ม: TC-WORKFLOW-01) | TC-RBAC-02 | – | – | 50 passed · 1 failed ✅ |
| B08 | TC-QUEUE-02 | TC-QUEUE-02 | – | – | 50 passed · 1 failed ✅ |
| B09 | TC-PDPA-02 | TC-PDPA-02 | – | – | 50 passed · 1 failed ✅ |
| B10 | TC-DASH-02 (อาจล้ม: TC-DASH-01 · TC-DASH-03) | TC-DASH-01 · TC-DASH-02 · TC-DASH-03 | – | – | 48 passed · 3 failed ✅ |
| B11 | TC-PDPA-03 · TC-AUDIT-01 | TC-AUDIT-01 · TC-PDPA-03 | – | – | 49 passed · 2 failed ✅ |
| B12 | TC-WORKFLOW-04 | TC-WORKFLOW-04 | – | – | 50 passed · 1 failed ✅ |
| B03,B07 | TC-SLA-01 · TC-SLA-02 · TC-RBAC-02 (อาจล้ม: TC-SLA-03 · TC-RBAC-04 · TC-NOTI-02 · TC-WORKFLOW-01) | TC-NOTI-02 · TC-RBAC-02 · TC-RBAC-04 · TC-SLA-01 · TC-SLA-02 · TC-SLA-03 | – | – | 45 passed · 6 failed ✅ |
| B01,B05,B09 | TC-FEE-01 · TC-PAY-01 · TC-PDPA-02 | TC-FEE-01 · TC-PAY-01 · TC-PDPA-02 | – | – | 48 passed · 3 failed ✅ |
| (ปิดบั๊ก) final | – | – | – | – | 51 passed · 0 failed ✅ |

> หมายเหตุคอลัมน์ "TC ที่คาดว่าล้ม" ของ B03: TC-NOTI-02 **ไม่อยู่ในตาราง BUGS §2/TEST-PLAN §18** เป็นรายการที่ P14 เพิ่มเข้ากลุ่ม "อาจล้ม" หลัง triage (ดู §5.1) · นอกจากแถวนี้ คอลัมน์ "คาดว่าล้ม/อาจล้ม" ตรงกับ BUGS §2 ทุกตัวอักษร

### 4.3 ชุดรวมต้องเท่า union (BUGS §3 ขั้น 5)

| ชุด | ที่ | ล้มจริง | union ของรายตัว | เท่ากัน |
|---|---|---|---|---|
| B03,B07 | docker | TC-NOTI-02 · TC-RBAC-02 · TC-RBAC-04 · TC-SLA-01 · TC-SLA-02 · TC-SLA-03 | TC-NOTI-02 · TC-RBAC-02 · TC-RBAC-04 · TC-SLA-01 · TC-SLA-02 · TC-SLA-03 | ✅ |
| B01,B05,B09 | docker | TC-FEE-01 · TC-PAY-01 · TC-PDPA-02 | TC-FEE-01 · TC-PAY-01 · TC-PDPA-02 | ✅ |

### 4.4 ข้อความที่ล้ม (BUGS §3 ขั้น 4: ต้องบอกค่าจริงต่างจากค่าที่คาดตรงไหน)

ทุกตัวล้มด้วยการเทียบค่า (Expected/Received) ไม่มีตัวไหนล้มเพราะหา element ไม่เจอ · ตัวที่ขึ้น `Timed out … waiting for expect(locator)` คือ assertion ที่ retry ได้ของ Playwright ซึ่งรายงานค่าที่อ่านได้จริงไว้แล้ว (เช่น `14 × locator resolved to … ฿1,000`)

| บั๊ก | TC | ข้อความแรกที่ล้ม (label ใน test) | คาด → ได้จริง |
|---|---|---|---|
| B01 | TC-FEE-01 | SV-03 พื้นที่ 101: fee-total | `"฿1,010"` → `"฿1,000"` |
| B02 | TC-UPLOAD-01 | 5,242,880 ไบต์ (ขอบ ≤ 5 MB) → รับ | `1` → `0` |
| B03 | TC-NOTI-02 | off.reg2 ส.5: noti-item (หน้าจอ) | diff: `-   "EG-2569-000016:near",` |
| B03 | TC-RBAC-04 | #7 dueAt: expected 2026-12-08T16:30:00+07:00, received 2026-12-04T16:30:00+07:00 | `"2026-12-08T16:30:00+07:00"` → `"2026-12-04T16:30:00+07:00"` |
| B03 | TC-SLA-01 | แถว c: dueAt | `"2026-12-08T16:30:00+07:00"` → `"2026-12-07T16:30:00+07:00"` |
| B03 | TC-SLA-02 | หลังส่งแก้: sla-due data-iso | `"2026-12-08T16:30:00+07:00"` → `"2026-12-07T16:30:00+07:00"` |
| B03 | TC-SLA-03 | ส่วน B 2026-12-04T09:00:00+07:00 sla-level ข้อความ | `"ใกล้ครบกำหนด"` → `"ปกติ"` |
| B04 | TC-SLA-02 | หลังส่งแก้: sla-due data-iso | `"2026-12-08T16:30:00+07:00"` → `"2026-12-04T16:30:00+07:00"` |
| B05 | TC-PAY-01 | รอบ 3 pay PP-0001 (body={"status":"PAID","caseNo":"EG-2569-000031","receiptNo":"RC-2569-000031","duplicate":false,"paidAt":"2026-12-01T09:10:00+07:00","amount":500,"dueAt":"2026-12-17T16:30:00+… | `410` → `200` |
| B06 | TC-RBAC-01 | UI …000005 (ของสมชาย): expected HTTP 404, received HTTP 200 | `404` → `200` |
| B07 | TC-RBAC-02 | #1 off.reg2 approve …000014: expected HTTP 403, received HTTP 200 · body={"status":"APPROVED"} | (ค่าอยู่ในข้อความ) |
| B08 | TC-QUEUE-02 | ผลรายส่วน (`expect.soft`) ส่วน 1 · 2 · 3 ล้มทั้งหมด แล้ว assert hard ตอนจบ (ดูรายส่วนด้านล่าง) | ส่วน 1 `[200, 409]` → `[200, 200]` · ส่วน 2 จำนวน 200 `1` → `9` · ส่วน 3 `409` → `200` (owner `off.reg2`) |
| B09 | TC-PDPA-02 | PDPA JSON: expected no full id, received 10 problem(s) | diff: `+   "off.reg1 /api/officer/queue?filter=all: found \\d{13} \"1101700123456\"",`, `+   "off.reg1 /api/officer/queue?filter=all: found 3100600987659",` |
| B10 | TC-DASH-01 | ธ.ค. ALL kpi-ontime-pct: expected text "–" | `"–"` → `"0.0%"` |
| B10 | TC-DASH-02 | 2026-11 ALL kpi-ontime-pct: expected text "85.7%" | `"85.7%"` → `"23.1%"` |
| B10 | TC-DASH-03 | พ.ย. ALL kpi-ontime-pct: expected text "85.7%" | `"85.7%"` → `"23.1%"` |
| B11 | TC-AUDIT-01 | audit-count: expected text "16" | `"16"` → `"15"` |
| B11 | TC-PDPA-03 | #5 UNMASK audit-count: expected text "1" | `"1"` → `"0"` |
| B12 | TC-WORKFLOW-04 | A5 return-btn: expected count 0 | `0` → `1` |

#### B08 · TC-QUEUE-02 ผลรายส่วนในรอบเดียว (ข้อสังเกต 10)

- TC-QUEUE-02 ส่วน 1: กด claim-btn พร้อมกัน 2 browser context
  - expect(received).toBe(expected) // Object.is equality ⏎ Expected: "ผ่าน" ⏎ Received: "ล้ม: สำเร็จ 1 คน อีกคน 409 (A=200 {\"caseNo\":\"EG-2569-000028\",\"status\":\"IN_REVIEW\",\"owner\":\"off.reg1\"} · B=200 {\"caseNo\":\"EG-2569-000028\",\"status\":\"IN_REVIEW\",\"owner\":\"off.reg2\"}) \| expect(received).toEqual(expected) // deep equality \| - Expected  - 1 \| + Received  + 1 \| Array [ \| 200,"
- TC-QUEUE-02 ส่วน 2: API 10 ครั้งพร้อมกัน (RESET)
  - expect(received).toBe(expected) // Object.is equality ⏎ Expected: "ผ่าน" ⏎ Received: "ล้ม: ต้องได้ 200 ครั้งเดียว (off.reg1:200: off.reg2:200: off.reg1:200: off.reg2:200: off.reg1:200: off.reg2:200: off.reg1:200: off.reg2:409:WORKLOAD_LIMIT off.reg1:200: off.reg2:200:) \| expect(received).toBe(expected) // Object.is equality \| Expected: 1 \| Received: 9"
- TC-QUEUE-02 ส่วน 3: ต่อกัน (RESET · จับ B08)
  - expect(received).toBe(expected) // Object.is equality ⏎ Expected: "ผ่าน" ⏎ Received: "ล้ม: off.reg2 claim ต่อจาก off.reg1 [/api/officer/cases/EG-2569-000029/claim]: HTTP status ควรเป็น 409 (body={\"caseNo\":\"EG-2569-000029\",\"status\":\"IN_REVIEW\",\"owner\":\"off.reg2\"}) \| expect(received).toBe(expected) // Object.is equality \| Expected: 409 \| Received: 200"
- TC-QUEUE-02 ทุกส่วนต้องผ่าน · ผลรายส่วน [{"part":"ส่วน 1: กด claim-btn พร้อมกัน 2 browser context","result":"ล้ม: สำเร็จ 1 คน อีกคน 409 (A=200 {\"caseNo\":\"EG-2569-000028\",\"status\":\"IN_REV…
  - expect(received).toEqual(expected) // deep equality ⏎ - Expected  -  1 ⏎ + Received  + 14

### 4.5 ตรวจว่าบั๊กอยู่ฝั่งเซิร์ฟเวอร์จริง (BUGS §1 ข้อ 4)

| บั๊ก | ยิง API ตรง ๆ | ผล |
|---|---|---|
| B07 | TC-RBAC-02 ยิง `POST /api/cases/EG-2569-000014/approve` ด้วย `off.reg2` | 200 `{"status":"APPROVED"}` (คาด 403) → test ตรวจที่ API ไม่ใช่แค่ปุ่ม |
| B08 | TC-QUEUE-02 ทั้ง 3 ส่วนในรอบเดียว: ส่วน 1 กด `claim-btn` พร้อมกันบน `…000028` · ส่วน 3 ยิง API ต่อกันบน `…000029` | ส่วน 1: ทั้งสองฝั่งได้ 200 (คาด `[200, 409]`) · ส่วน 3: `off.reg2` ได้ 200 ต่อจาก `off.reg1` (คาด 409 `ALREADY_CLAIMED`) ตรงตัวอย่าง BUGS §2 · ข้อความจริงอยู่ใน §4.4 |
| B09 | TC-PDPA-02 สแกน JSON ทุก API | พบ `idNo` 13 หลักเฉพาะใน `/api/officer/queue?filter=all` (off.reg1, head1) · API อื่นไม่รั่ว → บั๊กอยู่ตรงจุด |
| B12 | P14 ยิงเองกับเว็บ `BUG_MODE=B12`: `off.reg1` `POST /api/officer/cases/EG-2569-000023/return` | 200 `{"status":"NEED_FIX","returnCount":3,"fixDeadline":"2026-12-08T09:00:00+07:00"}` ตรง BUGS §2 (TC-WORKFLOW-04 ล้มก่อนที่ขั้นปุ่ม `return-btn` ยังแสดง) |
| B05 | TC-PAY-01 รอบ 3 pay `PP-0001` ที่ 09:10:00 | 200 `PAID` เลข `EG-2569-000031` (คาด 410 `QR_EXPIRED`) ตรงตัวอย่างใน BUGS §2 |

### 4.6 TC-NFR-04 ตรวจ log ของเว็บทุกรอบ (ข้อสังเกต 8)

| รอบ | บรรทัดหลักฐานจาก TC-NFR-04 (stdout ใน `<label>.log`) |
|---|---|
| (ปกติ) รอบ 1 | `[TC-NFR-04] web log /e2e/results/web.log: 80370 bytes · 2264 lines · register lines 1 → 2 · PII found 0 · DB files 1` |
| (ปกติ) รอบ 2 ทันที | `[TC-NFR-04] web log /e2e/results/web.log: 200257 bytes · 5646 lines · register lines 3 → 4 · PII found 0 · DB files 1` |
| B01 | `[TC-NFR-04] web log /e2e/results/web.log: 79143 bytes · 2227 lines · register lines 1 → 2 · PII found 0 · DB files 1` |
| B02 | `[TC-NFR-04] web log /e2e/results/web.log: 78718 bytes · 2224 lines · register lines 1 → 2 · PII found 0 · DB files 1` |
| B03 | `[TC-NFR-04] web log /e2e/results/web.log: 71073 bytes · 2027 lines · register lines 1 → 2 · PII found 0 · DB files 1` |
| B04 | `[TC-NFR-04] web log /e2e/results/web.log: 77500 bytes · 2192 lines · register lines 1 → 2 · PII found 0 · DB files 1` |
| B05 | `[TC-NFR-04] web log /e2e/results/web.log: 79687 bytes · 2246 lines · register lines 1 → 2 · PII found 0 · DB files 1` |
| B06 | `[TC-NFR-04] web log /e2e/results/web.log: 80389 bytes · 2264 lines · register lines 1 → 2 · PII found 0 · DB files 1` |
| B07 | `[TC-NFR-04] web log /e2e/results/web.log: 80396 bytes · 2264 lines · register lines 1 → 2 · PII found 0 · DB files 1` |
| B08 | `[TC-NFR-04] web log /e2e/results/web.log: 79702 bytes · 2246 lines · register lines 1 → 2 · PII found 0 · DB files 1` |
| B09 | `[TC-NFR-04] web log /e2e/results/web.log: 80395 bytes · 2264 lines · register lines 1 → 2 · PII found 0 · DB files 1` |
| B10 | `[TC-NFR-04] web log /e2e/results/web.log: 79046 bytes · 2225 lines · register lines 1 → 2 · PII found 0 · DB files 1` |
| B11 | `[TC-NFR-04] web log /e2e/results/web.log: 79986 bytes · 2249 lines · register lines 1 → 2 · PII found 0 · DB files 1` |
| B12 | `[TC-NFR-04] web log /e2e/results/web.log: 80374 bytes · 2263 lines · register lines 1 → 2 · PII found 0 · DB files 1` |
| B03,B07 | `[TC-NFR-04] web log /e2e/results/web.log: 71095 bytes · 2027 lines · register lines 1 → 2 · PII found 0 · DB files 1` |
| B01,B05,B09 | `[TC-NFR-04] web log /e2e/results/web.log: 78501 bytes · 2210 lines · register lines 1 → 2 · PII found 0 · DB files 1` |
| (ปิดบั๊ก) final | `[TC-NFR-04] web log /e2e/results/web.log: 80382 bytes · 2264 lines · register lines 1 → 2 · PII found 0 · DB files 1` |

"register lines a → b" = จำนวนบรรทัด `POST /api/auth/register 201` ใน log ก่อน/หลังมานะลงทะเบียน (b > a พิสูจน์ว่า log ที่สแกนครอบคำขอที่ส่งเบอร์ `0845678901` จริง) · log สะสมตั้งแต่เว็บเริ่ม จึงใหญ่ขึ้นในรอบที่ใช้เว็บตัวเดิม (normal-2 ใช้เว็บตัวเดียวกับ normal-1 จึงเป็น register 3 → 4 · รอบอื่นเว็บถูกสร้างใหม่ทุกรอบ → 1 → 2)

## 5. Triage

### 5.1 B03 → TC-NOTI-02 ล้มเกินตาราง §2 (ตัดสิน: ผลข้างเคียงที่ยอมรับ ไม่ใช่บั๊กรั่ว ไม่ใช่ test ผิด)

- **อาการ:** TC-NOTI-02 ส่วน B (RESET → `CLOCK(2026-12-05T10:00+07:00)` ส. → ประเมินแจ้งเตือน) `off.reg2` ขาด `EG-2569-000016:near` (คาด 10 รายการ ได้ 9) · ส่วน A และ C ผ่าน
- **สาเหตุ:** `…000016` กำหนด อ. 8 ธ.ค. 16:30 และ จ. 7 ธ.ค. เป็นวันหยุดในตาราง → เว็บถูกต้องนับวันคงเหลือ = 1 → `near` · B03 นับ 7 ธ.ค. เป็นวันทำการ → คงเหลือ 2 → `normal` → ไม่มีแจ้งเตือน `near`
- **ทำไมยอมรับ:** BUGS §2 แถว B03 ระบุเองว่า "ฟังก์ชันวันทำการตัวเดียวกันใช้นับ "วันคงเหลือ" ข้าม 7 ธ.ค." และยอมให้ TC-SLA-03 ส่วน B ล้ม (ศ.4 ธ.ค. 09:00 ได้ `ปกติ` แทน `ใกล้ครบกำหนด`) · ระดับแจ้งเตือน (FR-20) ต้องมาจาก `sla-level` ตัวเดียวกับหน้าจอ (FR-19 · ข้อตกลงบนกระดาน: ทุกโมดูลเรียก `ctx.rules` ไม่นับวันทำการเอง) จึงเป็นกลไกเดียวกันทุกประการ · ถ้าจะทำให้ TC-NOTI-02 ไม่ล้ม ต้องให้ระบบแจ้งเตือนนับวันคงเหลือด้วยสูตรแยกที่ B03 ไม่กระทบ ซึ่งทำให้หน้าจอบอก `ปกติ` แต่กระดิ่งบอก `ใกล้ครบกำหนด` (ขัด FR-19/FR-20 และกติกา BUGS §1 ข้อ 1 "เปลี่ยนเฉพาะจุดที่ระบุ") · test ก็ไม่ผิด เพราะคาดค่าตาม TEST-PLAN ทุกตัว
- **ทำอะไร:** ไม่แก้เว็บ ไม่แก้ test · เพิ่ม TC-NOTI-02 ในรายการ "อาจล้ม" ของ B03 ใน `scripts/run-bugs.sh` (มีคอมเมนต์อธิบาย) · ชุดรวม B03,B07 ก็ล้ม TC-NOTI-02 เหมือนกัน (union ไม่เปลี่ยน) · เสนอให้เจ้าของโจทย์เพิ่ม TC-NOTI-02 ในคอลัมน์ "อาจล้มด้วย" ของ BUGS §2 และ TEST-PLAN §18 (คำถาม §8 ข้อ 1)

### 5.2 กลุ่ม "อาจล้ม" อื่น

| บั๊ก | อาจล้ม (ตาราง §2) | ผลจริง | หมายเหตุ |
|---|---|---|---|
| B03 | TC-SLA-03 · TC-RBAC-04 | ล้มทั้งคู่ | SLA-03 ส่วน B `ใกล้ครบกำหนด` → `ปกติ` · RBAC-04 ขั้น #7 เพิ่มวันหยุด 2 ธ.ค. แล้ว `dueAt` คาด 8 ธ.ค. ได้ 4 ธ.ค. |
| B07 | TC-WORKFLOW-01 | ผ่าน | เว็บถอดเฉพาะการตรวจ "SV-02/03 ต้องเป็นหัวหน้า" ไม่ได้ถอดการตรวจสิทธิ์อนุมัติทั้งหมด จึงไม่กระทบ SV-01 |
| B10 | TC-DASH-01 · TC-DASH-03 | ล้มทั้งคู่ | สูตรเดียวกัน (ธ.ค. `–` → `0.0%` · พ.ย. `85.7%` → `23.1%`) ตรงตัวอย่าง BUGS §6 |

### 5.3 ไม่มีกรณี "ผ่านหลอก"

ทุกรอบคอลัมน์ "TC ที่ควรล้มแต่ผ่าน" = – (ทั้ง docker และ local) · TC ที่จับบั๊กสิทธิ์/ข้อมูลส่วนบุคคล (RBAC-01/02, QUEUE-02, PDPA-02/03, WORKFLOW-04) ตรวจที่ API/ค่าจริง ไม่ได้ดูแค่ปุ่มบนจอ

## 6. FR-01..FR-29 · traceability (REQUIREMENTS §5)

TC ต่อ FR ดึงจากคอลัมน์ "ครอบ" ของแต่ละ TC ใน TEST-PLAN · ทุก TC ในตารางนี้ผ่านในรอบ normal-1/normal-2/final (docker และ local) · คอลัมน์ smoke = `scripts/fr-smoke.js` (ตรวจ route/API/สิทธิ์ตาม CONTRACT §1 §6 ส่วนที่ 51 TC ไม่ได้แตะตรง ๆ · ผลเต็มที่ `reports/fr-smoke.txt` · **53/53 PASS**)

| FR | TC (ผ่านทั้งหมด) | smoke | โมดูล |
|---|---|---|---|
| FR-01 | TC-AUTH-01 · TC-AUTH-02 ✅ | 7/7 PASS | auth |
| FR-02 | TC-AUTH-03 ✅ | – | auth |
| FR-03 | TC-AUTH-04 · TC-RBAC-03 ✅ | 15/15 PASS | auth + core RBAC |
| FR-04 | TC-FEE-01 · TC-SUBMIT-01 ✅ | 4/4 PASS | apply + rules |
| FR-05 | TC-SUBMIT-02 · TC-UPLOAD-01 · TC-UPLOAD-02 ✅ | – | apply |
| FR-06 | TC-SUBMIT-02 ✅ | – | apply |
| FR-07 | TC-SUBMIT-03 ✅ | 2/2 PASS | apply |
| FR-08 | TC-PAY-01 · TC-PAY-02 · TC-PAY-03 · TC-PAY-04 ✅ | – | payment |
| FR-09 | TC-RBAC-01 ✅ | 3/3 PASS | cases |
| FR-10 | TC-SUBMIT-03 ✅ | – | cases + apply |
| FR-11 | TC-SLA-02 · TC-WORKFLOW-06 ✅ | – | cases + rules |
| FR-12 | TC-QUEUE-01 · TC-PDPA-02 ✅ | 1/1 PASS | queue |
| FR-13 | TC-QUEUE-02 · TC-QUEUE-03 · TC-WORKFLOW-01 ✅ | – | queue |
| FR-14 | TC-WORKFLOW-04 · TC-WORKFLOW-05 ✅ | – | workflow |
| FR-15 | TC-WORKFLOW-02 · TC-WORKFLOW-03 ✅ | – | workflow |
| FR-16 | TC-WORKFLOW-01 · TC-WORKFLOW-02 · TC-WORKFLOW-03 · TC-WORKFLOW-05 · TC-RBAC-02 ✅ | 1/1 PASS | workflow |
| FR-17 | TC-WORKFLOW-01 · TC-WORKFLOW-02 · TC-DOC-01 ✅ | – | documents |
| FR-18 | TC-DOC-02 · TC-DOC-03 ✅ | 2/2 PASS | documents |
| FR-19 | TC-SLA-01 · TC-SLA-02 · TC-SLA-03 ✅ | – | rules (+ cases/queue/workflow แสดงผล) |
| FR-20 | TC-NOTI-01 · TC-NOTI-02 ✅ | 3/3 PASS | queue (notifications) |
| FR-21 | TC-PDPA-01 · TC-PDPA-02 · TC-PDPA-03 ✅ | – | queue + workflow |
| FR-22 | TC-DASH-01 · TC-DASH-02 · TC-DASH-04 ✅ | 1/1 PASS | dashboard |
| FR-23 | TC-DASH-03 ✅ | 2/2 PASS | dashboard |
| FR-24 | TC-AUDIT-01 · TC-AUDIT-02 · TC-AUDIT-03 ✅ | 2/2 PASS | admin (audit) |
| FR-25 | TC-RBAC-04 · TC-RBAC-06 ✅ | 1/1 PASS | admin |
| FR-26 | TC-RBAC-04 · TC-RBAC-06 ✅ | 2/2 PASS | admin |
| FR-27 | TC-RBAC-04 · TC-RBAC-06 ✅ | 2/2 PASS | admin |
| FR-28 | TC-NFR-03 ✅ | 2/2 PASS | core |
| FR-29 | TC-RBAC-05 ✅ | 2/2 PASS | workflow |

ทุก FR มี TC อย่างน้อย 1 ตัว · traceability US → FR → BR ใน REQUIREMENTS §5 ครบ ไม่มีแถว ❌ · BR → TC ตาม TEST-PLAN §17 ครอบด้วยชุด 51 TC เดียวกัน

## 7. สิ่งที่ P14 แก้ระหว่างรวมระบบ

| # | ไฟล์ | ปัญหา | แก้ | ฝั่งที่ผิด (ตัดสินจาก) |
|---|---|---|---|---|
| 1 | `e2e/specs/part1/_lib.js` `expectStatus` | เรียก `res.request()` ซึ่ง `APIResponse` ของ Playwright 1.49 ไม่มี → TC ของ part1 ที่เรียก API ผ่าน helper ล้มที่ helper ก่อนถึงเว็บ | อ่าน method เฉพาะเมื่อ `typeof res.request === 'function'` · assert เดิมทั้งหมดคงไว้ | test (bug ใน helper) |
| 2 | `e2e/specs/part1/_lib.js` `claimApi` `clickAndCapture` | หน้าเปลี่ยน URL ทันทีหลังสำเร็จ → browser ทิ้ง body ของ response → `res.text()` throw | อ่าน body แบบ try/catch · **หลังรีวิว (§8 ข้อสังเกต 1):** `claimApi` ไม่มี catch แล้ว และ `clickAndCapture` ยอม body = null เฉพาะ HTTP 200 | test (เปราะ) |
| 3 | `e2e/specs/part1/_lib.js` `expectAttrList` | `queue-filter` ส่งฟอร์ม GET → `evaluateAll` ล้มระหว่างโหลดหน้า | ให้ `expect.poll` ลองใหม่แทนล้มทันที · ค่าที่คาดไม่เปลี่ยน | test (เปราะ) |
| 4 | `src/modules/queue/index.js` (Audit `UNMASK`) | บันทึก `fromStatus/toStatus` = สถานะปัจจุบัน → `/audit` แสดง `COMPLETED → COMPLETED` แต่ TEST-PLAN TC-AUDIT-01 คาด `–` (ไม่เปลี่ยนสถานะ) | ส่ง `null` ทั้งคู่ | เว็บ (TEST-PLAN TC-AUDIT-01) |
| 5 | `src/modules/apply/public/apply.js` | กด `to-upload-btn` แล้วเลือกไฟล์ทันทีขณะร่างยังสร้างไม่เสร็จ → ไฟล์ถูกทิ้งเงียบ ๆ (ไม่มี `draft`) | เก็บ promise `pendingDraft` แล้วอัปโหลดต่อเมื่อร่างสร้างเสร็จ | เว็บ (race ฝั่ง browser) |
| 6 | `e2e/playwright.config.js` | browser ในเครื่องเป็น build 1254 ไม่ตรง `@playwright/test` 1.49.1 | รองรับ env `PW_EXECUTABLE_PATH` (ไม่ตั้ง = ค่าปกติ · ใน docker ไม่ต้องตั้ง) | สภาพแวดล้อม |
| 7 | `docker-compose.yml` | TC-NFR-03 ต้องมีเว็บตัวที่ 2 ที่ไม่ตั้ง TEST_MODE (`BASE_URL_NO_TEST_MODE`) ไม่งั้น skip | เพิ่ม service `web-notest` (profile `test` · image เดียวกัน · tmpfs `/data`) และให้ `e2e` depends_on ทั้งสอง | รวมระบบ |
| 8 | `scripts/run-bugs.sh` `scripts/pw-summary.js` `scripts/fr-smoke.js` | – | สคริปต์รันชุดเต็ม/บั๊ก/สรุปผล/smoke FR (ใหม่) · แก้ `OUT` relative → absolute (log หายเมื่อ `cd e2e`) | – |

ไม่มีการลด assert หรือเปลี่ยนค่าที่คาดใน test ข้อไหนเพื่อให้ผ่าน

## 8. แก้ตามรีวิว REVIEW-P14

รีวิวอิสระ `reports/REVIEW-P14.md` ให้แก้ M1 M2 M3 และข้อสังเกต 1 8 9 10 · ไม่ได้แก้พฤติกรรม BUG_MODE ของเว็บ ไม่ได้แก้ `src/` เลย (ใช้ `LOG_REQUESTS` ที่มีอยู่แล้วใน `src/core/config.js:28` + `src/core/index.js:151` (เลขบรรทัดหลัง §11)) · ไม่ลด assert ข้อไหน ทุกข้อเข้มขึ้นหรือเท่าเดิม · หลักฐานทั้งหมดมาจาก `npm test` (§1) และรอบ docker ใน §3–§4

| ข้อ | ปัญหา (รีวิว) | แก้ (file:line) | หลักฐาน |
|---|---|---|---|
| **M1** | `pw-summary.js` นับ TC ที่ skipped ว่าผ่าน → รอบที่มี skip ยังได้ `RESULT: MATCH` | `scripts/pw-summary.js:36` `ok` = `status === 'passed'` เท่านั้น และแยก `skipped` · `:51` `okMatch` ต้องมี `skipped.length === 0` (+ ครบ 51 TC ไม่ซ้ำ + กฎ must/may-fail เดิม) · `:55` พิมพ์ `SKIP …` · TC ที่ต้องล้มแต่ถูก skip ตกไปอยู่ใน `should-fail-but-passed` | `test/pw-summary.test.js` 5 ข้อผ่าน: 51 passed → MATCH · 1 skipped ในรอบปกติ → MISMATCH (exit 1) · TC ที่ต้องล้มถูก skip → MISMATCH · ล้มเกิน → MISMATCH · ไม่ครบ 51/ซ้ำ → MISMATCH · ทุกรอบ docker ใน §4.1 พิมพ์ `skipped=0` |
| **M2 (ก)** | `pdfText()` เงียบแล้วคืน `''` → ตรวจ PII ได้ลิสต์ว่างแล้วผ่าน | ย้ายตัวตรวจไป `e2e/specs/part2/pii.js` (ไม่พึ่ง Playwright เพื่อให้ unit test ใช้ตัวเดียวกัน) · `pii.js:22` `pdfText` throw ถ้าโหลด pdf-parse ไม่ได้หรือ parse ไม่ได้ · `pii.js:39` `assertPdfText` throw ถ้า `text.trim()` ว่าง · `e2e/specs/part2/_lib.js:378` `pdfLines` เรียกทั้งคู่ก่อนตรวจทุกครั้ง | `test/pii-check.test.js` "ข้อความว่าง/อ่านไม่ได้ → throw": `''`, ช่องว่างล้วน, ไบต์ที่ไม่ใช่ PDF และ **PDF จริงจาก pdfkit ที่ไม่มีข้อความ** (pdf-parse คืน `''`) → throw ทุกกรณี |
| **M2 (ข)** | `expectPdfLine` ผ่านได้ด้วยไบต์ดิบ (`raw.includes`) ซึ่งมีบรรทัด KPI ใน Info `Subject`/`Keywords` | `_lib.js:384` `expectPdfLine` เทียบเฉพาะบรรทัดจากข้อความที่ pdf-parse ดึงได้ (ไม่มีไบต์ดิบ/Info dictionary อีก · `grep raw.includes e2e/specs` = 0) · ข้อความล้มบอกบรรทัด ASCII ที่ได้จริง · `dash.spec.js:144` `:175` ใช้ `text` ที่คืนมาตรวจ PII ต่อ | unit test "PDF ปกติ" และ "แทรก PII": บรรทัด `kpi received=26 closed=7 ontime=85.7% backlog=21 overdue=1` อยู่ในข้อความที่ดึงได้จาก `buildPdf` จริง · TC-DASH-03 ผ่านในรอบปกติทุกรอบ และ B10 ล้มที่ KPI บนจอก่อนถึง PDF (§4.4) |
| **M2 (ค)** | ชื่อไทยเทียบทีละบรรทัด แต่ pdf-parse แยกสระ/วรรณยุกต์ขึ้นบรรทัดใหม่ | `pii.js:74` `pdfPiiFindings`: `\d{13}` และ `0\d{9}` ยังตรวจทีละบรรทัด · ชื่อ `สมชาย สมหญิง ปิติ มานะ` (`pii.js:7`) ตรวจบนข้อความทั้งไฟล์ที่ตัด whitespace ทุกตัวออก (`pii.js:16` `squash`) · `pii.js:55` `piiFindings` (xlsx/innerText) ก็เทียบชื่อหลังตัด whitespace ด้วย · `dash.spec.js:145` `:176` เรียก `pdfPiiFindings` | **ตัวควบคุมบวก** `test/pii-check.test.js`: (1) สตริง `"ส\nม\nห\nญ\nิ\nง\nป\nิ\nต\nิ"` → แบบทีละบรรทัดเดิมเจอ `[]` แบบใหม่เจอ `["สมหญิง","ปิติ"]` (2) PDF จาก `buildPdf` ของเว็บที่แทรกชื่อทั้ง 4 + `1101700123456` + `0845678901` → pdf-parse + `pdfPiiFindings` จับได้ครบ (3) PDF ของเว็บที่ใส่ `ช่วงสมหญิง` → pdf-parse ได้ `"ช\n่\nวงสมหญิง"` แบบทีละบรรทัดไม่เจอคำเดิม แบบตัด whitespace จับ `สมหญิง` ได้ (4) PDF ปกติ → `[]` (ไม่มี false positive) · ผลจริงอยู่ใน `reports/npm-test.txt` |
| **M3** | `if (n !== null)` ข้ามการตรวจจำนวนไฟล์ผ่าน API แบบเงียบ | `e2e/specs/part1/upload.spec.js:17-20` `filesOf()` assert `Array.isArray(draft.files)` ก่อน (ไม่มี → ล้มพร้อม body) · `:85` `toBe(5)` และ `:138` `toBe(accepted)` แบบไม่มีเงื่อนไข | TC-UPLOAD-01/02 ผ่านทุกรอบปกติ · B02 ล้ม TC-UPLOAD-01 ตามตาราง (§4.1) |
| **ข้อสังเกต 1** | `claimApi` / `clickAndCapture` กลืน error ตอนอ่าน body ทุกกรณี | `e2e/specs/part1/_lib.js:209-213` `claimApi` (APIRequestContext ไม่เปลี่ยนหน้า) ไม่มี try/catch แล้ว · `:256-272` `clickAndCapture` catch เฉพาะ `status === 200` (สำเร็จแล้วหน้าเปลี่ยน URL) · status อื่นที่อ่าน body ไม่ได้ → throw `HTTP <status>: อ่าน body ไม่ได้` (`:268`) · `readBody` (`:93`) คืน JSON ที่ parse แล้วเสมอเมื่ออ่านได้ → ข้อความล้มบอก code ที่คาด/ที่ได้ | ทุกรอบปกติผ่าน (ไม่มีกรณี error response อ่าน body ไม่ได้) · B08 ส่วน 1 ข้อความล้มแสดง body ของทั้งสองฝั่ง (§4.4) |
| **ข้อสังเกต 8** | TC-NFR-04 ไม่ตรวจ log ของเว็บ | `scripts/run-bugs.sh:32` เปิด `LOG_REQUESTS=1` (เว็บ log `METHOD path status ms` ทุกคำขอ) · `:119-125` docker: `docker compose logs -f web` ลง `e2e/results/web.log` ตลอดรอบ แล้วส่ง `WEB_LOG_PATH=/e2e/results/web.log` · `:129` local: `data/p14/server.log` · `docker-compose.yml:16` `:64` ส่ง env · `e2e/specs/part2/nfr.spec.js:303-341` ตัวควบคุมบวกของ log ในรอบจริง: log ต้องมีบรรทัด `listening on … TEST_MODE=1` และต้องมีบรรทัด `POST /api/auth/register 201` **เพิ่มขึ้น** หลังมานะลงทะเบียน (พิสูจน์ว่า log ที่สแกนครอบคำขอที่ส่งเบอร์ `0845678901` จริง) แล้วค้น 12 ค่า (utf8 + utf16le) ต้องไม่พบ · ไม่ตั้ง `WEB_LOG_PATH` → บันทึก annotation `skip-step` และพิมพ์ลง stdout | ตัวควบคุมบวก unit: `needleFindings` จับ `0845678901` และ `3-1006-00987-65-9` ที่ฉีดลง log ได้ · รอบ docker: `normal-1.log` = `[TC-NFR-04] web log /e2e/results/web.log: 80296 bytes · 2262 lines · register lines 1 → 2 · PII found 0 · DB files 1` (ตัวเลขรอบอื่นใน §4.6) |
| **ข้อสังเกต 9** | `testFile()` สร้าง PDF สังเคราะห์เองถ้าไม่มีไฟล์ | `e2e/specs/part2/_lib.js:61-69` `testFilePath()` throw `ไม่พบไฟล์ทดสอบ …` ถ้าไม่มีใน `e2e/testfiles/` · `testFile()`/`inputFile()` อ่านผ่านตัวนี้เท่านั้น ไม่มีโค้ดสร้างไฟล์แทน | รอบปกติ 51/51 (global-setup สร้างไฟล์ครบตาม TEST-DATA §11) |
| **ข้อสังเกต 10** | B08 ล้มที่ส่วน 1 แล้วไม่ไปถึงส่วน 3 | `e2e/specs/part1/queue.spec.js:104-113` ห่อแต่ละส่วนด้วย `part()` = `test.step` + จับ error → บันทึกผลรายส่วนด้วย `expect.soft(...).toBe('ผ่าน')` แล้วรันส่วนถัดไป (ส่วน 2/3 เริ่มด้วย RESET เอง) · `:180-181` ปิดท้าย assert แบบ hard ว่าทุกส่วนผ่าน · assert ข้างในแต่ละส่วนไม่เปลี่ยน | รอบ B08 ใหม่ (`reports/runs-docker/bug-B08.json`) TC-QUEUE-02 มี error 4 ตัวในรอบเดียว: **ส่วน 1** `[200, 200]` (A owner `off.reg1` · B owner `off.reg2` คาด `[200, 409]`) · **ส่วน 2** 10 ครั้งพร้อมกันได้ 200 × 9 (คาด 1) · **ส่วน 3** `off.reg2 claim ต่อจาก off.reg1 [/api/officer/cases/EG-2569-000029/claim]: HTTP status ควรเป็น 409` ได้ `200` body `{"caseNo":"EG-2569-000029","status":"IN_REVIEW","owner":"off.reg2"}` ตรงตัวอย่าง BUGS §2 · ตัวที่ 4 = assert hard สรุปผลรายส่วน · รอบปกติทั้ง 3 ส่วนผ่าน (51/51) |

## 9. คำถาม / ข้อสังเกตที่เหลือ

1. **BUGS §2 / TEST-PLAN §18 แถว B03** ควรเพิ่ม TC-NOTI-02 (ส่วน B) ในคอลัมน์ "อาจล้มด้วย" เพราะกลไกเดียวกับ TC-SLA-03 ส่วน B (§5.1) · ตอนนี้ P14 บันทึกไว้ใน `run-bugs.sh` และรายงานนี้
2. ~~B08 ไม่ไปถึงส่วน 3~~ แก้แล้ว (§8 ข้อสังเกต 10) · รอบ B08 ตอนนี้แสดงผลทั้ง 3 ส่วนในรอบเดียว
3. `TEST_MODE=1` (และ `RESET_ON_START=1`) ล้างและ seed DB ใหม่ทุกครั้งที่เริ่ม และ compose ใช้ `./data` เดียวกันทั้งโหมดปกติและโหมดทดสอบ → อย่าเปิด TEST_MODE กับข้อมูลจริง (production ต้องตั้ง `PII_KEY` `SIGN_KEY` ด้วย) · โหมดปกติไม่ลบข้อมูลอีกแล้วไม่ว่าโครงสร้างตารางจะเปลี่ยนอย่างไร (§11)
4. service `e2e` รัน `npm install` ใน container ทุกครั้ง (ใช้ `e2e/node_modules` ที่ mount มา) · ถ้าเครื่องใหม่ไม่มี `e2e/node_modules` ต้องต่อ npm registry ได้
5. บนเครื่องนี้ (นอก docker) Node เป็น v22 และ browser ของ Playwright เป็น build 1254 → `run-bugs.sh` แบบ `RUNNER=local` ตั้ง `PW_EXECUTABLE_PATH` ให้อัตโนมัติ · ใน docker ใช้ Node 20 และ browser ของ image 1.49.1 ตรงเวอร์ชัน

## 10. วิธีรันซ้ำ

```bash
cd app
npm test                                         # unit test
docker compose up --build -d                     # เว็บโหมดปกติ http://localhost:3000
scripts/restart-check.sh                         # โหมดปกติ: ลงทะเบียน → restart → down/up → ผู้ใช้ยังอยู่ (reports/restart-check.txt)
npm run migrate:new -- <desc>                    # เปลี่ยนโครงสร้างตาราง = เพิ่มไฟล์ migration ใหม่ (ห้ามแก้ไฟล์ที่ apply แล้ว)
scripts/run-bugs.sh                              # ชุดเต็ม: ปกติ×2 → B01..B12 → B03,B07 → B01,B05,B09 → ปกติ (docker ถ้ามี · ไม่งั้น node)
scripts/run-bugs.sh normal                       # เฉพาะ 51 TC สองรอบติด
scripts/run-bugs.sh B03 B07,B12                  # เฉพาะรหัสที่ระบุ (รวมหลายตัวด้วย ,)
RUNNER=local OUT=reports/runs-local scripts/run-bugs.sh   # บังคับรันด้วย node บนเครื่อง
BASE_URL=http://localhost:3000 node scripts/fr-smoke.js   # smoke FR (ต้องเปิด TEST_MODE=1)
node scripts/report-tables.js reports/runs-docker   # ตาราง §4.1 + ข้อความล้มจาก summary.json
```

ผลแต่ละรอบ: `<OUT>/<label>.json` (Playwright JSON) · `.summary.json` · `.txt` (สรุป MATCH/MISMATCH) · `.log` (ผลรันเต็ม)

## 11. เปลี่ยนเป็น migration แบบเพิ่มไฟล์

> ทำเมื่อ 2026-11-19 · กติกาใหม่ (ARCHITECTURE §6.0): **ห้ามแก้ไฟล์ migration ที่ apply แล้ว ให้เพิ่มไฟล์ใหม่เท่านั้น** · ไม่ได้แก้ `src/modules/**` `src/rules/**` seed หรือ e2e · ไม่ได้เปลี่ยนค่าที่คาดของ test ข้อไหน (server.test.js แค่ย้ายตารางของโมดูล demo ไปเป็นไฟล์ migration และเพิ่ม assert 1 จุด)

**ปัญหาเดิม:** โครงสร้างตารางทั้งหมดอยู่ในไฟล์ schema กลางไฟล์เดียว (+ ไฟล์ของโมดูล) แล้ว core เทียบค่า hash (sha1) ที่เก็บในตาราง `meta` ทุกครั้งที่เริ่ม · hash ต่าง → **ลบทุกตารางแล้ว seed ใหม่แม้ไม่ได้ตั้ง TEST_MODE** → แก้โครงสร้างหนึ่งบรรทัด = ข้อมูลจริงหายทั้งหมด

### 11.1 สิ่งที่เปลี่ยน (file:line)

| ไฟล์ | เปลี่ยน |
|---|---|
| `src/core/migrations/0001_init.sql` | เนื้อหาไฟล์ schema กลางเดิมทั้งไฟล์ ไม่แก้แม้แต่ไบต์เดียว (sha256 `db8341a9c2f9…` เท่าเดิม · `cmp` ก่อนลบไฟล์เดิม) · คอมเมนต์บรรทัดแรกยังเป็นข้อความเดิม เพราะไฟล์นี้ apply แล้วจึงห้ามแก้ |
| `src/core/migrate.js` (ใหม่) | `:17` ชื่อไฟล์ `NNNN_<desc>.sql` · `:20` ตาราง `schema_migrations(id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)` · `:36` checksum sha256 (ตัด BOM · CRLF นับเป็น LF) · `:97` `readScope` ชื่อผิดรูปแบบ/เลขซ้ำ/`0000` → error แล้วเรียงตามเลข · `:133` `loadMigrations` core ก่อน แล้วโมดูลตามลำดับที่ส่งมา · scope ซ้ำ หรือเจอไฟล์ schema แบบเดิมในโฟลเดอร์ → error · `:183` `baselineLegacy` · `:215` `verify`: ถูกแก้ `:231` · ลบ/เปลี่ยนชื่อ `:228` (บอกไฟล์ใหม่ที่น่าจะเป็นตัวเดิม) · ไฟล์ใหม่เลขน้อยกว่าที่ apply แล้ว `:251` · ไฟล์ว่าง `:252` · `:268` `migrate`: แต่ละไฟล์ `db.tx` ของตัวเองพร้อม INSERT แถว `schema_migrations` (`:280-290`) · **ไม่มีคำสั่ง DROP ในไฟล์นี้** |
| `src/core/index.js` | `:15` ใช้ `migrate`/`loadMigrations` แทน helper hash เดิม · `:47-61` โหมดปกติ = `migrate()` อย่างเดียว (apply เฉพาะที่ค้าง ตรวจ checksum ก่อน) · TEST_MODE/RESET_ON_START = `db.tx(dropAll + migrate)` · migration ผิด → ปิด DB แล้ว throw (`:60`) · `:63` seed เฉพาะ TEST_MODE/RESET_ON_START หรือ DB ที่ยังไม่มีผู้ใช้ · `:131-143` `resetAll` (POST /api/test/reset) = `clock.reset()` → `db.tx(dropAll + migrate)` → seed → onReset · ไม่เขียน hash ลง `meta` อีก |
| `src/core/db.js` | ลบ helper อ่าน/รวม/hash/apply ไฟล์ schema และ get/set meta · เหลือ `openDb` + `dropAll` (`:22-25` ใช้เฉพาะ TEST_MODE / RESET_ON_START / reset) |
| `src/server.js` | `:24` discovery ใช้ `src/modules/<โฟลเดอร์>/migrations` · `:40-56` require ทุกโมดูลก่อนสร้าง ctx → เรียง `order` แล้วชื่อโฟลเดอร์ → ส่ง scope migration ตามลำดับโหลด (โมดูลที่ require ไม่ผ่านต่อท้าย เพื่อไม่ให้ไฟล์ที่ apply แล้วกลายเป็น "หาย") · `:96-98` `MigrationError` พิมพ์ข้อความล้วนแล้ว exit 1 |
| `src/core/tools/migrate-new.js` (ใหม่) + `package.json:15` | `npm run migrate:new -- <desc> [--module <โฟลเดอร์>]` → ไฟล์ว่างเลขถัดไป (ตรวจเลขซ้ำ/ชื่อผิดก่อนสร้าง · desc → `a-z 0-9 _`) |
| `src/core/test/server.test.js:17-18` `:109-113` | โมดูล demo ใช้ `migrations/0001_demo_items.sql` · หลัง reset `schema_migrations` = `core/0001_init.sql` + `demo/0001_demo_items.sql` |
| `src/core/test/migrate.test.js` (ใหม่) | (a)–(f) + กรณีขอบ (§11.2) |
| `scripts/restart-check.sh` (ใหม่) | หลักฐาน restart บน Docker (§11.3) |
| `ARCHITECTURE.md` §1 §2 §3 ข้อ 3 · §6.0 (ใหม่) · §6.1 แถว `meta`/`schema_migrations` · §8 · §9 · §11 | กติกา + ลำดับ + checksum + baseline + พฤติกรรมแต่ละโหมด · ไม่มีการอ้างถึงไฟล์ schema/hash แบบเดิมแล้ว |

พฤติกรรมตอนเริ่มเครื่อง:

| โหมด | ทำอะไร |
|---|---|
| ปกติ (ไม่ตั้ง TEST_MODE) | ตรวจชื่อ/เลขไฟล์ → ตรวจ checksum ของไฟล์ที่ apply แล้ว → apply เฉพาะไฟล์ที่ค้าง (ไฟล์ละ transaction) → seed เฉพาะ DB ใหม่ที่ยังไม่มีผู้ใช้ · **ไม่ลบอะไรเลย** |
| ไฟล์ที่ apply แล้วถูกแก้/ลบ/เปลี่ยนชื่อ | ไม่เริ่มระบบ (exit 1) ข้อความบอกชื่อไฟล์ + "ห้ามแก้ไฟล์ migration ที่ apply แล้ว ให้เพิ่มไฟล์ใหม่เท่านั้น" + `npm run migrate:new -- <desc>` · ไม่แตะ DB |
| `TEST_MODE=1` / `RESET_ON_START=1` / `POST /api/test/reset` | ลบทุกตาราง → รัน migration ทั้งหมดใหม่ → seed (เหมือนเดิม) |
| DB รุ่นก่อน migration (มีตาราง + hash เดิมใน `meta` · ไม่มี `schema_migrations`) | โครงสร้างตรง `core/0001_init.sql` → บันทึก `core/0001_init.sql` ว่า apply แล้วโดยไม่รัน (baseline) + ลบ key เดิมใน `meta` · ไม่ตรง/ไม่รู้จัก → ไม่เริ่มระบบ ไม่ลบอะไร |

### 11.2 Test (`npm test` · `src/core/test/migrate.test.js`)

| ข้อ | test | ตรวจอะไร |
|---|---|---|
| (a) DB ใหม่ | `:95` | โหมดปกติ → applied = `core/0001_init.sql`, `demo/0001_demo_items.sql` ตามลำดับ · seed 11 users / 30 cases · checksum = sha256 ของไฟล์ · `applied_at` ISO +07:00 · `meta` ว่าง |
| (b) restart เก็บข้อมูล | `:115` | เพิ่มผู้ใช้ `mig.keep` + แก้ fee SV-02 เป็น 777 + แถวใน `demo_items` → เริ่มใหม่ → applied = [] · ไม่ seed ซ้ำ · ทั้ง 3 อย่างยังอยู่ |
| (c) เพิ่ม 0002 | `:131` | เพิ่ม `core/0002_users_nickname.sql` (ALTER TABLE ADD COLUMN) + `demo/0002_demo_note.sql` → applied = 2 ไฟล์นี้เท่านั้น core ก่อน · `demo/0001` ไม่มี IF NOT EXISTS (ถ้ารันซ้ำจะ error) · แถวของ 0001 `applied_at` เดิม · ข้อมูลอยู่ครบ + คอลัมน์ใหม่มีจริง |
| (d) แก้ไฟล์ที่ apply แล้ว | `:151` | แก้ `core/0002` → `MigrationError` `MIGRATION_CHANGED` มีชื่อไฟล์ + ข้อความกติกา + "add a new migration" · จำนวนแถวและ `schema_migrations` เท่าเดิม ผู้ใช้ `mig.keep` ยังอยู่ · แก้ `core/0001` / ลบ `demo/0002` ("ไม่พบไฟล์ → ถูกลบหรือเปลี่ยนชื่อ") / เปลี่ยนชื่อ (บอก `demo/0002_demo_note_v2.sql`) → ไม่เริ่มทุกกรณี · คืนไฟล์เดิม (แม้เป็น CRLF) → เริ่มได้ ข้อมูลครบ |
| (e) baseline DB รุ่นเดิม | `:242` `:268` | สร้าง DB แบบโค้ดรุ่นก่อน (exec ไฟล์ทั้งไฟล์ + seed + hash sha1 ใน `meta` + แถวที่ไม่ใช่ seed) → baseline `core/0001` ไม่รัน · migration ของโมดูลที่เพิ่งมีถูก apply · ไม่ seed ซ้ำ จำนวนแถวเท่าเดิม · ลบ key เดิมใน `meta` · เริ่มครั้งถัดไปไม่มีอะไรทำ · DB รุ่นเก่ากว่า (ไม่มีดัชนี `cases_due` · `notifications` ไม่มี UNIQUE) → `MIGRATION_LEGACY_MISMATCH` บอกวัตถุที่ต่าง ไม่สร้าง `schema_migrations` ไม่ลบอะไร · DB มีตารางแต่ไม่มี key เดิม → `MIGRATION_UNKNOWN_DB` |
| (f) TEST_MODE ยังล้าง | `:192` | TEST_MODE=1 บน DB เดิม → ข้อมูลที่เพิ่มหาย · migration 4 ไฟล์รันใหม่ · seed · `ctx.reset()` (= POST /api/test/reset) ทำเหมือนกัน และ `applied_at` = นาฬิกาทดสอบทุกครั้ง (NFR-09) · `RESET_ON_START=1` ล้างเหมือนกันโดยไม่เปิด TEST_MODE |
| เลข/ไฟล์ผิด | `:293` `:324` | เลขซ้ำ · ชื่อผิด 8 แบบ (`1_a` `00002_a` `0002-a` `0002_A` `.SQL` `.txt` `0002.sql` `init.sql`) · `0000` · ไฟล์ schema แบบเดิมในโฟลเดอร์ · scope ซ้ำ · ไฟล์ใหม่เลขน้อยกว่าที่ apply แล้ว · ไฟล์ว่าง · SQL ผิดกลางไฟล์ → rollback ทั้งไฟล์ ไฟล์ก่อนหน้าคงอยู่ |
| migrate:new | `:351` | สร้าง `0002_…` `0003_…` เป็นไฟล์ว่าง · `--module queue` → `migrations/0001_…` · desc ไทย / โมดูลไม่มี / เลขซ้ำ → error |
| NFR-04 | `:376` | ไฟล์ migration จริงทุกไฟล์ (core + โมดูล) ไม่มีเลข 13 หลัก · รูปแบบ `d-dddd-ddddd-dd-d` · เบอร์มือถือ |

ผล: host 196/196 (16 ไฟล์ · เพิ่ม 12) · image node 20 184/184 (14 ไฟล์) (§1)

### 11.3 Docker: restart แล้วข้อมูลอยู่ครบ (`scripts/restart-check.sh` → `reports/restart-check.txt`)

ไม่ตั้ง TEST_MODE · `./data/app.db` ตอนเริ่มเป็น DB ที่โค้ดรุ่นก่อนสร้างไว้จริง (hash เดิมใน `meta` = `b38ed80c…` = sha1 ของ `0001_init.sql`) → **baseline จริงบน Docker** · เลขบัตร/เบอร์ในหลักฐานแสดงแค่ 4 ตัวท้าย

```text
## 1. docker compose up --build -d --wait web (ไม่ตั้ง TEST_MODE)
  health: {"status":"ok"} · POST /api/test/reset → HTTP 404
  log: [egov] [migrate] baseline core/0001_init.sql (DB รุ่นก่อน migration · ตารางตรงกัน → บันทึกว่า apply แล้วโดยไม่รัน · ข้อมูลเดิมอยู่ครบ)
  log: [egov] listening on :3000 · TEST_MODE=off · BUG_MODE=- · DB_PATH=/data/app.db · modules=[auth, …, dashboard] · clock=2026-11-19T10:14:35+07:00
  DB: {"users":11,"cases":30,"citizen":null,"schema_migrations":[{"id":"core/0001_init.sql","checksum":"db8341a9c2f9","applied_at":"2026-11-19T10:14:35+07:00"}],"meta_rows":0}
## 2. ลงทะเบียนประชาชนใหม่ผ่าน API (โหมดปกติ)
  POST /api/auth/thaid/start   {"status":"OTP_SENT"} → HTTP 200
  POST /api/auth/thaid/verify  {"registered":false} → HTTP 200
  POST /api/auth/register      {"registered":true,"landing":"/citizen"} → HTTP 201
  DB หลังลงทะเบียน: {"users":12,"cases":30,"citizen":{"id":12,"username":"cit-0005","registered":1,"consent_at":"2026-11-19T10:14:40+07:00",…},"schema_migrations":[…core/0001_init.sql…]}
## 3. docker compose restart web · 2026-11-19 10:14:40 +0700
  (log หลัง restart: มีแค่ "listening" เพิ่ม 1 บรรทัด · ไม่มี [migrate] ใหม่ · ไม่ seed)
  POST /api/auth/thaid/verify  {"registered":true} → HTTP 200
  GET  /api/me                 {"username":"cit-0005","role":"citizen"} → HTTP 200
  DB หลัง restart: {"users":12,"cases":30,"citizen":{"id":12,"username":"cit-0005","registered":1,…}, schema_migrations เท่าเดิม}
## 4. docker compose down (ไม่ -v) แล้ว up -d --wait web · 2026-11-19 10:14:42 +0700
  log (คอนเทนเนอร์ใหม่): [egov] listening on :3000 · TEST_MODE=off · … (ไม่มี [migrate] · ไม่ seed)
  POST /api/auth/thaid/verify  {"registered":true} → HTTP 200
  GET  /api/me                 {"username":"cit-0005","role":"citizen"} → HTTP 200
  DB หลัง down/up: {"users":12,"cases":30,"citizen":{"id":12,"username":"cit-0005","registered":1,…}, schema_migrations เท่าเดิม}
RESULT: PASS · ผู้ใช้ที่ลงทะเบียนก่อน restart ยังอยู่ (registered=1) · users/cases/schema_migrations เท่าเดิมทั้งหลัง restart และหลัง down/up
```

แก้ไฟล์ที่ apply แล้วบน image จริง (`reports/migration-edited-docker.txt`): ต่อท้าย `0001_init.sql` หนึ่งบรรทัดคอมเมนต์แล้ว mount ทับในคอนเทนเนอร์กับสำเนา DB ข้างบน → `exit=1` พร้อมข้อความ `core/0001_init.sql: ไฟล์ถูกแก้หลัง apply แล้ว (checksum ที่บันทึก db8341a9c2f9… ≠ ไฟล์ตอนนี้ 71474a49b467…)` + กติกา · sha256 ของไฟล์ DB ก่อน/หลังเท่ากัน (`694e317a7916645a`) · `cit-0005` ยังอยู่

### 11.4 ชุด 51 TC หลังเปลี่ยน

ชุดเต็มรันใหม่ทั้งหมดบน image ที่มีโค้ด §11 (`OUT=reports/runs-docker scripts/run-bugs.sh > reports/runs-docker/matrix.out` · `run-bugs exit=0` · รอบที่ไม่ตรงตามคาด = 0):

| รอบ | ผล |
|---|---|
| normal-1 · normal-2 (ไม่ restart) | 51 passed · 0 failed · 0 skipped · `RESULT: MATCH` ทั้งสองรอบ |
| B01 … B12 ทีละตัว | 12/12 `RESULT: MATCH` (ตาราง §4.1) |
| B03,B07 · B01,B05,B09 | `RESULT: MATCH` ทั้งคู่ · ล้มเท่า union ของรายตัว (§4.3) |
| final (ปิดบั๊ก) | 51 passed · 0 failed · 0 skipped · `RESULT: MATCH` |
| ข้อความล้มเทียบกับรอบก่อนเปลี่ยน (2026-11-16) | 28/28 คู่ (รอบ × TC) ข้อความ assert แรกเหมือนเดิมทุกตัว → พฤติกรรม BUG_MODE ไม่เปลี่ยน |
| TC-NFR-04 | PII found 0 ทุกรอบ (log ของเว็บ + ไฟล์ DB ซึ่งตอนนี้มีตาราง `schema_migrations` ด้วย · §4.6) |

จบแล้ว `docker compose --profile test down` (ไม่มี container ค้าง)

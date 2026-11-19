# test-report · ขั้น 4 · รัน TEST-PLAN ชุดเต็ม (51 TC) กับเว็บถูกต้อง · รุ่น migration

> รันจริงเมื่อ **2026-11-19 10:41:54 (+07:00)** · ใช้เวลา 87.5 วินาที · Docker compose (ทางหลัก เหมือน `app/scripts/run-bugs.sh`) · **รันกับโค้ดรุ่น migration แบบเพิ่มไฟล์** (`app/reports/FINAL-REPORT.md` §11: `src/core/migrations/0001_init.sql` + `schema_migrations` แทนไฟล์ schema กลาง + hash เดิม) · image สร้างใหม่ด้วย `--build` จากโค้ดปัจจุบันก่อนรัน · **ไม่ได้แก้โค้ดเว็บหรือ test** ในรอบนี้
>
> รายงานนี้แทนชุดเดิมที่รันเมื่อ 2026-11-19 09:50 กับโค้ดรุ่นก่อนเปลี่ยนเป็น migration (ชุดเดิมย้ายไปไว้ที่ `/tmp/test-report-old/` นอกโปรเจกต์)

## ผลรวม

**51/51 passed · 0 failed · 0 skipped · 0 flaky** (`results.json` → `stats`: `expected=51 unexpected=0 skipped=0 flaky=0`)

| ไฟล์ | คืออะไร |
|---|---|
| [`index.html`](index.html) + `data/` | Playwright HTML report (เปิดในเบราว์เซอร์ · มีวิดีโอ .webm ของทุก browser context แนบอยู่ · 190 คลิป) |
| [`results.json`](results.json) | Playwright JSON report (path ของไฟล์แนบเป็น path ใน container `/e2e/.test-report-run/…` · โฟลเดอร์นั้นลบแล้ว ไฟล์จริงอยู่ใน `data/`) |
| [`gif/`](gif/) | GIF ของ TC ระดับ P1 · 105 ไฟล์ จาก 42 TC · รวม 24.7 MB (ดูหมายเหตุ GIF) |
| [`run.log`](run.log) | stdout ของการรัน (reporter `list`) · มีบรรทัด `[TC-NFR-04] … PII found 0` |
| [`web-start.txt`](web-start.txt) | บรรทัดเริ่มเว็บ: `TEST_MODE=1 · BUG_MODE=- · clock=2026-12-01T09:00:00+07:00` (ก่อนหน้านั้นใน log เว็บมี `[egov] [migrate] applied core/0001_init.sql`) |
| [`report.config.tmp.js`](report.config.tmp.js) | config ชั่วคราวที่ใช้รอบนี้ (สำเนาเดียวกับรอบก่อน · ลบออกจาก `app/e2e/` แล้ว) |

## วิธีรัน

เปิดเว็บแบบเดียวกับ `scripts/run-bugs.sh` (`start_docker` + `run_suite`): `TEST_MODE=1` ไม่ตั้ง `BUG_MODE` · `LOG_REQUESTS=1` · เก็บ log เว็บให้ TC-NFR-04 ผ่าน `WEB_LOG_PATH`

```bash
cd app
cp ../test-report/report.config.tmp.js e2e/                                     # config ชั่วคราว (ลบออกเมื่อจบ)
export LOG_REQUESTS=1
TEST_MODE=1 BUG_MODE= docker compose up --build -d --force-recreate --wait web  # เว็บ TEST_MODE=1 · BUG_MODE=- (โค้ด migration)
docker compose logs --no-color --no-log-prefix -f web > e2e/.test-report-run/web.log &   # log เว็บสำหรับ TC-NFR-04
WEB_LOG_PATH=/e2e/.test-report-run/web.log TEST_MODE=1 BUG_MODE= \
  docker compose --profile test run --rm e2e \
  bash -lc "npm install --no-audit --no-fund && npx playwright test -c report.config.tmp.js"
docker compose --profile test down                                              # ปิดเว็บเมื่อจบ
rm -rf e2e/report.config.tmp.js e2e/.test-report-run                            # คืนโฟลเดอร์ app ให้สะอาด (คัดลอกผลออกมาแล้ว)
```

- service `e2e` = `mcr.microsoft.com/playwright:v1.49.1-jammy` · `BASE_URL=http://web:3000` · `web-notest` (ไม่ตั้ง TEST_MODE) ขึ้นให้ TC-NFR-03 → ไม่มี TC ถูก skip
- เว็บเริ่มด้วย `TEST_MODE=1` → ตาม §11 ลบทุกตาราง → รัน migration ทั้งหมด → seed · ทุก TC เริ่มด้วย `POST /api/test/reset` ซึ่งตอนนี้ทำ `db.tx(dropAll + migrate)` → seed (FINAL-REPORT §11.1 `src/core/index.js:131-143`) · log TC-NFR-04 ตรวจ log เว็บ + ไฟล์ DB (ซึ่งมีตาราง `schema_migrations` แล้ว) → PII found 0
- `report.config.tmp.js` = `...require('./playwright.config.js')` แล้วเปลี่ยนเฉพาะ `use.video = 'on'` · reporter `list` + `json` + `html` (`open: 'never'`) · `outputDir` แยก (`e2e/.test-report-run/`) · ค่าอื่น (workers 1, retries 0, timeout, expect, project chromium, globalSetup) เหมือนเดิมทุกตัว
- **ข้อที่ต้องรู้เรื่องวิดีโอ:** test ทุกตัวเปิด browser context เองผ่าน fixture `tc`/`kit` (`browser.newContext`) ซึ่ง `use.video` ของ Playwright ไม่ครอบ (ครอบแค่ fixture `page`/`context`) · config ชั่วคราวจึงห่อ `Browser.newContext` ให้ใส่ `recordVideo` (1280×720) ลงโฟลเดอร์ผลของ test นั้น และแนบวิดีโอเข้า test เมื่อ context ปิด · การอัดวิดีโอเป็นแบบ passive ไม่แตะ option อื่นหรือ assert ใด ๆ · รอบนี้รันครั้งเดียว = 51/51
- GIF: `ffmpeg` 6.1.1 · `tpad` ค้างเฟรมสุดท้าย 1 วินาที → `fps=6` → `scale=640:-1` (lanczos) → palette 128 สี (`stats_mode=diff`) · 640×360 · ใหญ่สุด 0.64 MB · รวม 24.7 MB (รอบก่อน 800 px · 8 fps · 132 ไฟล์ · 56 MB)

## หมายเหตุ GIF

- วิดีโอของ TC P1 มี 166 คลิป (1 คลิปต่อ browser context) · `<TC>.gif` = context แรกที่มีภาพ (หน้าหลัก) · `<TC>-2.gif`, `-3.gif` … = context ถัดไปที่ **เก็บไว้** เรียงตามลำดับที่เปิด (เลขต่อท้ายจึงไม่ใช่เลข context)
- context ที่ใช้แค่ `ctx.request` (ยิง API) และไม่เคยเปิดหน้า = วิดีโอขาวทั้งคลิป → **ไม่ทำ GIF** (36 คลิป · ตรวจด้วย `signalstats` ว่า YMAX−YMIN ≤ 8 ทุกเฟรม) · ถ้าทุก context ของ TC เป็นหน้าว่าง (TC-PAY-02 · TC-PAY-03) ยังทำ `<TC>.gif` จากคลิปแรกไว้เป็นหลักฐาน
- **ลดขนาด:** เก็บ GIF ของ context เพิ่มเฉพาะเมื่อแสดงสิ่งที่ต่างจาก context ที่เก็บแล้ว คือ **ผู้ใช้/บทบาทอื่น** (ดูจากชื่อผู้ใช้บนแถบหัว หรือรูปแบบหน้า: ประชาชนเห็นเลขบัตรของตัวเองเต็ม · เจ้าหน้าที่เห็นแบบปิดบัง) **หน้าคนละแบบ** หรือ **ผลที่ต่างกัน** · context ที่เป็นผู้ใช้เดิมบนหน้าแบบเดิม (ต่างแค่เวลา/เลขคำขอ) ตัดออก 27 คลิป · วิดีโอเต็มทุกคลิปยังดูได้ใน `index.html`
- **TC-PDPA-02** (P1) ไม่มี GIF: test ยิง API ล้วนด้วย `request.newContext` ไม่เปิด browser context จึงไม่มีวิดีโอให้แปลง (ข้อ P2 ไม่ทำ GIF ตามโจทย์)
- test หลายตัวจบในไม่ถึง 1 วินาที วิดีโอจึงสั้นมาก (บางคลิปมี 3 เฟรม)

context ที่ตัดออก (ผู้ใช้เดิม หน้าแบบเดิม):

| TC | context ทั้งหมด (มีภาพ) | GIF ที่เก็บ = context | ตัดออก · เหตุผล |
|---|---|---|---|
| TC-NOTI-02 | 9 | 1 off.reg1 · 2 off.reg2 · 3 หัวหน้าฝ่าย · 4 เจ้าหน้าที่โยธา 1 (หน้าแจ้งเตือน) | 5–9 · ผู้ใช้ 4 คนเดิมเปิดหน้าแจ้งเตือนซ้ำในส่วน B/C (ต่างแค่จำนวน) |
| TC-QUEUE-02 | 3 | 1 off.reg1 · 2 off.reg2 (กดรับเรื่องพร้อมกัน) | 8 · off.reg2 หน้าคิวเดิม (ส่วน 3 ต่อกัน) |
| TC-QUEUE-03 | 3 | 1 off.reg2 หน้าคิว · 4 ประชาชน (สมหญิง) หน้าคำขอ | 3 · off.reg2 หน้าคิวเดิม |
| TC-SLA-01 | 9 | 1 ประชาชน (สมชาย) หน้าคำขอ | 2–9 · ผู้ใช้/หน้าเดิม ต่างแค่เวลานาฬิกาทดสอบ |
| TC-SLA-02 | 5 | 1 ประชาชน หน้าคำขอ · 2 off.reg1 หน้าคำขอ · 7 ประชาชน หน้ายื่นคำขอ | 3 · 4 · ประชาชนหน้าคำขอเดิม (อีกคำขอ) |
| TC-WORKFLOW-02 | 6 | 1 off.reg2 · 2 หัวหน้าฝ่าย · 3 off.reg1 · 4 หน้าตรวจสอบเอกสาร | 5 · off.reg1 อีกคำขอ · 6 หน้าตรวจสอบเอกสารซ้ำ (ผลเดิม "ถูกต้อง") |
| TC-WORKFLOW-04 | 7 | 1 off.reg1 · 2 ประชาชน · 4 off.reg2 · 6 ผู้ตรวจสอบภายใน · 7 หัวหน้าฝ่าย | 3 · off.reg1 อีกคำขอ · 5 ประชาชนอีกคำขอ |
| TC-WORKFLOW-05 | 5 | 1 off.reg1 (ตีกลับ) · 2 ประชาชน · 3 off.reg2 (ไม่อนุมัติ) · 5 หัวหน้าฝ่าย (ไม่อนุมัติ SV-03) | 4 · ประชาชนหน้าคำขอเดิม |
| TC-WORKFLOW-06 | 3 | 1 ประชาชน หน้าคำขอ | 2 · 3 · ประชาชนคำขอเดิม |
| TC-DOC-03 | 5 | 1 "เอกสารหมดอายุ" · 5 "ลายเซ็นไม่ถูกต้อง" | 2–4 · ผล "เอกสารหมดอายุ" ซ้ำ |

TC P1 อื่นที่มีหลาย context เก็บครบทุก context ที่มีภาพ เพราะแต่ละ context เป็นผู้ใช้/บทบาท/ขนาดจอคนละแบบ (เช่น TC-RBAC-03 7 บทบาท · TC-NFR-01 8 หน้า × ขนาดจอ · TC-NFR-02 9 หน้า/บทบาท)

## ตาราง 51 TC

คอลัมน์ "ประเภทที่ล้ม/แก้อะไร" ใช้ข้อความเดิมจากรายงานรอบก่อน ซึ่งมาจาก `app/reports/FINAL-REPORT.md` §7 (แก้ระหว่างรวมระบบ) และ §8 (แก้ตามรีวิว REVIEW-P14) · FINAL-REPORT บันทึกการแก้รายไฟล์/helper ไม่ได้บันทึกราย TC จึงผูกเข้ากับ TC โดยดูว่า test ตัวไหนเรียก helper นั้น (เช่น §7-1 `expectStatus` ถูกเรียกใน RESET/CLOCK ของทุก TC ใน `specs/part1/`) · รายการ §8 เป็น test ที่ **ผ่านอยู่แล้วแต่ตรวจหลวม** (รีวิวพบ) ไม่ใช่ล้ม · ไม่มีรายการไหนเป็น **แผนผิด** ในขั้นนี้ (เรื่อง B03 → TC-NOTI-02 อยู่ใน [`../BUG-HUNT.md`](../BUG-HUNT.md)) · TC ที่ไม่ถูกแก้ = "–"

**§11 (migration) ไม่ทำให้ TC ไหนล้มและไม่ได้แก้ test:** §11 แก้เฉพาะ `src/core/**` `src/server.js` และเพิ่ม unit test (`migrate.test.js`) · ไม่ได้แก้ `src/modules/**` seed หรือ e2e · ผลต่อชุด 51 TC มีทางเดียวคือ RESET (`POST /api/test/reset`) ที่ทุก TC เรียก เปลี่ยนเป็น `dropAll + migrate` → seed · รอบนี้ 51/51 และ FINAL-REPORT §11.4 ก็ได้ 51/51 ทั้งรอบ normal-1/normal-2/final → ไม่มีแถวไหนเพิ่มประเภทจาก §11

| TC | P | ผล | ประเภทที่ล้ม | แก้อะไร | GIF |
|---|---|---|---|---|---|
| TC-AUTH-01 | P1 | ✅ ผ่าน (1.7 วิ) | test ผิด | §7-1 `expectStatus` (ใช้ใน RESET/CLOCK) เรียก `res.request()` เฉพาะเมื่อมี | [GIF](gif/TC-AUTH-01.gif) |
| TC-AUTH-02 | P1 | ✅ ผ่าน (1.7 วิ) | test ผิด | §7-1 `expectStatus` (ใช้ใน RESET/CLOCK) เรียก `res.request()` เฉพาะเมื่อมี<br>(เปราะ) §7-2 `claimApi`/`clickAndCapture` อ่าน body หลังหน้าเปลี่ยน URL → หลังรีวิว (§8 ข้อสังเกต 1) เข้มขึ้น: `claimApi` ไม่ catch · `clickAndCapture` ยอม body = null เฉพาะ HTTP 200 | [GIF](gif/TC-AUTH-02.gif) [2](gif/TC-AUTH-02-2.gif) |
| TC-AUTH-03 | P1 | ✅ ผ่าน (1.7 วิ) | test ผิด | §7-1 `expectStatus` (ใช้ใน RESET/CLOCK) เรียก `res.request()` เฉพาะเมื่อมี | [GIF](gif/TC-AUTH-03.gif) |
| TC-AUTH-04 | P2 | ✅ ผ่าน (3.5 วิ) | test ผิด | §7-1 `expectStatus` (ใช้ใน RESET/CLOCK) เรียก `res.request()` เฉพาะเมื่อมี | – (P2) |
| TC-FEE-01 | P1 | ✅ ผ่าน (1.3 วิ) | test ผิด | §7-1 `expectStatus` (ใช้ใน RESET/CLOCK) เรียก `res.request()` เฉพาะเมื่อมี | [GIF](gif/TC-FEE-01.gif) |
| TC-SUBMIT-01 | P1 | ✅ ผ่าน (1.2 วิ) | test ผิด · เว็บผิด | §7-1 `expectStatus` (ใช้ใน RESET/CLOCK) เรียก `res.request()` เฉพาะเมื่อมี<br>§7-5 `apply.js` race: เลือกไฟล์ขณะร่างยังสร้างไม่เสร็จ → ไฟล์ถูกทิ้ง · แก้ให้รอ `pendingDraft` | [GIF](gif/TC-SUBMIT-01.gif) [2](gif/TC-SUBMIT-01-2.gif) |
| TC-SUBMIT-02 | P1 | ✅ ผ่าน (1.5 วิ) | test ผิด · เว็บผิด | §7-1 `expectStatus` (ใช้ใน RESET/CLOCK) เรียก `res.request()` เฉพาะเมื่อมี<br>§7-5 `apply.js` race: เลือกไฟล์ขณะร่างยังสร้างไม่เสร็จ → ไฟล์ถูกทิ้ง · แก้ให้รอ `pendingDraft` | [GIF](gif/TC-SUBMIT-02.gif) |
| TC-SUBMIT-03 | P2 | ✅ ผ่าน (2.7 วิ) | test ผิด | §7-1 `expectStatus` (ใช้ใน RESET/CLOCK) เรียก `res.request()` เฉพาะเมื่อมี<br>(เปราะ) §7-2 `claimApi`/`clickAndCapture` อ่าน body หลังหน้าเปลี่ยน URL → หลังรีวิว (§8 ข้อสังเกต 1) เข้มขึ้น: `claimApi` ไม่ catch · `clickAndCapture` ยอม body = null เฉพาะ HTTP 200 | – (P2) |
| TC-UPLOAD-01 | P1 | ✅ ผ่าน (2.3 วิ) | test ผิด · เว็บผิด | §7-1 `expectStatus` (ใช้ใน RESET/CLOCK) เรียก `res.request()` เฉพาะเมื่อมี<br>§7-5 `apply.js` race: เลือกไฟล์ขณะร่างยังสร้างไม่เสร็จ → ไฟล์ถูกทิ้ง · แก้ให้รอ `pendingDraft`<br>(ตรวจหลวม · รีวิว M3) §8 M3 `filesOf()` assert `Array.isArray` + `toBe(5)`/`toBe(accepted)` ไม่มีเงื่อนไข | [GIF](gif/TC-UPLOAD-01.gif) |
| TC-UPLOAD-02 | P1 | ✅ ผ่าน (2.8 วิ) | test ผิด · เว็บผิด | §7-1 `expectStatus` (ใช้ใน RESET/CLOCK) เรียก `res.request()` เฉพาะเมื่อมี<br>§7-5 `apply.js` race: เลือกไฟล์ขณะร่างยังสร้างไม่เสร็จ → ไฟล์ถูกทิ้ง · แก้ให้รอ `pendingDraft`<br>(ตรวจหลวม · รีวิว M3) §8 M3 `filesOf()` assert `Array.isArray` + `toBe(5)`/`toBe(accepted)` ไม่มีเงื่อนไข | [GIF](gif/TC-UPLOAD-02.gif) |
| TC-PAY-01 | P1 | ✅ ผ่าน (0.8 วิ) | test ผิด | §7-1 `expectStatus` (ใช้ใน RESET/CLOCK) เรียก `res.request()` เฉพาะเมื่อมี | [GIF](gif/TC-PAY-01.gif) |
| TC-PAY-02 | P1 | ✅ ผ่าน (0.2 วิ) | test ผิด | §7-1 `expectStatus` (ใช้ใน RESET/CLOCK) เรียก `res.request()` เฉพาะเมื่อมี | [GIF](gif/TC-PAY-02.gif) (API ล้วน · หน้าว่าง) |
| TC-PAY-03 | P1 | ✅ ผ่าน (0.4 วิ) | test ผิด | §7-1 `expectStatus` (ใช้ใน RESET/CLOCK) เรียก `res.request()` เฉพาะเมื่อมี | [GIF](gif/TC-PAY-03.gif) (API ล้วน · หน้าว่าง) |
| TC-PAY-04 | P2 | ✅ ผ่าน (0.9 วิ) | test ผิด | §7-1 `expectStatus` (ใช้ใน RESET/CLOCK) เรียก `res.request()` เฉพาะเมื่อมี | – (P2) |
| TC-QUEUE-01 | P1 | ✅ ผ่าน (1.3 วิ) | test ผิด | §7-1 `expectStatus` (ใช้ใน RESET/CLOCK) เรียก `res.request()` เฉพาะเมื่อมี<br>(เปราะ) §7-2 `claimApi`/`clickAndCapture` อ่าน body หลังหน้าเปลี่ยน URL → หลังรีวิว (§8 ข้อสังเกต 1) เข้มขึ้น: `claimApi` ไม่ catch · `clickAndCapture` ยอม body = null เฉพาะ HTTP 200<br>(เปราะ) §7-3 `expectAttrList` ใช้ `expect.poll` ระหว่าง `queue-filter` โหลดหน้า (ค่าที่คาดไม่เปลี่ยน) | [GIF](gif/TC-QUEUE-01.gif) [2](gif/TC-QUEUE-01-2.gif) [3](gif/TC-QUEUE-01-3.gif) [4](gif/TC-QUEUE-01-4.gif) |
| TC-QUEUE-02 | P1 | ✅ ผ่าน (1.7 วิ) | test ผิด | §7-1 `expectStatus` (ใช้ใน RESET/CLOCK) เรียก `res.request()` เฉพาะเมื่อมี<br>(เปราะ) §7-2 `claimApi`/`clickAndCapture` อ่าน body หลังหน้าเปลี่ยน URL → หลังรีวิว (§8 ข้อสังเกต 1) เข้มขึ้น: `claimApi` ไม่ catch · `clickAndCapture` ยอม body = null เฉพาะ HTTP 200<br>(ตรวจไม่ครบ · รีวิว ข้อสังเกต 10) §8 ข้อสังเกต 10 แยก 3 ส่วนด้วย `test.step` + `expect.soft` → B08 แสดงครบทั้ง 3 ส่วน | [GIF](gif/TC-QUEUE-02.gif) [2](gif/TC-QUEUE-02-2.gif) |
| TC-QUEUE-03 | P1 | ✅ ผ่าน (2.3 วิ) | test ผิด | §7-1 `expectStatus` (ใช้ใน RESET/CLOCK) เรียก `res.request()` เฉพาะเมื่อมี<br>(เปราะ) §7-2 `claimApi`/`clickAndCapture` อ่าน body หลังหน้าเปลี่ยน URL → หลังรีวิว (§8 ข้อสังเกต 1) เข้มขึ้น: `claimApi` ไม่ catch · `clickAndCapture` ยอม body = null เฉพาะ HTTP 200 | [GIF](gif/TC-QUEUE-03.gif) [2](gif/TC-QUEUE-03-2.gif) |
| TC-SLA-01 | P1 | ✅ ผ่าน (3.2 วิ) | test ผิด | §7-1 `expectStatus` (ใช้ใน RESET/CLOCK) เรียก `res.request()` เฉพาะเมื่อมี | [GIF](gif/TC-SLA-01.gif) |
| TC-SLA-02 | P1 | ✅ ผ่าน (2.7 วิ) | test ผิด | §7-1 `expectStatus` (ใช้ใน RESET/CLOCK) เรียก `res.request()` เฉพาะเมื่อมี | [GIF](gif/TC-SLA-02.gif) [2](gif/TC-SLA-02-2.gif) [3](gif/TC-SLA-02-3.gif) |
| TC-SLA-03 | P1 | ✅ ผ่าน (1.6 วิ) | test ผิด | §7-1 `expectStatus` (ใช้ใน RESET/CLOCK) เรียก `res.request()` เฉพาะเมื่อมี | [GIF](gif/TC-SLA-03.gif) [2](gif/TC-SLA-03-2.gif) [3](gif/TC-SLA-03-3.gif) [4](gif/TC-SLA-03-4.gif) |
| TC-NOTI-01 | P1 | ✅ ผ่าน (0.9 วิ) | test ผิด | §7-1 `expectStatus` (ใช้ใน RESET/CLOCK) เรียก `res.request()` เฉพาะเมื่อมี | [GIF](gif/TC-NOTI-01.gif) [2](gif/TC-NOTI-01-2.gif) [3](gif/TC-NOTI-01-3.gif) [4](gif/TC-NOTI-01-4.gif) |
| TC-NOTI-02 | P1 | ✅ ผ่าน (4.0 วิ) | test ผิด | §7-1 `expectStatus` (ใช้ใน RESET/CLOCK) เรียก `res.request()` เฉพาะเมื่อมี | [GIF](gif/TC-NOTI-02.gif) [2](gif/TC-NOTI-02-2.gif) [3](gif/TC-NOTI-02-3.gif) [4](gif/TC-NOTI-02-4.gif) |
| TC-WORKFLOW-01 | P1 | ✅ ผ่าน (0.8 วิ) | test ผิด | (ตรวจหลวม · รีวิว M2) §8 M2(ข) helper `expectPdfLine` ที่ TC นี้ใช้ เทียบเฉพาะข้อความที่ดึงจาก PDF ได้ | [GIF](gif/TC-WORKFLOW-01.gif) [2](gif/TC-WORKFLOW-01-2.gif) |
| TC-WORKFLOW-02 | P1 | ✅ ผ่าน (2.2 วิ) | – | – | [GIF](gif/TC-WORKFLOW-02.gif) [2](gif/TC-WORKFLOW-02-2.gif) [3](gif/TC-WORKFLOW-02-3.gif) [4](gif/TC-WORKFLOW-02-4.gif) |
| TC-WORKFLOW-03 | P1 | ✅ ผ่าน (1.7 วิ) | – | – | [GIF](gif/TC-WORKFLOW-03.gif) [2](gif/TC-WORKFLOW-03-2.gif) [3](gif/TC-WORKFLOW-03-3.gif) [4](gif/TC-WORKFLOW-03-4.gif) |
| TC-WORKFLOW-04 | P1 | ✅ ผ่าน (4.3 วิ) | – | – | [GIF](gif/TC-WORKFLOW-04.gif) [2](gif/TC-WORKFLOW-04-2.gif) [3](gif/TC-WORKFLOW-04-3.gif) [4](gif/TC-WORKFLOW-04-4.gif) [5](gif/TC-WORKFLOW-04-5.gif) |
| TC-WORKFLOW-05 | P1 | ✅ ผ่าน (2.9 วิ) | – | – | [GIF](gif/TC-WORKFLOW-05.gif) [2](gif/TC-WORKFLOW-05-2.gif) [3](gif/TC-WORKFLOW-05-3.gif) [4](gif/TC-WORKFLOW-05-4.gif) |
| TC-WORKFLOW-06 | P1 | ✅ ผ่าน (0.8 วิ) | – | – | [GIF](gif/TC-WORKFLOW-06.gif) |
| TC-DOC-01 | P1 | ✅ ผ่าน (0.4 วิ) | test ผิด | (ตรวจหลวม · รีวิว M2) §8 M2(ข) helper `expectPdfLine` ที่ TC นี้ใช้ เทียบเฉพาะข้อความที่ดึงจาก PDF ได้ | [GIF](gif/TC-DOC-01.gif) [2](gif/TC-DOC-01-2.gif) |
| TC-DOC-02 | P1 | ✅ ผ่าน (0.2 วิ) | – | – | [GIF](gif/TC-DOC-02.gif) |
| TC-DOC-03 | P1 | ✅ ผ่าน (1.1 วิ) | – | – | [GIF](gif/TC-DOC-03.gif) [2](gif/TC-DOC-03-2.gif) |
| TC-PDPA-01 | P1 | ✅ ผ่าน (0.7 วิ) | – | – | [GIF](gif/TC-PDPA-01.gif) [2](gif/TC-PDPA-01-2.gif) [3](gif/TC-PDPA-01-3.gif) [4](gif/TC-PDPA-01-4.gif) |
| TC-PDPA-02 | P1 | ✅ ผ่าน (0.1 วิ) | – | – | ไม่มี (API ล้วน ไม่เปิดหน้าเว็บ → ไม่มีวิดีโอ) |
| TC-PDPA-03 | P1 | ✅ ผ่าน (0.9 วิ) | – | – | [GIF](gif/TC-PDPA-03.gif) [2](gif/TC-PDPA-03-2.gif) |
| TC-DASH-01 | P1 | ✅ ผ่าน (0.4 วิ) | – | – | [GIF](gif/TC-DASH-01.gif) |
| TC-DASH-02 | P1 | ✅ ผ่าน (0.7 วิ) | – | – | [GIF](gif/TC-DASH-02.gif) |
| TC-DASH-03 | P2 | ✅ ผ่าน (1.1 วิ) | test ผิด | (ตรวจหลวม · รีวิว M2) §8 M2 `pdfText` throw เมื่ออ่านไม่ได้/ว่าง · `expectPdfLine` เทียบเฉพาะข้อความที่ดึงได้ (ไม่ใช้ไบต์ดิบ) · ตรวจชื่อไทยหลังตัด whitespace | – (P2) |
| TC-DASH-04 | P1 | ✅ ผ่าน (0.5 วิ) | – | – | [GIF](gif/TC-DASH-04.gif) [2](gif/TC-DASH-04-2.gif) |
| TC-AUDIT-01 | P1 | ✅ ผ่าน (1.0 วิ) | เว็บผิด | §7-4 `src/modules/queue` Audit `UNMASK` บันทึก from/to = null → แสดง `–` ตามการ์ด TC-AUDIT-01 | [GIF](gif/TC-AUDIT-01.gif) |
| TC-AUDIT-02 | P1 | ✅ ผ่าน (0.4 วิ) | – | – | [GIF](gif/TC-AUDIT-02.gif) |
| TC-AUDIT-03 | P1 | ✅ ผ่าน (0.9 วิ) | – | – | [GIF](gif/TC-AUDIT-03.gif) |
| TC-RBAC-01 | P1 | ✅ ผ่าน (0.2 วิ) | – | – | [GIF](gif/TC-RBAC-01.gif) |
| TC-RBAC-02 | P1 | ✅ ผ่าน (0.6 วิ) | – | – | [GIF](gif/TC-RBAC-02.gif) [2](gif/TC-RBAC-02-2.gif) |
| TC-RBAC-03 | P1 | ✅ ผ่าน (4.7 วิ) | – | – | [GIF](gif/TC-RBAC-03.gif) [2](gif/TC-RBAC-03-2.gif) [3](gif/TC-RBAC-03-3.gif) [4](gif/TC-RBAC-03-4.gif) [5](gif/TC-RBAC-03-5.gif) [6](gif/TC-RBAC-03-6.gif) [7](gif/TC-RBAC-03-7.gif) |
| TC-RBAC-04 | P2 | ✅ ผ่าน (1.9 วิ) | – | – | – (P2) |
| TC-RBAC-05 | P1 | ✅ ผ่าน (0.7 วิ) | – | – | [GIF](gif/TC-RBAC-05.gif) [2](gif/TC-RBAC-05-2.gif) [3](gif/TC-RBAC-05-3.gif) |
| TC-RBAC-06 | P2 | ✅ ผ่าน (1.3 วิ) | – | – | – (P2) |
| TC-NFR-01 | P1 | ✅ ผ่าน (3.9 วิ) | – | – | [GIF](gif/TC-NFR-01.gif) [2](gif/TC-NFR-01-2.gif) [3](gif/TC-NFR-01-3.gif) [4](gif/TC-NFR-01-4.gif) [5](gif/TC-NFR-01-5.gif) [6](gif/TC-NFR-01-6.gif) [7](gif/TC-NFR-01-7.gif) [8](gif/TC-NFR-01-8.gif) |
| TC-NFR-02 | P1 | ✅ ผ่าน (10.1 วิ) | – | – | [GIF](gif/TC-NFR-02.gif) [2](gif/TC-NFR-02-2.gif) [3](gif/TC-NFR-02-3.gif) [4](gif/TC-NFR-02-4.gif) [5](gif/TC-NFR-02-5.gif) [6](gif/TC-NFR-02-6.gif) [7](gif/TC-NFR-02-7.gif) [8](gif/TC-NFR-02-8.gif) [9](gif/TC-NFR-02-9.gif) |
| TC-NFR-03 | P2 | ✅ ผ่าน (1.2 วิ) | รวมระบบ | (skip ไม่ใช่ล้ม) §7-7 เพิ่ม service `web-notest` (ไม่ตั้ง TEST_MODE) ใน docker-compose → ไม่ skip | – (P2) |
| TC-NFR-04 | P2 | ✅ ผ่าน (0.1 วิ) | test ผิด | (ตรวจไม่ครบ · รีวิว ข้อสังเกต 8) §8 ข้อสังเกต 8 สแกน log ของเว็บจริง (`WEB_LOG_PATH` + `LOG_REQUESTS=1`) พร้อมตัวควบคุมบวก register 1 → 2 | – (P2) |

**ไม่ผูกกับ TC ใดโดยตรง** (§7/§8/§11): §7-6 `playwright.config.js` รองรับ `PW_EXECUTABLE_PATH` (สภาพแวดล้อมนอก docker) · §7-8 สคริปต์ `run-bugs.sh` `pw-summary.js` `fr-smoke.js` · §8 M1 `pw-summary.js` นับ skip เป็น MISMATCH · §8 ข้อสังเกต 9 `testFile()` throw เมื่อไม่มีไฟล์ทดสอบ (ไม่สร้าง PDF แทน · helper ร่วมของ part2) · §11 migration แบบเพิ่มไฟล์ (`src/core/migrate.js` · `migrations/0001_init.sql` · `schema_migrations` · `scripts/restart-check.sh`) ตรวจด้วย unit test และ restart บน Docker ไม่ใช่ e2e · FINAL-REPORT ยืนยันว่าไม่มีการลด assert หรือเปลี่ยนค่าที่คาดใน test เพื่อให้ผ่าน

**สรุป: 51/51 passed** (รุ่น migration · 2026-11-19 10:41) · GIF 105 ไฟล์ 24.7 MB ครอบ TC P1 42/43 ตัว (ขาด TC-PDPA-02 เพราะไม่มีหน้าเว็บ)

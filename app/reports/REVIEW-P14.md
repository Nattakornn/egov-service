# REVIEW-P14 · ตรวจงานรวมระบบ (P14) แบบอิสระ

ผู้ตรวจ: reviewer อิสระ · วันที่ 2026-11-16 · ไม่ได้แก้ไฟล์ใดในแอป (เขียนเฉพาะรายงานนี้)
เทียบกับ: `TEST-PLAN.md` · `BUGS.md` · `CONTRACT.md` · `REQUIREMENTS.md` (ใน `/workspace/week2_student/`) · ผลรัน `reports/runs-docker/*`

---

## สรุป

**คำตัดสิน: มีปัญหา (ไม่ร้ายแรง)** · ต้องแก้ 3 ข้อ (กลาง 2 · ต่ำ 1)

- **ไม่พบการลด assertion เพื่อให้ผ่านโดย P14** จุดที่ P14 แก้ใน `e2e/specs/part1/_lib.js` ไม่กลืน error จนทำให้ test ที่ควรล้มกลับผ่าน ไม่ข้ามการตรวจ ไม่ผ่อนการเทียบค่า และไม่มี retry (`retries: 0` ที่ `e2e/playwright.config.js:20`)
- ผลรันเชื่อถือได้: `normal-1` `normal-2` `normal-final` = 51 passed · 0 skipped · B01–B12 และชุดรวม `B03,B07` `B01,B05,B09` ได้ `RESULT: MATCH` ทุกรอบ ทุกข้อความที่ล้มเป็นค่าต่างจากที่คาด (ไม่มีรอบไหนล้มเพราะ timeout)
- รายการ may-fail ใน `scripts/run-bugs.sh` ตรงกับ BUGS.md §2 ทุกบั๊ก ส่วนเกินมีข้อเดียวคือ TC-NOTI-02 ใต้ B03 ซึ่งยอมรับไปแล้ว (และ TEST-PLAN §18 บรรทัด 1161 ก็ระบุไว้เอง)
- การแก้แอป 2 จุดของ P14 (UNMASK from/to = null และ upload race) ทำตามสเปก ไม่ได้ทำกรณีพิเศษให้ test
- ปัญหา 3 ข้อด้านล่างเป็นจุดอ่อนของตัว gate และของการตรวจ PII ใน PDF **ไม่กระทบผลรันชุดปัจจุบัน** แต่ปล่อยไว้แล้วอาจทำให้ผ่านหลอกในอนาคตได้

---

## ปัญหาที่ต้องแก้

### M1 · กลาง · `scripts/pw-summary.js:35` และ `:49` นับ TC ที่ skipped ว่าผ่าน
- **ทำไมเป็นปัญหา:** ที่บรรทัด 35 ตั้ง `ok: status === 'passed' || status === 'skipped'` ส่วน `okMatch` ที่บรรทัด 49 เช็กแค่ `tests.length === 51` ผลคือถ้ารอบปกติมี TC ถูก skip (เช่น TC-NFR-04 ตอนไม่ได้ตั้ง `DB_PATH` หรือหาไฟล์ไม่เจอ ตาม `e2e/specs/part2/nfr.spec.js:298,301`) สคริปต์จะยังพิมพ์ `RESULT: MATCH` และ `run-bugs.sh` คืน exit 0 ทั้งที่ BUGS.md §3 ขั้น 1/2/6 ต้องได้ "ผ่านครบ 51/51" (ถ้าเป็นรอบเปิดบั๊กแล้ว TC ที่ต้องล้มถูก skip จะยังขึ้น MISMATCH ถูกต้อง เพราะไม่อยู่ใน `failed`)
- **ผลปัจจุบัน:** ไม่กระทบ ทุกรอบใน `runs-docker` มี `skipped=0` และ TC-NFR-03/04 รันจริงทุกรอบ (ดู "สิ่งที่ตรวจแล้วไม่พบปัญหา")
- **แนะนำ:** ให้ `ok` เป็นจริงเฉพาะ `status === 'passed'` หรือเพิ่ม `skipped.length === 0` ใน `okMatch`

### M2 · กลาง · ตรวจ PII ใน PDF ของ TC-DASH-03 อาจไม่ได้ตรวจจริง (`e2e/specs/part2/dash.spec.js:143-145`, `:175-176` · `e2e/specs/part2/_lib.js:382-399`, `:411`, `:439`)
- **ทำไมเป็นปัญหา:** การ์ด TC-DASH-03 กำหนดว่า "บรรทัดใน PDF ไม่พบ … ชื่อ `สมชาย` `สมหญิง` `ปิติ` `มานะ` (ตรวจบนข้อความที่ดึงออกมา)" แต่ตอนนี้มีช่องโหว่ 2 จุด
  1. ถ้าดึงข้อความไม่สำเร็จ `pdfText()` จะเงียบแล้วคืน `''` (บรรทัด 399) ส่วน `expectPdfLine()` ยังผ่านได้เพราะไปเจอบรรทัด KPI ในไบต์ดิบ (`raw.includes(line)` บรรทัด 411) บรรทัดนี้อยู่ใน Info `Subject`/`Keywords` ของ PDF ด้วย (`src/modules/dashboard/index.js:58-59`) จากนั้น `piiFindings(lines)` ได้ลิสต์ว่าง จึงผ่านแบบไม่ได้ตรวจอะไรเลย
  2. ผมรันเว็บจริงด้วย DB ชั่วคราวแล้วลองกับ pdf-parse 1.1.1 ที่ใช้อยู่ ดึงข้อความได้ (1,038 ตัวอักษร) **แต่สระและวรรณยุกต์ไทยถูกแยกไปขึ้นบรรทัดใหม่** เช่น `ช\n่\nวง` `ท\nี่` `วิธ\nี\nคิด` ส่วน `piiFindings` เทียบชื่อทีละบรรทัด ชื่อที่มีสระบน/ล่าง (`สมหญิง` `ปิติ`) จึงอาจหลุดการตรวจไปได้
- **แนะนำ:** (ก) assert ว่า `text.trim().length > 0` ก่อนตรวจ PII (ข) ตรวจชื่อบน `text.replace(/\s+/g, '')` ที่ตัดช่องว่างและขึ้นบรรทัดออกทั้งหมด แทนการตรวจทีละบรรทัด โดยยังเก็บ regex `\d{13}` และ `0\d{9}` ไว้ตรวจทีละบรรทัดเหมือนเดิม

### M3 · ต่ำ · TC-UPLOAD-01/02 ตรวจจำนวนไฟล์ผ่าน API แบบมีเงื่อนไข (`e2e/specs/part1/upload.spec.js:17-20`, `:86`, `:140`)
- **ทำไมเป็นปัญหา:** การ์ด TC-UPLOAD-02 ระบุชัดว่า "`GET /api/drafts/:id` จำนวนไฟล์ไม่เพิ่ม" แต่โค้ดเขียน `if (n !== null) expect(n …)` ถ้า response ไม่มี `files`/`items` การตรวจจะถูกข้ามแบบเงียบ ตอนนี้แอปส่ง `files` มา (`src/modules/apply/index.js:13`) จึงตรวจจริง และยังมีการตรวจ `file-item` = 0 บนหน้าจอช่วยอยู่ แต่ถ้า API เปลี่ยนรูป การตรวจฝั่ง API จะหายไปโดยไม่มีใครรู้
- **แนะนำ:** เปลี่ยนเป็น `expect(Array.isArray(g.files), 'GET /api/drafts/:id ต้องมี files').toBe(true)` แล้วตามด้วย `toBe(5)` / `toBe(accepted)` แบบไม่มีเงื่อนไข

---

## ข้อสังเกต (minor)

1. **`_lib.js:209-215` `claimApi` และ `:258-267` `clickAndCapture`** ใช้ `try { readBody } catch { body = null }` ซึ่ง P14 เพิ่มเพราะเรื่อง body-after-navigation **ไม่ได้บังหน้าความผิดพลาด** เพราะทุกจุดที่เรียกแบบคาดว่าจะล้มยังอ่าน `r.body.code` ต่อ (`queue.spec.js:81,95,120,187` · `auth.spec.js:62`) ถ้า body เป็น null จะล้มด้วย TypeError ไม่ได้ผ่านไปเฉย ๆ ข้อเสียมีแค่ข้อความล้มจะไม่ใช่รูป expected/received ตาม BUGS §3 ขั้น 4 อีกเรื่องคือ `claimApi` ใช้ APIRequestContext ซึ่งไม่มีการเปลี่ยนหน้า `catch` ตรงนี้จึงไม่จำเป็น แนะนำให้จำกัดการ catch เฉพาะกรณี `status === 200`
2. **`_lib.js:246-249` `expectAttrList`** poll ระหว่างโหลดหน้าแล้ว catch error เป็นสตริง สตริงนั้นไม่มีทางเท่ากับลิสต์ที่คาด จึงล้มเมื่อหมดเวลา 10 วินาที ไม่ได้บังหน้า และลำดับยังเทียบด้วย `toEqual` ตรงตัว
3. **`_lib.js:103`** แก้เรื่อง `res.request()` ที่ทำให้ crash ส่วนนี้แค่ใช้ประกอบ label ไม่มีผลต่อ assertion
4. **`noti.spec.js:51-52`** ข้อความ `noti-item` บนจอใช้ `toContainText` ทั้งที่ CONTRACT บรรทัด 257 ให้ข้อความตรงตัว แต่ข้อความจาก API เทียบตรงตัวแล้ว (`:48-49`) จึงถือว่ายอมรับได้
5. **`auth.spec.js:88`** ตอนถูกล็อก `thaid/start` ยอมรับทั้ง 200 และ 423 เพราะการ์ด TC-AUTH-02 ขั้น 4 กำหนดเฉพาะผล verify (ซึ่งตรวจ 423 `LOCKED` ตรงตัว) จึงไม่ถือว่าผ่อนค่าที่การ์ดกำหนด
6. **`nfr.spec.js:160`** ส่วน C ยอมรับ `title` เป็นชื่อที่เข้าถึงได้ด้วย กว้างกว่าที่การ์ดเขียน (getByLabel / aria-label / aria-labelledby) แต่ถูกต้องตามมาตรฐาน accname
7. **`nfr.spec.js:286-293`** ขั้น "ปิด hook" จะข้ามแบบเงียบ (แค่บันทึก annotation) ถ้าไม่ตั้ง `BASE_URL_NO_TEST_MODE` การ์ดอนุญาตไว้ ("ถ้ารันเว็บได้สองโหมด") และรอบ docker ตั้งค่านี้แล้ว (`docker-compose.yml` e2e env) ไม่มี annotation `skip-step` ในผล จึงรันจริง
8. **`nfr.spec.js:307`** TC-NFR-04 ตรวจเฉพาะไฟล์ DB + `-wal`/`-journal`/`-shm` ไม่ได้ตรวจ log ของเว็บตามที่การ์ดพูดถึง ("ไฟล์ดัมพ์ และ log ของเว็บ") ควรเพิ่มการตรวจ log ถ้าเข้าถึงได้
9. **`part2/_lib.js:63-67`** `testFile()` สร้าง PDF สังเคราะห์ให้เองถ้าไม่มีไฟล์ใน `testfiles/` ตอนนี้ global-setup สร้างไฟล์ครบอยู่แล้วจึงไม่กระทบ แต่ควร throw แทน เพื่อไม่ให้ใช้ไฟล์ผิดสเปกโดยไม่รู้ตัว
10. **B08** ล้มที่ส่วน 1 (`[200,200]`) จึงไปไม่ถึงส่วน 3 ที่ BUGS บอกว่าล้มแน่นอน ผลไม่ต่างกัน แต่ถ้าอยากพิสูจน์ว่าส่วน 3 จับได้ด้วย ควรแยกเป็น `test.step` ที่รันต่อแม้ส่วนก่อนล้ม (เช่นใช้ `expect.soft` เฉพาะตอนสรุปผล) หรือรันส่วน 3 เป็นอย่างแรก

---

## สิ่งที่ตรวจแล้วไม่พบปัญหา

### 1. `e2e/specs/part1/_lib.js` (จุดที่ P14 แก้)
- ไม่มี retry หรือ `toPass` และไม่ใช้ `expect.soft` · `retries: 0` · `workers: 1`
- `reset()`/`clock()` ตรวจ `ok`, `now` = T0 และเวลาที่ตั้งได้ตรงตัว (`:118-134`)
- `expectStatus` ยังตรวจ status, `code` และ `message` ตรงตัว (`:105-107`)
- `payOk` ตรวจทั้ง 200 และ `PAID` (`:150-155`) · `newPaid` เช็กว่า `caseNo` ตรงกับ `GET /api/payments` (`:198-199`)

### 2. ค่าที่คาดในการ์ด TC (อ่านละเอียดทีละบรรทัดเทียบการ์ด)
- **TC-FEE-01** (B01): ครบ 11 แถวของ SV-03, qty 0–6 และ SV-02 ทั้งบนจอและ API · ข้อความ error, code และ disabled ตรงตัว
- **TC-UPLOAD-01** (B02): 5,242,879/880/881 บนจอ + API · 400 `FILE_TOO_LARGE` พร้อมข้อความ (ไม่ใช่ 413) · `size` ไม่ถูกตัด · จำนวน 5/6 + `FILE_COUNT` (ยกเว้น M3)
- **TC-UPLOAD-02**: magic bytes ครบทุกแถว รวมกรณี `mimeType: application/pdf` · 400 `FILE_TYPE` พร้อมข้อความ (ยกเว้น M3)
- **TC-PAY-01** (B05): รอบ 1–4 · 410 `QR_EXPIRED` · `EXPIRED` · cases = 10 · บนจอ `qr-expired-msg`/`payment-status`/`PP-0002`/`09:25:00` · **TC-PAY-02/03/04** ครบทุกค่า
- **TC-QUEUE-01**: ลำดับ 17 แถวตรงตัว · claim-btn 4 · filter · workload · head1 18 แถว · works1 · **TC-QUEUE-02** (B08): ส่วน 1–3 ครบ (200/409 `ALREADY_CLAIMED` · `action-error` ตรงตัว · owner · Audit CLAIM = 1 · 10 ครั้ง → 200 ×1 + 409 ×9) · **TC-QUEUE-03**: ขั้น 1–10 ครบ รวม workload 11 และ 409 `WORKLOAD_LIMIT` พร้อมข้อความ
- **TC-SLA-01** (B03): 9 แถวเทียบ `dueAt` และข้อความบนจอตรงตัว · **TC-SLA-02** (B03/B04): ส่วน 1–5 ครบ · **TC-SLA-03**: ส่วน A/B/C ทุกแถว ทั้ง data-level และ API
- **TC-NOTI-01/02**: ชุด (caseNo, level) เทียบเป็นเซตตรงตัวทั้งบนจอและ API · `bell-count` 3/1/1/0 → 4/2/1 · ส่วน B 7/10/1/15 · ส่วน C ครบ 3 ขั้น · ตรวจว่าไม่มี near ย้อนหลัง
- **TC-PDPA-01/02** (B09)/**03** (B11): regex `\d{13}`, รูปมีขีด, key `idNo` ค้นลึกทุกชั้น, `idMasked` · `unmask-error` ตรงตัว · Audit UNMASK = 1 ตรวจครบทุกฟิลด์ · 403 ×3
- **TC-AUDIT-01** (B11): 16 แถว · นับแยกตามเหตุการณ์ · transition ทุกแถว (UNMASK = `–`) · ตัวกรอง 7/2/1 · CSV header + 16 แถว · หลังส่งออก 17 · **TC-AUDIT-02/03** ครบ
- **TC-DASH-01/02** (B10)/**03**/**04**: KPI ทุกแถวตรงตัวทั้งบนจอและ API (`ontimePct` null) · xlsx เท่าบนจอ · บรรทัด KPI ใน PDF · Audit EXPORT = 3 · ค่าขอบ 16:29:59/16:30:00/16:30:01 (ยกเว้น M2)
- **TC-RBAC-01** (B06): 404 + ข้อความ · เนื้อหา 404 ของเลขที่ไม่มีจริงเหมือนกันทุกตัวอักษร · **TC-RBAC-02** (B07): ยิง API ตรง 403 `FORBIDDEN` และสถานะไม่เปลี่ยน · Audit APPROVE เหลือแถวเดียว · **TC-RBAC-04** ขั้น 1–11 ครบ
- **TC-WORKFLOW-04** (B12): ส่วน A/B/C ครบ · 409 `RETURN_LIMIT` พร้อมข้อความ · จำนวนปุ่ม 0/1 ตรงการ์ด
- **TC-NFR-01**: 33 การตรวจ + งานหลักที่ 375 px · **TC-NFR-02**: 13 หน้า axe serious/critical = 0 · คีย์บอร์ด · label · สถานะ (ปกติ + forcedColors) · **TC-NFR-03**: health ตรงตัว · ≤ 3,000 ms · S1 = S2 · 400 `INVALID_TIME` · 404 เมื่อปิด hook · **TC-NFR-04**: 12 ค่า (utf8 + utf16le) + ตัวควบคุมบวก
- TC อื่น (AUTH, SUBMIT, WORKFLOW-01/02/03/05/06, DOC, RBAC-03/05/06) สแกนหา pattern ผ่อนการตรวจ (`if (` ที่ครอบ expect, `catch`, `toContain`, `>=`, `skip`) เงื่อนไขที่เจอทั้งหมดตรงกับการ์ด เช่น SUBMIT-03 ส่วน F แยก 2 กรณีตามที่การ์ดกำหนดไว้ (`submit.spec.js:244`) และ AUTH-04 ตรวจ `data-dept` เฉพาะบทบาทที่มีแผนก (`auth.spec.js:240`)

### 3. skip / fixme
- ทั้งชุดมี skip แค่ 2 จุด คือ `nfr.spec.js:298` และ `:301` (TC-NFR-04 ตอนไม่มี `DB_PATH`) ไม่มี `test.fixme` `test.only` หรือ `test.fail`
- ใน `normal-1.json` `normal-2.json` `normal-final.json` และ `bug-*.json` ทุกไฟล์ TC-NFR-03 และ TC-NFR-04 เป็น `passed` (ใช้เวลา NFR-04 ราว 54–88 ms) ไม่มี annotation ของการ skip

### 4. `scripts/run-bugs.sh` (`must_fail` :32-48 · `may_fail` :49-58)
- `must_fail` ตรงกับ BUGS.md §2 ครบ 12 บั๊ก
- `may_fail`: B03 = TC-SLA-03, TC-RBAC-04 (+ TC-NOTI-02 ข้อยกเว้นที่ยอมรับแล้ว) · B07 = TC-WORKFLOW-01 · B10 = TC-DASH-01, TC-DASH-03 · บั๊กอื่นว่าง **ไม่มีรายการเกินนอกจากข้อยกเว้นนี้**
- `union()` รวม must/may ของชุดรวมได้ถูกต้อง · `pw-summary.js` เช็กว่ามีครบ 51 TC, ไม่มี TC ที่ควรล้มแต่ผ่าน และไม่มี TC ล้มเกินที่คาด (ยกเว้น M1)

### 5. การแก้แอปของ P14
- **`src/modules/queue/index.js:273-294` UNMASK `fromStatus`/`toStatus` = null**: ตรงกับ TEST-PLAN TC-AUDIT-01 (บรรทัด 866: UNMASK `audit-transition` = `–`) และ CONTRACT §6.8 (detail = เหตุผล) เพราะ unmask ไม่เปลี่ยนสถานะ ไม่ได้ผูกกับ test เป็นพิเศษ · บั๊ก B11 ยังแค่ข้ามการบันทึก (`:282`) จึงเป็นอิสระจากกัน · ยังตรวจสิทธิ์ (`canSeeCase`) และ `REASON_REQUIRED` ก่อนบันทึก
- **`src/modules/apply/public/apply.js:159-166`, `:220-226` upload race**: ถ้าเลือกไฟล์ระหว่างที่ร่างยังสร้างไม่เสร็จ จะรอ `pendingDraft` ก่อนแทนการทิ้งไฟล์ และอัปโหลดหลายไฟล์ทีละไฟล์ (`:231-238`) เป็นการแก้ UX ทั่วไป ไม่ได้อิง test · ฝั่งเซิร์ฟเวอร์ตรวจขนาด → ชนิด → แบบแปลน → จำนวน ภายใน `db.tx` (`src/modules/apply/index.js:308-325`) จึงนับจำนวนแบบ atomic ตาม BR-07/BR-08 · B02 แตะแค่เงื่อนไขขนาด (`:202`)

---

## สถานะหลังแก้

แก้ 2026-11-16 · รายละเอียด file:line และหลักฐานอยู่ใน `reports/FINAL-REPORT.md` §8 "แก้ตามรีวิว REVIEW-P14" · ไม่ได้แก้ `src/` และไม่ได้แตะพฤติกรรม BUG_MODE

| ข้อ | สถานะ | สรุป |
|---|---|---|
| M1 | ✅ แก้แล้ว | `scripts/pw-summary.js:36` `ok` = passed เท่านั้น · `:51` MATCH ต้องมี `skipped.length === 0` · พิสูจน์ด้วย `test/pw-summary.test.js` (รอบที่มี skip → MISMATCH exit 1) |
| M2 | ✅ แก้แล้ว | ตัวตรวจย้ายไป `e2e/specs/part2/pii.js` · (ก) ดึงไม่ได้/ข้อความว่าง → throw · (ข) `expectPdfLine` ใช้เฉพาะข้อความจาก pdf-parse (ไม่มีไบต์ดิบ/Info) · (ค) ชื่อไทยเทียบบนข้อความที่ตัด whitespace ทั้งหมด ส่วน `\d{13}` `0\d{9}` ยังทีละบรรทัด · ตัวควบคุมบวก `test/pii-check.test.js` (สตริงแยกสระ + PDF จริงจาก `buildPdf` ที่แทรกชื่อ/เลข + PDF ที่ pdf-parse แยก `ช\n่\nวงสมหญิง` → จับได้ · PDF ว่าง → throw) |
| M3 | ✅ แก้แล้ว | `e2e/specs/part1/upload.spec.js:17-20` `filesOf()` assert ว่า `files` เป็น array · `:85` `:138` เทียบจำนวนแบบไม่มีเงื่อนไข |
| ข้อสังเกต 1 | ✅ แก้แล้ว | `claimApi` ไม่มี catch · `clickAndCapture` ยอม body = null เฉพาะ HTTP 200 · error response อ่าน body ไม่ได้ → throw พร้อม status |
| ข้อสังเกต 8 | ✅ แก้แล้ว | TC-NFR-04 สแกน log ของเว็บด้วย (`WEB_LOG_PATH` · `run-bugs.sh` เก็บ `docker compose logs -f web` และเปิด `LOG_REQUESTS=1`) · ตัวควบคุมบวกในรอบจริง: log ต้องมีบรรทัดเริ่มเว็บ TEST_MODE=1 และบรรทัด `POST /api/auth/register 201` ใหม่หลังมานะลงทะเบียน · unit test พิสูจน์ว่า `needleFindings` จับค่าที่ฉีดลง log ได้ · ข้อจำกัด: ถ้ารัน Playwright เองโดยไม่ตั้ง `WEB_LOG_PATH` ส่วน log จะไม่ถูกตรวจ (บันทึก annotation `skip-step`) |
| ข้อสังเกต 9 | ✅ แก้แล้ว | `testFilePath()` throw ถ้าไม่มีไฟล์ใน `e2e/testfiles/` · ไม่สร้างไฟล์แทน |
| ข้อสังเกต 10 | ✅ แก้แล้ว | TC-QUEUE-02 แต่ละส่วนรันเสมอ (ผลรายส่วนด้วย `expect.soft` + assert hard ตอนจบ) |
| ข้อสังเกต 2–7 | ไม่ได้แก้ (ตามที่รีวิวสรุปว่ายอมรับได้) | ไม่ได้อยู่ในรายการที่ให้แก้ |

**ผลรันหลังแก้ (docker · 2026-11-16):** `npm test` 184/184 (รวม `test/pii-check.test.js` `test/pw-summary.test.js`) · normal-1 / normal-2 = 51 passed · 0 skipped · B01–B12, `B03,B07`, `B01,B05,B09` และ normal-final = `RESULT: MATCH` ทุกรอบ (`run-bugs.sh` exit 0 · `reports/runs-docker/matrix.out`) · B08: TC-QUEUE-02 แสดงครบ 3 ส่วนในรอบเดียว ส่วน 3 `off.reg2` claim `…000029` ต่อจาก `off.reg1` ได้ 200 owner `off.reg2` (คาด 409 `ALREADY_CLAIMED`) ตาม BUGS §2 · B10: ล้ม TC-DASH-02 (`85.7%` → `23.1%`) + DASH-01/03 ที่อนุญาต · TC-NFR-04 สแกน log ของเว็บทุกรอบ พบ PII 0 · `docker compose down` แล้ว · ตารางเต็มใน `reports/FINAL-REPORT.md` §3 §4 และ §8

**ไม่ได้แก้ / ข้อจำกัดที่เหลือ:** ไม่มีข้อที่สั่งให้แก้ค้าง · รอบ local (node บนเครื่อง) ใน FINAL-REPORT §4.2 เป็นผลก่อนแก้ ไม่ได้รันซ้ำ (ใช้ docker เป็นทางหลักตามที่กำหนด)

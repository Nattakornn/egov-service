# BUG-HUNT · ขั้น 5 · พิสูจน์ว่า test จับบั๊กได้ (BUG_MODE B01–B12) · รุ่น migration

> ที่มาของผล: รอบ Docker compose (ทางหลัก) ที่รันด้วย `OUT=reports/runs-docker app/scripts/run-bugs.sh` เมื่อ **2026-11-19 10:15–10:39 (+07:00)** (ไฟล์ผลลงเวลา 10:16:45 `normal-1.txt` ถึง 10:39:14 `normal-final.txt`) · **รันกับโค้ดรุ่น migration แบบเพิ่มไฟล์** (`app/reports/FINAL-REPORT.md` §11 · image สร้างใหม่ `--build` ในรอบแรก) · ฉบับนี้แทนฉบับเดิมที่อ้างผลรอบ 2026-11-16 17:45–18:10 ของโค้ดรุ่นก่อน migration
>
> ทุกรอบ restart เว็บด้วย `TEST_MODE=1 BUG_MODE=<รหัส>` (เว็บลบตาราง → รัน migration ทั้งหมด → seed) แล้วรัน **ชุดเต็ม 51 TC** · สรุปผลด้วย `app/scripts/pw-summary.js` (ต้องครบ 51 TC ไม่ซ้ำ · skip นับเป็นไม่ตรง · TC ที่ต้องล้มต้องล้มทุกตัว · TC ที่ล้มทั้งหมดต้องอยู่ใน "ต้องล้ม ∪ อาจล้ม") · `run-bugs exit=0` · รอบที่ไม่ตรงตามคาด = 0 ([`matrix.out`](app/reports/runs-docker/matrix.out) บรรทัดสุดท้าย)
>
> ไฟล์ดิบ: [`app/reports/runs-docker/`](app/reports/runs-docker/) · ต่อรอบมี `<label>.json` (Playwright JSON) · `.summary.json` · `.txt` (สรุป MATCH/MISMATCH) · `.log` (ผลรันเต็ม) · `.web.log` (log เว็บ) · ลำดับรันทั้งหมด [`matrix.out`](app/reports/runs-docker/matrix.out) · รายงานรวม [`app/reports/FINAL-REPORT.md`](app/reports/FINAL-REPORT.md) §4–§5 · §11.4

## 1. ตาราง triage (รูปแบบ BUGS.md §4)

คอลัมน์ "TC ที่คาดว่าล้ม" ตาม BUGS.md §2 ฉบับปัจจุบัน (รวม TC-NOTI-02 ในกลุ่ม "อาจล้ม" ของ B03 แล้ว · ดู §4) · คอลัมน์ผลมาจากบรรทัด `total=… passed=… failed=…` และ `RESULT:` ใน `<label>.txt`

| บั๊ก | TC ที่คาดว่าล้ม (จากตาราง 2) | TC ที่ล้มจริง | TC ล้มเกินที่คาด | TC ที่ควรล้มแต่ผ่าน | ผล |
|---|---|---|---|---|---|
| (ปกติ) | – | – | – | – | 51/51 passed · 0 skipped ✅ ([รอบ 1](app/reports/runs-docker/normal-1.txt) · [รอบ 2 ทันทีไม่ restart](app/reports/runs-docker/normal-2.txt) · [ปิดบั๊กตอนจบ](app/reports/runs-docker/normal-final.txt)) |
| B01 | TC-FEE-01 | TC-FEE-01 | – | – | 50 passed · 1 failed · `MATCH` ✅ |
| B02 | TC-UPLOAD-01 | TC-UPLOAD-01 | – | – | 50 passed · 1 failed · `MATCH` ✅ |
| B03 | TC-SLA-01 · TC-SLA-02 (อาจล้มด้วย TC-SLA-03 · TC-RBAC-04 · TC-NOTI-02) | TC-SLA-01 · TC-SLA-02 · TC-SLA-03 · TC-RBAC-04 · TC-NOTI-02 | – (3 ตัวหลังอยู่ในกลุ่ม "อาจล้ม") | – | 46 passed · 5 failed · `MATCH` ✅ |
| B04 | TC-SLA-02 | TC-SLA-02 | – | – | 50 passed · 1 failed · `MATCH` ✅ |
| B05 | TC-PAY-01 | TC-PAY-01 | – | – | 50 passed · 1 failed · `MATCH` ✅ |
| B06 | TC-RBAC-01 | TC-RBAC-01 | – | – | 50 passed · 1 failed · `MATCH` ✅ |
| B07 | TC-RBAC-02 (อาจล้มด้วย TC-WORKFLOW-01) | TC-RBAC-02 | – | – | 50 passed · 1 failed · `MATCH` ✅ |
| B08 | TC-QUEUE-02 (ส่วน 3 ต่อกัน ล้มแน่นอน) | TC-QUEUE-02 (ส่วน 1 · 2 · 3 ล้มทั้งหมดในรอบเดียว) | – | – | 50 passed · 1 failed · `MATCH` ✅ |
| B09 | TC-PDPA-02 | TC-PDPA-02 | – | – | 50 passed · 1 failed · `MATCH` ✅ |
| B10 | TC-DASH-02 (อาจล้มด้วย TC-DASH-01 · TC-DASH-03) | TC-DASH-01 · TC-DASH-02 · TC-DASH-03 | – (2 ตัวอยู่ในกลุ่ม "อาจล้ม") | – | 48 passed · 3 failed · `MATCH` ✅ |
| B11 | TC-PDPA-03 · TC-AUDIT-01 | TC-PDPA-03 · TC-AUDIT-01 | – | – | 49 passed · 2 failed · `MATCH` ✅ |
| B12 | TC-WORKFLOW-04 | TC-WORKFLOW-04 | – | – | 50 passed · 1 failed · `MATCH` ✅ |
| B03,B07 | TC-SLA-01 · TC-SLA-02 · TC-RBAC-02 (อาจล้ม: TC-SLA-03 · TC-RBAC-04 · TC-NOTI-02 · TC-WORKFLOW-01) | TC-SLA-01 · TC-SLA-02 · TC-SLA-03 · TC-RBAC-02 · TC-RBAC-04 · TC-NOTI-02 | – | – | 45 passed · 6 failed · `MATCH` ✅ |
| B01,B05,B09 | TC-FEE-01 · TC-PAY-01 · TC-PDPA-02 | TC-FEE-01 · TC-PAY-01 · TC-PDPA-02 | – | – | 48 passed · 3 failed · `MATCH` ✅ |

ทุกรอบ `skipped=0` และครบ 51 TC ไม่ซ้ำ (บรรทัด `total=51 unique=51 …` ใน `*.txt`)

## 2. ตารางคำตอบขั้น 5 (PROMPTS)

ข้อความล้มคัดจาก `errors[…].message` ใน `app/reports/runs-docker/bug-<รหัส>.json` ของรอบ 2026-11-19 (ตัด ANSI ออก) · ทุกตัวล้มด้วยการเทียบค่า Expected/Received ไม่มีตัวไหนล้มเพราะหา element ไม่เจอ (ตัวที่ใช้ `expect(locator)` แบบรอ Playwright รายงานค่าที่อ่านได้จริง เช่น `14 × locator resolved to <strong … data-testid="fee-total">฿1,000</strong>`) · FINAL-REPORT §11.4 เทียบแล้วว่าข้อความ assert แรก 28/28 คู่ (รอบ × TC) เหมือนรอบก่อนเปลี่ยนเป็น migration

| บั๊ก | TC ที่ต้องล้ม | ล้มจริง ✅/❌ | หมายเหตุ (ข้อความล้มจริง: คาด → ได้) |
|---|---|---|---|
| B01 | TC-FEE-01 | ✅ | `SV-03 พื้นที่ 101: fee-total` · Expected `"฿1,010"` · Received `"฿1,000"` |
| B02 | TC-UPLOAD-01 | ✅ | `5,242,880 ไบต์ (ขอบ ≤ 5 MB) → รับ` (จำนวน `file-item`) · Expected `1` · Received `0` |
| B03 | TC-SLA-01 · TC-SLA-02 | ✅ | TC-SLA-01 `แถว c: dueAt` · Expected `"2026-12-08T16:30:00+07:00"` · Received `"2026-12-07T16:30:00+07:00"` · TC-SLA-02 `หลังส่งแก้: sla-due data-iso` · Expected `"2026-12-08T16:30:00+07:00"` · Received `"2026-12-07T16:30:00+07:00"` · ล้มด้วย (อาจล้ม): TC-SLA-03 `ส่วน B 2026-12-04T09:00:00+07:00 sla-level ข้อความ` `"ใกล้ครบกำหนด"` → `"ปกติ"` · TC-RBAC-04 `#7 dueAt: expected 2026-12-08T16:30:00+07:00, received 2026-12-04T16:30:00+07:00` · TC-NOTI-02 `off.reg2 ส.5: noti-item (หน้าจอ)` diff `-   "EG-2569-000016:near"` (Expected −1 · Received +0 · ดู §4) |
| B04 | TC-SLA-02 | ✅ | `หลังส่งแก้: sla-due data-iso` · Expected `"2026-12-08T16:30:00+07:00"` · Received `"2026-12-04T16:30:00+07:00"` (ไม่หยุดนับช่วงรอแก้) |
| B05 | TC-PAY-01 | ✅ | `รอบ 3 pay PP-0001` · Expected `410` · Received `200` · body `{"status":"PAID","caseNo":"EG-2569-000031","receiptNo":"RC-2569-000031","duplicate":false,"paidAt":"2026-12-01T09:10:00+07:00",…}` (จ่ายได้ที่ 09:10:00 หลัง QR หมดอายุ) ตรงตัวอย่าง BUGS §2 |
| B06 | TC-RBAC-01 | ✅ | `UI …000005 (ของสมชาย): expected HTTP 404, received HTTP 200` · Expected `404` · Received `200` |
| B07 | TC-RBAC-02 | ✅ | `#1 off.reg2 approve …000014: expected HTTP 403, received HTTP 200 · body={"status":"APPROVED"}` · ยิง API ตรง ไม่ได้ดูแค่ปุ่ม · TC-WORKFLOW-01 (อาจล้ม) ผ่าน เพราะเว็บถอดเฉพาะการตรวจ "SV-02/03 ต้องเป็นหัวหน้า" |
| B08 | TC-QUEUE-02 | ✅ | error 4 ตัวในรอบเดียว · **ส่วน 1** (กด `claim-btn` พร้อมกัน 2 context) `A=200 {"caseNo":"EG-2569-000028",…,"owner":"off.reg1"} · B=200 {…,"owner":"off.reg2"}` (คาด 200 หนึ่งคน อีกคน 409) · **ส่วน 2** (API 10 ครั้งพร้อมกัน) `ต้องได้ 200 ครั้งเดียว` Expected `1` · Received `9` (อีก 1 ครั้งได้ `409:WORKLOAD_LIMIT` ไม่ใช่ 409 จากการชนกัน) · **ส่วน 3** (ต่อกัน) `off.reg2 claim ต่อจาก off.reg1 [/api/officer/cases/EG-2569-000029/claim]: HTTP status ควรเป็น 409` · Expected `409` · Received `200` body `{"caseNo":"EG-2569-000029","status":"IN_REVIEW","owner":"off.reg2"}` · ตัวที่ 4 = assert สรุป `TC-QUEUE-02 ทุกส่วนต้องผ่าน` |
| B09 | TC-PDPA-02 | ✅ | `PDPA JSON: expected no full id, received 10 problem(s)` · Expected `[]` · Received เช่น `"off.reg1 /api/officer/queue?filter=all: found 3100600987659"`, `"… found 1101700123456"`, `"… has key idNo at $.items[0].idNo, …"` · ทั้ง 10 รายการอยู่ที่ `/api/officer/queue` (ของ off.reg1 และ head1) · API อื่นไม่รั่ว |
| B10 | TC-DASH-02 | ✅ | `2026-11 ALL kpi-ontime-pct` · Expected `"85.7%"` · Received `"23.1%"` · ล้มด้วย (อาจล้ม): TC-DASH-01 `ธ.ค. ALL kpi-ontime-pct` `"–"` → `"0.0%"` · TC-DASH-03 `พ.ย. ALL kpi-ontime-pct` `"85.7%"` → `"23.1%"` |
| B11 | TC-PDPA-03 · TC-AUDIT-01 | ✅ | TC-PDPA-03 `#5 UNMASK audit-count` · Expected `"1"` · Received `"0"` · TC-AUDIT-01 `audit-count` · Expected `"16"` · Received `"15"` |
| B12 | TC-WORKFLOW-04 | ✅ | `A5 return-btn: expected count 0` · Expected `0` · Received `1` (ปุ่มตีกลับครั้งที่ 3 ยังแสดง) · การยิง API ตรงกับ `BUG_MODE=B12` ได้ 200 `NEED_FIX` `returnCount=3` อยู่ใน FINAL-REPORT §4.5 (ไม่ได้ยิงซ้ำในรอบนี้) |

ไม่มีบั๊กตัวไหนที่ TC ไม่ล้ม จึงไม่ต้องแก้เว็บหรือ test ในขั้นนี้ · ไม่มีกรณี "ผ่านหลอก" (คอลัมน์ "ควรล้มแต่ผ่าน" ว่างทุกแถว · `should-fail-but-passed=[]` ทุกรอบ) · TC สิทธิ์/ข้อมูลส่วนบุคคล (RBAC-01/02 · QUEUE-02 · PDPA-02/03 · WORKFLOW-04) ตรวจที่ API/ค่าจริง

## 3. ชุดรวม (BUGS §3 ขั้น 5: ต้องล้มเท่า union)

| ชุด | ล้มจริง | union ของรอบเดี่ยว | เท่ากัน | ข้อความล้ม |
|---|---|---|---|---|
| `BUG_MODE=B03,B07` | TC-NOTI-02 · TC-RBAC-02 · TC-RBAC-04 · TC-SLA-01 · TC-SLA-02 · TC-SLA-03 (45 passed · 6 failed) | B03 (5 TC) ∪ B07 (TC-RBAC-02) = 6 TC เดียวกัน | ✅ | เหมือนรอบเดี่ยวทุกตัว เช่น TC-SLA-01 `"2026-12-08T16:30:00+07:00"` → `"2026-12-07T16:30:00+07:00"` · TC-RBAC-02 `expected HTTP 403, received HTTP 200 · body={"status":"APPROVED"}` · TC-NOTI-02 ขาด `EG-2569-000016:near` |
| `BUG_MODE=B01,B05,B09` | TC-FEE-01 · TC-PAY-01 · TC-PDPA-02 (48 passed · 3 failed) | B01 ∪ B05 ∪ B09 = 3 TC เดียวกัน | ✅ | TC-FEE-01 `"฿1,010"` → `"฿1,000"` · TC-PAY-01 `410` → `200` · TC-PDPA-02 `received 10 problem(s)` |

ไฟล์: [`bug-B03_B07.txt`](app/reports/runs-docker/bug-B03_B07.txt) · [`bug-B01_B05_B09.txt`](app/reports/runs-docker/bug-B01_B05_B09.txt)

## 4. Triage · B03 → TC-NOTI-02 (ผลข้างเคียงที่ยอมรับ)

- **อาการ (รอบนี้ยังเหมือนเดิม):** TC-NOTI-02 ล้มเมื่อเปิด B03 ทั้งรอบ B03 และ B03,B07 · ล้มที่ส่วน B (RESET → `CLOCK(2026-12-05T10:00+07:00)` วันเสาร์ → ประเมินแจ้งเตือน) `off.reg2 ส.5: noti-item (หน้าจอ)` ขาด `EG-2569-000016:near` · ส่วน A และ C ผ่าน
- **สาเหตุ:** `…000016` กำหนดเสร็จ อ. 8 ธ.ค. 16:30 และ จ. 7 ธ.ค. เป็นวันหยุดในตาราง → เว็บถูกต้องนับวันคงเหลือ = 1 → `near` · B03 นับ 7 ธ.ค. เป็นวันทำการ → คงเหลือ 2 → `normal` → ไม่มีแจ้ง `near` · กลไกเดียวกับ TC-SLA-03 ส่วน B ที่ BUGS §2 ยอมให้ล้มอยู่แล้ว
- **ตัดสิน:** ไม่ใช่บั๊กรั่ว (ระดับแจ้งเตือน FR-20 ต้องมาจาก `sla-level` ตัวเดียวกับหน้าจอ FR-19 ถ้าแยกสูตรให้ B03 ไม่กระทบ หน้าจอจะบอก `ปกติ` แต่กระดิ่งบอก `ใกล้ครบกำหนด`) และไม่ใช่ test ผิด (ค่าที่คาดตรง TEST-PLAN) → **ไม่แก้เว็บ ไม่แก้ test** · เพิ่ม TC-NOTI-02 ในรายการ "อาจล้ม" ของ B03 ใน `app/scripts/run-bugs.sh` (`may_fail`) และเสนอให้แก้แผน (FINAL-REPORT §5.1 · §9 ข้อ 1)
- **สถานะตอนนี้:** BUGS.md §2 แถว B03 และ §4 รวมถึง TEST-PLAN ตารางสรุป (`(B03 อาจล้มด้วย)`) และ §18 **ปรับแล้ว** ให้มี TC-NOTI-02 ในคอลัมน์ "อาจล้มด้วย" → ตามแผนฉบับปัจจุบันไม่มี TC ล้มเกินที่คาด ทั้งในรอบ B03 และ B03,B07 (`extra=[]`)
- ไฟล์: [`bug-B03.txt`](app/reports/runs-docker/bug-B03.txt) (`side-effects=[TC-NOTI-02 TC-RBAC-04 TC-SLA-03]`) · [`bug-B03.log`](app/reports/runs-docker/bug-B03.log)

## 5. สรุป

**จับได้ 12/12** (รุ่น migration · รัน 2026-11-19) · ทุกบั๊ก B01–B12 ทำให้ TC ที่ต้องล้มล้มจริงด้วยค่าที่ต่างจากที่คาด · TC ที่ล้มเกินมีเฉพาะกลุ่ม "อาจล้มด้วย" (B03: SLA-03 · RBAC-04 · NOTI-02 · B10: DASH-01 · DASH-03) · ชุดรวมทั้งสองชุดล้มเท่า union · ปิดบั๊กกลับมา 51/51 · TC-NFR-04 PII found 0 ทุกรอบ (FINAL-REPORT §4.6) · ผลเหมือนรอบก่อนเปลี่ยนเป็น migration ทุกข้อ

## 6. ไฟล์ผลรันดิบ

| รอบ | ไฟล์ |
|---|---|
| ปกติ | [normal-1](app/reports/runs-docker/normal-1.txt) · [normal-2](app/reports/runs-docker/normal-2.txt) · [normal-final](app/reports/runs-docker/normal-final.txt) |
| B01–B12 | [B01](app/reports/runs-docker/bug-B01.txt) · [B02](app/reports/runs-docker/bug-B02.txt) · [B03](app/reports/runs-docker/bug-B03.txt) · [B04](app/reports/runs-docker/bug-B04.txt) · [B05](app/reports/runs-docker/bug-B05.txt) · [B06](app/reports/runs-docker/bug-B06.txt) · [B07](app/reports/runs-docker/bug-B07.txt) · [B08](app/reports/runs-docker/bug-B08.txt) · [B09](app/reports/runs-docker/bug-B09.txt) · [B10](app/reports/runs-docker/bug-B10.txt) · [B11](app/reports/runs-docker/bug-B11.txt) · [B12](app/reports/runs-docker/bug-B12.txt) |
| ชุดรวม | [B03,B07](app/reports/runs-docker/bug-B03_B07.txt) · [B01,B05,B09](app/reports/runs-docker/bug-B01_B05_B09.txt) |

แต่ละรอบมีไฟล์คู่กัน `.json` `.summary.json` `.log` `.web.log` ชื่อเดียวกันในโฟลเดอร์ [`app/reports/runs-docker/`](app/reports/runs-docker/) · ลำดับรัน [`matrix.out`](app/reports/runs-docker/matrix.out)

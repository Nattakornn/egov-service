# egov-eservice · การบ้าน Week 2 (e-Service เทศบาลนครตัวอย่าง)

เว็บ e-Service กลางของ "เทศบาลนครตัวอย่าง" ซึ่งเป็นหน่วยงานสมมติ ประชาชนยื่นคำขอได้ 3 บริการ (SV-01 · SV-02 · SV-03) และชำระเงินด้วย PromptPay QR จำลอง เจ้าหน้าที่ตรวจคำขอ ตีกลับ หรือส่งต่อ หัวหน้าเป็นผู้อนุมัติ ระบบออกเอกสารดิจิทัลที่ตรวจสอบได้ที่ `/verify` และมี Dashboard, Audit Trail กับหน้าผู้ดูแลระบบ

ทั้งโปรเจกต์สร้างด้วย agent-team ผ่าน Docker `multi-account` โดยใช้บัญชี yolo1 กับ yolo2 แบ่งงานเป็น 14 บล็อกตาม DAG (P01–P14)

> ThaiD, PromptPay และลายเซ็นในโปรเจกต์นี้เป็นตัวจำลองทั้งหมด และไม่มีการใช้ชื่อ ตรา หรือโลโก้ของหน่วยงานจริง

## ผลโดยสรุป

| รายการ | ผล |
|---|---|
| บล็อกงานตามแผน | เสร็จ 14/14 |
| Playwright (TEST-PLAN ชุดเต็ม) | **51/51 passed** · 0 failed · 0 skipped |
| Unit test (`npm test`) | 196/196 passed |
| พิสูจน์ด้วย BUG_MODE (B01–B12) | **จับได้ 12/12** · ชุดรวม `B03,B07` กับ `B01,B05,B09` ได้ `MATCH` |
| Migration | เพิ่มไฟล์ใหม่อย่างเดียว ห้ามแก้ไฟล์ที่ apply แล้ว · ข้อมูลยังอยู่หลัง restart |

## ไฟล์ในโฟลเดอร์

| ไฟล์ | ขั้น | คืออะไร |
|---|---|---|
| [LAB1-ANSWERS.md](LAB1-ANSWERS.md) | LAB 1 | สรุปโจทย์และคำตอบ 3 ข้อ (ค่าธรรมเนียม · SLA · data-testid) |
| [blocks.json](blocks.json) · [dag.png](dag.png) · [gantt-plan.png](gantt-plan.png) · [PLAN.md](PLAN.md) | 1 | แผนงาน: บล็อก, DAG และ Gantt ตามแผน |
| [REPORT.md](REPORT.md) · [gantt-actual.png](gantt-actual.png) · [compare.png](compare.png) | 3 | ผลจริงเทียบกับแผน: เวลา, บัญชีที่ใช้ และ tokens |
| [app/](app/) | 2–3 | โค้ดเว็บ, Playwright e2e, unit test และ Docker |
| [test-report/](test-report/) | 4 | ผล Playwright: `results.json`, `index.html` และ GIF ของ TC ระดับ P1 |
| [BUG-HUNT.md](BUG-HUNT.md) | 5 | ผลรัน BUG_MODE B01–B12 พร้อมตาราง triage และข้อความที่ test ล้ม |
| `dag.json` · `graph.json` · `plan.json` · `*.svg` | – | ไฟล์ดิบจาก dag-planner และ agent-team |

## Stack

Node 20 · Express 4 · better-sqlite3 · HTML render ฝั่งเซิร์ฟเวอร์ · JS ฝั่ง browser แบบ vanilla · Playwright 1.49 · Docker Compose

รายละเอียดโครงสร้างโค้ดและเจ้าของแต่ละส่วนอยู่ใน [app/ARCHITECTURE.md](app/ARCHITECTURE.md) ส่วนรายงานรวมของทีมอยู่ใน [app/reports/FINAL-REPORT.md](app/reports/FINAL-REPORT.md)

## วิธีรัน

ทุกคำสั่งรันในโฟลเดอร์ `app/`

```bash
cd app

# รันเว็บแบบปกติ (ปิด test hook และไม่ลบข้อมูล) → http://localhost:3000
docker compose up --build -d

# โหมดทดสอบ (เปิด /api/test/*, ใช้นาฬิกาแช่แข็ง และ reset + seed ทุกครั้งที่เริ่ม)
TEST_MODE=1 docker compose up --build -d

# รัน Playwright ชุดเต็ม 51 TC ใน Docker
TEST_MODE=1 docker compose up --build -d && docker compose --profile test run --rm e2e

# เปิดบั๊กเพื่อพิสูจน์ว่า test จับได้
TEST_MODE=1 BUG_MODE=B03,B07 docker compose up --build -d

# รันทุกบั๊กตั้งแต่ B01 ถึง B12 รวมชุดผสม แล้วสรุปผล MATCH/MISMATCH
OUT=reports/runs-docker ./scripts/run-bugs.sh

# unit test (ต้อง npm install ก่อน)
npm install && npm test

# ปิดเว็บ
docker compose down
```

> ในโฟลเดอร์นี้ไม่มี `node_modules/` และ `data/` ถ้าจะรันโดยไม่ใช้ Docker ต้อง `npm install` ก่อน

### ตัวแปรสำคัญ

| env | ความหมาย |
|---|---|
| `TEST_MODE=1` | เปิด `/api/test/*`, ล้างตาราง, รัน migration ใหม่ทั้งหมด และ seed ทุกครั้งที่เริ่ม |
| `BUG_MODE=B01,…` | เปิดบั๊กที่ฝังไว้ตาม BUGS.md (คั่นด้วย `,`) |
| `WEB_PORT` | พอร์ตบนเครื่อง (ค่าเริ่มต้น 3000) |
| `RESET_ON_START=1` | ล้างข้อมูลแล้ว seed ใหม่ตอนเริ่ม · **ห้ามตั้งค่านี้กับข้อมูลจริง** |

ตัวแปรทั้งหมดอยู่ใน [app/ARCHITECTURE.md §1](app/ARCHITECTURE.md)

## Migration (การเปลี่ยนโครงสร้างตาราง)

- ไฟล์ migration อยู่ที่ `app/src/core/migrations/NNNN_<desc>.sql` และ `app/src/modules/<ชื่อ>/migrations/` ตอนนี้มีไฟล์เดียวคือ `0001_init.sql`
- **ห้ามแก้ไฟล์ migration ที่ apply แล้ว ให้เพิ่มไฟล์ใหม่เท่านั้น** เช่น `npm run migrate:new -- add_column_x`
- ระบบเก็บ checksum (sha256) ของแต่ละไฟล์ไว้ในตาราง `schema_migrations` ถ้ามีคนแก้ ลบ หรือเปลี่ยนชื่อไฟล์ที่ apply แล้ว เว็บจะไม่ยอมเริ่ม และแสดงชื่อไฟล์ที่มีปัญหา
- โหมดปกติจะไม่ลบข้อมูลเด็ดขาด ระบบรันเฉพาะ migration ที่ยังค้าง และ seed เฉพาะตอนที่ DB ยังไม่มีผู้ใช้
- หลักฐานอยู่ที่ [app/reports/restart-check.txt](app/reports/restart-check.txt) กับ [app/reports/migration-edited-docker.txt](app/reports/migration-edited-docker.txt) และรายละเอียดอยู่ใน FINAL-REPORT §11

## หมายเหตุ

- **GIF ของ TC ระดับ P1:** มีครบ 42 จาก 43 TC ที่ขาดคือ TC-PDPA-02 เพราะ test นี้เรียกแค่ API ไม่มีหน้าเว็บให้อัดวิดีโอ วิดีโอเต็มของทุก TC ดูได้ใน `test-report/index.html`
- **เวลารวมใน REPORT.md:** ตัวเลข "จริง 1132.8 นาที" นับรวมช่วงที่ run หยุดข้ามคืนตอนโควตาหมดด้วย
- **B03:** test TC-NOTI-02 ล้มด้วยเมื่อเปิดบั๊กนี้ ซึ่งเป็นผลข้างเคียงที่ยอมรับได้และเอกสาร brief บันทึกไว้แล้ว (ดู BUG-HUNT.md §4)

-- schema กลางของระบบ (core เป็นเจ้าของ · โมดูลห้ามสร้างตารางใหม่นอกไฟล์นี้ ยกเว้น schema.sql ในโฟลเดอร์โมดูลตนเอง)
-- เวลาทุกคอลัมน์ *_at / due_at / fix_deadline เก็บเป็นข้อความ ISO เวลาไทย 'YYYY-MM-DDTHH:MM:SS+07:00' (time.iso) → เทียบ/เรียงแบบ string ได้
-- วันที่ล้วน (holidays.date, documents.valid_until) เก็บ 'YYYY-MM-DD'
-- เงินเป็นจำนวนเต็มบาท

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ผู้ใช้ทุกบทบาท · ประชาชน: id_enc/mobile_enc เข้ารหัส AES-256-GCM (NFR-04) + id_hash/mobile_hash (HMAC) ไว้ค้นหา
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,            -- เจ้าหน้าที่: off.reg1 … · ประชาชน: cit-0001 … (ไม่ใช่ข้อมูลส่วนบุคคล)
  password_hash TEXT,                            -- เจ้าหน้าที่เท่านั้น (scrypt) · ประชาชน NULL
  name          TEXT NOT NULL,                   -- ชื่อแสดง (user-name) / ชื่อ-สกุลจาก ThaiD
  role          TEXT NOT NULL CHECK (role IN ('citizen','officer','head','executive','auditor','admin')),
  dept          TEXT CHECK (dept IS NULL OR dept IN ('registry','works')),
  id_enc        TEXT,                            -- crypto.enc(เลขบัตร 13 หลัก)
  id_hash       TEXT UNIQUE,                     -- crypto.hash(เลขบัตร 13 หลัก)
  mobile_enc    TEXT,                            -- crypto.enc(เบอร์มือถือ 10 หลัก)
  mobile_hash   TEXT,
  email         TEXT NOT NULL DEFAULT '',
  registered    INTEGER NOT NULL DEFAULT 1,      -- ประชาชนที่ยังไม่ลงทะเบียน = 0 (มานะ)
  consent_at    TEXT,                            -- เวลาที่ยินยอม PDPA
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT
);

-- บริการ (ผู้ดูแลแก้ fee/fee_per_sqm/sla ได้ · A-09)
CREATE TABLE IF NOT EXISTS services (
  id          TEXT PRIMARY KEY,                  -- 'SV-01'
  name        TEXT NOT NULL,                     -- 'ขอหนังสือรับรอง'
  fee_type    TEXT NOT NULL CHECK (fee_type IN ('per_copy','fixed','area')),
  fee         INTEGER NOT NULL,                  -- SV-01 ต่อฉบับ (20) · SV-02 คงที่ (500) · SV-03 ฐาน 1–100 ตร.ม. (1000)
  fee_per_sqm INTEGER,                           -- SV-03 เท่านั้น (10) ต่อ ตร.ม. ที่เกิน 100
  sla         INTEGER NOT NULL,                  -- วันทำการ 3 / 10 / 15
  approver    TEXT NOT NULL CHECK (approver IN ('officer','head')),
  route       TEXT NOT NULL,                     -- JSON ขั้นตอน: ["registry"] · ["registry","head"] · ["registry","works","head"]
  docs        TEXT NOT NULL,                     -- JSON [{key,name,required,pdfOnly}] ตามลำดับ CONTRACT §4.3
  sort        INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS holidays (
  date TEXT PRIMARY KEY,                         -- 'YYYY-MM-DD'
  name TEXT NOT NULL
);

-- ร่าง/รอชำระ (ยังไม่มีเลขคำขอ · FR-07)
CREATE TABLE IF NOT EXISTS drafts (
  id            TEXT PRIMARY KEY,                -- 'DR-0001'
  citizen_id    INTEGER NOT NULL REFERENCES users(id),
  service_id    TEXT NOT NULL REFERENCES services(id),
  status        TEXT NOT NULL CHECK (status IN ('DRAFT','PENDING_PAYMENT','PAID')),
  qty           INTEGER,                         -- SV-01
  area_sqm      INTEGER,                         -- SV-03
  fee           INTEGER,                         -- ค่าธรรมเนียมที่คำนวณล่าสุด
  locked_amount INTEGER,                         -- ยอดที่ล็อกตอนเข้า PENDING_PAYMENT (BR-11)
  case_no       TEXT,                            -- หลังชำระสำเร็จ
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS drafts_citizen ON drafts(citizen_id);

-- ไฟล์แนบ (เนื้อไฟล์อยู่ที่ UPLOAD_DIR/<storage> · ใช้ ctx.storage.read(row))
CREATE TABLE IF NOT EXISTS files (
  id          TEXT PRIMARY KEY,                  -- fileId 'F-000001'
  draft_id    TEXT,                              -- แนบตอนเป็นร่าง
  case_no     TEXT,                              -- ผูกกับคำขอ (ตั้งตอนชำระสำเร็จ / แนบตอนส่งแก้)
  doc_key     TEXT NOT NULL,                     -- id-card | map | site-photo | plan | deed | extra
  name        TEXT NOT NULL,                     -- ชื่อไฟล์เดิม
  mime        TEXT NOT NULL,                     -- จากชนิดจริง (magic bytes)
  size        INTEGER NOT NULL,
  storage     TEXT NOT NULL,                     -- path สัมพัทธ์ใต้ UPLOAD_DIR
  seed        INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER,
  uploaded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS files_case ON files(case_no);
CREATE INDEX IF NOT EXISTS files_draft ON files(draft_id);

-- QR ชำระเงิน (PromptPay จำลอง)
CREATE TABLE IF NOT EXISTS payments (
  ref           TEXT PRIMARY KEY,                -- 'PP-0001'
  draft_id      TEXT NOT NULL,
  amount        INTEGER NOT NULL,                -- = drafts.locked_amount
  status        TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','VOID')),
  qr_created_at TEXT NOT NULL,
  qr_expires_at TEXT NOT NULL,                   -- created + 15:00 นาที
  paid_at       TEXT,
  case_no       TEXT,
  receipt_no    TEXT
);
CREATE INDEX IF NOT EXISTS payments_draft ON payments(draft_id);

-- คำขอที่มีเลขแล้ว
CREATE TABLE IF NOT EXISTS cases (
  case_no      TEXT PRIMARY KEY,                 -- 'EG-2569-000001'
  draft_id     TEXT,                             -- NULL สำหรับ seed
  citizen_id   INTEGER NOT NULL REFERENCES users(id),
  service_id   TEXT NOT NULL REFERENCES services(id),
  qty          INTEGER,
  area_sqm     INTEGER,
  fee          INTEGER NOT NULL,                 -- ยอดที่ชำระ
  status       TEXT NOT NULL CHECK (status IN ('SUBMITTED','IN_REVIEW','NEED_FIX','PENDING_APPROVAL','APPROVED','COMPLETED','REJECTED','CANCELLED')),
  step         INTEGER,                          -- SV-03 เท่านั้น: 1 ทะเบียน · 2 โยธา · 3 หัวหน้า · อื่น NULL
  dept         TEXT,                             -- คิวที่ถือเรื่องอยู่: registry | works | head | NULL (ปิด/ยกเลิก)
  owner        TEXT,                             -- username ผู้ถือเรื่อง (IN_REVIEW / NEED_FIX) · ไม่มี = NULL
  issuer       TEXT,                             -- A-27 ผู้ออกเอกสาร = เจ้าหน้าที่ทะเบียนที่รับเรื่องขั้นแรก
  approved_by  TEXT,                             -- username ผู้อนุมัติ (= ผู้ลงนาม)
  approved_at  TEXT,
  payment_ref  TEXT,
  receipt_no   TEXT UNIQUE,                      -- 'RC-2569-000001'
  paid_at      TEXT NOT NULL,
  due_at       TEXT NOT NULL,                    -- กำหนดเสร็จ (คำนวณครั้งเดียวตอนชำระ + ขยายเมื่อส่งแก้ · seed ตายตัว A-35)
  return_count INTEGER NOT NULL DEFAULT 0,
  returned_at  TEXT,                             -- เวลาตีกลับครั้งล่าสุด
  fix_deadline TEXT,                             -- returned_at + 168 ชม. (มีค่าเฉพาะตอน NEED_FIX)
  closed_at    TEXT,                             -- COMPLETED / REJECTED เท่านั้น
  cancelled_at TEXT,                             -- CANCELLED (ไม่ใช่ "ปิดงาน")
  doc_no       TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cases_citizen ON cases(citizen_id);
CREATE INDEX IF NOT EXISTS cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS cases_due ON cases(due_at, case_no);

-- ไทม์ไลน์ของคำขอ (ประชาชน/เจ้าหน้าที่เห็น) · เขียนผ่าน ctx.caseEvents
CREATE TABLE IF NOT EXISTS case_timeline (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_no     TEXT NOT NULL,
  at          TEXT NOT NULL,
  event       TEXT NOT NULL,                     -- PAID CLAIM RETURN RESUBMIT FORWARD APPROVE REJECT ISSUE CANCEL AUTO_CANCEL NOTE
  from_status TEXT,
  to_status   TEXT,
  actor       TEXT,                              -- username (NULL = ระบบ)
  actor_name  TEXT,
  actor_role  TEXT,
  text        TEXT NOT NULL,                     -- ข้อความไทยที่แสดง
  detail      TEXT                               -- เหตุผล/หมายเหตุ
);
CREATE INDEX IF NOT EXISTS timeline_case ON case_timeline(case_no, at, id);

-- ประวัติตีกลับ (BR-13 BR-19 BR-20)
CREATE TABLE IF NOT EXISTS returns (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  case_no        TEXT NOT NULL,
  seq            INTEGER NOT NULL,               -- ครั้งที่ 1, 2 (B12 อาจมี 3)
  returned_at    TEXT NOT NULL,
  returned_by    TEXT NOT NULL,
  reason         TEXT NOT NULL,
  fix_deadline   TEXT NOT NULL,                  -- returned_at + 168 ชม.
  resubmitted_at TEXT,
  paused_days    INTEGER,                        -- วันทำการใน (วันตีกลับ, วันส่งแก้]
  UNIQUE (case_no, seq)
);

-- เอกสารดิจิทัล (ลายเซ็น = ctx.sign.signDoc)
CREATE TABLE IF NOT EXISTS documents (
  doc_no          TEXT PRIMARY KEY,              -- 'DOC-2569-000001'
  case_no         TEXT NOT NULL UNIQUE,
  verify_code     TEXT NOT NULL UNIQUE,          -- [A-Z0-9]{8}
  applicant       TEXT NOT NULL,                 -- ชื่อ-สกุลเต็ม (หน้า verify ปิดบังด้วย fmt.maskName)
  service_id      TEXT NOT NULL,
  issued_at       TEXT NOT NULL,                 -- ISO +07:00
  valid_until     TEXT NOT NULL,                 -- 'YYYY-MM-DD' วันสุดท้ายที่ใช้ได้
  signer          TEXT NOT NULL,                 -- ชื่อแสดงผู้ลงนาม
  signer_username TEXT,
  signature       TEXT NOT NULL,                 -- hex HMAC-SHA256
  issued_by       TEXT,                          -- username ผู้กดออกเอกสาร
  created_at      TEXT NOT NULL
);

-- แจ้งเตือนกระดิ่ง (BR-15: 1 ครั้งต่อระดับต่อคำขอต่อคน → UNIQUE)
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT NOT NULL,
  case_no    TEXT NOT NULL,
  level      TEXT NOT NULL CHECK (level IN ('near','overdue')),
  text       TEXT NOT NULL,                      -- 'คำขอ EG-2569-000024 ใกล้ครบกำหนด'
  created_at TEXT NOT NULL,
  read_at    TEXT,
  UNIQUE (username, case_no, level)
);

-- Audit Trail: เพิ่มได้อย่างเดียว (trigger กัน UPDATE/DELETE) · เขียนผ่าน ctx.audit.log เท่านั้น
CREATE TABLE IF NOT EXISTS audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,                     -- ISO +07:00 จากนาฬิกาทดสอบ
  username    TEXT NOT NULL,
  role        TEXT NOT NULL,
  event       TEXT NOT NULL CHECK (event IN ('STAFF_LOGIN','CLAIM','RETURN','FORWARD','APPROVE','REJECT','ISSUE','UNMASK','EXPORT','ADMIN_CHANGE')),
  case_no     TEXT,
  from_status TEXT,
  to_status   TEXT,
  detail      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS audit_at ON audit(at, id);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit
BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit
BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;

-- session ล็อกอิน (cookie eg_sid HttpOnly) · role/dept ณ ตอนล็อกอิน (admin เปลี่ยนบทบาท → มีผลครั้งถัดไป)
CREATE TABLE IF NOT EXISTS sessions (
  sid        TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  role       TEXT NOT NULL,
  dept       TEXT,
  scope      TEXT NOT NULL DEFAULT 'full' CHECK (scope IN ('full','register')),
  created_at TEXT NOT NULL
);

-- ตัวนับ OTP ผิด/การล็อก (BR-02) · key = crypto.hash(เลขบัตร) ห้ามเก็บเลขตรง ๆ
CREATE TABLE IF NOT EXISTS otp_attempts (
  id_hash      TEXT PRIMARY KEY,
  fail_count   INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_fail_at TEXT,
  otp_sent_at  TEXT
);

-- ตัวนับเลขรัน (ใช้ผ่าน ctx.ids) · case:2569 receipt:2569 doc:2569 draft payment file citizen
CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

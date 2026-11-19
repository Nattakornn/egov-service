'use strict';
// ข้อมูล seed ตาม TEST-DATA.md §1–§12 (ทุกค่าตายตัว · A-35)
// เวลาในไฟล์นี้เป็นเวลาไทย 'YYYY-MM-DD HH:MM' (seed แปลงเป็น ISO +07:00)

const PASSWORD = 'Test@1234';

// §1.1 ประชาชน (เลขบัตร/เบอร์ถูกเข้ารหัสก่อนเขียน DB)
const CITIZENS = [
  { key: 'somchai', username: 'cit-0001', name: 'สมชาย ใจดี', idNo: '1101700123456', mobile: '0812345678', registered: true },
  { key: 'somying', username: 'cit-0002', name: 'สมหญิง รักไทย', idNo: '3100600987659', mobile: '0823456789', registered: true },
  { key: 'mana', username: 'cit-0003', name: 'มานะ ตั้งใจ', idNo: '5500400111221', mobile: null, registered: false },
  { key: 'piti', username: 'cit-0004', name: 'ปิติ มีสุข', idNo: '1909900555015', mobile: '0834567890', registered: true },
];

// §1.2 เจ้าหน้าที่และบทบาทอื่น
const STAFF = [
  { username: 'off.reg1', name: 'เจ้าหน้าที่ทะเบียน 1', role: 'officer', dept: 'registry' },
  { username: 'off.reg2', name: 'เจ้าหน้าที่ทะเบียน 2', role: 'officer', dept: 'registry' },
  { username: 'off.works1', name: 'เจ้าหน้าที่โยธา 1', role: 'officer', dept: 'works' },
  { username: 'head1', name: 'หัวหน้าฝ่าย', role: 'head', dept: null },
  { username: 'exec1', name: 'ผู้บริหาร', role: 'executive', dept: null },
  { username: 'audit1', name: 'ผู้ตรวจสอบภายใน', role: 'auditor', dept: null },
  { username: 'admin1', name: 'ผู้ดูแลระบบ', role: 'admin', dept: null },
];

// §2 บริการ · docs เรียงตาม CONTRACT §4.3 (ลำดับที่ใช้ใน missing-docs)
const SERVICES = [
  {
    id: 'SV-01', name: 'ขอหนังสือรับรอง', fee_type: 'per_copy', fee: 20, fee_per_sqm: null, sla: 3,
    approver: 'officer', route: ['registry'], sort: 1,
    docs: [{ key: 'id-card', name: 'บัตรประชาชน', required: true }],
  },
  {
    id: 'SV-02', name: 'ขออนุญาตประกอบกิจการ', fee_type: 'fixed', fee: 500, fee_per_sqm: null, sla: 10,
    approver: 'head', route: ['registry', 'head'], sort: 2,
    docs: [
      { key: 'id-card', name: 'บัตรประชาชน', required: true },
      { key: 'map', name: 'แผนที่ตั้ง', required: true },
      { key: 'site-photo', name: 'ภาพสถานที่', required: false },
    ],
  },
  {
    id: 'SV-03', name: 'ขออนุญาตก่อสร้าง/ต่อเติมอาคาร', fee_type: 'area', fee: 1000, fee_per_sqm: 10, sla: 15,
    approver: 'head', route: ['registry', 'works', 'head'], sort: 3,
    docs: [
      { key: 'id-card', name: 'บัตรประชาชน', required: true },
      { key: 'plan', name: 'แบบแปลน', required: true, pdfOnly: true },
      { key: 'deed', name: 'โฉนด', required: true },
    ],
  },
];

// ไฟล์บังคับของ seed ต่อบริการ (TEST-DATA §4.1 ท้ายตาราง)
const SEED_FILES = {
  'SV-01': [['id-card', 'id-card.pdf']],
  'SV-02': [['id-card', 'id-card.pdf'], ['map', 'map.pdf']],
  'SV-03': [['id-card', 'id-card.pdf'], ['plan', 'plan.pdf'], ['deed', 'deed.pdf']],
};

// §3 วันหยุด
const HOLIDAYS = [
  { date: '2026-12-07', name: 'ชดเชยวันหยุดทดสอบ (สมมติ)' },
  { date: '2026-12-10', name: 'วันรัฐธรรมนูญทดสอบ (สมมติ)' },
  { date: '2026-12-31', name: 'วันสิ้นปีทดสอบ (สมมติ)' },
  { date: '2027-01-01', name: 'วันขึ้นปีใหม่ทดสอบ (สมมติ)' },
];

// เหตุผลตีกลับ (§4.4) และไม่อนุมัติ
const R = {
  F01_1: 'ภาพบัตรประชาชนไม่ชัด กรุณาถ่ายใหม่',
  F01_2: 'ชื่อในเอกสารไม่ตรงกับบัตร กรุณาแก้ไข',
  F02_1: 'ภาพเอกสารเบลอ อ่านเลขไม่ได้',
  F02_2: 'ข้อมูลในแบบฟอร์มไม่ครบถ้วน',
  H04_REJECT: 'ข้อมูลผู้ขอไม่ตรงกับทะเบียน ไม่สามารถออกหนังสือรับรองได้',
};

// §4.1 คำขอ 30 ใบ · events จำลองตามแผนภาพสถานะ (seed ตรวจว่าสถานะสุดท้ายตรง status)
// รูปแบบ event: [ชนิด, เวลา, ผู้ทำ(username|'citizen'), เหตุผล/หมายเหตุ]
// ชนิด: CLAIM RETURN RESUBMIT FORWARD APPROVE REJECT ISSUE CANCEL (PAID ใส่ให้อัตโนมัติที่เวลาชำระ)
const CASES = [
  { no: 1, tag: 'H01', svc: 'SV-01', qty: 1, fee: 20, who: 'somying', status: 'COMPLETED', paid: '2026-10-14 10:00', due: '2026-10-19 16:30', closed: '2026-10-16 14:00',
    events: [['CLAIM', '2026-10-14 13:00', 'off.reg1'], ['APPROVE', '2026-10-16 11:00', 'off.reg1'], ['ISSUE', '2026-10-16 14:00', 'off.reg1']] },
  { no: 2, tag: 'H05', svc: 'SV-03', area: 120, fee: 1200, who: 'piti', status: 'COMPLETED', paid: '2026-11-02 09:00', due: '2026-11-23 16:30', closed: '2026-11-20 11:00',
    events: [['CLAIM', '2026-11-02 10:00', 'off.reg1'], ['FORWARD', '2026-11-04 10:00', 'off.reg1'], ['CLAIM', '2026-11-04 11:00', 'off.works1'],
      ['FORWARD', '2026-11-12 10:00', 'off.works1'], ['APPROVE', '2026-11-19 15:00', 'head1'], ['ISSUE', '2026-11-20 11:00', 'off.reg1']] },
  { no: 3, tag: 'H02', svc: 'SV-01', qty: 2, fee: 40, who: 'piti', status: 'COMPLETED', paid: '2026-11-02 09:30', due: '2026-11-05 16:30', closed: '2026-11-04 15:00',
    events: [['CLAIM', '2026-11-02 11:00', 'off.reg2'], ['APPROVE', '2026-11-04 14:00', 'off.reg2'], ['ISSUE', '2026-11-04 15:00', 'off.reg2']] },
  { no: 4, tag: 'H06', svc: 'SV-02', fee: 500, who: 'somchai', status: 'COMPLETED', paid: '2026-11-02 14:00', due: '2026-11-16 16:30', closed: '2026-11-13 15:00',
    events: [['CLAIM', '2026-11-03 09:00', 'off.reg1'], ['FORWARD', '2026-11-05 10:00', 'off.reg1'], ['APPROVE', '2026-11-12 15:00', 'head1'], ['ISSUE', '2026-11-13 15:00', 'off.reg1']] },
  { no: 5, tag: 'H03', svc: 'SV-01', qty: 1, fee: 20, who: 'somchai', status: 'COMPLETED', paid: '2026-11-03 11:00', due: '2026-11-06 16:30', closed: '2026-11-05 10:00',
    events: [['CLAIM', '2026-11-03 13:00', 'off.reg1'], ['APPROVE', '2026-11-05 09:30', 'off.reg1'], ['ISSUE', '2026-11-05 10:00', 'off.reg1']], document: true },
  { no: 6, tag: 'H08', svc: 'SV-02', fee: 500, who: 'piti', status: 'COMPLETED', paid: '2026-11-03 15:00', due: '2026-11-17 16:30', closed: '2026-11-19 10:00',
    events: [['CLAIM', '2026-11-04 09:00', 'off.reg2'], ['FORWARD', '2026-11-10 10:00', 'off.reg2'], ['APPROVE', '2026-11-18 15:00', 'head1'], ['ISSUE', '2026-11-19 10:00', 'off.reg2']] },
  { no: 7, tag: 'H07', svc: 'SV-02', fee: 500, who: 'somying', status: 'COMPLETED', paid: '2026-11-04 10:00', due: '2026-11-18 16:30', closed: '2026-11-18 16:00',
    events: [['CLAIM', '2026-11-04 13:00', 'off.reg1'], ['FORWARD', '2026-11-11 10:00', 'off.reg1'], ['APPROVE', '2026-11-18 11:00', 'head1'], ['ISSUE', '2026-11-18 16:00', 'off.reg1']] },
  { no: 8, tag: 'H04', svc: 'SV-01', qty: 1, fee: 20, who: 'somying', status: 'REJECTED', paid: '2026-11-09 10:00', due: '2026-11-12 16:30', closed: '2026-11-11 09:00',
    events: [['CLAIM', '2026-11-09 13:00', 'off.reg1'], ['REJECT', '2026-11-11 09:00', 'off.reg1', R.H04_REJECT]] },
  { no: 9, tag: 'X01', svc: 'SV-01', qty: 1, fee: 20, who: 'somchai', status: 'CANCELLED', paid: '2026-11-09 14:30', due: '2026-11-12 16:30', cancelled: '2026-11-09 15:00',
    events: [['CANCEL', '2026-11-09 15:00', 'citizen']] },
  { no: 10, tag: 'W01', svc: 'SV-03', area: 80, fee: 1000, who: 'somying', status: 'IN_REVIEW', paid: '2026-11-12 10:00', due: '2026-12-03 16:30',
    events: [['CLAIM', '2026-11-12 13:00', 'off.reg1'], ['FORWARD', '2026-11-16 10:00', 'off.reg1']] },
  { no: 11, tag: 'P02', svc: 'SV-03', area: 150, fee: 1500, who: 'somchai', status: 'PENDING_APPROVAL', paid: '2026-11-16 10:00', due: '2026-12-08 16:30',
    events: [['CLAIM', '2026-11-16 13:00', 'off.reg1'], ['FORWARD', '2026-11-18 10:00', 'off.reg1'], ['CLAIM', '2026-11-18 13:00', 'off.works1'],
      ['FORWARD', '2026-11-27 10:00', 'off.works1']] },
  { no: 12, tag: 'R09', svc: 'SV-03', area: 101, fee: 1010, who: 'piti', status: 'IN_REVIEW', paid: '2026-11-18 10:00', due: '2026-12-11 16:30',
    events: [['CLAIM', '2026-11-18 13:00', 'off.reg2']] },
  { no: 13, tag: 'R01', svc: 'SV-02', fee: 500, who: 'somchai', status: 'IN_REVIEW', paid: '2026-11-20 10:00', due: '2026-12-04 16:30',
    events: [['CLAIM', '2026-11-20 13:00', 'off.reg2']] },
  { no: 14, tag: 'P01', svc: 'SV-02', fee: 500, who: 'piti', status: 'PENDING_APPROVAL', paid: '2026-11-20 11:00', due: '2026-12-04 16:30',
    events: [['CLAIM', '2026-11-20 13:30', 'off.reg1'], ['FORWARD', '2026-11-26 10:00', 'off.reg1']] },
  { no: 15, tag: 'R02', svc: 'SV-02', fee: 500, who: 'somying', status: 'IN_REVIEW', paid: '2026-11-20 15:00', due: '2026-12-04 16:30',
    events: [['CLAIM', '2026-11-23 09:30', 'off.reg2']] },
  { no: 16, tag: 'R03', svc: 'SV-02', fee: 500, who: 'piti', status: 'IN_REVIEW', paid: '2026-11-23 09:00', due: '2026-12-08 16:30',
    events: [['CLAIM', '2026-11-23 11:00', 'off.reg2']] },
  { no: 17, tag: 'F01', svc: 'SV-01', qty: 1, fee: 20, who: 'somchai', status: 'NEED_FIX', paid: '2026-11-23 10:00', due: '2026-11-27 16:30',
    events: [['CLAIM', '2026-11-23 13:00', 'off.reg1'], ['RETURN', '2026-11-24 11:00', 'off.reg1', R.F01_1], ['RESUBMIT', '2026-11-25 10:00', 'citizen'],
      ['RETURN', '2026-11-27 14:00', 'off.reg1', R.F01_2]] },
  { no: 18, tag: 'R04', svc: 'SV-02', fee: 500, who: 'somchai', status: 'IN_REVIEW', paid: '2026-11-24 10:00', due: '2026-12-09 16:30',
    events: [['CLAIM', '2026-11-24 13:00', 'off.reg2']] },
  { no: 19, tag: 'A01', svc: 'SV-02', fee: 500, who: 'somying', status: 'APPROVED', paid: '2026-11-24 14:00', due: '2026-12-09 16:30',
    events: [['CLAIM', '2026-11-24 15:00', 'off.reg1'], ['FORWARD', '2026-11-26 11:00', 'off.reg1'], ['APPROVE', '2026-11-30 15:00', 'head1']] },
  { no: 20, tag: 'O01', svc: 'SV-01', qty: 1, fee: 20, who: 'somchai', status: 'IN_REVIEW', paid: '2026-11-25 10:00', due: '2026-11-30 16:30',
    events: [['CLAIM', '2026-11-25 11:00', 'off.reg1']] },
  { no: 21, tag: 'R08', svc: 'SV-02', fee: 500, who: 'somying', status: 'IN_REVIEW', paid: '2026-11-25 12:00', due: '2026-12-11 16:30',
    events: [['CLAIM', '2026-11-25 14:00', 'off.reg2']] },
  { no: 22, tag: 'N02', svc: 'SV-01', qty: 2, fee: 40, who: 'somying', status: 'IN_REVIEW', paid: '2026-11-26 10:00', due: '2026-12-01 16:30',
    events: [['CLAIM', '2026-11-26 11:00', 'off.reg1']] },
  { no: 23, tag: 'F02', svc: 'SV-01', qty: 1, fee: 20, who: 'somying', status: 'IN_REVIEW', paid: '2026-11-26 10:30', due: '2026-12-03 16:30',
    events: [['CLAIM', '2026-11-26 13:00', 'off.reg1'], ['RETURN', '2026-11-27 10:00', 'off.reg1', R.F02_1], ['RESUBMIT', '2026-11-30 10:00', 'citizen'],
      ['RETURN', '2026-11-30 14:00', 'off.reg1', R.F02_2], ['RESUBMIT', '2026-12-01 08:30', 'citizen']] },
  { no: 24, tag: 'N01', svc: 'SV-01', qty: 1, fee: 20, who: 'piti', status: 'SUBMITTED', paid: '2026-11-27 11:00', due: '2026-12-02 16:30', events: [] },
  { no: 25, tag: 'R05', svc: 'SV-01', qty: 3, fee: 60, who: 'somying', status: 'IN_REVIEW', paid: '2026-11-30 10:00', due: '2026-12-03 16:30',
    events: [['CLAIM', '2026-11-30 11:00', 'off.reg2']] },
  { no: 26, tag: 'R07', svc: 'SV-01', qty: 5, fee: 100, who: 'somchai', status: 'IN_REVIEW', paid: '2026-11-30 16:29', due: '2026-12-03 16:30',
    events: [['CLAIM', '2026-11-30 16:40', 'off.reg2']] },
  { no: 27, tag: 'R06', svc: 'SV-01', qty: 1, fee: 20, who: 'piti', status: 'IN_REVIEW', paid: '2026-11-30 16:30', due: '2026-12-04 16:30',
    events: [['CLAIM', '2026-11-30 16:45', 'off.reg2']] },
  { no: 28, tag: 'S01', svc: 'SV-01', qty: 1, fee: 20, who: 'somying', status: 'SUBMITTED', paid: '2026-12-01 08:10', due: '2026-12-04 16:30', events: [] },
  { no: 29, tag: 'S02', svc: 'SV-01', qty: 1, fee: 20, who: 'piti', status: 'SUBMITTED', paid: '2026-12-01 08:20', due: '2026-12-04 16:30', events: [] },
  { no: 30, tag: 'S03', svc: 'SV-01', qty: 1, fee: 20, who: 'somchai', status: 'SUBMITTED', paid: '2026-12-01 08:30', due: '2026-12-04 16:30', events: [] },
];

// ค่าที่คาดหลัง seed (ให้ seed ตรวจตัวเอง · TEST-DATA §4.4)
const EXPECT = {
  'EG-2569-000017': { owner: 'off.reg1', returnCount: 2, fixDeadline: '2026-12-04T14:00:00+07:00' },
  'EG-2569-000023': { owner: 'off.reg1', returnCount: 2, fixDeadline: null },
  'EG-2569-000010': { owner: null, step: 2, dept: 'works', issuer: 'off.reg1' },
  'EG-2569-000011': { step: 3, dept: 'head', issuer: 'off.reg1' },
  'EG-2569-000012': { owner: 'off.reg2', step: 1 },
  'EG-2569-000014': { dept: 'head', issuer: 'off.reg1' },
  'EG-2569-000019': { owner: null, dept: 'registry', issuer: 'off.reg1', approvedBy: 'head1', approvedAt: '2026-11-30T15:00:00+07:00' },
};

// §4.2 ร่างและรอชำระของสมชาย
const DRAFTS = [
  { id: 'DR-0001', who: 'somchai', svc: 'SV-01', status: 'DRAFT', qty: 2, fee: 40, created: '2026-11-30 19:00', files: [] },
  { id: 'DR-0002', who: 'somchai', svc: 'SV-02', status: 'PENDING_PAYMENT', fee: 500, locked: 500, created: '2026-12-01 08:40',
    files: [['id-card', 'id-card.pdf', '2026-12-01 08:45'], ['map', 'map.pdf', '2026-12-01 08:47']] },
];

// §4.2 / §6 รายการชำระที่ค้าง
const PAYMENTS = [
  { ref: 'PP-0001', draft: 'DR-0002', amount: 500, created: '2026-12-01T08:55:00+07:00', expires: '2026-12-01T09:10:00+07:00' },
];

// §5 เอกสารที่ออกแล้ว
const DOCUMENT = {
  docNo: 'DOC-2569-000001',
  caseNo: 'EG-2569-000005',
  verifyCode: 'K7M2Q9XA',
  applicant: 'สมชาย ใจดี',
  serviceId: 'SV-01',
  issuedAt: '2026-11-05T10:00:00+07:00',
  validUntil: '2027-02-02',
  signer: 'เจ้าหน้าที่ทะเบียน 1',
  signerUsername: 'off.reg1',
  issuedBy: 'off.reg1',
};

// §12 ค่าถัดไป (counter = ค่าล่าสุดที่ใช้ไปแล้ว)
const COUNTERS = {
  'case:2569': 30,
  'receipt:2569': 30,
  'doc:2569': 1,
  draft: 2,
  payment: 1,
  citizen: 4,
  // file: ตั้งตามจำนวนไฟล์ seed จริง
};

module.exports = { PASSWORD, CITIZENS, STAFF, SERVICES, SEED_FILES, HOLIDAYS, CASES, EXPECT, DRAFTS, PAYMENTS, DOCUMENT, COUNTERS, REASONS: R };

'use strict';
// P03 · SLA วันทำการ + ระดับเตือน: ทุกตัวอย่างใน REQUIREMENTS BR-12 BR-13 BR-14 BR-20 · DECISIONS §0 §8 §18
// TEST-PLAN TC-SLA-01/02/03 · TC-RBAC-04 (ข้อ 6–7) · TEST-DATA §4 (dueAt ของ seed) · BUGS B03 B04
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('.');
const { bugs } = require('../core/bugs');
const { clock } = require('../core/clock');

const H = ['2026-12-07', '2026-12-10', '2026-12-31', '2027-01-01']; // TEST-DATA §3
const HSET = new Set(H);
const T = (s) => `${s}+07:00`; // '2026-12-01T09:00:00' → ISO +07:00
const DUE = (ymd) => `${ymd}T16:30:00+07:00`;

function withBugs(list, fn) {
  bugs.set(list);
  try {
    return fn();
  } finally {
    bugs.set('');
  }
}

bugs.set(''); // เริ่มจากเว็บถูกต้อง 100% แม้รันด้วย BUG_MODE ใน env

test.afterEach(() => {
  bugs.set('');
  clock.configure({ frozen: false });
});

// ───────────────────────── วันทำการ (A-02) ─────────────────────────

test('A-02 วันทำการ = จ.–ศ. ที่ไม่อยู่ในตารางวันหยุด', () => {
  const cases = {
    '2026-12-01': true, // อ.
    '2026-12-04': true, // ศ.
    '2026-12-05': false, // ส.
    '2026-12-06': false, // อา.
    '2026-12-07': false, // จ. หยุด
    '2026-12-08': true,
    '2026-12-10': false, // พฤ. หยุด
    '2026-12-31': false, // พฤ. หยุด
    '2027-01-01': false, // ศ. หยุด
    '2027-01-04': true,
    '2026-11-30': true,
  };
  for (const [d, want] of Object.entries(cases)) assert.equal(rules.isBusinessDay(d, H), want, d);
  // รับเวลา (Date / ISO) ได้ · ใช้วันที่ตามเวลาไทย (2026-12-06T17:30Z = จ. 7 ธ.ค. 00:30 ไทย = หยุด)
  assert.equal(rules.isBusinessDay(T('2026-12-07T23:59:59'), H), false);
  assert.equal(rules.isBusinessDay(new Date('2026-12-06T17:30:00Z'), H), false);
  assert.equal(rules.isBusinessDay(new Date('2026-12-06T16:59:59Z'), H), false); // อา. 23:59:59 ไทย
  assert.equal(rules.isBusinessDay('2026-12-07', []), true); // ไม่มีวันหยุดในตาราง
  assert.equal(rules.isBusinessDay('2026-12-07', HSET), false);
  assert.equal(rules.isBusinessDay('2026-12-07', { holidays: H }), false);
  assert.throws(() => rules.isBusinessDay('2026-12-07'), TypeError); // ลืมส่งวันหยุด = ใช้ผิด
});

test('addBusinessDays / nextBusinessDay / countBusinessDays', () => {
  assert.equal(rules.addBusinessDays('2026-12-01', 0, H), '2026-12-01');
  assert.equal(rules.addBusinessDays('2026-12-01', 3, H), '2026-12-04');
  assert.equal(rules.addBusinessDays('2026-12-02', 3, H), '2026-12-08');
  assert.equal(rules.addBusinessDays('2026-12-04', 3, H), '2026-12-11');
  assert.equal(rules.addBusinessDays('2026-12-29', 3, H), '2027-01-05');
  // รับเวลา → คืน ISO เวลาเดิม
  assert.equal(rules.addBusinessDays(DUE('2026-12-04'), 1, H), DUE('2026-12-08'));
  assert.equal(rules.nextBusinessDay('2026-12-04', H), '2026-12-08');
  assert.equal(rules.nextBusinessDay('2026-12-30', H), '2027-01-04');
  assert.equal(rules.countBusinessDays('2026-12-01', '2026-12-04', H), 3);
  assert.equal(rules.countBusinessDays('2026-12-04', '2026-12-08', H), 1);
  assert.equal(rules.countBusinessDays('2026-12-04', '2026-12-04', H), 0);
  assert.equal(rules.countBusinessDays('2026-12-08', '2026-12-04', H), 0);
  assert.throws(() => rules.addBusinessDays('2026-12-01', -1, H), TypeError);
  assert.throws(() => rules.addBusinessDays('2026-12-01', 1.5, H), TypeError);
});

// ───────────────────────── BR-12 · D0 + กำหนดเสร็จ ─────────────────────────

test('BR-12 D0: ก่อน 16:30:00 ของวันทำการ = วันนั้น · ตั้งแต่ 16:30:00 / วันหยุด = วันทำการถัดไป', () => {
  assert.equal(rules.computeD0(T('2026-12-01T09:00:00'), H), '2026-12-01');
  assert.equal(rules.computeD0(T('2026-12-01T16:29:00'), H), '2026-12-01');
  assert.equal(rules.computeD0(T('2026-12-01T16:29:59'), H), '2026-12-01');
  assert.equal(rules.computeD0(T('2026-12-01T16:30:00'), H), '2026-12-02');
  assert.equal(rules.computeD0(T('2026-12-01T00:00:00'), H), '2026-12-01');
  assert.equal(rules.computeD0(T('2026-12-01T23:59:59'), H), '2026-12-02');
  assert.equal(rules.computeD0(T('2026-12-04T10:00:00'), H), '2026-12-04');
  assert.equal(rules.computeD0(T('2026-12-04T16:30:00'), H), '2026-12-08'); // ข้าม ส-อา + จ.7
  assert.equal(rules.computeD0(T('2026-12-05T10:00:00'), H), '2026-12-08');
  assert.equal(rules.computeD0(T('2026-12-07T09:00:00'), H), '2026-12-08'); // วันหยุดในตาราง
  assert.equal(rules.computeD0(T('2026-12-31T23:59:00'), H), '2027-01-04');
  // Date ที่เป็น UTC ก็คิดเป็นเวลาไทย (09:29:59Z = 16:29:59 ไทย)
  assert.equal(rules.computeD0(new Date('2026-12-01T09:29:59Z'), H), '2026-12-01');
  assert.equal(rules.computeD0(new Date('2026-12-01T09:30:00Z'), H), '2026-12-02');
});

test('BR-12 ตัวอย่างใน REQUIREMENTS + DECISIONS §8 (ขอบวินาที 16:29:59 / 16:30:00)', () => {
  const rows = [
    ['2026-12-01T16:29:00', 3, '2026-12-04'],
    ['2026-12-01T16:29:59', 3, '2026-12-04'],
    ['2026-12-01T16:30:00', 3, '2026-12-08'],
    ['2026-12-01T16:30:01', 3, '2026-12-08'],
    ['2026-12-04T10:00:00', 3, '2026-12-11'],
    ['2026-12-05T10:00:00', 3, '2026-12-14'],
    ['2026-12-01T09:00:00', 10, '2026-12-17'],
    ['2026-12-01T09:00:00', 15, '2026-12-24'],
    ['2026-12-31T23:59:00', 3, '2027-01-07'],
  ];
  for (const [paid, n, due] of rows) assert.equal(rules.computeDueAt(T(paid), n, H), DUE(due), `${paid} SLA ${n}`);
});

const SLA01 = [
  // แถว · บริการ (SLA) · ชำระเมื่อ · D0 · dueAt — TEST-PLAN TC-SLA-01
  ['a', 3, '2026-12-01T09:00:00', '2026-12-01', '2026-12-04'],
  ['b', 3, '2026-12-01T16:29:00', '2026-12-01', '2026-12-04'],
  ['c', 3, '2026-12-01T16:30:00', '2026-12-02', '2026-12-08'],
  ['d', 3, '2026-12-04T10:00:00', '2026-12-04', '2026-12-11'],
  ['e', 3, '2026-12-05T10:00:00', '2026-12-08', '2026-12-14'],
  ['f', 10, '2026-12-01T09:00:00', '2026-12-01', '2026-12-17'],
  ['g', 15, '2026-12-01T09:00:00', '2026-12-01', '2026-12-24'],
  ['h', 3, '2026-12-29T10:00:00', '2026-12-29', '2027-01-05'],
  ['i', 3, '2026-12-31T23:59:00', '2027-01-04', '2027-01-07'],
];

test('TC-SLA-01 ตารางกำหนดเสร็จ a–i (D0 และ dueAt)', () => {
  for (const [row, n, paid, d0, due] of SLA01) {
    assert.equal(rules.computeD0(T(paid), H), d0, `แถว ${row} D0`);
    assert.equal(rules.computeDueAt(T(paid), n, H), DUE(due), `แถว ${row} dueAt`);
  }
});

test('computeDueAt รับ SLA เป็นแถวบริการ/รหัสบริการ (+ แหล่งข้อมูล) และ SLA ที่ผู้ดูแลแก้', () => {
  const services = { 'SV-01': { id: 'SV-01', sla: 3 }, 'SV-02': { id: 'SV-02', sla: 10 }, 'SV-03': { id: 'SV-03', sla: 15 } };
  const src = { holidays: H, services };
  assert.equal(rules.computeDueAt(T('2026-12-01T09:00:00'), 'SV-01', src), DUE('2026-12-04'));
  assert.equal(rules.computeDueAt(T('2026-12-01T09:00:00'), 'SV-02', src), DUE('2026-12-17'));
  assert.equal(rules.computeDueAt(T('2026-12-01T09:00:00'), 'SV-03', src), DUE('2026-12-24'));
  assert.equal(rules.computeDueAt(T('2026-12-01T09:00:00'), { id: 'SV-02', sla: 10 }, H), DUE('2026-12-17'));
  assert.equal(rules.computeDueAt(T('2026-12-01T09:00:00'), { id: 'SV-01', fee_type: 'per_copy', sla: 5 }, H), DUE('2026-12-09'));
  assert.equal(rules.computeDueAt(T('2026-12-01T09:00:00'), '3', H), DUE('2026-12-04'));
  assert.throws(() => rules.computeDueAt(T('2026-12-01T09:00:00'), 'SV-01', H), TypeError); // รหัสบริการแต่ไม่มีแหล่งบริการ
});

test('TC-RBAC-04 ข้อ 6–7: วันหยุดใหม่ 2026-12-02 มีผลกับการคำนวณใหม่ (ค่าเดิมไม่คำนวณซ้ำ = หน้าที่ผู้เรียก)', () => {
  assert.equal(rules.computeDueAt(T('2026-12-01T09:00:00'), 3, H), DUE('2026-12-04'));
  assert.equal(rules.computeDueAt(T('2026-12-01T09:00:00'), 3, [...H, '2026-12-02']), DUE('2026-12-08'));
});

test('TEST-DATA §4.1: dueAt ของ seed ทุกใบที่ไม่เคยถูกตีกลับ = computeDueAt(เวลาชำระ, SLA)', () => {
  const SLA = { 'SV-01': 3, 'SV-02': 10, 'SV-03': 15 };
  const seed = [
    [1, 'SV-01', '2026-10-14 10:00', '2026-10-19'], [2, 'SV-03', '2026-11-02 09:00', '2026-11-23'],
    [3, 'SV-01', '2026-11-02 09:30', '2026-11-05'], [4, 'SV-02', '2026-11-02 14:00', '2026-11-16'],
    [5, 'SV-01', '2026-11-03 11:00', '2026-11-06'], [6, 'SV-02', '2026-11-03 15:00', '2026-11-17'],
    [7, 'SV-02', '2026-11-04 10:00', '2026-11-18'], [8, 'SV-01', '2026-11-09 10:00', '2026-11-12'],
    [9, 'SV-01', '2026-11-09 14:30', '2026-11-12'], [10, 'SV-03', '2026-11-12 10:00', '2026-12-03'],
    [11, 'SV-03', '2026-11-16 10:00', '2026-12-08'], [12, 'SV-03', '2026-11-18 10:00', '2026-12-11'],
    [13, 'SV-02', '2026-11-20 10:00', '2026-12-04'], [14, 'SV-02', '2026-11-20 11:00', '2026-12-04'],
    [15, 'SV-02', '2026-11-20 15:00', '2026-12-04'], [16, 'SV-02', '2026-11-23 09:00', '2026-12-08'],
    [18, 'SV-02', '2026-11-24 10:00', '2026-12-09'], [19, 'SV-02', '2026-11-24 14:00', '2026-12-09'],
    [20, 'SV-01', '2026-11-25 10:00', '2026-11-30'], [21, 'SV-02', '2026-11-25 12:00', '2026-12-11'],
    [22, 'SV-01', '2026-11-26 10:00', '2026-12-01'], [24, 'SV-01', '2026-11-27 11:00', '2026-12-02'],
    [25, 'SV-01', '2026-11-30 10:00', '2026-12-03'], [26, 'SV-01', '2026-11-30 16:29', '2026-12-03'],
    [27, 'SV-01', '2026-11-30 16:30', '2026-12-04'], [28, 'SV-01', '2026-12-01 08:10', '2026-12-04'],
    [29, 'SV-01', '2026-12-01 08:20', '2026-12-04'], [30, 'SV-01', '2026-12-01 08:30', '2026-12-04'],
  ];
  for (const [no, svc, paid, due] of seed) {
    assert.equal(rules.computeDueAt(paid, SLA[svc], H), DUE(due), `EG-2569-${String(no).padStart(6, '0')}`);
  }
});

// ───────────────────────── BR-13 · หยุดนับระหว่าง NEED_FIX ─────────────────────────

test('BR-13 ตัวอย่าง: ตีกลับ พ.2 11:00 ส่งแก้ พฤ.3 10:00 → หยุด 1 วัน → อ.8 ธ.ค. 16:30', () => {
  const due = rules.computeDueAt(T('2026-12-01T09:00:00'), 3, H);
  assert.equal(due, DUE('2026-12-04'));
  assert.equal(rules.pausedBusinessDays(T('2026-12-02T11:00:00'), T('2026-12-03T10:00:00'), H), 1);
  assert.equal(rules.extendDueForFix(due, T('2026-12-02T11:00:00'), T('2026-12-03T10:00:00'), H), DUE('2026-12-08'));
  assert.deepEqual(rules.fixExtension(due, T('2026-12-02T11:00:00'), T('2026-12-03T10:00:00'), H), { dueAt: DUE('2026-12-08'), pausedDays: 1 });
});

test('BR-13 ตีกลับและส่งแก้วันเดียวกัน → หยุด 0 วัน (TC-SLA-02 ส่วน 4)', () => {
  assert.equal(rules.pausedBusinessDays(T('2026-12-02T09:00:00'), T('2026-12-02T15:00:00'), H), 0);
  assert.equal(rules.extendDueForFix(DUE('2026-12-04'), T('2026-12-02T09:00:00'), T('2026-12-02T15:00:00'), H), DUE('2026-12-04'));
});

test('BR-13 ตีกลับ ศ.4 ส่งแก้ อ.8 17:00 → หยุด 1 วัน (อ.8) → อ.8 16:30 และเกินกำหนดทันที (TC-SLA-02 ส่วน 5)', () => {
  const ret = T('2026-12-04T10:00:00');
  const resub = T('2026-12-08T17:00:00');
  assert.equal(rules.pausedBusinessDays(ret, resub, H), 1);
  const newDue = rules.extendDueForFix(DUE('2026-12-04'), ret, resub, H);
  assert.equal(newDue, DUE('2026-12-08'));
  assert.equal(rules.fixDeadline(ret), T('2026-12-11T10:00:00'));
  assert.equal(rules.isFixWindowOpen(rules.fixDeadline(ret), resub), true);
  assert.equal(rules.slaLevel({ status: 'IN_REVIEW', dueAt: newDue }, { holidays: H, now: resub }), 'overdue');
});

test('BR-13 นับตามวันที่ไม่ขึ้นกับเวลา (ส่งแก้ 00:00:01 วันถัดไปนับ 1 · ตีกลับ 23:59 นับจากวันถัดไป)', () => {
  assert.equal(rules.pausedBusinessDays(T('2026-12-02T23:59:00'), T('2026-12-03T00:00:01'), H), 1);
  assert.equal(rules.pausedBusinessDays(T('2026-12-03T00:00:00'), T('2026-12-03T23:59:59'), H), 0);
});

test('TEST-DATA §4.4: F01/F02 กำหนดเสร็จที่เก็บ = ชำระ + SLA + หยุดนับทุกครั้ง · TC-SLA-02 ส่วน 2 และ 3', () => {
  // F01 …000017: ชำระ 23 พ.ย. 10:00 → 26 พ.ย. · ตีกลับ 24 พ.ย. 11:00 ส่งแก้ 25 พ.ย. 10:00 (หยุด 1) → 27 พ.ย.
  let f01 = rules.computeDueAt('2026-11-23 10:00', 3, H);
  assert.equal(f01, DUE('2026-11-26'));
  assert.equal(rules.pausedBusinessDays('2026-11-24 11:00', '2026-11-25 10:00', H), 1);
  f01 = rules.extendDueForFix(f01, '2026-11-24 11:00', '2026-11-25 10:00', H);
  assert.equal(f01, DUE('2026-11-27'));
  // F02 …000023: ชำระ 26 พ.ย. 10:30 → 1 ธ.ค. → (27 พ.ย. 10:00, 30 พ.ย. 10:00] +1 → 2 ธ.ค. → (30 พ.ย. 14:00, 1 ธ.ค. 08:30] +1 → 3 ธ.ค.
  let f02 = rules.computeDueAt('2026-11-26 10:30', 3, H);
  assert.equal(f02, DUE('2026-12-01'));
  assert.equal(rules.pausedBusinessDays('2026-11-27 10:00', '2026-11-30 10:00', H), 1);
  f02 = rules.extendDueForFix(f02, '2026-11-27 10:00', '2026-11-30 10:00', H);
  assert.equal(f02, DUE('2026-12-02'));
  assert.equal(rules.pausedBusinessDays('2026-11-30 14:00', '2026-12-01 08:30', H), 1);
  f02 = rules.extendDueForFix(f02, '2026-11-30 14:00', '2026-12-01 08:30', H);
  assert.equal(f02, DUE('2026-12-03'));
  // TC-SLA-02 ส่วน 2: F01 (ตีกลับครั้งที่ 2 = 27 พ.ย. 14:00) ส่งแก้ 1 ธ.ค. 09:00 → หยุด 2 (30 พ.ย., 1 ธ.ค.) → 1 ธ.ค. 16:30 · ใกล้ (เหลือ 0)
  const ret2 = T('2026-11-27T14:00:00');
  const at1 = T('2026-12-01T09:00:00');
  assert.equal(rules.pausedBusinessDays(ret2, at1, H), 2);
  const d1 = rules.extendDueForFix(DUE('2026-11-27'), ret2, at1, H);
  assert.equal(d1, DUE('2026-12-01'));
  assert.equal(rules.remainingBusinessDays(d1, at1, H), 0);
  assert.equal(rules.slaLevel({ status: 'IN_REVIEW', due_at: d1 }, { holidays: H, now: at1 }), 'near');
  // ส่วน 3: ส่งแก้ 4 ธ.ค. 10:00 → หยุด 5 (30 พ.ย., 1, 2, 3, 4 ธ.ค.) → 4 ธ.ค. 16:30 · ใกล้
  const at4 = T('2026-12-04T10:00:00');
  assert.equal(rules.pausedBusinessDays(ret2, at4, H), 5);
  const d4 = rules.extendDueForFix(DUE('2026-11-27'), ret2, at4, H);
  assert.equal(d4, DUE('2026-12-04'));
  assert.equal(rules.slaLevel({ status: 'IN_REVIEW', due_at: d4 }, { holidays: H, now: at4 }), 'near');
});

test('TC-SLA-02 ส่วน 1: ตีกลับ 2 ธ.ค. 11:00 → เส้นตายแก้ 9 ธ.ค. 11:00 · หยุดนับ · ส่งแก้ 3 ธ.ค. 10:00 → 8 ธ.ค. ปกติ (เหลือ 2)', () => {
  const ret = T('2026-12-02T11:00:00');
  const resub = T('2026-12-03T10:00:00');
  assert.equal(rules.fixDeadline(ret), T('2026-12-09T11:00:00'));
  assert.equal(rules.slaLevel({ status: 'NEED_FIX', dueAt: DUE('2026-12-04') }, { holidays: H, now: ret }), 'paused');
  const newDue = rules.extendDueForFix(DUE('2026-12-04'), ret, resub, H);
  assert.equal(newDue, DUE('2026-12-08'));
  assert.equal(rules.remainingBusinessDays(newDue, resub, H), 2);
  assert.equal(rules.slaLevel({ status: 'IN_REVIEW', dueAt: newDue }, { holidays: H, now: resub }), 'normal');
});

test('BR-13 ใช้ตารางวันหยุด ณ เวลาที่ส่งแก้ (A-42)', () => {
  // เพิ่มวันหยุด 3 ธ.ค. ก่อนส่งแก้ → (2 ธ.ค., 3 ธ.ค.] ไม่มีวันทำการ → ไม่เลื่อน
  const h2 = [...H, '2026-12-03'];
  assert.equal(rules.extendDueForFix(DUE('2026-12-04'), T('2026-12-02T11:00:00'), T('2026-12-03T10:00:00'), h2), DUE('2026-12-04'));
  // เพิ่มวันหยุด 8 ธ.ค. → ศ.4 + 1 = พ.9
  const h3 = [...H, '2026-12-08'];
  assert.equal(rules.extendDueForFix(DUE('2026-12-04'), T('2026-12-02T11:00:00'), T('2026-12-03T10:00:00'), h3), DUE('2026-12-09'));
});

// ───────────────────────── BR-14 · ระดับเตือน ─────────────────────────

test('BR-14 กำหนด ศ.4 ธ.ค. 16:30: อ.1 ปกติ(3) · พ.2 ปกติ(2) · พฤ.3 ใกล้(1) · ศ.4 16:30:00 ใกล้(0) · 16:30:01 / 16:31 / ส.5 เกิน', () => {
  const due = DUE('2026-12-04');
  const row = { status: 'IN_REVIEW', dueAt: due };
  const table = [
    ['2026-12-01T09:00:00', 3, 'normal'],
    ['2026-12-02T09:00:00', 2, 'normal'],
    ['2026-12-03T09:00:00', 1, 'near'],
    ['2026-12-04T09:00:00', 0, 'near'],
    ['2026-12-04T16:30:00', 0, 'near'],
    ['2026-12-04T16:30:01', null, 'overdue'],
    ['2026-12-04T16:31:00', null, 'overdue'],
    ['2026-12-05T10:00:00', null, 'overdue'],
  ];
  for (const [now, rem, level] of table) {
    assert.equal(rules.slaLevel(row, { holidays: H, now: T(now) }), level, now);
    assert.equal(rules.slaLevel('IN_REVIEW', due, T(now), H), level, `${now} (แบบพารามิเตอร์)`);
    const info = rules.slaInfo(row, { holidays: H, now: T(now) });
    assert.equal(info.level, level);
    assert.equal(info.remainingDays, rem, `${now} remainingDays`);
    assert.equal(info.dueAt, due);
    if (rem !== null) assert.equal(rules.remainingBusinessDays(due, T(now), H), rem);
  }
  assert.equal(rules.slaInfo(row, { holidays: H, now: T('2026-12-03T09:00:00') }).levelText, 'ใกล้ครบกำหนด');
});

test('BR-14 กำหนด อ.8 ธ.ค. (คั่น ส-อา + จ.7 หยุด): พฤ.3 ปกติ(2) · ศ.4 ใกล้(1) · อ.8 16:30:00 ใกล้ · 16:31 เกิน (TC-SLA-03 ส่วน B)', () => {
  const row = { status: 'IN_REVIEW', due_at: DUE('2026-12-08') }; // …000016
  assert.equal(rules.remainingBusinessDays(DUE('2026-12-08'), T('2026-12-03T09:00:00'), H), 2);
  assert.equal(rules.slaLevel(row, { holidays: H, now: T('2026-12-03T09:00:00') }), 'normal');
  assert.equal(rules.remainingBusinessDays(DUE('2026-12-08'), T('2026-12-04T09:00:00'), H), 1);
  assert.equal(rules.slaLevel(row, { holidays: H, now: T('2026-12-04T09:00:00') }), 'near');
  assert.equal(rules.slaLevel(row, { holidays: H, now: T('2026-12-05T09:00:00') }), 'near'); // ส. → เหลือ อ.8 = 1
  assert.equal(rules.slaLevel(row, { holidays: H, now: T('2026-12-08T16:30:00') }), 'near');
  assert.equal(rules.slaLevel(row, { holidays: H, now: T('2026-12-08T16:31:00') }), 'overdue');
});

test('BR-14 ไม่คำนวณเมื่อปิดแล้ว (closed) หรือ NEED_FIX (paused) · ไม่มี dueAt → null', () => {
  const opts = { holidays: H, now: T('2026-12-01T09:00:00') };
  for (const status of ['COMPLETED', 'REJECTED', 'CANCELLED']) {
    assert.equal(rules.slaLevel({ status, dueAt: DUE('2026-11-12') }, opts), 'closed', status);
    const info = rules.slaInfo({ status, dueAt: DUE('2026-11-12') }, opts);
    assert.equal(info.remainingDays, null);
    assert.equal(info.levelText, 'ปิดแล้ว');
  }
  assert.equal(rules.slaLevel({ status: 'NEED_FIX', dueAt: DUE('2026-11-27') }, opts), 'paused'); // ไม่ใช่ overdue แม้เลยกำหนด
  assert.equal(rules.slaInfo({ status: 'NEED_FIX', dueAt: DUE('2026-11-27') }, opts).levelText, 'หยุดนับ');
  assert.equal(rules.slaLevel({ status: 'DRAFT' }, opts), null);
  for (const status of ['SUBMITTED', 'IN_REVIEW', 'PENDING_APPROVAL', 'APPROVED']) {
    assert.equal(rules.slaLevel({ status, dueAt: DUE('2026-11-30') }, opts), 'overdue', status);
  }
});

test('TEST-DATA §4.1 คอลัมน์ "ระดับ ณ 1 ธ.ค. 09:00" ครบ 30 ใบ + TC-SLA-03 ส่วน C', () => {
  const seed = [
    [1, 'COMPLETED', '2026-10-19', 'closed'], [2, 'COMPLETED', '2026-11-23', 'closed'],
    [3, 'COMPLETED', '2026-11-05', 'closed'], [4, 'COMPLETED', '2026-11-16', 'closed'],
    [5, 'COMPLETED', '2026-11-06', 'closed'], [6, 'COMPLETED', '2026-11-17', 'closed'],
    [7, 'COMPLETED', '2026-11-18', 'closed'], [8, 'REJECTED', '2026-11-12', 'closed'],
    [9, 'CANCELLED', '2026-11-12', 'closed'], [10, 'IN_REVIEW', '2026-12-03', 'normal'],
    [11, 'PENDING_APPROVAL', '2026-12-08', 'normal'], [12, 'IN_REVIEW', '2026-12-11', 'normal'],
    [13, 'IN_REVIEW', '2026-12-04', 'normal'], [14, 'PENDING_APPROVAL', '2026-12-04', 'normal'],
    [15, 'IN_REVIEW', '2026-12-04', 'normal'], [16, 'IN_REVIEW', '2026-12-08', 'normal'],
    [17, 'NEED_FIX', '2026-11-27', 'paused'], [18, 'IN_REVIEW', '2026-12-09', 'normal'],
    [19, 'APPROVED', '2026-12-09', 'normal'], [20, 'IN_REVIEW', '2026-11-30', 'overdue'],
    [21, 'IN_REVIEW', '2026-12-11', 'normal'], [22, 'IN_REVIEW', '2026-12-01', 'near'],
    [23, 'IN_REVIEW', '2026-12-03', 'normal'], [24, 'SUBMITTED', '2026-12-02', 'near'],
    [25, 'IN_REVIEW', '2026-12-03', 'normal'], [26, 'IN_REVIEW', '2026-12-03', 'normal'],
    [27, 'IN_REVIEW', '2026-12-04', 'normal'], [28, 'SUBMITTED', '2026-12-04', 'normal'],
    [29, 'SUBMITTED', '2026-12-04', 'normal'], [30, 'SUBMITTED', '2026-12-04', 'normal'],
  ];
  const opts = { holidays: H, now: T('2026-12-01T09:00:00') };
  for (const [no, status, due, level] of seed) {
    assert.equal(rules.slaLevel({ status, due_at: DUE(due) }, opts), level, `EG-2569-${String(no).padStart(6, '0')}`);
  }
  // remainingDays ของส่วน C: …022 = 0 · …024 = 1 · …025 = 2
  assert.equal(rules.remainingBusinessDays(DUE('2026-12-01'), opts.now, H), 0);
  assert.equal(rules.remainingBusinessDays(DUE('2026-12-02'), opts.now, H), 1);
  assert.equal(rules.remainingBusinessDays(DUE('2026-12-03'), opts.now, H), 2);
  // …000022 ที่ 16:30:00 ใกล้ · 16:31 เกิน
  const n02 = { status: 'IN_REVIEW', due_at: DUE('2026-12-01') };
  assert.equal(rules.slaLevel(n02, { holidays: H, now: T('2026-12-01T16:30:00') }), 'near');
  assert.equal(rules.slaLevel(n02, { holidays: H, now: T('2026-12-01T16:31:00') }), 'overdue');
});

test('ไม่ส่ง now → ใช้นาฬิกากลาง (core/clock) · ตัดมิลลิวินาที', () => {
  clock.set(T('2026-12-04T16:30:00'));
  const row = { status: 'IN_REVIEW', dueAt: DUE('2026-12-04') };
  assert.equal(rules.slaLevel(row, H), 'near');
  assert.equal(rules.slaLevel(row, { holidays: H }), 'near');
  clock.set(new Date(Date.parse('2026-12-04T09:30:00.900Z'))); // 16:30:00.900 ไทย → ตัดเป็น 16:30:00
  assert.equal(rules.slaLevel(row, H), 'near');
  clock.set(T('2026-12-04T16:30:01'));
  assert.equal(rules.slaLevel(row, H), 'overdue');
  clock.set(T('2026-12-02T09:00:00'));
  assert.equal(rules.remainingBusinessDays(DUE('2026-12-04'), null, H), 2);
  assert.equal(rules.slaInfo(row, H).remainingDays, 2);
});

// ───────────────────────── BR-20 · 168 ชม. ─────────────────────────

test('BR-20 ตีกลับ 27 พ.ย. 14:00 → เส้นตาย 4 ธ.ค. 14:00 · 13:59 ส่งแก้ได้ · 14:00 หมดเวลา', () => {
  const dl = rules.fixDeadline(T('2026-11-27T14:00:00'));
  assert.equal(dl, T('2026-12-04T14:00:00')); // = fix_deadline ของ F01 ใน seed
  assert.equal(rules.isFixWindowOpen(dl, T('2026-12-04T13:59:00')), true);
  assert.equal(rules.isFixWindowOpen(dl, T('2026-12-04T13:59:59')), true);
  assert.equal(rules.isFixWindowOpen(dl, T('2026-12-04T14:00:00')), false);
  assert.equal(rules.isFixWindowExpired(dl, T('2026-12-04T14:00:00')), true);
  assert.equal(rules.isFixWindowExpired(dl, T('2026-12-04T13:59:59')), false);
  assert.equal(rules.isFixWindowExpired(dl, T('2026-12-05T10:00:00')), true);
  // 168 ชม. ปฏิทิน (ไม่สนวันหยุด) · ข้ามปี
  assert.equal(rules.fixDeadline(T('2026-12-29T16:45:30')), T('2027-01-05T16:45:30'));
  assert.equal(rules.fixDeadline('2026-12-02 11:00'), T('2026-12-09T11:00:00'));
  clock.set(T('2026-12-04T13:59:59'));
  assert.equal(rules.isFixWindowOpen(dl), true);
  clock.set(T('2026-12-04T14:00:00'));
  assert.equal(rules.isFixWindowOpen(dl), false);
});

// ───────────────────────── DECISIONS §18 · ทันกำหนด ─────────────────────────

test('ทันกำหนด ⇔ closed_at ≤ dueAt: 16:29 ทัน · 16:30:00 ทัน · 16:30:01 / 16:31 ไม่ทัน · seed H08 ไม่ทัน', () => {
  const due = DUE('2026-11-18');
  assert.equal(rules.isOnTime(T('2026-11-18T16:29:00'), due), true);
  assert.equal(rules.isOnTime(T('2026-11-18T16:30:00'), due), true);
  assert.equal(rules.isOnTime(T('2026-11-18T16:30:01'), due), false);
  assert.equal(rules.isOnTime(T('2026-11-18T16:31:00'), due), false);
  assert.equal(rules.isOnTime('2026-11-19 10:00', DUE('2026-11-17')), false); // H08 …000006
  assert.equal(rules.isOnTime('2026-11-18 16:00', DUE('2026-11-18')), true); // H07 …000007
  assert.equal(rules.isOnTime(null, due), false);
});

// ───────────────────────── BUG_MODE B03 B04 ─────────────────────────

test('B03: ข้ามแค่เสาร์-อาทิตย์ ไม่ข้ามวันหยุดในตาราง → ค่าตาม BUGS.md', () => {
  withBugs(['B03'], () => {
    const due = (paid, n = 3) => rules.computeDueAt(T(paid), n, H);
    assert.equal(due('2026-12-01T16:30:00'), DUE('2026-12-07')); // แทน 8 ธ.ค. (TC-SLA-01 แถว c)
    assert.equal(due('2026-12-04T10:00:00'), DUE('2026-12-09')); // แทน 11 ธ.ค.
    assert.equal(due('2026-12-05T10:00:00'), DUE('2026-12-10')); // แทน 14 ธ.ค.
    assert.equal(due('2026-12-29T10:00:00'), DUE('2027-01-01')); // แทน 5 ม.ค. 70
    assert.equal(due('2026-12-31T23:59:00'), DUE('2027-01-06')); // แทน 7 ม.ค. 70
    // แถวที่ไม่คร่อมวันหยุดยังถูก
    assert.equal(due('2026-12-01T09:00:00'), DUE('2026-12-04'));
    assert.equal(due('2026-12-01T16:29:00'), DUE('2026-12-04'));
    // หยุดนับ (DECISIONS §8 แถว 6) ได้ 7 ธ.ค. แทน 8 ธ.ค.
    assert.equal(rules.extendDueForFix(DUE('2026-12-04'), T('2026-12-02T11:00:00'), T('2026-12-03T10:00:00'), H), DUE('2026-12-07'));
    // วันคงเหลือ (TC-SLA-03 ส่วน B อาจล้มด้วย): ศ.4 09:00 กำหนด 8 ธ.ค. → 2 = ปกติ แทน ใกล้
    assert.equal(rules.remainingBusinessDays(DUE('2026-12-08'), T('2026-12-04T09:00:00'), H), 2);
    assert.equal(rules.slaLevel({ status: 'IN_REVIEW', dueAt: DUE('2026-12-08') }, { holidays: H, now: T('2026-12-04T09:00:00') }), 'normal');
    // วันหยุดที่เพิ่มใหม่ก็ไม่ถูกนับ (TC-RBAC-04 อาจล้มด้วย)
    assert.equal(rules.computeDueAt(T('2026-12-01T09:00:00'), 3, [...H, '2026-12-02']), DUE('2026-12-04'));
    // เสาร์-อาทิตย์ยังข้าม
    assert.equal(rules.isBusinessDay('2026-12-05', H), false);
    assert.equal(rules.isBusinessDay('2026-12-07', H), true);
  });
  // ปิดบั๊ก → กลับมาถูก
  assert.equal(rules.computeDueAt(T('2026-12-01T16:30:00'), 3, H), DUE('2026-12-08'));
});

test('B04: extendDueForFix คืนกำหนดเดิม ไม่หยุดนับ → ค่าตาม BUGS.md', () => {
  withBugs(['B04'], () => {
    assert.equal(rules.extendDueForFix(DUE('2026-12-04'), T('2026-12-02T11:00:00'), T('2026-12-03T10:00:00'), H), DUE('2026-12-04'));
    // seed …000017 ส่งแก้ 1 ธ.ค. 09:00 → ยัง 27 พ.ย. 16:30 และเกินกำหนด
    const d = rules.extendDueForFix(DUE('2026-11-27'), T('2026-11-27T14:00:00'), T('2026-12-01T09:00:00'), H);
    assert.equal(d, DUE('2026-11-27'));
    assert.equal(rules.slaLevel({ status: 'IN_REVIEW', dueAt: d }, { holidays: H, now: T('2026-12-01T09:00:00') }), 'overdue');
    // จำนวนวันที่หยุดจริงยังนับได้ (ใช้บันทึก returns.paused_days) · กำหนดเสร็จตอนชำระไม่เปลี่ยน
    assert.equal(rules.pausedBusinessDays(T('2026-11-27T14:00:00'), T('2026-12-01T09:00:00'), H), 2);
    assert.deepEqual(rules.fixExtension(DUE('2026-12-04'), T('2026-12-02T11:00:00'), T('2026-12-03T10:00:00'), H), { dueAt: DUE('2026-12-04'), pausedDays: 1 });
    assert.equal(rules.computeDueAt(T('2026-12-01T16:30:00'), 3, H), DUE('2026-12-08'));
  });
  assert.equal(rules.extendDueForFix(DUE('2026-11-27'), T('2026-11-27T14:00:00'), T('2026-12-01T09:00:00'), H), DUE('2026-12-01'));
});

test('B01 ไม่กระทบ SLA · B03+B04 รวมกันได้ (union)', () => {
  withBugs(['B01'], () => {
    assert.equal(rules.computeDueAt(T('2026-12-01T16:30:00'), 3, H), DUE('2026-12-08'));
    assert.equal(rules.extendDueForFix(DUE('2026-12-04'), T('2026-12-02T11:00:00'), T('2026-12-03T10:00:00'), H), DUE('2026-12-08'));
  });
  withBugs(['B03', 'B04'], () => {
    assert.equal(rules.computeDueAt(T('2026-12-01T16:30:00'), 3, H), DUE('2026-12-07'));
    assert.equal(rules.extendDueForFix(DUE('2026-12-04'), T('2026-12-02T11:00:00'), T('2026-12-03T10:00:00'), H), DUE('2026-12-04'));
  });
});

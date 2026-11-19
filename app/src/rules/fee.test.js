'use strict';
// P03 · ค่าธรรมเนียม: ทุกตัวอย่าง/ค่าขอบใน REQUIREMENTS BR-04 BR-05 · DECISIONS §3 · TEST-PLAN TC-FEE-01 · TC-RBAC-04 · BUGS B01
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('.');
const { bugs } = require('../core/bugs');
const { AppError } = require('../core/errors');

// แถวตาม TEST-DATA §2 (รูปแบบ ctx.catalog.service และแบบแถว DB)
const SV01 = { id: 'SV-01', feeType: 'per_copy', fee: 20, feePerSqm: null, sla: 3 };
const SV02 = { id: 'SV-02', feeType: 'fixed', fee: 500, feePerSqm: null, sla: 10 };
const SV03 = { id: 'SV-03', feeType: 'area', fee: 1000, feePerSqm: 10, sla: 15 };
const SV03_ROW = { id: 'SV-03', fee_type: 'area', fee: 1000, fee_per_sqm: 10, sla: 15 };

const MSG = {
  INVALID_QTY: 'จำนวนฉบับต้อง 1–5 ฉบับ',
  INVALID_AREA: 'กรุณาระบุพื้นที่ 1–500 ตร.ม.',
  AREA_TOO_LARGE: 'พื้นที่เกิน 500 ตร.ม. กรุณายื่นที่สำนักงาน',
};

function withBugs(list, fn) {
  bugs.set(list);
  try {
    return fn();
  } finally {
    bugs.set('');
  }
}

function assertFee(svc, input, expected) {
  const r = rules.computeFee(svc, input);
  assert.equal(r.ok, true, `${svc.id} ${JSON.stringify(input)} ควรผ่าน แต่ได้ ${r.code}`);
  assert.equal(r.fee, expected, `${svc.id} ${JSON.stringify(input)}`);
}

function assertErr(svc, input, code) {
  const r = rules.computeFee(svc, input);
  assert.equal(r.ok, false, `${svc.id} ${JSON.stringify(input)} ควรไม่ผ่าน`);
  assert.equal(r.fee, null);
  assert.equal(r.code, code);
  assert.equal(r.message, MSG[code]);
  assert.equal(r.status, 400);
}

bugs.set(''); // เริ่มจากเว็บถูกต้อง 100% แม้รันด้วย BUG_MODE ใน env

test.afterEach(() => bugs.set(''));

test('BR-04 SV-01 ฿20 ต่อฉบับ: 0 ✗ · 1 → ฿20 · 5 → ฿100 · 6 ✗ ข้อความเดียวกัน', () => {
  assertErr(SV01, { qty: 0 }, 'INVALID_QTY');
  assertFee(SV01, { qty: 1 }, 20);
  assertFee(SV01, { qty: 2 }, 40); // DR-0001 / …000003 / …000022
  assertFee(SV01, { qty: 3 }, 60); // …000025
  assertFee(SV01, { qty: 4 }, 80);
  assertFee(SV01, { qty: 5 }, 100); // …000026
  assertErr(SV01, { qty: 6 }, 'INVALID_QTY');
});

test('BR-04 SV-01 ค่าที่ไม่ใช่จำนวนเต็ม 1–5 → INVALID_QTY · สตริงตัวเลขรับได้ · ไม่ส่ง qty = 1 (A-56)', () => {
  for (const qty of [-1, 2.5, '', ' ', 'abc', '1.5', '1e1', NaN, Infinity, true, {}, [2]]) {
    assertErr(SV01, { qty }, 'INVALID_QTY');
  }
  assertFee(SV01, { qty: '3' }, 60);
  assertFee(SV01, { qty: ' 5 ' }, 100);
  assertErr(SV01, { qty: '6' }, 'INVALID_QTY');
  assertFee(SV01, {}, 20);
  assertFee(SV01, { qty: null }, 20);
  assert.equal(rules.computeFee(SV01, { qty: 4 }).qty, 4);
  assert.equal(rules.computeFee(SV01).fee, 20);
});

test('BR-05 SV-02 ฿500 คงที่ (ไม่สน qty/พื้นที่)', () => {
  assertFee(SV02, {}, 500);
  assertFee(SV02, { qty: 9, areaSqm: 999 }, 500);
});

test('BR-05 SV-03 ตามพื้นที่: 0 ✗ · 1 → ฿1,000 · 100 → ฿1,000 · 101 → ฿1,010 · 500 → ฿5,000 · 501 ✗', () => {
  assertErr(SV03, { areaSqm: 0 }, 'INVALID_AREA');
  assertFee(SV03, { areaSqm: 1 }, 1000);
  assertFee(SV03, { areaSqm: 100 }, 1000);
  assertFee(SV03, { areaSqm: 101 }, 1010);
  assertFee(SV03, { areaSqm: 500 }, 5000);
  assertErr(SV03, { areaSqm: 501 }, 'AREA_TOO_LARGE');
});

test('TC-FEE-01 ตาราง SV-03 ครบทุกแถว (-1 0 1 100 101 102 250 300 499 500 501)', () => {
  const table = [
    [0, 'INVALID_AREA'], [-1, 'INVALID_AREA'],
    [1, 1000], [100, 1000], [101, 1010], [102, 1020], [250, 2500], [300, 3000], [499, 4990], [500, 5000],
    [501, 'AREA_TOO_LARGE'],
  ];
  for (const [area, want] of table) {
    if (typeof want === 'number') assertFee(SV03, { areaSqm: area }, want);
    else assertErr(SV03, { areaSqm: area }, want);
  }
});

test('SV-03 ค่าใน seed (TEST-DATA §4.1): 80 → ฿1,000 · 101 → ฿1,010 · 120 → ฿1,200 · 150 → ฿1,500', () => {
  assertFee(SV03, { areaSqm: 80 }, 1000);
  assertFee(SV03, { areaSqm: 101 }, 1010);
  assertFee(SV03, { areaSqm: 120 }, 1200);
  assertFee(SV03, { areaSqm: 150 }, 1500);
});

test('SV-03 ค่าที่กรอกผิดรูป → INVALID_AREA · มากเกิน → AREA_TOO_LARGE · ชื่อฟิลด์ area/area_sqm ใช้ได้ · สตริงตัวเลขได้', () => {
  for (const areaSqm of [undefined, null, '', ' ', 'abc', 100.5, '100.5', '1e2', NaN, -500, '-1']) {
    assertErr(SV03, { areaSqm }, 'INVALID_AREA');
  }
  assertErr(SV03, {}, 'INVALID_AREA');
  assertErr(SV03, { areaSqm: 99999 }, 'AREA_TOO_LARGE');
  assertErr(SV03, { areaSqm: '501' }, 'AREA_TOO_LARGE');
  assertFee(SV03, { areaSqm: '101' }, 1010);
  assertFee(SV03, { area: 250 }, 2500);
  assertFee(SV03, { area_sqm: 102 }, 1020);
  assert.equal(rules.computeFee(SV03, { areaSqm: '101' }).areaSqm, 101);
});

test('รับแถว DB (snake_case) และรหัสบริการ + แหล่งข้อมูล (catalog / db / {services})', () => {
  assertFee(SV03_ROW, { areaSqm: 101 }, 1010);
  const catalog = { service: (id) => ({ 'SV-01': SV01, 'SV-02': SV02, 'SV-03': SV03 })[id] };
  assert.equal(rules.computeFee('SV-03', { areaSqm: 101 }, catalog).fee, 1010);
  assert.equal(rules.computeFee('SV-01', { qty: 5 }, { catalog }).fee, 100);
  const fakeDb = { prepare: () => ({ get: (id) => (id === 'SV-03' ? SV03_ROW : undefined) }) };
  assert.equal(rules.computeFee('SV-03', { areaSqm: 500 }, fakeDb).fee, 5000);
  assert.equal(rules.computeFee('SV-03', { areaSqm: 500 }, { db: fakeDb }).fee, 5000);
  assert.equal(rules.computeFee('SV-02', {}, { services: { 'SV-02': SV02 } }).fee, 500);
  // ไม่พบบริการ → BAD_REQUEST (ไม่ throw)
  const r = rules.computeFee('SV-09', {}, catalog);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'BAD_REQUEST');
  // ส่งรหัสแต่ไม่ส่งแหล่งข้อมูล = ใช้ผิด → throw ให้เห็นทันที
  assert.throws(() => rules.computeFee('SV-01', { qty: 1 }), TypeError);
});

test('ค่าธรรมเนียมที่ผู้ดูแลแก้ (TC-RBAC-04): SV-01 ฿25 → 5 ฉบับ ฿125 · 1 ฉบับ ฿25 · SV-02 ฿600 · SV-03 ฐาน/ต่อ ตร.ม. ใหม่', () => {
  assertFee({ ...SV01, fee: 25 }, { qty: 5 }, 125);
  assertFee({ ...SV01, fee: 25 }, { qty: 1 }, 25);
  assertFee({ ...SV02, fee: 600 }, {}, 600);
  assertFee({ ...SV03, fee: 1200, feePerSqm: 20 }, { areaSqm: 101 }, 1220);
  assertFee({ ...SV03, fee: 1200, feePerSqm: 20 }, { areaSqm: 100 }, 1200);
  assertFee({ ...SV02, fee: 0 }, {}, 0); // ขอบ 0 ✓ (A-53)
  // ช่วงจำนวนฉบับ/พื้นที่ไม่เปลี่ยนตามค่าธรรมเนียม
  assertErr({ ...SV01, fee: 25 }, { qty: 6 }, 'INVALID_QTY');
  assertErr({ ...SV03, fee: 1200 }, { areaSqm: 501 }, 'AREA_TOO_LARGE');
});

test('requireFee → throw AppError 400 ข้อความตาม CONTRACT §5 · validateFeeInput', () => {
  assert.equal(rules.requireFee(SV03, { areaSqm: 101 }).fee, 1010);
  for (const [svc, input, code] of [
    [SV01, { qty: 0 }, 'INVALID_QTY'],
    [SV03, { areaSqm: 0 }, 'INVALID_AREA'],
    [SV03, { areaSqm: 501 }, 'AREA_TOO_LARGE'],
  ]) {
    assert.throws(
      () => rules.requireFee(svc, input),
      (e) => e instanceof AppError && e.code === code && e.status === 400 && e.message === MSG[code]
    );
    assert.deepEqual(rules.validateFeeInput(svc, input), { code, message: MSG[code], status: 400 });
  }
  assert.equal(rules.validateFeeInput(SV01, { qty: 5 }), null);
});

test('B01: SV-03 พื้นที่ 101 = ฿1,000 (ใช้ > 101) · 102 ยัง ฿1,020 · ค่าอื่น/บริการอื่นไม่เปลี่ยน', () => {
  withBugs(['B01'], () => {
    assertFee(SV03, { areaSqm: 101 }, 1000);
    assertFee(SV03, { areaSqm: 102 }, 1020);
    assertFee(SV03, { areaSqm: 100 }, 1000);
    assertFee(SV03, { areaSqm: 1 }, 1000);
    assertFee(SV03, { areaSqm: 250 }, 2500);
    assertFee(SV03, { areaSqm: 500 }, 5000);
    assertErr(SV03, { areaSqm: 0 }, 'INVALID_AREA');
    assertErr(SV03, { areaSqm: 501 }, 'AREA_TOO_LARGE');
    assertFee(SV01, { qty: 5 }, 100);
    assertErr(SV01, { qty: 6 }, 'INVALID_QTY');
    assertFee(SV02, {}, 500);
  });
  // บั๊กอื่นไม่กระทบค่าธรรมเนียม
  withBugs(['B03', 'B04'], () => assertFee(SV03, { areaSqm: 101 }, 1010));
  // ปิดบั๊กแล้วกลับมาถูก
  assertFee(SV03, { areaSqm: 101 }, 1010);
});

'use strict';
// P03 · ใช้กับ DB จริงของ core: อ่านบริการ/วันหยุดจากตาราง (ผู้ดูแลแก้แล้วมีผลทันที) · ตรวจไขว้ค่า seed กับกฎ
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../core/config');
const { createContext } = require('../core');
const rules = require('.');
const { bugs } = require('../core/bugs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'egov-rules-'));
const ctx = createContext(loadConfig({ DB_PATH: path.join(dir, 'app.db'), TEST_MODE: '1' }), { log: () => {} });
const { db } = ctx;
const r = rules.forContext(ctx);
const DUE = (ymd) => `${ymd}T16:30:00+07:00`;
const NOW = '2026-12-01T09:00:00+07:00'; // นาฬิกาหลัง reset (ส่งตรง ๆ เพราะ test ไฟล์อื่นอาจรันใน process เดียวกัน)

test.after(() => {
  bugs.set('');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ctx.rules โหลดไลบรารีนี้ได้', () => {
  assert.equal(ctx.rules.computeFee, rules.computeFee);
  assert.equal(typeof ctx.rules.forContext, 'function');
});

test('ค่าธรรมเนียมจากตาราง services (seed): SV-01 ×qty · SV-02 ฿500 · SV-03 101 → ฿1,010', () => {
  assert.equal(r.computeFee('SV-01', { qty: 5 }).fee, 100);
  assert.equal(r.computeFee('SV-02', {}).fee, 500);
  assert.equal(r.computeFee('SV-03', { areaSqm: 101 }).fee, 1010);
  assert.equal(r.computeFee(ctx.catalog.service('SV-03'), { areaSqm: 500 }).fee, 5000);
  assert.equal(rules.computeFee('SV-03', { areaSqm: 101 }, db).fee, 1010);
  assert.equal(rules.computeFee('SV-03', { areaSqm: 101 }, ctx.catalog).fee, 1010);
  assert.equal(r.computeFee('SV-03', { areaSqm: 501 }).code, 'AREA_TOO_LARGE');
  assert.equal(r.computeFee('SV-99', {}).code, 'BAD_REQUEST');
});

test('dueAt จากเวลาชำระ + SLA/วันหยุดในตาราง (TC-SLA-01 แถว a c f g i)', () => {
  assert.equal(r.computeDueAt('2026-12-01T09:00:00+07:00', 'SV-01'), DUE('2026-12-04'));
  assert.equal(r.computeDueAt('2026-12-01T16:30:00+07:00', 'SV-01'), DUE('2026-12-08'));
  assert.equal(r.computeDueAt('2026-12-01T09:00:00+07:00', 'SV-02'), DUE('2026-12-17'));
  assert.equal(r.computeDueAt('2026-12-01T09:00:00+07:00', 'SV-03'), DUE('2026-12-24'));
  assert.equal(r.computeDueAt('2026-12-31T23:59:00+07:00', 'SV-01'), DUE('2027-01-07'));
  assert.equal(rules.computeDueAt('2026-12-01T16:30:00+07:00', 3, db), DUE('2026-12-08'));
  ctx.clock.reset();
  assert.equal(r.computeDueAt(ctx.clock.nowIso(), 'SV-01'), DUE('2026-12-04')); // นาฬิกา reset = 1 ธ.ค. 09:00
});

test('seed ทุกใบ: dueAt ที่เก็บ = ชำระ + SLA + หยุดนับจากตาราง returns · ระดับ ณ 1 ธ.ค. 09:00 ตาม TEST-DATA §4.1', () => {
  const rows = db.prepare('SELECT * FROM cases ORDER BY case_no').all();
  assert.equal(rows.length, 30);
  const expectLevel = {
    10: 'normal', 11: 'normal', 12: 'normal', 13: 'normal', 14: 'normal', 15: 'normal', 16: 'normal',
    17: 'paused', 18: 'normal', 19: 'normal', 20: 'overdue', 21: 'normal', 22: 'near', 23: 'normal',
    24: 'near', 25: 'normal', 26: 'normal', 27: 'normal', 28: 'normal', 29: 'normal', 30: 'normal',
  };
  for (const row of rows) {
    const no = Number(row.case_no.slice(-6));
    let due = r.computeDueAt(row.paid_at, row.service_id);
    const rets = db.prepare('SELECT * FROM returns WHERE case_no = ? ORDER BY seq').all(row.case_no);
    for (const ret of rets) {
      if (ret.resubmitted_at) {
        assert.equal(r.pausedBusinessDays(ret.returned_at, ret.resubmitted_at), ret.paused_days, `${row.case_no} returns.paused_days #${ret.seq}`);
        due = r.extendDueForFix(due, ret.returned_at, ret.resubmitted_at);
      }
    }
    assert.equal(due, row.due_at, `${row.case_no} due_at`);
    assert.equal(r.slaLevel(row, NOW), expectLevel[no] || 'closed', `${row.case_no} slaLevel`);
    if (row.status === 'NEED_FIX') assert.equal(r.fixDeadline(row.returned_at), row.fix_deadline, `${row.case_no} fix_deadline`);
  }
});

test('ผู้ดูแลแก้ค่าธรรมเนียม/SLA/วันหยุด → การคำนวณใหม่เห็นทันที (TC-RBAC-04)', () => {
  const svc = db.prepare('SELECT fee, sla FROM services WHERE id = ?');
  const orig1 = svc.get('SV-01');
  const orig2 = svc.get('SV-02');
  try {
    db.prepare('UPDATE services SET fee = 25 WHERE id = ?').run('SV-01');
    db.prepare('UPDATE services SET fee = 600 WHERE id = ?').run('SV-02');
    assert.equal(r.computeFee('SV-01', { qty: 5 }).fee, 125);
    assert.equal(r.computeFee('SV-01', { qty: 1 }).fee, 25);
    assert.equal(r.computeFee('SV-02', {}).fee, 600);
    db.prepare("INSERT INTO holidays (date, name) VALUES ('2026-12-02', 'วันหยุดทดสอบ')").run();
    assert.equal(r.computeDueAt('2026-12-01T09:00:00+07:00', 'SV-01'), DUE('2026-12-08'));
    assert.equal(r.isBusinessDay('2026-12-02'), false);
    db.prepare("DELETE FROM holidays WHERE date = '2026-12-02'").run();
    assert.equal(r.computeDueAt('2026-12-01T09:00:00+07:00', 'SV-01'), DUE('2026-12-04'));
    db.prepare('UPDATE services SET sla = 5 WHERE id = ?').run('SV-01');
    assert.equal(r.computeDueAt('2026-12-01T09:00:00+07:00', 'SV-01'), DUE('2026-12-09'));
  } finally {
    db.prepare('UPDATE services SET fee = ?, sla = ? WHERE id = ?').run(orig1.fee, orig1.sla, 'SV-01');
    db.prepare('UPDATE services SET fee = ?, sla = ? WHERE id = ?').run(orig2.fee, orig2.sla, 'SV-02');
  }
});

test('forContext ใช้นาฬิกากลาง: …000022 ที่ 16:30 ใกล้ · 16:31 เกิน · slaInfo', () => {
  const row = ctx.caseEvents.get('EG-2569-000022');
  try {
    ctx.clock.set('2026-12-01T16:30:00+07:00');
    assert.equal(r.slaLevel(row), 'near');
    assert.deepEqual(r.slaInfo(row), { level: 'near', levelText: 'ใกล้ครบกำหนด', dueAt: DUE('2026-12-01'), remainingDays: 0 });
    ctx.clock.set('2026-12-01T16:31:00+07:00');
    assert.equal(r.slaLevel(row), 'overdue');
    assert.equal(r.slaLevel(row, NOW), 'near');
  } finally {
    ctx.clock.reset();
  }
});

test('BUG_MODE ผ่าน ctx.bugs: B01 B03 B04 เปลี่ยนเฉพาะการคำนวณใหม่ · ค่า seed ใน DB ไม่เปลี่ยน', () => {
  const before = db.prepare('SELECT case_no, due_at FROM cases ORDER BY case_no').all();
  try {
    ctx.bugs.set('B01,B03,B04');
    assert.equal(r.computeFee('SV-03', { areaSqm: 101 }).fee, 1000);
    assert.equal(r.computeDueAt('2026-12-01T16:30:00+07:00', 'SV-01'), DUE('2026-12-07'));
    assert.equal(r.extendDueForFix(DUE('2026-11-27'), '2026-11-27T14:00:00+07:00', '2026-12-01T09:00:00+07:00'), DUE('2026-11-27'));
  } finally {
    ctx.bugs.set('');
  }
  assert.deepEqual(db.prepare('SELECT case_no, due_at FROM cases ORDER BY case_no').all(), before);
  assert.equal(r.computeFee('SV-03', { areaSqm: 101 }).fee, 1010);
});

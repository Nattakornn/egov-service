'use strict';
// ตรวจ seed ตาม TEST-DATA §1–§12 + NFR-04 (ไม่มีเลขบัตร/เบอร์ตรง ๆ ในไฟล์ DB)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../config');
const { createContext } = require('..');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'egov-seed-'));
const ctx = createContext(loadConfig({ DB_PATH: path.join(dir, 'app.db'), TEST_MODE: '1' }), { log: () => {} });
const { db } = ctx;
const NOW = '2026-12-01T09:00:00+07:00';

test.after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('§1 บัญชี: ประชาชน 4 + เจ้าหน้าที่/บทบาทอื่น 7 · ข้อมูลส่วนบุคคลเข้ารหัสและถอดได้', () => {
  const users = db.prepare('SELECT * FROM users ORDER BY id').all();
  assert.equal(users.length, 11);
  const somchai = ctx.auth.findCitizenByIdNo('1101700123456');
  assert.equal(somchai.name, 'สมชาย ใจดี');
  assert.equal(ctx.crypto.dec(somchai.mobile_enc), '0812345678');
  assert.equal(ctx.auth.citizenIdNo(somchai), '1101700123456');
  assert.equal(somchai.email, '');
  const mana = ctx.auth.findCitizenByIdNo('5500400111221');
  assert.equal(mana.registered, 0);
  assert.equal(mana.mobile_enc, null);
  assert.equal(ctx.auth.findCitizenByIdNo('1101700123457'), undefined);
  const staff = Object.fromEntries(users.filter((u) => u.role !== 'citizen').map((u) => [u.username, u]));
  assert.deepEqual(
    Object.keys(staff).sort(),
    ['admin1', 'audit1', 'exec1', 'head1', 'off.reg1', 'off.reg2', 'off.works1']
  );
  assert.equal(staff['off.reg1'].name, 'เจ้าหน้าที่ทะเบียน 1');
  assert.equal(staff['off.works1'].dept, 'works');
  assert.equal(staff['head1'].role, 'head');
  assert.equal(ctx.auth.verifyPassword('Test@1234', staff['admin1'].password_hash), true);
  assert.equal(ctx.auth.verifyPassword('wrong', staff['admin1'].password_hash), false);
});

test('§2 บริการ · §3 วันหยุด', () => {
  const s = Object.fromEntries(db.prepare('SELECT * FROM services').all().map((r) => [r.id, r]));
  assert.equal(s['SV-01'].fee, 20);
  assert.equal(s['SV-02'].fee, 500);
  assert.equal(s['SV-03'].fee, 1000);
  assert.equal(s['SV-03'].fee_per_sqm, 10);
  assert.deepEqual([s['SV-01'].sla, s['SV-02'].sla, s['SV-03'].sla], [3, 10, 15]);
  assert.equal(s['SV-03'].name, 'ขออนุญาตก่อสร้าง/ต่อเติมอาคาร');
  assert.deepEqual(JSON.parse(s['SV-03'].docs).map((d) => d.name), ['บัตรประชาชน', 'แบบแปลน', 'โฉนด']);
  assert.deepEqual(JSON.parse(s['SV-02'].route), ['registry', 'head']);
  const h = db.prepare('SELECT date FROM holidays ORDER BY date').all().map((r) => r.date);
  assert.deepEqual(h, ['2026-12-07', '2026-12-10', '2026-12-31', '2027-01-01']);
});

test('§4.1 คำขอ 30 ใบ: จำนวนต่อคน สถานะ ผู้ถือ', () => {
  const cases = db.prepare('SELECT * FROM cases ORDER BY case_no').all();
  assert.equal(cases.length, 30);
  assert.equal(cases[0].case_no, 'EG-2569-000001');
  assert.equal(cases[29].case_no, 'EG-2569-000030');
  const byName = db
    .prepare('SELECT u.name, COUNT(*) n FROM cases c JOIN users u ON u.id = c.citizen_id GROUP BY u.name')
    .all()
    .reduce((a, r) => ({ ...a, [r.name]: r.n }), {});
  assert.deepEqual(byName, { 'สมชาย ใจดี': 10, 'สมหญิง รักไทย': 11, 'ปิติ มีสุข': 9 });
  const open = db.prepare("SELECT status, COUNT(*) n FROM cases WHERE status IN ('SUBMITTED','IN_REVIEW','NEED_FIX','PENDING_APPROVAL','APPROVED') GROUP BY status").all();
  assert.deepEqual(Object.fromEntries(open.map((r) => [r.status, r.n])), { SUBMITTED: 4, IN_REVIEW: 13, NEED_FIX: 1, PENDING_APPROVAL: 2, APPROVED: 1 });
  const wl = Object.fromEntries(db.prepare("SELECT owner, COUNT(*) n FROM cases WHERE status = 'IN_REVIEW' AND owner IS NOT NULL GROUP BY owner").all().map((r) => [r.owner, r.n]));
  assert.deepEqual(wl, { 'off.reg1': 3, 'off.reg2': 9 });
  const r09 = db.prepare("SELECT * FROM cases WHERE case_no = 'EG-2569-000012'").get();
  assert.deepEqual([r09.fee, r09.area_sqm, r09.step, r09.owner], [1010, 101, 1, 'off.reg2']);
  const r05 = db.prepare("SELECT * FROM cases WHERE case_no = 'EG-2569-000025'").get();
  assert.deepEqual([r05.qty, r05.fee, r05.due_at, r05.paid_at], [3, 60, '2026-12-03T16:30:00+07:00', '2026-11-30T10:00:00+07:00']);
  const f01 = db.prepare("SELECT * FROM cases WHERE case_no = 'EG-2569-000017'").get();
  assert.deepEqual([f01.status, f01.owner, f01.return_count, f01.fix_deadline, f01.due_at], ['NEED_FIX', 'off.reg1', 2, '2026-12-04T14:00:00+07:00', '2026-11-27T16:30:00+07:00']);
  const a01 = db.prepare("SELECT * FROM cases WHERE case_no = 'EG-2569-000019'").get();
  assert.deepEqual([a01.status, a01.owner, a01.issuer, a01.approved_by, a01.approved_at], ['APPROVED', null, 'off.reg1', 'head1', '2026-11-30T15:00:00+07:00']);
  const w01 = db.prepare("SELECT * FROM cases WHERE case_no = 'EG-2569-000010'").get();
  assert.deepEqual([w01.status, w01.step, w01.dept, w01.owner, w01.issuer], ['IN_REVIEW', 2, 'works', null, 'off.reg1']);
  const x01 = db.prepare("SELECT * FROM cases WHERE case_no = 'EG-2569-000009'").get();
  assert.deepEqual([x01.status, x01.closed_at, x01.cancelled_at], ['CANCELLED', null, '2026-11-09T15:00:00+07:00']);
  for (const c of cases) {
    assert.equal(c.receipt_no, c.case_no.replace('EG-', 'RC-'), 'ใบเสร็จเลขตรงคำขอ');
    const tl = ctx.caseEvents.timeline(c.case_no);
    assert.ok(tl.length >= 1);
    assert.equal(tl[0].event, 'PAID');
    assert.equal(tl[tl.length - 1].toStatus, c.status, `${c.case_no} ไทม์ไลน์จบที่สถานะปัจจุบัน`);
    for (const t of tl) assert.ok(t.at <= NOW, `${c.case_no} timeline ไม่เกินเวลาเริ่ม`);
  }
});

test('§9.1 คิวทะเบียน 17 แถวเรียงกำหนดเสร็จแล้วเลขคำขอ · §9.2 โยธา 1 · §9.3 รออนุมัติ 2', () => {
  const reg = db
    .prepare("SELECT case_no FROM cases WHERE dept = 'registry' AND status IN ('SUBMITTED','IN_REVIEW','APPROVED') ORDER BY due_at, case_no")
    .all()
    .map((r) => r.case_no.slice(-2));
  assert.deepEqual(reg, ['20', '22', '24', '23', '25', '26', '13', '15', '27', '28', '29', '30', '16', '18', '19', '12', '21']);
  const works = db.prepare("SELECT case_no FROM cases WHERE dept = 'works' AND status IN ('SUBMITTED','IN_REVIEW')").all();
  assert.deepEqual(works.map((r) => r.case_no), ['EG-2569-000010']);
  const appr = db.prepare("SELECT case_no FROM cases WHERE status = 'PENDING_APPROVAL' ORDER BY due_at, case_no").all();
  assert.deepEqual(appr.map((r) => r.case_no), ['EG-2569-000014', 'EG-2569-000011']);
});

test('§7 ตัวเลขดิบของ Dashboard ตรง TEST-DATA (รับเรื่อง/ปิดงาน/ทัน)', () => {
  const received = (p) => db.prepare('SELECT COUNT(*) n FROM cases WHERE substr(paid_at,1,?) = ?').get(p.length, p).n;
  const closed = (p) => db.prepare("SELECT COUNT(*) n FROM cases WHERE status IN ('COMPLETED','REJECTED') AND substr(closed_at,1,?) = ?").get(p.length, p).n;
  const ontime = (p) => db.prepare("SELECT COUNT(*) n FROM cases WHERE status IN ('COMPLETED','REJECTED') AND substr(closed_at,1,?) = ? AND closed_at <= due_at").get(p.length, p).n;
  assert.deepEqual([received('2026-12'), closed('2026-12')], [3, 0]);
  assert.deepEqual([received('2026-11'), closed('2026-11'), ontime('2026-11')], [26, 7, 6]);
  assert.deepEqual([received('2026-10'), closed('2026-10'), ontime('2026-10')], [1, 1, 1]);
  assert.deepEqual([received('2026'), closed('2026'), ontime('2026')], [30, 8, 7]);
  const overdue = db
    .prepare("SELECT case_no FROM cases WHERE status IN ('SUBMITTED','IN_REVIEW','PENDING_APPROVAL','APPROVED') AND due_at < ?")
    .all(NOW);
  assert.deepEqual(overdue.map((r) => r.case_no), ['EG-2569-000020']);
});

test('§4.4 ประวัติตีกลับ F01/F02 + paused_days', () => {
  const rows = db.prepare('SELECT case_no, seq, returned_at, resubmitted_at, paused_days, reason FROM returns ORDER BY case_no, seq').all();
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => [r.case_no.slice(-2), r.seq, r.paused_days]), [['17', 1, 1], ['17', 2, null], ['23', 1, 1], ['23', 2, 1]]);
  assert.equal(rows[1].reason, 'ชื่อในเอกสารไม่ตรงกับบัตร กรุณาแก้ไข');
  assert.equal(rows[3].resubmitted_at, '2026-12-01T08:30:00+07:00');
});

test('§4.1 ไฟล์แนบ: SV-01 1 · SV-02 2 · SV-03 3 + ร่าง DR-0002 2 ไฟล์ = PDF จริงบนดิสก์', () => {
  const per = db.prepare('SELECT c.service_id s, COUNT(f.id) n FROM cases c JOIN files f ON f.case_no = c.case_no GROUP BY c.case_no').all();
  for (const r of per) assert.equal(r.n, { 'SV-01': 1, 'SV-02': 2, 'SV-03': 3 }[r.s]);
  const f10 = db.prepare("SELECT name, doc_key FROM files WHERE case_no = 'EG-2569-000010' ORDER BY id").all();
  assert.deepEqual(f10.map((f) => f.name), ['id-card.pdf', 'plan.pdf', 'deed.pdf']);
  const d2 = db.prepare("SELECT name, doc_key FROM files WHERE draft_id = 'DR-0002' ORDER BY id").all();
  assert.deepEqual(d2.map((f) => f.doc_key), ['id-card', 'map']);
  const any = db.prepare('SELECT * FROM files LIMIT 1').get();
  const buf = ctx.storage.read(any);
  assert.equal(buf.length, any.size);
  assert.equal(ctx.storage.detectType(buf).type, 'pdf');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM files').get().n, 50);
});

test('§4.2 ร่าง + §6 รอชำระ PP-0001', () => {
  const d = db.prepare('SELECT * FROM drafts ORDER BY id').all();
  assert.deepEqual(d.map((x) => [x.id, x.service_id, x.status, x.fee]), [['DR-0001', 'SV-01', 'DRAFT', 40], ['DR-0002', 'SV-02', 'PENDING_PAYMENT', 500]]);
  assert.equal(d[0].qty, 2);
  assert.equal(d[1].locked_amount, 500);
  const p = db.prepare("SELECT * FROM payments WHERE ref = 'PP-0001'").get();
  assert.deepEqual([p.draft_id, p.amount, p.status, p.qr_created_at, p.qr_expires_at], ['DR-0002', 500, 'PENDING', '2026-12-01T08:55:00+07:00', '2026-12-01T09:10:00+07:00']);
});

test('§5 เอกสาร DOC-2569-000001 ลายเซ็น HMAC verify ผ่าน · tamper → ไม่ผ่าน', () => {
  const doc = db.prepare("SELECT * FROM documents WHERE verify_code = 'K7M2Q9XA'").get();
  assert.equal(doc.doc_no, 'DOC-2569-000001');
  assert.equal(doc.case_no, 'EG-2569-000005');
  assert.equal(doc.valid_until, '2027-02-02');
  assert.equal(doc.signer, 'เจ้าหน้าที่ทะเบียน 1');
  assert.equal(ctx.sign.verifyDoc(doc), true);
  assert.equal(ctx.sign.verifyDoc({ ...doc, applicant: 'สมชาย ใจร้าย' }), false);
  assert.equal(
    ctx.sign.docCanonical(doc),
    'DOC-2569-000001|EG-2569-000005|สมชาย ใจดี|SV-01|2026-11-05T10:00:00+07:00|2027-02-02|เจ้าหน้าที่ทะเบียน 1'
  );
  assert.equal(db.prepare("SELECT doc_no FROM cases WHERE case_no = 'EG-2569-000005'").get().doc_no, 'DOC-2569-000001');
});

test('§10 Audit/แจ้งเตือน/session ว่างตอนเริ่ม · Audit แก้/ลบไม่ได้', () => {
  assert.equal(db.prepare('SELECT COUNT(*) n FROM audit').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 0);
  const row = ctx.audit.log({ username: 'off.reg1', role: 'officer', event: 'STAFF_LOGIN' });
  assert.equal(row.at, ctx.clock.nowIso());
  assert.throws(() => db.prepare('UPDATE audit SET detail = ?').run('x'), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM audit').run(), /append-only/);
  assert.throws(() => ctx.audit.log({ username: 'x', role: 'admin', event: 'HACK' }), /unknown event/);
});

test('§12 เลขถัดไปหลัง seed', () => {
  db.exec('SAVEPOINT ids');
  try {
    assert.equal(ctx.ids.caseNo('2026-12-31T23:59:00+07:00'), 'EG-2569-000031');
    assert.equal(ctx.ids.caseNo('2027-01-01T00:00:00+07:00'), 'EG-2570-000001');
    assert.equal(ctx.ids.receiptNo('2026-12-01T09:00:00+07:00'), 'RC-2569-000031');
    assert.equal(ctx.ids.docNo('2026-12-01T09:00:00+07:00'), 'DOC-2569-000002');
    assert.equal(ctx.ids.draftId(), 'DR-0003');
    assert.equal(ctx.ids.paymentRef(), 'PP-0002');
    assert.equal(ctx.ids.fileId(), 'F-000051');
    assert.equal(ctx.ids.citizenUsername(), 'cit-0005');
    assert.match(ctx.ids.verifyCode((c) => c === 'K7M2Q9XA'), /^[A-Z0-9]{8}$/);
  } finally {
    db.exec('ROLLBACK TO ids');
    db.exec('RELEASE ids');
  }
});

test('caseEvents.transition: เปลี่ยนสถานะ + ไทม์ไลน์ + Audit · สถานะผิด → INVALID_STATE', () => {
  db.exec('SAVEPOINT ce');
  try {
    const actor = { username: 'off.reg1', name: 'เจ้าหน้าที่ทะเบียน 1', role: 'officer' };
    const r = ctx.caseEvents.transition('EG-2569-000028', {
      from: 'SUBMITTED', to: 'IN_REVIEW', event: 'CLAIM', actor, set: { owner: 'off.reg1', issuer: 'off.reg1' }, audit: true,
    });
    assert.equal(r.from, 'SUBMITTED');
    assert.equal(r.row.owner, 'off.reg1');
    const tl = ctx.caseEvents.timeline('EG-2569-000028');
    assert.equal(tl[tl.length - 1].event, 'CLAIM');
    assert.equal(tl[tl.length - 1].at, '2026-12-01T09:00:00+07:00');
    const a = db.prepare("SELECT * FROM audit WHERE event = 'CLAIM'").get();
    assert.deepEqual([a.username, a.role, a.case_no, a.from_status, a.to_status], ['off.reg1', 'officer', 'EG-2569-000028', 'SUBMITTED', 'IN_REVIEW']);
    assert.throws(
      () => ctx.caseEvents.transition('EG-2569-000028', { from: 'SUBMITTED', to: 'IN_REVIEW', event: 'CLAIM', actor }),
      (e) => e.code === 'INVALID_STATE' && e.status === 409
    );
    assert.throws(
      () => ctx.caseEvents.transition('EG-2569-000029', { from: 'SUBMITTED', to: 'IN_REVIEW', event: 'CLAIM', actor, check: () => ctx.errors.fail('ALREADY_CLAIMED') }),
      (e) => e.code === 'ALREADY_CLAIMED' && e.message === 'มีเจ้าหน้าที่รับเรื่องนี้แล้ว'
    );
    assert.equal(db.prepare("SELECT status FROM cases WHERE case_no = 'EG-2569-000029'").get().status, 'SUBMITTED', 'check ล้ม → ไม่แก้');
    assert.throws(() => ctx.caseEvents.transition('EG-2569-999999', { to: 'IN_REVIEW', event: 'CLAIM' }), (e) => e.code === 'NOT_FOUND');
  } finally {
    db.exec('ROLLBACK TO ce');
    db.exec('RELEASE ce');
  }
});

test('NFR-04: ไฟล์ DB ไม่มีเลขบัตร/เบอร์โทรตรง ๆ (ทั้งแบบมีขีด)', () => {
  db.pragma('wal_checkpoint(TRUNCATE)');
  const buf = fs.readFileSync(ctx.config.dbPath);
  const secrets = [
    '1101700123456', '3100600987659', '1909900555015', '5500400111221',
    '0812345678', '0823456789', '0834567890',
    '1-1017-00123-45-6', '3-1006-00987-65-9', '1-9099-00555-01-5', '5-5004-00111-22-1',
  ];
  for (const s of secrets) assert.equal(buf.includes(Buffer.from(s)), false, `พบ ${s} ในไฟล์ DB`);
});

test('catalog: บริการ/วันหยุดจาก DB · audit.toJson · caseEvents.record', () => {
  const sv3 = ctx.catalog.service('SV-03');
  assert.deepEqual([sv3.fee, sv3.feePerSqm, sv3.sla, sv3.approver], [1000, 10, 15, 'head']);
  assert.deepEqual(sv3.route, ['registry', 'works', 'head']);
  assert.equal(sv3.docs.find((d) => d.key === 'plan').pdfOnly, true);
  assert.deepEqual(ctx.catalog.services().map((s) => s.id), ['SV-01', 'SV-02', 'SV-03']);
  assert.equal(ctx.catalog.holidaySet().has('2026-12-07'), true);
  assert.equal(ctx.catalog.docName('deed'), 'โฉนด');
  assert.equal(ctx.catalog.service('SV-99'), undefined);
  const j = ctx.audit.toJson({ id: 1, at: '2026-12-01T09:00:00+07:00', username: 'u', role: 'officer', event: 'CLAIM', case_no: 'EG-1', from_status: 'A', to_status: 'B', detail: '' });
  assert.deepEqual(Object.keys(j), ['id', 'time', 'username', 'role', 'event', 'caseNo', 'fromStatus', 'toStatus', 'detail']);
  db.exec('SAVEPOINT rec');
  try {
    ctx.caseEvents.record('EG-2569-000030', { event: 'NOTE', from: 'SUBMITTED', to: 'SUBMITTED', text: 'ทดสอบ' });
    const tl = ctx.caseEvents.timeline('EG-2569-000030');
    assert.equal(tl[tl.length - 1].text, 'ทดสอบ');
    assert.equal(tl[tl.length - 1].actorName, 'ระบบ');
  } finally {
    db.exec('ROLLBACK TO rec');
    db.exec('RELEASE rec');
  }
});

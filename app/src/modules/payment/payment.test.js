'use strict';
// P05 · ชำระเงิน: BR-09 BR-10 BR-11 FR-08 · TC-PAY-01..04 · B05
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServer } = require('../../server');
const { bugs } = require('../../core/bugs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'egov-pay-'));
let srv;
let ctx;
let base;

function req(method, url, { body, cookie } = {}) {
  const h = {};
  if (cookie) h.cookie = cookie;
  let payload;
  if (body !== undefined) {
    h['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  return fetch(base + url, { method, headers: h, body: payload, redirect: 'manual' });
}
async function j(method, url, opts) {
  const r = await req(method, url, opts);
  const text = await r.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: r.status, data };
}
function loginAs(username) {
  const u = ctx.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const sid = ctx.crypto.randomHex(16) + username.replace(/\W/g, '');
  ctx.db
    .prepare('INSERT INTO sessions(sid, user_id, role, dept, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sid, u.id, u.role, u.dept, 'full', ctx.clock.nowIso());
  return `eg_sid=${sid}`;
}
async function reset(clockIso) {
  const r = await j('POST', '/api/test/reset');
  assert.equal(r.status, 200);
  if (clockIso) {
    const c = await j('PUT', '/api/test/clock', { body: { now: clockIso } });
    assert.equal(c.status, 200);
  }
}
const setClock = (iso) => j('PUT', '/api/test/clock', { body: { now: iso } });

/** สร้างร่างตรงใน DB (ไม่พึ่ง P04) + ไฟล์บังคับ */
function makeDraft(username, serviceId, { qty = null, area = null, docs } = {}) {
  const u = ctx.db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  const id = ctx.ids.draftId();
  const now = ctx.clock.nowIso();
  const fee = ctx.rules.forContext(ctx).computeFee(serviceId, { qty, areaSqm: area }).fee;
  ctx.db
    .prepare(
      `INSERT INTO drafts(id, citizen_id, service_id, status, qty, area_sqm, fee, locked_amount, case_no, created_at, updated_at)
       VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, NULL, NULL, ?, ?)`
    )
    .run(id, u.id, serviceId, qty, area, fee, now, now);
  const req = docs || { 'SV-01': ['id-card'], 'SV-02': ['id-card', 'map'], 'SV-03': ['id-card', 'plan', 'deed'] }[serviceId];
  for (const k of req) {
    ctx.db
      .prepare(
        `INSERT INTO files(id, draft_id, case_no, doc_key, name, mime, size, storage, seed, uploaded_by, uploaded_at)
         VALUES (?, ?, NULL, ?, ?, 'application/pdf', 1024, 'u/none.pdf', 0, ?, ?)`
      )
      .run(ctx.ids.fileId(), id, k, `${k}.pdf`, u.id, now);
  }
  return id;
}
const casesOf = async (username) => ctx.db.prepare("SELECT COUNT(*) n FROM cases c JOIN users u ON u.id = c.citizen_id WHERE u.username = ?").get(username).n;

test.before(async () => {
  const r = await createServer({ env: { DB_PATH: path.join(tmp, 'app.db'), TEST_MODE: '1' }, log: () => {} });
  ctx = r.ctx;
  srv = await new Promise((resolve) => {
    const s = r.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => {
  bugs.set('');
  srv && srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('TC-PAY-01 อายุ QR: 5:00 และ 14:59 จ่ายได้ · 15:00 และ 15:01 ได้ 410 QR_EXPIRED', async () => {
  bugs.set('');
  for (const [clock, expect] of [
    [null, 200],
    ['2026-12-01T09:09:59+07:00', 200],
    ['2026-12-01T09:10:00+07:00', 410],
    ['2026-12-01T09:10:01+07:00', 410],
  ]) {
    await reset(clock);
    const r = await j('POST', '/api/test/payments/PP-0001/pay', { body: { amount: 500 } });
    assert.equal(r.status, expect, `clock ${clock}`);
    const c = loginAs('cit-0001');
    const g = await j('GET', '/api/payments/PP-0001', { cookie: c });
    assert.equal(g.status, 200);
    if (expect === 200) {
      assert.deepEqual(r.data, { status: 'PAID', caseNo: 'EG-2569-000031', receiptNo: 'RC-2569-000031', duplicate: false, paidAt: r.data.paidAt, amount: 500, dueAt: r.data.dueAt });
      assert.equal(g.data.status, 'PAID');
      assert.equal(g.data.caseNo, 'EG-2569-000031');
    } else {
      assert.equal(r.data.code, 'QR_EXPIRED');
      assert.equal(r.data.message, 'QR หมดอายุ กรุณาสร้าง QR ใหม่');
      assert.equal(g.data.status, 'EXPIRED');
      assert.equal(ctx.db.prepare("SELECT COUNT(*) n FROM cases WHERE case_no = 'EG-2569-000031'").get().n, 0);
    }
  }
  // รอบ 3: สร้าง QR ใหม่ → PP-0002 หมดอายุ 09:25 · จ่ายได้เลข 000031
  await reset('2026-12-01T09:10:00+07:00');
  const c = loginAs('cit-0001');
  const html = await j('GET', '/api/drafts/DR-0002/payment?format=html', { cookie: c });
  assert.match(html.data.html, /data-testid="qr-expired-msg"[^>]*>QR หมดอายุ กรุณาสร้าง QR ใหม่</);
  assert.match(html.data.html, /data-testid="payment-status" data-status="EXPIRED">QR หมดอายุ</);
  assert.match(html.data.html, /data-testid="regenerate-qr-btn"/);
  assert.match(html.data.html, /data-testid="payment-amount">฿500</);
  const n = await j('POST', '/api/drafts/DR-0002/payment', { cookie: c });
  assert.equal(n.status, 201);
  assert.deepEqual(n.data, { ref: 'PP-0002', draftId: 'DR-0002', amount: 500, status: 'PENDING', qrCreatedAt: '2026-12-01T09:10:00+07:00', qrExpiresAt: '2026-12-01T09:25:00+07:00' });
  const html2 = await j('GET', '/api/drafts/DR-0002/payment?format=html', { cookie: c });
  assert.match(html2.data.html, /data-testid="qr-ref">PP-0002</);
  assert.match(html2.data.html, /data-testid="qr-expires" data-iso="2026-12-01T09:25:00\+07:00"[^>]*>หมดอายุ 1 ธ.ค. 2569 09:25</);
  assert.match(html2.data.html, /data-testid="payment-status" data-status="PENDING">รอชำระ</);
  const p = await j('POST', '/api/test/payments/PP-0002/pay', { body: { amount: 500 } });
  assert.equal(p.status, 200);
  assert.equal(p.data.caseNo, 'EG-2569-000031');
});

test('B05: อายุ 15:00 พอดียังจ่ายได้ · 15:01 ยัง 410', async () => {
  bugs.set(['B05']);
  try {
    await reset('2026-12-01T09:10:00+07:00');
    const r = await j('POST', '/api/test/payments/PP-0001/pay', { body: { amount: 500 } });
    assert.equal(r.status, 200);
    assert.equal(r.data.caseNo, 'EG-2569-000031');
    await reset('2026-12-01T09:10:01+07:00');
    const r2 = await j('POST', '/api/test/payments/PP-0001/pay', { body: { amount: 500 } });
    assert.equal(r2.status, 410);
  } finally {
    bugs.set('');
  }
});

test('TC-PAY-02 ยอดขาด/เกิน ฿1 → 422 · ตรง → PAID · callback ซ้ำ duplicate:true เลขเดิม · ถัดไปไม่ข้ามเลข', async () => {
  await reset();
  const c = loginAs('cit-0001');
  const d = makeDraft('cit-0001', 'SV-01', { qty: 1 });
  const q = await j('POST', `/api/drafts/${d}/payment`, { cookie: c });
  assert.equal(q.status, 201);
  assert.equal(q.data.ref, 'PP-0002');
  assert.equal(q.data.amount, 20);
  assert.equal(ctx.db.prepare('SELECT status, locked_amount FROM drafts WHERE id = ?').get(d).status, 'PENDING_PAYMENT');
  const before = await casesOf('cit-0001');
  for (const amt of [19, 21, '19', null, undefined, 20.5]) {
    const r = await j('POST', '/api/test/payments/PP-0002/pay', { body: amt === undefined ? {} : { amount: amt } });
    assert.equal(r.status, 422, `amount ${amt}`);
    assert.deepEqual(r.data, { code: 'AMOUNT_MISMATCH', message: 'ยอดเงินไม่ตรงกับค่าธรรมเนียม' });
    assert.equal((await j('GET', '/api/payments/PP-0002', { cookie: c })).data.status, 'PENDING');
  }
  assert.equal(await casesOf('cit-0001'), before);
  const ok = await j('POST', '/api/test/payments/PP-0002/pay', { body: { amount: 20 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.status, 'PAID');
  assert.equal(ok.data.caseNo, 'EG-2569-000031');
  assert.equal(ok.data.receiptNo, 'RC-2569-000031');
  assert.equal(ok.data.duplicate, false);
  assert.equal(await casesOf('cit-0001'), before + 1);
  const dup = await j('POST', '/api/test/payments/PP-0002/pay', { body: { amount: 20 } });
  assert.equal(dup.status, 200);
  assert.equal(dup.data.duplicate, true);
  assert.equal(dup.data.caseNo, 'EG-2569-000031');
  assert.equal(dup.data.receiptNo, 'RC-2569-000031');
  assert.equal(await casesOf('cit-0001'), before + 1);
  const g = await j('GET', '/api/payments/PP-0002', { cookie: c });
  assert.equal(g.data.status, 'PAID');
  assert.equal(g.data.receiptNo, 'RC-2569-000031');
  const d2 = makeDraft('cit-0001', 'SV-01', { qty: 1 });
  const q2 = await j('POST', `/api/drafts/${d2}/payment`, { cookie: c });
  const ok2 = await j('POST', `/api/test/payments/${q2.data.ref}/pay`, { body: { amount: 20 } });
  assert.equal(ok2.data.caseNo, 'EG-2569-000032');
  assert.equal(ok2.data.receiptNo, 'RC-2569-000032');
  // ใบเสร็จบนจอ
  const html = await j('GET', `/api/drafts/${d}/payment?format=html`, { cookie: c });
  assert.match(html.data.html, /data-testid="payment-status" data-status="PAID">ชำระแล้ว</);
  assert.match(html.data.html, /data-testid="submitted-case-no">EG-2569-000031</);
  assert.match(html.data.html, /data-testid="receipt-no">RC-2569-000031</);
  assert.match(html.data.html, /data-testid="receipt-amount">฿20</);
  assert.match(html.data.html, /data-testid="receipt-paid-at" data-iso="2026-12-01T09:00:00\+07:00"/);
  assert.match(html.data.html, /data-testid="go-case-btn" href="\/citizen\/cases\/EG-2569-000031">ดูคำขอ</);
  assert.match(html.data.html, /data-testid="refresh-payment-btn"/);
});

test('TC-PAY-03 ชำระพร้อมกัน 6 ref ได้เลขไม่ซ้ำ', async () => {
  await reset();
  const refs = [];
  for (const who of ['cit-0001', 'cit-0001', 'cit-0001', 'cit-0002', 'cit-0002', 'cit-0002']) {
    const c = loginAs(who);
    const d = makeDraft(who, 'SV-01', { qty: 1 });
    const q = await j('POST', `/api/drafts/${d}/payment`, { cookie: c });
    assert.equal(q.status, 201);
    refs.push(q.data.ref);
  }
  assert.deepEqual(refs, ['PP-0002', 'PP-0003', 'PP-0004', 'PP-0005', 'PP-0006', 'PP-0007']);
  const rs = await Promise.all(refs.map((ref) => j('POST', `/api/test/payments/${ref}/pay`, { body: { amount: 20 } })));
  assert.ok(rs.every((r) => r.status === 200));
  const nos = rs.map((r) => r.data.caseNo).sort();
  const rcs = rs.map((r) => r.data.receiptNo).sort();
  assert.deepEqual(nos, [31, 32, 33, 34, 35, 36].map((n) => `EG-2569-0000${n}`));
  assert.deepEqual(rcs, [31, 32, 33, 34, 35, 36].map((n) => `RC-2569-0000${n}`));
  const c = loginAs('cit-0001');
  const d = makeDraft('cit-0001', 'SV-01', { qty: 1 });
  const q = await j('POST', `/api/drafts/${d}/payment`, { cookie: c });
  const r = await j('POST', `/api/test/payments/${q.data.ref}/pay`, { body: { amount: 20 } });
  assert.equal(r.data.caseNo, 'EG-2569-000037');
});

test('TC-PAY-04 เลขคำขอข้ามปี: 31 ธ.ค. 23:59 → 2569 · 1 ม.ค. 00:00 → EG-2570-000001', async () => {
  await reset('2026-12-31T23:58:00+07:00');
  const c = loginAs('cit-0001');
  const d1 = makeDraft('cit-0001', 'SV-01', { qty: 1 });
  const q1 = await j('POST', `/api/drafts/${d1}/payment`, { cookie: c });
  assert.equal(ctx.db.prepare('SELECT case_no FROM drafts WHERE id = ?').get(d1).case_no, null);
  await setClock('2026-12-31T23:59:00+07:00');
  const p1 = await j('POST', `/api/test/payments/${q1.data.ref}/pay`, { body: { amount: 20 } });
  assert.equal(p1.data.caseNo, 'EG-2569-000031');
  assert.equal(p1.data.receiptNo, 'RC-2569-000031');
  assert.equal(p1.data.paidAt, '2026-12-31T23:59:00+07:00');
  await setClock('2027-01-01T00:00:00+07:00');
  for (const [no, rc] of [
    ['EG-2570-000001', 'RC-2570-000001'],
    ['EG-2570-000002', 'RC-2570-000002'],
  ]) {
    const d = makeDraft('cit-0001', 'SV-01', { qty: 1 });
    const q = await j('POST', `/api/drafts/${d}/payment`, { cookie: c });
    const p = await j('POST', `/api/test/payments/${q.data.ref}/pay`, { body: { amount: 20 } });
    assert.equal(p.data.caseNo, no);
    assert.equal(p.data.receiptNo, rc);
  }
  assert.ok(ctx.caseEvents.get('EG-2569-000031'));
});

test('คำขอใหม่: SUBMITTED · dueAt จาก rules (P03) · ไทม์ไลน์ PAID · ไฟล์ผูกเลขคำขอ · ร่าง PAID · SV-03 step 1', async () => {
  await reset();
  const c = loginAs('cit-0001');
  const d = makeDraft('cit-0001', 'SV-01', { qty: 2 });
  const q = await j('POST', `/api/drafts/${d}/payment`, { cookie: c });
  assert.equal(q.data.amount, 40);
  const p = await j('POST', `/api/test/payments/${q.data.ref}/pay`, { body: { amount: 40 } });
  const row = ctx.caseEvents.get(p.data.caseNo);
  assert.equal(row.status, 'SUBMITTED');
  assert.equal(row.dept, 'registry');
  assert.equal(row.step, null);
  assert.equal(row.owner, null);
  assert.equal(row.issuer, null);
  assert.equal(row.fee, 40);
  assert.equal(row.qty, 2);
  assert.equal(row.paid_at, '2026-12-01T09:00:00+07:00');
  assert.equal(row.due_at, ctx.rules.forContext(ctx).computeDueAt('2026-12-01T09:00:00+07:00', 'SV-01'));
  assert.equal(row.due_at, '2026-12-04T16:30:00+07:00');
  assert.equal(p.data.dueAt, '2026-12-04T16:30:00+07:00');
  assert.equal(row.receipt_no, p.data.receiptNo);
  assert.equal(row.payment_ref, q.data.ref);
  assert.equal(row.draft_id, d);
  const tl = ctx.caseEvents.timeline(p.data.caseNo);
  assert.equal(tl.length, 1);
  assert.equal(tl[0].event, 'PAID');
  assert.equal(tl[0].toStatus, 'SUBMITTED');
  assert.equal(tl[0].actor, 'cit-0001');
  assert.equal(tl[0].at, '2026-12-01T09:00:00+07:00');
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM files WHERE draft_id = ? AND case_no = ?').get(d, p.data.caseNo).n, 1);
  const dr = ctx.db.prepare('SELECT * FROM drafts WHERE id = ?').get(d);
  assert.equal(dr.status, 'PAID');
  assert.equal(dr.case_no, p.data.caseNo);
  // ชำระแล้วสร้าง QR อีกไม่ได้
  assert.equal((await j('POST', `/api/drafts/${d}/payment`, { cookie: c })).status, 409);
  // SV-03 ขั้น 1/3 · SLA 15
  const d3 = makeDraft('cit-0001', 'SV-03', { area: 101 });
  const q3 = await j('POST', `/api/drafts/${d3}/payment`, { cookie: c });
  assert.equal(q3.data.amount, 1010);
  const p3 = await j('POST', `/api/test/payments/${q3.data.ref}/pay`, { body: { amount: 1010 } });
  const r3 = ctx.caseEvents.get(p3.data.caseNo);
  assert.equal(r3.step, 1);
  assert.equal(r3.dept, 'registry');
  assert.equal(r3.area_sqm, 101);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM files WHERE case_no = ?').get(p3.data.caseNo).n, 3);
});

test('MISSING_DOCS: SV-03 ขาดแบบแปลน → 409 + missing · ครบแล้ว 201', async () => {
  await reset();
  const c = loginAs('cit-0001');
  const d = makeDraft('cit-0001', 'SV-03', { area: 120, docs: ['id-card', 'deed'] });
  const r = await j('POST', `/api/drafts/${d}/payment`, { cookie: c });
  assert.equal(r.status, 409);
  assert.deepEqual(r.data, { code: 'MISSING_DOCS', message: 'ยังขาดเอกสาร: แบบแปลน', missing: ['แบบแปลน'] });
  assert.equal(ctx.db.prepare('SELECT status FROM drafts WHERE id = ?').get(d).status, 'DRAFT');
  const d2 = makeDraft('cit-0001', 'SV-03', { area: 120, docs: ['id-card'] });
  const r2 = await j('POST', `/api/drafts/${d2}/payment`, { cookie: c });
  assert.deepEqual(r2.data.missing, ['แบบแปลน', 'โฉนด']);
  assert.equal(r2.data.message, 'ยังขาดเอกสาร: แบบแปลน, โฉนด');
  ctx.db
    .prepare(`INSERT INTO files(id, draft_id, doc_key, name, mime, size, storage, uploaded_at) VALUES (?, ?, 'plan', 'plan.pdf', 'application/pdf', 10, 'x', ?)`)
    .run(ctx.ids.fileId(), d, ctx.clock.nowIso());
  const ok = await j('POST', `/api/drafts/${d}/payment`, { cookie: c });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.amount, 1200);
});

test('BR-11 ยอดล็อก: admin แก้ SV-02 เป็น ฿600 → PP-0001 จ่าย 600 = 422 · 500 = 200 · QR ใหม่ของร่างเดิมยัง ฿500 · ร่างใหม่ ฿600', async () => {
  await reset();
  ctx.db.prepare("UPDATE services SET fee = 600 WHERE id = 'SV-02'").run();
  const c = loginAs('cit-0001');
  const q = await j('POST', '/api/drafts/DR-0002/payment', { cookie: c });
  assert.equal(q.data.amount, 500);
  const bad = await j('POST', '/api/test/payments/PP-0001/pay', { body: { amount: 600 } });
  assert.equal(bad.status, 422);
  const ok = await j('POST', '/api/test/payments/PP-0001/pay', { body: { amount: 500 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.caseNo, 'EG-2569-000031');
  // ref อื่นของร่างเดียวกันใช้ไม่ได้แล้ว
  const other = await j('POST', `/api/test/payments/${q.data.ref}/pay`, { body: { amount: 500 } });
  assert.equal(other.status, 409);
  assert.equal((await j('GET', `/api/payments/${q.data.ref}`, { cookie: c })).data.status, 'EXPIRED');
  const d = makeDraft('cit-0001', 'SV-02');
  const q2 = await j('POST', `/api/drafts/${d}/payment`, { cookie: c });
  assert.equal(q2.data.amount, 600);
  // admin แก้อีกหลังร่างนี้ล็อกแล้ว → ยอดเดิม
  ctx.db.prepare("UPDATE services SET fee = 700 WHERE id = 'SV-02'").run();
  const q3 = await j('POST', `/api/drafts/${d}/payment`, { cookie: c });
  assert.equal(q3.data.amount, 600);
});

test('สิทธิ์และ 404: ไม่ล็อกอิน 401 · admin 403 · ร่าง/ref ของคนอื่น 404 · ref ไม่มี 404 · ร่างถูกลบ ref เป็น 404', async () => {
  await reset();
  assert.equal((await j('POST', '/api/drafts/DR-0002/payment')).status, 401);
  assert.equal((await j('GET', '/api/payments/PP-0001')).status, 401);
  const adm = loginAs('admin1');
  assert.equal((await j('POST', '/api/drafts/DR-0002/payment', { cookie: adm })).status, 403);
  assert.equal((await j('GET', '/api/payments/PP-0001', { cookie: adm })).status, 403);
  const off = loginAs('off.reg1');
  assert.equal((await j('GET', '/api/payments/PP-0001', { cookie: off })).status, 403);
  const other = loginAs('cit-0002');
  const r = await j('POST', '/api/drafts/DR-0002/payment', { cookie: other });
  assert.equal(r.status, 404);
  assert.equal(r.data.code, 'NOT_FOUND');
  assert.equal((await j('GET', '/api/payments/PP-0001', { cookie: other })).status, 404);
  const own = loginAs('cit-0001');
  assert.equal((await j('GET', '/api/payments/PP-9999', { cookie: own })).status, 404);
  assert.equal((await j('POST', '/api/test/payments/PP-9999/pay', { body: { amount: 1 } })).status, 404);
  const g = await j('GET', '/api/payments/PP-0001', { cookie: own });
  assert.deepEqual(
    { ref: g.data.ref, amount: g.data.amount, status: g.data.status, qrCreatedAt: g.data.qrCreatedAt, qrExpiresAt: g.data.qrExpiresAt, caseNo: g.data.caseNo, receiptNo: g.data.receiptNo },
    { ref: 'PP-0001', amount: 500, status: 'PENDING', qrCreatedAt: '2026-12-01T08:55:00+07:00', qrExpiresAt: '2026-12-01T09:10:00+07:00', caseNo: null, receiptNo: null }
  );
  // จำลอง P04 DELETE /api/drafts/DR-0002
  ctx.db.prepare("DELETE FROM files WHERE draft_id = 'DR-0002'").run();
  ctx.db.prepare("DELETE FROM drafts WHERE id = 'DR-0002'").run();
  assert.equal((await j('GET', '/api/payments/PP-0001', { cookie: own })).status, 404);
  assert.equal((await j('POST', '/api/test/payments/PP-0001/pay', { body: { amount: 500 } })).status, 404);
  assert.equal(ctx.db.prepare("SELECT COUNT(*) n FROM cases WHERE case_no = 'EG-2569-000031'").get().n, 0);
});

test('ส่วนหน้า: panel ก่อนสร้าง QR มี create-qr-btn · สคริปต์เสิร์ฟได้ · QR svg', async () => {
  await reset();
  const c = loginAs('cit-0001');
  const html = await j('GET', '/api/drafts/DR-0001/payment?format=html', { cookie: c });
  assert.match(html.data.html, /data-testid="payment-amount">฿40</);
  assert.match(html.data.html, /data-testid="create-qr-btn"[^>]*>สร้าง QR</);
  assert.doesNotMatch(html.data.html, /qr-ref/);
  const js = await req('GET', '/static/payment/payment.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  const svg = await req('GET', '/api/payments/PP-0001/qr.svg', { cookie: c });
  assert.equal(svg.status, 200);
  assert.match(await svg.text(), /^<svg/);
});

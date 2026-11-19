'use strict';
// P06 · คำขอของประชาชน: รายการ รายละเอียด ยกเลิก ส่งแก้ไข 168 ชม. (HTTP จริงกับ seed)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServer } = require('../../server');
const { bugs } = require('../../core/bugs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'egov-cases-'));
let base;
let server;
let ctx;

function req(method, url, { body, cookie } = {}) {
  const h = {};
  if (cookie) h.cookie = cookie;
  let payload = body;
  if (body !== undefined && !(body instanceof FormData)) {
    h['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  return fetch(base + url, { method, headers: h, body: payload, redirect: 'manual' });
}

function loginAs(username) {
  const u = ctx.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const sid = ctx.crypto.randomHex(16) + username.replace(/\W/g, '');
  ctx.db
    .prepare('INSERT INTO sessions(sid, user_id, role, dept, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sid, u.id, u.role, u.dept, 'full', ctx.clock.nowIso());
  return `eg_sid=${sid}`;
}

async function reset(now) {
  bugs.set('');
  await ctx.reset();
  if (now) ctx.clock.set(now);
}

const SOMCHAI = 'cit-0001';
const SOMYING = 'cit-0002';

test.before(async () => {
  const r = await createServer({ env: { DB_PATH: path.join(tmp, 'app.db'), TEST_MODE: '1' }, log: () => {} });
  ctx = r.ctx;
  server = await new Promise((resolve) => {
    const s = r.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  bugs.set('');
  server.close();
  ctx.db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('/citizen: คำขอ 10 แถวเรียงเลขมาก→น้อย + ร่าง 2 แถว (ไม่มี EG-) + ปุ่มเริ่ม 3 บริการ + dueAt/ระดับเตือน', async () => {
  await reset();
  const c = loginAs(SOMCHAI);
  const r = await req('GET', '/citizen', { cookie: c });
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /data-testid="citizen-welcome">สวัสดี สมชาย ใจดี</);
  for (const s of ['SV-01', 'SV-02', 'SV-03']) assert.match(html, new RegExp(`data-testid="start-service-${s}" href="/citizen/new/${s}"`));
  const caseNos = [...html.matchAll(/data-testid="my-case-row" data-case-no="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(caseNos.length, 10);
  assert.deepEqual(caseNos, [...caseNos].sort().reverse());
  const drafts = [...html.matchAll(/<tr data-testid="my-draft-row"[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  assert.equal(drafts.length, 2);
  assert.match(drafts.join(''), /data-draft-id="DR-0001" data-status="DRAFT"/);
  assert.match(drafts.join(''), /data-draft-id="DR-0002" data-status="PENDING_PAYMENT"/);
  for (const d of drafts) assert.doesNotMatch(d, /EG-/);
  assert.match(html, /data-testid="open-draft-btn" href="\/citizen\/new\/SV-01\?draft=DR-0001"/);
  // แถว …000020 เกินกำหนด · …000017 หยุดนับ
  assert.match(html, /data-case-no="EG-2569-000020"[\s\S]*?data-testid="row-due" data-iso="2026-11-30T16:30:00\+07:00"[\s\S]*?data-level="overdue"/);
  assert.match(html, /data-case-no="EG-2569-000017"[\s\S]*?data-level="paused"/);

  const api = await (await req('GET', '/api/cases', { cookie: c })).json();
  assert.equal(api.items.length, 10);
  const o01 = api.items.find((x) => x.caseNo === 'EG-2569-000020');
  assert.deepEqual(o01, { caseNo: 'EG-2569-000020', serviceId: 'SV-01', status: 'IN_REVIEW', dueAt: '2026-11-30T16:30:00+07:00', slaLevel: 'overdue' });
});

test('GET /api/cases/:caseNo รูปแบบ CONTRACT 6.7 · เจ้าของได้ idNo · staff ได้ idMasked · executive/auditor 403', async () => {
  await reset();
  const own = await (await req('GET', '/api/cases/EG-2569-000025', { cookie: loginAs(SOMYING) })).json();
  assert.equal(own.idNo, '3100600987659');
  assert.equal(own.idMasked, undefined);
  const r = await req('GET', '/api/cases/EG-2569-000025', { cookie: loginAs('off.reg2') });
  assert.equal(r.status, 200);
  const raw = await r.text();
  assert.doesNotMatch(raw, /\d{13}|\d-\d{4}-\d{5}-\d{2}-\d/);
  const j = JSON.parse(raw);
  assert.equal(j.idNo, undefined);
  for (const [k, v] of Object.entries({
    caseNo: 'EG-2569-000025', serviceId: 'SV-01', status: 'IN_REVIEW', step: null, fee: 60,
    paidAt: '2026-11-30T10:00:00+07:00', dueAt: '2026-12-03T16:30:00+07:00', slaLevel: 'normal',
    owner: 'off.reg2', returnCount: 0, closedAt: null, applicantName: 'สมหญิง รักไทย',
    idMasked: 'X-XXXX-XXXXX-65-9', fixDeadline: null, docNo: null, verifyCode: null,
  })) assert.deepEqual(j[k], v, k);
  const w01 = await (await req('GET', '/api/cases/EG-2569-000010', { cookie: loginAs('head1') })).json();
  assert.equal(w01.step, 2);
  const h03 = await (await req('GET', '/api/cases/EG-2569-000005', { cookie: loginAs(SOMCHAI) })).json();
  assert.equal(h03.docNo, 'DOC-2569-000001');
  assert.equal(h03.verifyCode, 'K7M2Q9XA');
  for (const u of ['exec1', 'audit1', 'admin1']) {
    assert.equal((await req('GET', '/api/cases/EG-2569-000025', { cookie: loginAs(u) })).status, 403, u);
  }
  assert.equal((await req('GET', '/api/cases/EG-2569-000025')).status, 401);
});

test('BR-22 IDOR: สมหญิงเปิดของสมชาย → 404 เหมือนเลขที่ไม่มี · B06 เปิดได้', async () => {
  await reset();
  const c = loginAs(SOMYING);
  const a = await req('GET', '/api/cases/EG-2569-000005', { cookie: c });
  const b = await req('GET', '/api/cases/EG-2569-999999', { cookie: c });
  assert.equal(a.status, 404);
  assert.equal(b.status, 404);
  assert.equal(await a.text(), await b.text());
  const p = await req('GET', '/citizen/cases/EG-2569-000005', { cookie: c });
  assert.equal(p.status, 404);
  const html = await p.text();
  assert.match(html, /data-testid="not-found-msg">ไม่พบคำขอ</);
  assert.doesNotMatch(html, /สมชาย|data-testid="case-no"/);
  assert.equal((await req('POST', '/api/cases/EG-2569-000030/cancel', { cookie: c })).status, 404);

  bugs.set(['B06']);
  try {
    assert.equal((await req('GET', '/api/cases/EG-2569-000005', { cookie: c })).status, 200);
    assert.equal((await req('GET', '/citizen/cases/EG-2569-000005', { cookie: c })).status, 200);
  } finally {
    bugs.set('');
  }
});

test('FR-10 ยกเลิก: SUBMITTED ไม่มีผู้รับได้ (มี confirm) · มีผู้รับ/IN_REVIEW → 409 CANNOT_CANCEL', async () => {
  await reset();
  const c = loginAs(SOMCHAI);
  let html = await (await req('GET', '/citizen/cases/EG-2569-000030', { cookie: c })).text();
  assert.match(html, /data-testid="cancel-case-btn"/);
  assert.match(html, /data-testid="cancel-confirm-text">ค่าธรรมเนียมที่ชำระแล้วไม่คืน</);
  assert.match(html, /data-testid="confirm-cancel-btn"/);
  assert.doesNotMatch(html, /data-testid="no-refund-note"/);
  assert.doesNotMatch(html, /data-testid="case-step"/);

  const r = await req('POST', '/api/cases/EG-2569-000030/cancel', { cookie: c });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { status: 'CANCELLED' });
  html = await (await req('GET', '/citizen/cases/EG-2569-000030', { cookie: c })).text();
  assert.match(html, /data-testid="case-status" data-status="CANCELLED">ยกเลิก</);
  assert.match(html, /data-testid="no-refund-note">ค่าธรรมเนียมที่ชำระแล้วไม่คืน</);
  assert.doesNotMatch(html, /data-testid="cancel-case-btn"/);
  assert.match(html, /data-level="closed"/);
  const row = ctx.db.prepare('SELECT * FROM cases WHERE case_no = ?').get('EG-2569-000030');
  assert.equal(row.cancelled_at, '2026-12-01T09:00:00+07:00');
  assert.equal(row.dept, null);

  const again = await req('POST', '/api/cases/EG-2569-000030/cancel', { cookie: c });
  assert.equal(again.status, 409);
  assert.deepEqual(await again.json(), { code: 'CANNOT_CANCEL', message: 'ยกเลิกไม่ได้ คำขอมีเจ้าหน้าที่รับเรื่องแล้ว' });
  const ir = await req('POST', '/api/cases/EG-2569-000013/cancel', { cookie: c });
  assert.equal(ir.status, 409);
  html = await (await req('GET', '/citizen/cases/EG-2569-000013', { cookie: c })).text();
  assert.doesNotMatch(html, /data-testid="cancel-case-btn"/);
  // เจ้าหน้าที่/ผู้ดูแลเรียกไม่ได้
  assert.equal((await req('POST', '/api/cases/EG-2569-000030/cancel', { cookie: loginAs('admin1') })).status, 403);

  // มีผู้รับแล้ว (จำลอง claim) → 409
  await reset();
  ctx.db.prepare("UPDATE cases SET status='IN_REVIEW', owner='off.reg1' WHERE case_no='EG-2569-000030'").run();
  assert.equal((await req('POST', '/api/cases/EG-2569-000030/cancel', { cookie: loginAs(SOMCHAI) })).status, 409);
});

test('BR-20 · TC-WORKFLOW-06: 167:59 ส่งแก้ได้ (ผู้ถือเดิม)', async () => {
  await reset('2026-12-04T13:59:00+07:00');
  const c = loginAs(SOMCHAI);
  const html = await (await req('GET', '/citizen/cases/EG-2569-000017', { cookie: c })).text();
  assert.match(html, /data-testid="case-status" data-status="NEED_FIX"/);
  assert.match(html, /data-testid="return-reason-display">ชื่อในเอกสารไม่ตรงกับบัตร กรุณาแก้ไข</);
  assert.match(html, /data-testid="fix-deadline" data-iso="2026-12-04T14:00:00\+07:00"[^>]*>4 ธ.ค. 2569 14:00</);
  assert.match(html, /data-testid="submit-fix-btn"/);
  assert.match(html, /data-testid="sla-level"[^>]*data-level="paused">หยุดนับ</);
  const r = await req('POST', '/api/cases/EG-2569-000017/resubmit', { cookie: c });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.status, 'IN_REVIEW');
  const row = ctx.db.prepare('SELECT * FROM cases WHERE case_no = ?').get('EG-2569-000017');
  assert.equal(row.owner, 'off.reg1');
  assert.equal(row.status, 'IN_REVIEW');
  assert.equal(row.fix_deadline, null);
  assert.equal(row.due_at, j.dueAt);
  const ret = ctx.db.prepare('SELECT * FROM returns WHERE case_no = ? AND seq = 2').get('EG-2569-000017');
  assert.equal(ret.resubmitted_at, '2026-12-04T13:59:00+07:00');
  // ส่งซ้ำ → 409 INVALID_STATE
  const again = await req('POST', '/api/cases/EG-2569-000017/resubmit', { cookie: c });
  assert.equal(again.status, 409);
  assert.equal((await again.json()).code, 'INVALID_STATE');
});

test('BR-20 · A-46: 168:00 ยกเลิกอัตโนมัติ (ไทม์ไลน์ = เส้นตาย) → resubmit 409 FIX_WINDOW_EXPIRED', async () => {
  await reset('2026-12-04T14:00:00+07:00');
  const c = loginAs(SOMCHAI);
  const html = await (await req('GET', '/citizen/cases/EG-2569-000017', { cookie: c })).text();
  assert.match(html, /data-testid="case-status" data-status="CANCELLED">ยกเลิก</);
  assert.doesNotMatch(html, /data-testid="submit-fix-btn"/);
  assert.match(html, /data-testid="no-refund-note"/);
  assert.match(html, /data-testid="timeline-item" data-iso="2026-12-04T14:00:00\+07:00" data-event="AUTO_CANCEL"/);
  const r = await req('POST', '/api/cases/EG-2569-000017/resubmit', { cookie: c });
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { code: 'FIX_WINDOW_EXPIRED', message: 'หมดเวลาแก้ไขแล้ว คำขอถูกยกเลิก' });
  const row = ctx.db.prepare('SELECT * FROM cases WHERE case_no = ?').get('EG-2569-000017');
  assert.equal(row.cancelled_at, '2026-12-04T14:00:00+07:00');
  // idempotent: request ซ้ำไม่เพิ่มไทม์ไลน์
  await req('GET', '/api/cases', { cookie: c });
  const n = ctx.db.prepare("SELECT COUNT(*) AS n FROM case_timeline WHERE case_no = ? AND event = 'AUTO_CANCEL'").get('EG-2569-000017').n;
  assert.equal(n, 1);
});

test('resubmit ผ่าน API โดยตรงที่ 168:00 (ก่อนมี request อื่น) ก็ได้ 409 FIX_WINDOW_EXPIRED', async () => {
  await reset();
  const c = loginAs(SOMCHAI);
  ctx.clock.set('2026-12-05T08:00:00+07:00');
  const r = await req('POST', '/api/cases/EG-2569-000017/resubmit', { cookie: c });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, 'FIX_WINDOW_EXPIRED');
});

test('BR-13 · TC-SLA-02 ส่วน 2: ส่งแก้ …017 ที่ 1 ธ.ค. 09:00 → dueAt 1 ธ.ค. 16:30 near · B04 → คงเดิม', async () => {
  await reset();
  const c = loginAs(SOMCHAI);
  const r = await req('POST', '/api/cases/EG-2569-000017/resubmit', { cookie: c });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { status: 'IN_REVIEW', dueAt: '2026-12-01T16:30:00+07:00' });
  const j = await (await req('GET', '/api/cases/EG-2569-000017', { cookie: c })).json();
  assert.equal(j.slaLevel, 'near');
  assert.equal(j.owner, 'off.reg1');

  await reset('2026-12-04T10:00:00+07:00');
  const r3 = await (await req('POST', '/api/cases/EG-2569-000017/resubmit', { cookie: loginAs(SOMCHAI) })).json();
  assert.equal(r3.dueAt, '2026-12-04T16:30:00+07:00');

  await reset();
  bugs.set(['B04']);
  try {
    const rb = await (await req('POST', '/api/cases/EG-2569-000017/resubmit', { cookie: loginAs(SOMCHAI) })).json();
    assert.equal(rb.dueAt, '2026-11-27T16:30:00+07:00');
  } finally {
    bugs.set('');
  }
});

test('resubmit แนบไฟล์ใหม่ (multipart) · ไฟล์ผิดชนิด → 400 FILE_TYPE ไม่เปลี่ยนสถานะ', async () => {
  await reset();
  const c = loginAs(SOMCHAI);
  const bad = new FormData();
  bad.append('file', new Blob([Buffer.from('hello world')], { type: 'text/plain' }), 'x.txt');
  const rb = await req('POST', '/api/cases/EG-2569-000017/resubmit', { cookie: c, body: bad });
  assert.equal(rb.status, 400);
  assert.equal((await rb.json()).code, 'FILE_TYPE');
  assert.equal(ctx.db.prepare('SELECT status FROM cases WHERE case_no = ?').get('EG-2569-000017').status, 'NEED_FIX');

  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('%PDF-1.4\n%%EOF\n')], { type: 'application/pdf' }), 'ใหม่.pdf');
  const r = await req('POST', '/api/cases/EG-2569-000017/resubmit', { cookie: c, body: fd });
  assert.equal(r.status, 200);
  const files = ctx.db.prepare('SELECT * FROM files WHERE case_no = ? ORDER BY id').all('EG-2569-000017');
  assert.equal(files.length, 2);
  assert.equal(files[1].name, 'ใหม่.pdf');
  assert.equal(files[1].mime, 'application/pdf');
  const html = await (await req('GET', '/citizen/cases/EG-2569-000017', { cookie: c })).text();
  assert.equal((html.match(/data-testid="doc-item"/g) || []).length, 2);
});

test('หน้า /citizen/cases: case-id-full ของตัวเอง · ขั้นตอน SV-03 · closed-at เฉพาะ COMPLETED/REJECTED · ผู้ไม่ใช่ citizen 403', async () => {
  await reset();
  const c = loginAs(SOMYING);
  let html = await (await req('GET', '/citizen/cases/EG-2569-000025', { cookie: c })).text();
  assert.match(html, /data-testid="case-id-full">3-1006-00987-65-9</);
  assert.match(html, /data-testid="case-service">SV-01 ขอหนังสือรับรอง</);
  assert.match(html, /data-testid="case-fee">฿60</);
  assert.match(html, /data-testid="sla-due" data-iso="2026-12-03T16:30:00\+07:00"/);
  assert.doesNotMatch(html, /data-testid="closed-at"/);
  html = await (await req('GET', '/citizen/cases/EG-2569-000010', { cookie: c })).text();
  assert.match(html, /data-testid="case-step">ขั้นตอน 2\/3 · ฝ่ายโยธา</);
  html = await (await req('GET', '/citizen/cases/EG-2569-000008', { cookie: c })).text();
  assert.match(html, /data-testid="closed-at" data-iso="2026-11-11T09:00:00\+07:00"/);
  assert.match(html, /data-testid="no-refund-note"/);
  html = await (await req('GET', '/citizen/cases/EG-2569-000005', { cookie: loginAs(SOMCHAI) })).text();
  assert.match(html, /data-testid="doc-no">DOC-2569-000001</);
  assert.match(html, /data-testid="download-doc-btn"/);
  assert.match(html, /data-testid="timeline-item" data-iso="/);
  assert.equal((await req('GET', '/citizen', { cookie: loginAs('off.reg1') })).status, 403);
  assert.equal((await req('GET', '/citizen/cases/EG-2569-000025', { cookie: loginAs('off.reg1') })).status, 403);
});

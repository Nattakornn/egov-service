'use strict';
// P09 · BR-23 (อายุเอกสาร · 29 ก.พ.) + FR-17/FR-18 ผ่าน HTTP บน server ชั่วคราว (โหลดเฉพาะโมดูล documents)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const docs = require('./index');

// ---------------------------------------------------------------------------
// BR-23 · A-43 · A-61 (ตัวอย่างใน REQUIREMENTS)
// ---------------------------------------------------------------------------
test('BR-23 SV-01 90 วัน: ออก 1 ธ.ค. 69 → ใช้ได้ถึง 28 ก.พ. 70', () => {
  assert.equal(docs.validUntilFor('SV-01', '2026-12-01T09:00:00+07:00'), '2027-02-28');
  assert.equal(docs.isExpired('2027-02-28', '2027-02-28T23:59:00+07:00'), false);
  assert.equal(docs.isExpired('2027-02-28', '2027-03-01T00:00:00+07:00'), true);
});

test('BR-23 SV-02/03 1 ปี: ออก 1 ธ.ค. 69 → ใช้ได้ถึง 30 พ.ย. 70', () => {
  for (const sv of ['SV-02', 'SV-03']) {
    assert.equal(docs.validUntilFor(sv, '2026-12-01T09:00:00+07:00'), '2027-11-30');
  }
  assert.equal(docs.isExpired('2027-11-30', '2027-11-30T23:59:00+07:00'), false);
  assert.equal(docs.isExpired('2027-11-30', '2027-12-01T00:00:00+07:00'), true);
});

test('BR-23 seed DOC-2569-000001: ออก 5 พ.ย. 69 → 2 ก.พ. 70 (ออก + 89 วัน)', () => {
  assert.equal(docs.validUntilFor('SV-01', '2026-11-05T10:00:00+07:00'), '2027-02-02');
  assert.equal(docs.isExpired('2027-02-02', '2027-02-02T23:59:00+07:00'), false);
  assert.equal(docs.isExpired('2027-02-02', '2027-02-03T00:00:00+07:00'), true);
});

test('BR-23 / A-61 ออก 29 ก.พ. 2571 (ค.ศ. 2028)', () => {
  // SV-01: ออก + 89 วัน
  assert.equal(docs.validUntilFor('SV-01', '2028-02-29T10:00:00+07:00'), '2028-05-28');
  // SV-02/03: ครบรอบใช้ 28 ก.พ. 2572 → −1 วัน = 27 ก.พ. 2572
  assert.equal(docs.validUntilFor('SV-02', '2028-02-29T10:00:00+07:00'), '2029-02-27');
  assert.equal(docs.validUntilFor('SV-03', '2028-02-29T10:00:00+07:00'), '2029-02-27');
  assert.equal(docs.isExpired('2029-02-27', '2029-02-27T23:59:00+07:00'), false);
  assert.equal(docs.isExpired('2029-02-27', '2029-02-28T00:00:00+07:00'), true);
});

test('BR-23 ขอบอื่น: ออก 28 ก.พ. 2570 / 1 มี.ค. 2570 / ข้ามปีอธิกสุรทิน · เวลาไทยใกล้เที่ยงคืน', () => {
  assert.equal(docs.validUntilFor('SV-02', '2027-02-28T10:00:00+07:00'), '2028-02-27');
  assert.equal(docs.validUntilFor('SV-02', '2027-03-01T10:00:00+07:00'), '2028-02-29'); // ครบรอบ 1 มี.ค. 2571 − 1 = 29 ก.พ.
  assert.equal(docs.validUntilFor('SV-01', '2027-12-15T10:00:00+07:00'), '2028-03-13'); // ผ่าน 29 ก.พ. 2028
  // 00:30 เวลาไทย (= 17:30Z วันก่อน) ต้องนับวันไทย
  assert.equal(docs.validUntilFor('SV-01', '2026-12-01T00:30:00+07:00'), '2027-02-28');
  assert.equal(docs.validUntilFor('SV-01', '2026-11-30T17:30:00Z'), '2027-02-28');
});

// ---------------------------------------------------------------------------
// HTTP (FR-17 · FR-18 · FR-28 tamper)
// ---------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'egov-docs-'));
const modDir = path.join(tmp, 'modules');
fs.mkdirSync(path.join(modDir, 'documents'), { recursive: true });
fs.writeFileSync(path.join(modDir, 'documents', 'index.js'), `module.exports = require(${JSON.stringify(path.join(__dirname, 'index.js'))});`);

let base;
let server;
let ctx;

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
function loginAs(username) {
  const u = ctx.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const sid = ctx.crypto.randomHex(16) + username.replace(/\W/g, '');
  ctx.db.prepare('INSERT INTO sessions(sid, user_id, role, dept, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(sid, u.id, u.role, u.dept, 'full', ctx.clock.nowIso());
  return `eg_sid=${sid}`;
}
async function reset() {
  const r = await req('POST', '/api/test/reset');
  assert.equal(r.status, 200);
}
/** จำลองการอนุมัติ (P08) โดยตรงใน DB */
function approve(caseNo, by) {
  ctx.db.prepare("UPDATE cases SET status='APPROVED', approved_by=?, approved_at=?, owner=NULL, dept='registry' WHERE case_no=?").run(by, ctx.clock.nowIso(), caseNo);
}
async function setClock(now) {
  const r = await req('PUT', '/api/test/clock', { body: { now } });
  assert.equal(r.status, 200);
}
function pdfStreamsText(buf) {
  // ถอด FlateDecode ทุก stream แล้วรวม (ตรวจว่ามีข้อความ Helvetica ของบรรทัด ASCII อยู่ใน content)
  const s = buf.toString('latin1');
  const out = [];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) break;
    try {
      out.push(zlib.inflateSync(buf.subarray(start, end)).toString('latin1'));
    } catch (_) {
      /* ไม่ใช่ flate */
    }
  }
  return out.join('\n');
}

test.before(async () => {
  const { createServer } = require('../../server');
  const r = await createServer({ env: { DB_PATH: path.join(tmp, 'app.db'), TEST_MODE: '1' }, modulesDir: modDir, log: () => {} });
  ctx = r.ctx;
  server = await new Promise((resolve) => {
    const s = r.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  if (server) server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('FR-18 seed K7M2Q9XA: VALID ไม่ต้องล็อกอิน · ชื่อปิดบัง · 404 ไม่พบเอกสาร', async () => {
  await reset();
  const page = await req('GET', '/verify/K7M2Q9XA');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /data-testid="verify-result" data-result="VALID">เอกสารถูกต้อง</);
  assert.match(html, /data-testid="verify-doc-no">DOC-2569-000001</);
  assert.match(html, /data-testid="verify-applicant">สมชาย ใ\*\*\*</);
  assert.match(html, /data-testid="verify-service">SV-01 ขอหนังสือรับรอง</);
  assert.match(html, /data-testid="verify-issued" data-iso="2026-11-05T10:00:00\+07:00"/);
  assert.match(html, /data-testid="verify-expires" data-iso="2027-02-02"[^>]*>2 ก\.พ\. 2570</);
  assert.match(html, /data-testid="verify-signer">เจ้าหน้าที่ทะเบียน 1</);
  assert.ok(!html.includes('ใจดี'), 'ห้ามมีนามสกุลเต็ม');

  const api = await req('GET', '/api/verify/K7M2Q9XA');
  assert.equal(api.status, 200);
  assert.deepEqual(await api.json(), {
    result: 'VALID',
    docNo: 'DOC-2569-000001',
    applicantMasked: 'สมชาย ใ***',
    serviceId: 'SV-01',
    issuedAt: '2026-11-05T10:00:00+07:00',
    validUntil: '2027-02-02',
    signer: 'เจ้าหน้าที่ทะเบียน 1',
  });

  const nf = await req('GET', '/verify/ZZZZZZZZ');
  assert.equal(nf.status, 404);
  const nfHtml = await nf.text();
  assert.match(nfHtml, /data-result="NOT_FOUND">ไม่พบเอกสาร</);
  assert.ok(!nfHtml.includes('verify-applicant') && !nfHtml.includes('verify-doc-no'));
  const nfApi = await req('GET', '/api/verify/ZZZZZZZZ');
  assert.equal(nfApi.status, 404);
  assert.deepEqual(await nfApi.json(), { result: 'NOT_FOUND' });
});

test('FR-18 seed หมดอายุตั้งแต่ 3 ก.พ. 70 00:00 · tamper → TAMPERED (ก่อน EXPIRED)', async () => {
  await reset();
  await setClock('2027-02-02T23:59:00+07:00');
  assert.equal((await (await req('GET', '/api/verify/K7M2Q9XA')).json()).result, 'VALID');
  await setClock('2027-02-03T00:00:00+07:00');
  const exp = await req('GET', '/verify/K7M2Q9XA');
  assert.equal(exp.status, 200);
  const expHtml = await exp.text();
  assert.match(expHtml, /data-result="EXPIRED">เอกสารหมดอายุ</);
  assert.match(expHtml, /data-testid="verify-expires" data-iso="2027-02-02"/);

  await reset();
  const t404 = await req('POST', '/api/test/documents/DOC-2569-999999/tamper');
  assert.equal(t404.status, 404);
  const t = await req('POST', '/api/test/documents/DOC-2569-000001/tamper');
  assert.equal(t.status, 200);
  assert.deepEqual(await t.json(), { ok: true });
  const tp = await req('GET', '/verify/K7M2Q9XA');
  assert.equal(tp.status, 200);
  const tpHtml = await tp.text();
  assert.match(tpHtml, /data-result="TAMPERED">ลายเซ็นไม่ถูกต้อง</);
  assert.ok(!tpHtml.includes('verify-doc-no') && !tpHtml.includes('verify-applicant') && !tpHtml.includes('สมชาย'));
  assert.deepEqual(await (await req('GET', '/api/verify/K7M2Q9XA')).json(), { result: 'TAMPERED' });
  await setClock('2027-03-01T00:00:00+07:00');
  assert.deepEqual(await (await req('GET', '/api/verify/K7M2Q9XA')).json(), { result: 'TAMPERED' });
});

test('FR-17 ออกเอกสาร SV-01 …000025 → DOC-2569-000002 · PDF เฉพาะเจ้าของ/เจ้าหน้าที่ · ออกซ้ำ 409', async () => {
  await reset();
  const C25 = 'EG-2569-000025';
  const reg2 = loginAs('off.reg2');
  const reg1 = loginAs('off.reg1');
  const head = loginAs('head1');

  // ยังไม่ APPROVED → 409 (ผู้ถือ) · ไม่ล็อกอิน 401
  assert.equal((await req('POST', `/api/officer/cases/${C25}/issue`)).status, 401);
  const early = await req('POST', `/api/officer/cases/${C25}/issue`, { cookie: reg2 });
  assert.equal(early.status, 409);
  assert.equal((await early.json()).code, 'INVALID_STATE');

  approve(C25, 'off.reg2');
  // ไม่ใช่ผู้ออกเอกสาร / หัวหน้า → 403 · ไม่มีเลข → 404
  for (const ck of [reg1, head]) {
    const f = await req('POST', `/api/officer/cases/${C25}/issue`, { cookie: ck });
    assert.equal(f.status, 403);
    assert.deepEqual(await f.json(), { code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์ทำรายการนี้' });
  }
  assert.equal((await req('POST', '/api/officer/cases/EG-2569-999999/issue', { cookie: reg2 })).status, 404);

  const r = await req('POST', `/api/officer/cases/${C25}/issue`, { cookie: reg2 });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.docNo, 'DOC-2569-000002');
  assert.equal(j.status, 'COMPLETED');
  assert.match(j.verifyCode, /^[A-Z0-9]{8}$/);

  const c = ctx.db.prepare('SELECT * FROM cases WHERE case_no = ?').get(C25);
  assert.equal(c.status, 'COMPLETED');
  assert.equal(c.closed_at, '2026-12-01T09:00:00+07:00');
  assert.equal(c.doc_no, 'DOC-2569-000002');
  assert.equal(c.dept, null);
  const a = ctx.db.prepare("SELECT * FROM audit WHERE event = 'ISSUE' AND case_no = ?").get(C25);
  assert.ok(a && a.detail.includes('DOC-2569-000002') && a.username === 'off.reg2' && a.from_status === 'APPROVED' && a.to_status === 'COMPLETED');
  const tl = ctx.caseEvents.timeline(C25).pop();
  assert.equal(tl.event, 'ISSUE');

  // verify
  const v = await (await req('GET', `/api/verify/${j.verifyCode}`)).json();
  assert.equal(v.result, 'VALID');
  assert.equal(v.validUntil, '2027-02-28');
  assert.equal(v.issuedAt, '2026-12-01T09:00:00+07:00');
  assert.equal(v.applicantMasked, 'สมหญิง ร***');
  assert.equal(v.signer, 'เจ้าหน้าที่ทะเบียน 2');

  // PDF: เจ้าของ (สมหญิง) ✓ · officer ✓ · สมชาย 404 · executive 403 · ไม่ล็อกอิน 401
  const owner = ctx.db.prepare('SELECT u.username FROM cases c JOIN users u ON u.id = c.citizen_id WHERE c.case_no = ?').get(C25).username;
  const ownerCk = loginAs(owner);
  const pdf = await req('GET', '/api/documents/DOC-2569-000002/pdf', { cookie: ownerCk });
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type'), /application\/pdf/);
  assert.match(pdf.headers.get('content-disposition'), /DOC-2569-000002\.pdf/);
  const buf = Buffer.from(await pdf.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
  const line = `docNo=DOC-2569-000002 caseNo=${C25} verify=${j.verifyCode} validUntil=2027-02-28`;
  assert.ok(buf.toString('latin1').includes(line), 'raw bytes มีบรรทัด ASCII');
  // บรรทัดเดียวกันถูกวาดเป็นข้อความ (Helvetica hex) ใน content stream
  const hex = Buffer.from(line, 'latin1').toString('hex');
  assert.ok(pdfStreamsText(buf).toLowerCase().replace(/[^0-9a-f<>]/g, '').includes(hex.slice(0, 40)), 'content stream มีข้อความบรรทัด ASCII');

  assert.equal((await req('GET', '/api/documents/DOC-2569-000002/pdf', { cookie: reg1 })).status, 200);
  assert.equal((await req('GET', '/api/documents/DOC-2569-000002/pdf', { cookie: head })).status, 200);
  const other = ctx.db.prepare("SELECT username FROM users WHERE role='citizen' AND registered=1 AND username <> ? ORDER BY username").get(owner).username;
  assert.equal((await req('GET', '/api/documents/DOC-2569-000002/pdf', { cookie: loginAs(other) })).status, 404);
  assert.equal((await req('GET', '/api/documents/DOC-2569-000002/pdf', { cookie: loginAs('exec1') })).status, 403);
  assert.equal((await req('GET', '/api/documents/DOC-2569-000002/pdf')).status, 401);
  assert.equal((await req('GET', '/api/documents/DOC-2569-999999/pdf', { cookie: reg1 })).status, 404);

  // ออกซ้ำ → 409 · เลขถัดไปยัง 000003 (…000019 SV-02 ผู้ออก off.reg1 ผู้ลงนาม หัวหน้าฝ่าย)
  const again = await req('POST', `/api/officer/cases/${C25}/issue`, { cookie: reg2 });
  assert.equal(again.status, 409);
  assert.equal((await again.json()).code, 'INVALID_STATE');
  const n = await (await req('POST', '/api/officer/cases/EG-2569-000019/issue', { cookie: reg1 })).json();
  assert.equal(n.docNo, 'DOC-2569-000003');
  const v19 = await (await req('GET', `/api/verify/${n.verifyCode}`)).json();
  assert.equal(v19.signer, 'หัวหน้าฝ่าย');
  assert.equal(v19.validUntil, '2027-11-30');

  // shared helper สำหรับหน้าเคส
  const sh = ctx.shared.documents;
  assert.equal(sh.forCase(C25).docNo, 'DOC-2569-000002');
  const panel = sh.panelHtml({ protocol: 'http', get: () => 'web:3000' }, C25, { citizen: true });
  assert.match(panel, new RegExp(`data-testid="doc-qr" data-url="http://web:3000/verify/${j.verifyCode}"`));
  assert.match(panel, /data-testid="download-doc-btn"/);
});

test('A-61 ออกเอกสาร 29 ก.พ. 2571 → DOC-2571-000001/2 · SV-01 2028-05-28 · SV-02 2029-02-27', async () => {
  await reset();
  await setClock('2028-02-29T10:00:00+07:00');
  approve('EG-2569-000025', 'off.reg2');
  const a = await (await req('POST', '/api/officer/cases/EG-2569-000025/issue', { cookie: loginAs('off.reg2') })).json();
  const b = await (await req('POST', '/api/officer/cases/EG-2569-000019/issue', { cookie: loginAs('off.reg1') })).json();
  assert.equal(a.docNo, 'DOC-2571-000001');
  assert.equal(b.docNo, 'DOC-2571-000002');
  assert.equal(a.validUntil, '2028-05-28');
  assert.equal(b.validUntil, '2029-02-27');
  await setClock('2029-02-27T23:59:00+07:00');
  assert.equal((await (await req('GET', `/api/verify/${b.verifyCode}`)).json()).result, 'VALID');
  await setClock('2029-02-28T00:00:00+07:00');
  assert.equal((await (await req('GET', `/api/verify/${b.verifyCode}`)).json()).result, 'EXPIRED');
});

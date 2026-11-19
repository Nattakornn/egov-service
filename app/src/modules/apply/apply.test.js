'use strict';
// P04 · unit/HTTP test ของโมดูล apply: ค่าธรรมเนียม (ผ่าน P03) · ร่าง · ไฟล์ (magic bytes ขนาด จำนวน แบบแปลน) · เอกสารบังคับ · ลบร่าง · RBAC · B02
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServer } = require('../../server');
const { bugs } = require('../../core/bugs');
const { _internal } = require('./index');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'egov-apply-'));
let srv;
let ctx;
let base;

const MB5 = 5242880;
function pdf(n) {
  const b = Buffer.alloc(n, 0x20);
  b.write('%PDF-1.4\n', 0, 'latin1');
  return b;
}
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1020)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(1016)]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(1022)]);
const TXT = Buffer.from('hello');

function loginAs(username) {
  const u = ctx.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const sid = ctx.crypto.randomHex(16) + username.replace(/\W/g, '');
  ctx.db.prepare('INSERT INTO sessions(sid, user_id, role, dept, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(sid, u.id, u.role, u.dept, 'full', ctx.clock.nowIso());
  return `eg_sid=${sid}`;
}

async function call(method, url, { body, cookie } = {}) {
  const h = {};
  if (cookie) h.cookie = cookie;
  let payload = body;
  if (body !== undefined && !(body instanceof FormData)) {
    h['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const r = await fetch(base + url, { method, headers: h, body: payload, redirect: 'manual' });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {
    /* html */
  }
  return { status: r.status, json, text, headers: r.headers };
}

function upload(cookie, draftId, docKey, buf, name, type = 'application/octet-stream') {
  const fd = new FormData();
  fd.append('docKey', docKey);
  fd.append('file', new Blob([buf], { type }), name);
  return call('POST', `/api/drafts/${draftId}/files`, { body: fd, cookie });
}

async function reset() {
  await ctx.reset();
}

test.before(async () => {
  const r = await createServer({ env: { DB_PATH: path.join(tmp, 'app.db'), TEST_MODE: '1' }, log: () => {} });
  ctx = r.ctx;
  srv = await new Promise((resolve) => {
    const s = r.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${srv.address().port}`;
});

test.after(() => {
  srv.close();
  ctx.db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('cleanFileName: UTF-8 ที่ multer ถอดเป็น latin1 · ตัด path', () => {
  const thai = Buffer.from('บัตร.pdf', 'utf8').toString('latin1');
  assert.equal(_internal.cleanFileName(thai), 'บัตร.pdf');
  assert.equal(_internal.cleanFileName('../../etc/passwd'), 'passwd');
  assert.equal(_internal.cleanFileName('a\\b\\c.pdf'), 'c.pdf');
  assert.equal(_internal.cleanFileName(''), 'file');
});

test('ค่าธรรมเนียม: POST /api/drafts/fee และ POST /api/drafts ตาม BR-04 BR-05 (ผ่าน rules ของ P03)', async () => {
  await reset();
  const c = loginAs('cit-0001');
  const cases = [
    ['SV-01', { qty: 0 }, 400, 'INVALID_QTY'],
    ['SV-01', { qty: 1 }, 20],
    ['SV-01', { qty: '5' }, 100],
    ['SV-01', { qty: 6 }, 400, 'INVALID_QTY'],
    ['SV-01', { qty: '' }, 400, 'INVALID_QTY'],
    ['SV-01', {}, 20],
    ['SV-02', {}, 500],
    ['SV-03', { areaSqm: 0 }, 400, 'INVALID_AREA'],
    ['SV-03', { areaSqm: -1 }, 400, 'INVALID_AREA'],
    ['SV-03', { areaSqm: '' }, 400, 'INVALID_AREA'],
    ['SV-03', { areaSqm: 1 }, 1000],
    ['SV-03', { areaSqm: 100 }, 1000],
    ['SV-03', { areaSqm: 101 }, 1010],
    ['SV-03', { areaSqm: 500 }, 5000],
    ['SV-03', { areaSqm: 501 }, 400, 'AREA_TOO_LARGE'],
  ];
  for (const [serviceId, input, exp, code] of cases) {
    const r = await call('POST', '/api/drafts/fee', { body: { serviceId, ...input }, cookie: c });
    if (code) {
      assert.equal(r.status, 400, `${serviceId} ${JSON.stringify(input)}`);
      assert.equal(r.json.code, code);
      assert.equal(r.json.message, ctx.errors.message(code));
    } else {
      assert.equal(r.status, 200, `${serviceId} ${JSON.stringify(input)} ${r.text}`);
      assert.equal(r.json.fee, exp);
    }
  }
  const before = ctx.db.prepare('SELECT COUNT(*) n FROM drafts').get().n;
  assert.equal(before, 2, 'fee ไม่สร้างร่าง');
  const d = await call('POST', '/api/drafts', { body: { serviceId: 'SV-03', areaSqm: 101 }, cookie: c });
  assert.equal(d.status, 201);
  assert.deepEqual(d.json, { draftId: 'DR-0003', fee: 1010, serviceId: 'SV-03', status: 'DRAFT' });
  const bad = await call('POST', '/api/drafts', { body: { serviceId: 'SV-01', qty: 6 }, cookie: c });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, 'INVALID_QTY');
  const badSvc = await call('POST', '/api/drafts', { body: { serviceId: 'SV-09' }, cookie: c });
  assert.equal(badSvc.status, 400);
});

test('B01 ของ P03 แสดงผ่าน API ของหน้านี้ (พื้นที่ 101 → 1000)', async () => {
  await reset();
  const c = loginAs('cit-0001');
  bugs.set(['B01']);
  try {
    const r = await call('POST', '/api/drafts/fee', { body: { serviceId: 'SV-03', areaSqm: 101 }, cookie: c });
    assert.equal(r.json.fee, 1000);
  } finally {
    bugs.set('');
  }
});

test('ร่าง: GET รายการ/รายละเอียด · ของคนอื่น 404 · PATCH · ไม่มีเลขคำขอ', async () => {
  await reset();
  const c = loginAs('cit-0001');
  const other = loginAs('cit-0002');
  const list = await call('GET', '/api/drafts', { cookie: c });
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.items.map((x) => x.draftId), ['DR-0002', 'DR-0001']);
  const d1 = await call('GET', '/api/drafts/DR-0001', { cookie: c });
  assert.equal(d1.json.qty, 2);
  assert.equal(d1.json.fee, 40);
  assert.equal(d1.json.caseNo, null);
  assert.deepEqual(d1.json.missing, ['บัตรประชาชน']);
  assert.deepEqual(d1.json.files, []);
  const d2 = await call('GET', '/api/drafts/DR-0002', { cookie: c });
  assert.equal(d2.json.paymentRef, 'PP-0001');
  assert.equal(d2.json.amount, 500);
  assert.deepEqual(d2.json.missing, []);
  assert.equal((await call('GET', '/api/drafts/DR-0001', { cookie: other })).status, 404);
  assert.equal((await call('GET', '/api/drafts/DR-9999', { cookie: c })).status, 404);
  assert.equal((await call('GET', '/api/drafts/xyz', { cookie: c })).status, 404);
  const p = await call('PATCH', '/api/drafts/DR-0001', { body: { qty: 3 }, cookie: c });
  assert.equal(p.status, 200);
  assert.equal(p.json.fee, 60);
  const pBad = await call('PATCH', '/api/drafts/DR-0001', { body: { qty: 9 }, cookie: c });
  assert.equal(pBad.json.code, 'INVALID_QTY');
  const pLocked = await call('PATCH', '/api/drafts/DR-0002', { body: {}, cookie: c });
  assert.equal(pLocked.status, 409);
  assert.equal(pLocked.json.code, 'INVALID_STATE');
});

test('ไฟล์: ขนาด ≤ 5,242,880 · ชนิดจาก magic bytes · จำนวน ≤ 5', async () => {
  await reset();
  const c = loginAs('cit-0001');
  const { json: d } = await call('POST', '/api/drafts', { body: { serviceId: 'SV-01', qty: 1 }, cookie: c });
  let r = await upload(c, d.draftId, 'id-card', pdf(MB5 - 1), 'size-5242879.pdf');
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.size, MB5 - 1);
  assert.equal(r.json.name, 'size-5242879.pdf');
  r = await upload(c, d.draftId, 'extra', pdf(MB5), 'size-5242880.pdf');
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.size, MB5);
  r = await upload(c, d.draftId, 'extra', pdf(MB5 + 1), 'size-5242881.pdf');
  assert.equal(r.status, 400);
  assert.deepEqual(r.json, { code: 'FILE_TOO_LARGE', message: 'ไฟล์ใหญ่เกิน 5 MB' });
  r = await upload(c, d.draftId, 'extra', pdf(7 * 1024 * 1024 + 10), 'huge.pdf');
  assert.equal(r.status, 400, 'ใหญ่กว่า limit multer ก็ยัง 400 ไม่ใช่ 413');
  assert.equal(r.json.code, 'FILE_TOO_LARGE');

  for (const [buf, name, type] of [[TXT, 'fake-text.pdf', 'application/pdf'], [TXT, 'fake-text.jpg', 'image/jpeg'], [EXE, 'exe-as.png', 'image/png'], [TXT, 'notes.txt', 'text/plain']]) {
    r = await upload(c, d.draftId, 'extra', buf, name, type);
    assert.equal(r.status, 400, name);
    assert.deepEqual(r.json, { code: 'FILE_TYPE', message: 'รองรับเฉพาะไฟล์ PDF, JPG, PNG' });
  }
  r = await upload(c, d.draftId, 'extra', JPG, 'real.jpg', 'application/pdf');
  assert.equal(r.status, 201);
  assert.equal(r.json.mime, 'image/jpeg', 'mime จากเนื้อไฟล์ ไม่ใช่ Content-Type');
  r = await upload(c, d.draftId, 'extra', PNG, 'real.png');
  assert.equal(r.status, 201);
  assert.equal(r.json.mime, 'image/png');
  r = await upload(c, d.draftId, 'extra', pdf(1024), 'multi-5.pdf');
  assert.equal(r.status, 201, 'ไฟล์ที่ 5');
  r = await upload(c, d.draftId, 'extra', pdf(1024), 'multi-6.pdf');
  assert.equal(r.status, 400);
  assert.deepEqual(r.json, { code: 'FILE_COUNT', message: 'แนบได้สูงสุด 5 ไฟล์ต่อคำขอ' });
  const g = await call('GET', `/api/drafts/${d.draftId}`, { cookie: c });
  assert.equal(g.json.files.length, 5);
  assert.equal(fs.readdirSync(path.join(ctx.storage.dir, 'u')).length, 5, 'ไฟล์ที่ถูกปฏิเสธไม่ถูกเก็บ');

  // ลบ 1 แล้วแนบได้อีก
  const victim = g.json.files.find((f) => f.name === 'real.png');
  assert.equal((await call('DELETE', `/api/drafts/${d.draftId}/files/${victim.fileId}`, { cookie: c })).status, 204);
  r = await upload(c, d.draftId, 'extra', pdf(1024), 'multi-6.pdf');
  assert.equal(r.status, 201);
  // ดาวน์โหลดไฟล์ของตัวเอง
  const dl = await fetch(`${base}/api/drafts/${d.draftId}/files/${r.json.fileId}`, { headers: { cookie: c } });
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'application/pdf');
});

test('B02: 5,242,880 ไบต์ถูกปฏิเสธ · 5,242,879 ยังรับ', async () => {
  await reset();
  const c = loginAs('cit-0001');
  const { json: d } = await call('POST', '/api/drafts', { body: { serviceId: 'SV-01', qty: 1 }, cookie: c });
  bugs.set(['B02']);
  try {
    let r = await upload(c, d.draftId, 'id-card', pdf(MB5), 'size-5242880.pdf');
    assert.equal(r.status, 400);
    assert.equal(r.json.code, 'FILE_TOO_LARGE');
    r = await upload(c, d.draftId, 'id-card', pdf(MB5 - 1), 'size-5242879.pdf');
    assert.equal(r.status, 201);
  } finally {
    bugs.set('');
  }
});

test('เอกสารบังคับ SV-03 · แบบแปลน PDF เท่านั้น · payment ตอบ 409 MISSING_DOCS', async () => {
  await reset();
  const c = loginAs('cit-0001');
  const { json: d } = await call('POST', '/api/drafts', { body: { serviceId: 'SV-03', areaSqm: 100 }, cookie: c });
  let p = await call('POST', `/api/drafts/${d.draftId}/payment`, { cookie: c });
  assert.equal(p.status, 409);
  assert.equal(p.json.code, 'MISSING_DOCS');
  assert.deepEqual(p.json.missing, ['บัตรประชาชน', 'แบบแปลน', 'โฉนด']);
  assert.equal(p.json.message, 'ยังขาดเอกสาร: บัตรประชาชน, แบบแปลน, โฉนด');
  assert.equal((await upload(c, d.draftId, 'id-card', JPG, 'real.jpg')).status, 201);
  assert.equal((await upload(c, d.draftId, 'deed', pdf(1024), 'deed.pdf')).status, 201);
  const r = await upload(c, d.draftId, 'plan', JPG, 'plan-as-jpg.jpg');
  assert.equal(r.status, 400);
  assert.deepEqual(r.json, { code: 'PLAN_NOT_PDF', message: 'แบบแปลนต้องเป็นไฟล์ PDF เท่านั้น' });
  p = await call('POST', `/api/drafts/${d.draftId}/payment`, { cookie: c });
  assert.equal(p.status, 409);
  assert.deepEqual(p.json.missing, ['แบบแปลน']);
  assert.equal(p.json.message, 'ยังขาดเอกสาร: แบบแปลน');
  assert.deepEqual(ctx.shared.apply.missingDocs(d.draftId), ['แบบแปลน']);
  assert.equal((await upload(c, d.draftId, 'plan', pdf(1024), 'plan.pdf')).status, 201);
  assert.deepEqual(ctx.shared.apply.missingDocs(d.draftId), []);
  // แนบช่องเดิมซ้ำ = แทนไฟล์เดิม
  assert.equal((await upload(c, d.draftId, 'plan', pdf(2048), 'plan2.pdf')).status, 201);
  const g = await call('GET', `/api/drafts/${d.draftId}`, { cookie: c });
  assert.deepEqual(g.json.files.filter((f) => f.docKey === 'plan').map((f) => f.name), ['plan2.pdf']);
  // docKey ที่ไม่มีในบริการ
  assert.equal((await upload(c, d.draftId, 'map', pdf(1024), 'map.pdf')).status, 400);
  // ของคนอื่น → 404
  const o = loginAs('cit-0002');
  assert.equal((await call('POST', `/api/drafts/${d.draftId}/payment`, { cookie: o })).status, 404);
  assert.equal((await upload(o, d.draftId, 'extra', pdf(10), 'x.pdf')).status, 404);
});

test('ลบร่าง: DRAFT/PENDING_PAYMENT → 204 · ref ชำระหายไป · ไฟล์ถูกลบ', async () => {
  await reset();
  const c = loginAs('cit-0001');
  assert.equal((await call('DELETE', '/api/drafts/DR-0001', { cookie: loginAs('cit-0002') })).status, 404);
  assert.equal((await call('DELETE', '/api/drafts/DR-0001', { cookie: c })).status, 204);
  assert.equal((await call('GET', '/api/drafts/DR-0001', { cookie: c })).status, 404);
  assert.equal((await call('DELETE', '/api/drafts/DR-0002', { cookie: c })).status, 204);
  assert.equal(ctx.db.prepare("SELECT COUNT(*) n FROM payments WHERE ref = 'PP-0001'").get().n, 0);
  assert.equal(ctx.db.prepare("SELECT COUNT(*) n FROM files WHERE draft_id = 'DR-0002'").get().n, 0);
  const list = await call('GET', '/api/drafts', { cookie: c });
  assert.equal(list.json.items.length, 0);
  // ชำระแล้ว → 409
  const { json: d } = await call('POST', '/api/drafts', { body: { serviceId: 'SV-01', qty: 1 }, cookie: c });
  ctx.db.prepare("UPDATE drafts SET status = 'PAID', case_no = 'EG-2569-000031' WHERE id = ?").run(d.draftId);
  const r = await call('DELETE', `/api/drafts/${d.draftId}`, { cookie: c });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'INVALID_STATE');
});

test('RBAC: ไม่ล็อกอิน 401 · admin/เจ้าหน้าที่ 403 · หน้า /citizen/new ของ admin 403', async () => {
  await reset();
  assert.equal((await call('POST', '/api/drafts', { body: { serviceId: 'SV-01', qty: 1 } })).status, 401);
  for (const u of ['admin1', 'off.reg1', 'head1', 'exec1', 'audit1']) {
    const ck = loginAs(u);
    const r = await call('POST', '/api/drafts', { body: { serviceId: 'SV-01', qty: 1 }, cookie: ck });
    assert.equal(r.status, 403, u);
    assert.equal(r.json.code, 'FORBIDDEN');
    assert.equal((await upload(ck, 'DR-0001', 'id-card', pdf(10), 'a.pdf')).status, 403);
    assert.equal((await call('GET', '/api/drafts', { cookie: ck })).status, 403);
    assert.equal((await call('DELETE', '/api/drafts/DR-0001', { cookie: ck })).status, 403);
  }
  const pg = await call('GET', '/citizen/new/SV-01', { cookie: loginAs('admin1') });
  assert.equal(pg.status, 403);
  assert.match(pg.text, /data-testid="forbidden-msg"/);
  assert.equal((await call('GET', '/citizen/new/SV-01')).status, 302);
});

test('หน้า /citizen/new/:service: testid ขั้น 1 · ค่าตั้งต้น · เปิดร่าง · 404', async () => {
  await reset();
  const c = loginAs('cit-0001');
  let r = await call('GET', '/citizen/new/SV-01', { cookie: c });
  assert.equal(r.status, 200);
  for (const t of ['wizard-step', 'service-name', 'qty-input', 'fee-total', 'fee-error', 'draft-id', 'save-draft-btn', 'to-upload-btn', 'upload-input-id-card', 'upload-input-extra', 'upload-error', 'to-payment-btn', 'payment-amount']) {
    assert.match(r.text, new RegExp(`data-testid="${t}"`), t);
  }
  assert.match(r.text, /data-testid="wizard-step"[^>]*>1\/3 กรอกข้อมูล</);
  assert.match(r.text, /data-testid="service-name">ขอหนังสือรับรอง</);
  assert.match(r.text, /data-testid="qty-input"[^>]*value="1"|value="1"[^>]*data-testid="qty-input"/);
  assert.match(r.text, /data-testid="fee-total"[^>]*>฿20</);
  assert.doesNotMatch(r.text, /data-testid="area-input"/);
  assert.match(r.text, /data-testid="upload-input-extra"[^>]*multiple|multiple[^>]*data-testid="upload-input-extra"/);

  r = await call('GET', '/citizen/new/SV-03', { cookie: c });
  assert.match(r.text, /data-testid="area-input"/);
  assert.match(r.text, /data-testid="upload-input-plan"/);
  assert.match(r.text, /data-testid="upload-input-deed"/);
  assert.match(r.text, /data-testid="fee-total"[^>]*>–</);
  assert.match(r.text, /data-testid="to-upload-btn"[^>]*disabled/);

  r = await call('GET', '/citizen/new/SV-02', { cookie: c });
  assert.match(r.text, /data-testid="fee-total"[^>]*>฿500</);
  assert.doesNotMatch(r.text, /data-testid="(qty|area)-input"/);
  assert.match(r.text, /data-testid="upload-input-map"/);
  assert.match(r.text, /data-testid="upload-input-site-photo"/);

  r = await call('GET', '/citizen/new/SV-01?draft=DR-0001', { cookie: c });
  assert.equal(r.status, 200);
  assert.match(r.text, /value="2"/);
  assert.match(r.text, /data-testid="fee-total"[^>]*>฿40</);
  assert.match(r.text, /data-testid="draft-id"[^>]*>DR-0001</);
  assert.doesNotMatch(r.text, /EG-\d{4}-\d{6}/);

  r = await call('GET', '/citizen/new/SV-02?draft=DR-0002', { cookie: c });
  assert.match(r.text, /data-testid="wizard-step"[^>]*>3\/3 ชำระเงิน</);
  assert.match(r.text, /data-testid="payment-amount"[^>]*>฿500</);

  // บริการไม่ตรงร่าง → redirect · ร่างของคนอื่น → 404 · บริการไม่มี → 404
  r = await call('GET', '/citizen/new/SV-03?draft=DR-0001', { cookie: c });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/citizen/new/SV-01?draft=DR-0001');
  assert.equal((await call('GET', '/citizen/new/SV-01?draft=DR-0001', { cookie: loginAs('cit-0002') })).status, 404);
  assert.equal((await call('GET', '/citizen/new/SV-09', { cookie: c })).status, 404);
  // XSS: ชื่อไฟล์ถูก escape ใน JSON ที่ฝังหน้า
  const { json: d } = await call('POST', '/api/drafts', { body: { serviceId: 'SV-01', qty: 1 }, cookie: c });
  await upload(c, d.draftId, 'id-card', pdf(100), '</script><img src=x onerror=alert(1)>.pdf');
  r = await call('GET', `/citizen/new/SV-01?draft=${d.draftId}`, { cookie: c });
  assert.doesNotMatch(r.text, /<\/script><img/);
});

test('static: /static/apply/apply.js และ apply.css เสิร์ฟได้', async () => {
  const js = await fetch(`${base}/static/apply/apply.js`);
  assert.equal(js.status, 200);
  const css = await fetch(`${base}/static/apply/apply.css`);
  assert.equal(css.status, 200);
});

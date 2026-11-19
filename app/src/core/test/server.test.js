'use strict';
// ทดสอบ HTTP ของ core: health · test hook · reset ซ้ำได้ (NFR-09) · RBAC guard · layout testid · module loader · body ≥ 6 MB
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServer } = require('../../server');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'egov-srv-'));

// โมดูลจำลองสำหรับทดสอบ loader + hooks + guard
const modDir = path.join(tmp, 'modules');
fs.mkdirSync(path.join(modDir, 'demo', 'public'), { recursive: true });
fs.mkdirSync(path.join(modDir, '_ignored'), { recursive: true });
fs.writeFileSync(path.join(modDir, 'demo', 'public', 'x.js'), 'window.X=1;');
fs.mkdirSync(path.join(modDir, 'demo', 'migrations'), { recursive: true });
fs.writeFileSync(path.join(modDir, 'demo', 'migrations', '0001_demo_items.sql'), 'CREATE TABLE demo_items (id INTEGER PRIMARY KEY, v TEXT);');
fs.writeFileSync(
  path.join(modDir, 'demo', 'index.js'),
  `module.exports = {
  name: 'demo', order: 5,
  register(ctx) {
    ctx.shared.hits = [];
    ctx.shared.resets = 0;
    ctx.hooks.onRequest(50, (req) => { ctx.shared.hits.push(req.path); });
    ctx.hooks.onReset(() => { ctx.shared.resets++; ctx.db.prepare("INSERT INTO demo_items(v) VALUES ('seeded')").run(); });
    ctx.hooks.bellCount((user) => (user.username === 'off.reg1' ? 3 : 0));
    ctx.hooks.testRoute('post', '/api/test/demo/echo', (req, res) => res.json({ echo: req.body }));
    ctx.app.get('/dashboard', ctx.auth.page('executive'), (req, res) => ctx.ui.send(req, res, { title: 'Dashboard', body: '<h1>Dashboard</h1>' + ctx.ui.messages() }));
    ctx.app.get('/officer/queue', ctx.auth.page('officer', 'head'), (req, res) => ctx.ui.send(req, res, { title: 'คิว', body: '<h1>คิวงาน</h1>' + ctx.ui.statusBadge('IN_REVIEW') + ctx.ui.slaBadge('near') + ctx.ui.time('2026-12-04T16:30:00+07:00', { testid: 'sla-due' }) + ctx.ui.money(1010, { testid: 'case-fee' }) }));
    ctx.app.get('/api/dashboard', ctx.auth.api('executive'), (req, res) => res.json({ ok: true }));
    ctx.app.get('/api/boom', (req, res) => ctx.errors.fail('ALREADY_CLAIMED'));
    ctx.app.get('/api/boom-async', ctx.wrap(async () => { throw new Error('secret internals'); }));
    ctx.app.get('/officer/cases/:no', ctx.auth.page('officer', 'head'), (req, res) => ctx.errors.fail('NOT_FOUND'));
    ctx.app.post('/api/upload', ctx.upload.single('file'), (req, res) => {
      if (req.file.size > ctx.storage.MAX_FILE_BYTES) return ctx.errors.send(res, 'FILE_TOO_LARGE');
      res.status(201).json({ size: req.file.size, type: (ctx.storage.detectType(req.file.buffer) || {}).type || null });
    });
  },
};`
);
// โมดูลที่ register ล้ม ต้องไม่ทำให้ทั้งเว็บล่ม
fs.mkdirSync(path.join(modDir, 'broken'), { recursive: true });
fs.writeFileSync(path.join(modDir, 'broken', 'index.js'), "module.exports = { name: 'broken', order: 1, register() { throw new Error('boom'); } };");

let base;
let server;
let ctx;

async function start(env) {
  const r = await createServer({ env, modulesDir: modDir, log: () => {} });
  const srv = await new Promise((resolve) => {
    const s = r.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return { srv, ctx: r.ctx, base: `http://127.0.0.1:${srv.address().port}` };
}

function req(method, url, { body, cookie, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  let payload = body;
  if (body !== undefined && !(body instanceof FormData) && typeof body !== 'string') {
    h['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  return fetch(base + url, { method, headers: h, body: payload, redirect: 'manual' });
}

function loginAs(username, { scope = 'full' } = {}) {
  const u = ctx.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const sid = ctx.crypto.randomHex(16) + username.replace(/\W/g, '');
  ctx.db.prepare('INSERT INTO sessions(sid, user_id, role, dept, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(sid, u.id, u.role, u.dept, scope, ctx.clock.nowIso());
  return `eg_sid=${sid}`;
}

test.before(async () => {
  const s = await start({ DB_PATH: path.join(tmp, 'test.db'), TEST_MODE: '1', BUG_MODE: 'B03, b7' });
  server = s.srv;
  ctx = s.ctx;
  base = s.base;
});

test.after(() => {
  server.close();
  ctx.db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('GET /api/health → 200 {"status":"ok"} ตรงตัว (ไม่ต้องล็อกอิน)', async () => {
  const r = await req('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/json/);
  assert.equal(await r.text(), '{"status":"ok"}');
});

test('POST /api/test/reset → {"ok":true,"now":"2026-12-01T09:00:00+07:00"} + ล้าง session', async () => {
  const cookie = loginAs('off.reg1');
  assert.equal((await req('GET', '/officer/queue', { cookie })).status, 200);
  await req('PUT', '/api/test/clock', { body: { now: '2026-12-10T12:00:00+07:00' } });
  const r = await req('POST', '/api/test/reset');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, now: '2026-12-01T09:00:00+07:00' });
  assert.equal((await req('GET', '/officer/queue', { cookie })).status, 302, 'cookie เก่าใช้ไม่ได้หลัง reset');
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM cases').get().n, 30);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM drafts').get().n, 2);
  assert.ok(ctx.shared.resets >= 2, 'onReset ของโมดูลถูกเรียกทั้งตอนเริ่มและตอน reset');
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM demo_items').get().n, 1, 'ตารางโมดูลถูกล้างแล้ว seed ใหม่');
  assert.deepEqual(
    ctx.db.prepare('SELECT id FROM schema_migrations ORDER BY rowid').all().map((r) => r.id),
    ['core/0001_init.sql', 'demo/0001_demo_items.sql'],
    'reset รัน migration ของ core + โมดูลใหม่ทั้งหมด'
  );
});

test('GET/PUT /api/test/clock · INVALID_TIME เมื่อไม่มี offset', async () => {
  await req('POST', '/api/test/reset');
  assert.deepEqual(await (await req('GET', '/api/test/clock')).json(), { now: '2026-12-01T09:00:00+07:00' });
  let r = await req('PUT', '/api/test/clock', { body: { now: '2026-12-01T16:30:00+07:00' } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { now: '2026-12-01T16:30:00+07:00' });
  assert.deepEqual(await (await req('GET', '/api/test/clock')).json(), { now: '2026-12-01T16:30:00+07:00' }, 'แช่แข็ง');
  for (const bad of ['2026-12-01 09:00', '2026-12-01T09:00:00', 'tomorrow', '', null, 5]) {
    r = await req('PUT', '/api/test/clock', { body: { now: bad } });
    assert.equal(r.status, 400, `ค่า ${bad}`);
    assert.equal((await r.json()).code, 'INVALID_TIME');
  }
  r = await req('PUT', '/api/test/clock', { body: {} });
  assert.equal(r.status, 400);
  assert.equal(ctx.clock.nowIso(), '2026-12-01T16:30:00+07:00', 'ค่าที่ผิดไม่เปลี่ยนนาฬิกา');
  r = await req('PUT', '/api/test/clock', { body: { now: '2026-12-05T03:00:00Z' } });
  assert.deepEqual(await r.json(), { now: '2026-12-05T10:00:00+07:00' });
});

test('NFR-09: reset 2 ครั้ง (มีการเปลี่ยนแปลงคั่น) ได้ข้อมูลเหมือนกัน', async () => {
  const snapshot = () => {
    const out = {};
    for (const t of ['users', 'services', 'holidays', 'drafts', 'files', 'payments', 'cases', 'case_timeline', 'returns', 'documents', 'notifications', 'audit', 'sessions', 'otp_attempts', 'counters']) {
      out[t] = ctx.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all().map((r) => {
        const x = { ...r };
        for (const k of ['id_enc', 'mobile_enc']) if (x[k]) x[k] = ctx.crypto.dec(x[k]); // IV สุ่ม → เทียบค่าที่ถอดแล้ว
        return x;
      });
    }
    out.clock = ctx.clock.nowIso();
    out.uploads = fs.readdirSync(path.join(ctx.paths.uploadDir, 'seed')).sort();
    return JSON.stringify(out);
  };
  await req('POST', '/api/test/reset');
  const s1 = snapshot();
  await req('PUT', '/api/test/clock', { body: { now: '2026-12-10T12:00:00+07:00' } });
  ctx.caseEvents.transition('EG-2569-000028', { from: 'SUBMITTED', to: 'IN_REVIEW', event: 'CLAIM', actor: { username: 'off.reg1', role: 'officer', name: 'x' }, set: { owner: 'off.reg1' }, audit: true });
  ctx.storage.save('F-999999', Buffer.from('%PDF-1.4 new upload'));
  ctx.db.prepare("INSERT INTO notifications(username, case_no, level, text, created_at) VALUES ('off.reg1','EG-2569-000020','overdue','x','2026-12-10T12:00:00+07:00')").run();
  loginAs('exec1');
  await req('POST', '/api/test/reset');
  const s2 = snapshot();
  assert.equal(s2, s1);
  assert.equal(fs.existsSync(path.join(ctx.paths.uploadDir, 'u', 'F-999999')), false, 'ไฟล์อัปโหลดใหม่ถูกล้าง');
});

test('ไม่ตั้ง TEST_MODE → /api/test/* ตอบ 404 · health ยัง 200 · นาฬิกาเป็นเวลาจริง', async () => {
  const other = await start({ DB_PATH: path.join(tmp, 'prod.db'), TEST_MODE: '' });
  try {
    for (const [m, p] of [['POST', '/api/test/reset'], ['GET', '/api/test/clock'], ['PUT', '/api/test/clock'], ['POST', '/api/test/demo/echo'], ['POST', '/api/test/payments/PP-0001/pay']]) {
      const r = await fetch(other.base + p, { method: m, headers: { 'content-type': 'application/json' }, body: m === 'GET' ? undefined : '{}' });
      assert.equal(r.status, 404, `${m} ${p}`);
    }
    const h = await fetch(other.base + '/api/health');
    assert.equal(await h.text(), '{"status":"ok"}');
    assert.equal(other.ctx.clock.isFrozen(), false);
    assert.equal(other.ctx.db.prepare('SELECT COUNT(*) n FROM cases').get().n, 30, 'DB ใหม่ seed อัตโนมัติ');
  } finally {
    other.srv.close();
    // clock/bugs เป็น singleton ของ process → คืนค่าของ server หลัก
    other.ctx.clock.configure({ frozen: true });
    other.ctx.bugs.set('B03,B07');
  }
});

test('test route ของโมดูล (hooks.testRoute) ใช้ได้ใน TEST_MODE · ไม่เรียก onRequest', async () => {
  ctx.shared.hits.length = 0;
  const r = await req('POST', '/api/test/demo/echo', { body: { a: 1 } });
  assert.deepEqual(await r.json(), { echo: { a: 1 } });
  await req('GET', '/api/test/clock');
  assert.deepEqual(ctx.shared.hits, [], '/api/test/* ไม่เรียก onRequest');
  await req('GET', '/api/health');
  await req('GET', '/login');
  await req('GET', '/static/demo/x.js');
  assert.deepEqual(ctx.shared.hits, ['/api/health', '/login']);
});

test('BUG_MODE parser ต่อเข้า ctx.bugs', () => {
  assert.deepEqual(ctx.bugs.list(), ['B03', 'B07']);
  assert.equal(ctx.bugs.on('B07'), true);
  assert.equal(ctx.bugs.on('B01'), false);
});

test('route / redirect ตามบทบาท (CONTRACT §1)', async () => {
  await req('POST', '/api/test/reset');
  let r = await req('GET', '/');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login');
  const expect = { 'cit-0001': '/citizen', 'off.reg1': '/officer/queue', head1: '/head/approvals', exec1: '/dashboard', audit1: '/audit', admin1: '/admin/services' };
  for (const [u, loc] of Object.entries(expect)) {
    r = await req('GET', '/', { cookie: loginAs(u) });
    assert.equal(r.headers.get('location'), loc, u);
  }
  r = await req('GET', '/', { cookie: loginAs('cit-0003', { scope: 'register' }) });
  assert.equal(r.headers.get('location'), '/register');
});

test('guard หน้า: ไม่ล็อกอิน → /login · บทบาทไม่ตรง → 403 forbidden-msg · ยังไม่ลงทะเบียน → /register', async () => {
  let r = await req('GET', '/dashboard');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login');
  r = await req('GET', '/dashboard', { cookie: loginAs('off.reg1') });
  assert.equal(r.status, 403);
  const html = await r.text();
  assert.match(html, /data-testid="forbidden-msg">ไม่มีสิทธิ์เข้าถึงหน้านี้</);
  assert.match(html, /data-testid="app-header"/);
  r = await req('GET', '/dashboard', { cookie: loginAs('cit-0003', { scope: 'register' }) });
  assert.equal(r.headers.get('location'), '/register');
  r = await req('GET', '/dashboard', { cookie: loginAs('exec1') });
  assert.equal(r.status, 200);
  r = await req('GET', '/officer/cases/EG-2569-999999', { cookie: loginAs('off.reg1') });
  assert.equal(r.status, 404);
  assert.match(await r.text(), /data-testid="not-found-msg">ไม่พบคำขอ</);
});

test('guard API: 401/403 JSON {code,message}', async () => {
  let r = await req('GET', '/api/dashboard');
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { code: 'UNAUTHENTICATED', message: 'กรุณาเข้าสู่ระบบ' });
  r = await req('GET', '/api/dashboard', { cookie: loginAs('admin1') });
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์ทำรายการนี้' });
  r = await req('GET', '/api/dashboard', { cookie: loginAs('cit-0003', { scope: 'register' }) });
  assert.equal(r.status, 401);
  r = await req('GET', '/api/dashboard', { cookie: loginAs('exec1') });
  assert.equal(r.status, 200);
  r = await req('GET', '/api/boom');
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { code: 'ALREADY_CLAIMED', message: 'มีเจ้าหน้าที่รับเรื่องนี้แล้ว' });
  r = await req('GET', '/api/boom-async');
  assert.equal(r.status, 500);
  const j = await r.json();
  assert.equal(j.code, 'INTERNAL');
  assert.ok(!JSON.stringify(j).includes('secret internals'));
  r = await req('GET', '/api/does-not-exist');
  assert.equal(r.status, 404);
});

test('layout: testid หัวหน้าเว็บ เมนูตามบทบาท กระดิ่ง lang=th badge วันที่ เงิน', async () => {
  let html = await (await req('GET', '/officer/queue', { cookie: loginAs('off.reg1') })).text();
  assert.match(html, /<html lang="th">/);
  assert.match(html, /<main id="main"/);
  assert.match(html, /data-testid="user-name">เจ้าหน้าที่ทะเบียน 1</);
  assert.match(html, /data-testid="user-role" data-role="officer" data-dept="registry">เจ้าหน้าที่</);
  assert.match(html, /data-testid="logout-btn"/);
  assert.match(html, /data-testid="nav-queue"/);
  assert.match(html, /data-testid="nav-bell"/);
  assert.match(html, /data-testid="bell-count" class="bell-count">3</);
  assert.doesNotMatch(html, /nav-approvals|nav-dashboard|nav-audit|nav-admin|nav-my-cases/);
  assert.match(html, /data-testid="case-status" data-status="IN_REVIEW">กำลังตรวจสอบ</);
  assert.match(html, /data-testid="sla-level" data-level="near">ใกล้ครบกำหนด</);
  assert.match(html, /data-testid="sla-due" data-iso="2026-12-04T16:30:00\+07:00"[^>]*>4 ธ.ค. 2569 16:30</);
  assert.match(html, /data-testid="case-fee">฿1,010</);

  html = await (await req('GET', '/officer/queue', { cookie: loginAs('head1') })).text();
  assert.match(html, /data-testid="nav-queue"/);
  assert.match(html, /data-testid="nav-approvals"/);
  assert.match(html, /data-testid="bell-count" class="bell-count">0</);
  assert.match(html, /data-role="head">หัวหน้าฝ่าย</);
  assert.doesNotMatch(html, /data-dept=/);

  html = await (await req('GET', '/dashboard', { cookie: loginAs('exec1') })).text();
  assert.match(html, /data-testid="nav-dashboard"/);
  assert.doesNotMatch(html, /nav-bell|bell-count|nav-queue/);
  assert.match(html, /data-testid="action-error" role="alert" hidden/);
});

test('POST /logout → 303 /login และ session ถูกลบ', async () => {
  const cookie = loginAs('exec1');
  const r = await req('POST', '/logout', { cookie });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/login');
  assert.equal((await req('GET', '/dashboard', { cookie })).status, 302);
});

test('static ของ core และโมดูล · โฟลเดอร์ขึ้นต้น _ ไม่ถูกโหลด', async () => {
  assert.equal((await req('GET', '/static/core/app.css')).status, 200);
  assert.equal((await req('GET', '/static/core/app.js')).status, 200);
  assert.equal(await (await req('GET', '/static/demo/x.js')).text(), 'window.X=1;');
  assert.deepEqual(ctx.modules.map((m) => m.folder), ['demo']);
});

test('CONTRACT §0 ข้อ 10: multipart 5,242,881 ไบต์ไม่โดน 413 (ถึง handler ของโมดูล) · 5,242,880 ผ่าน', async () => {
  const pdf = (n) => {
    const head = Buffer.from('%PDF-1.4\n');
    return Buffer.concat([head, Buffer.alloc(n - head.length, 0x20)]);
  };
  let fd = new FormData();
  fd.append('docKey', 'id-card');
  fd.append('file', new Blob([pdf(5242881)], { type: 'application/pdf' }), 'size-5242881.pdf');
  let r = await req('POST', '/api/upload', { body: fd });
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { code: 'FILE_TOO_LARGE', message: 'ไฟล์ใหญ่เกิน 5 MB' });
  fd = new FormData();
  fd.append('file', new Blob([pdf(5242880)], { type: 'application/pdf' }), 'size-5242880.pdf');
  r = await req('POST', '/api/upload', { body: fd });
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { size: 5242880, type: 'pdf' });
  fd = new FormData();
  fd.append('file', new Blob([Buffer.alloc(8 * 1024 * 1024, 0x41)]), 'huge.pdf');
  r = await req('POST', '/api/upload', { body: fd });
  assert.equal(r.status, 400, 'ใหญ่กว่า limit ของ multer ก็ยังเป็น 400 FILE_TOO_LARGE ไม่ใช่ 413');
  assert.equal((await r.json()).code, 'FILE_TOO_LARGE');
});

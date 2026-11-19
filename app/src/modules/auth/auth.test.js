'use strict';
// P02 · unit + HTTP test ของโมดูล auth (BR-01 BR-02 BR-03 · CONTRACT §5 §6.1 §6.8)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const authMod = require('./index');

const ID = { SOMCHAI: '1101700123456', SOMYING: '3100600987659', MANA: '5500400111221', PITI: '1909900555015' };
const LOCKED_MSG = 'ผิดเกินกำหนด เลขบัตรนี้ถูกล็อก 15 นาที';

// ---------- BR-01 checksum (ฟังก์ชันบริสุทธิ์) ----------
test('BR-01 · isValidThaiId: เลขใน seed ผ่านทุกเลข', () => {
  for (const v of Object.values(ID)) assert.equal(authMod.isValidThaiId(v), true, v);
});

test('BR-01 · isValidThaiId: 12/14 หลัก · checksum ผิด · ไม่ใช่ตัวเลข → false', () => {
  for (const v of ['110170012345', '11017001234567', '1101700123457', '11017001234ab', '', ' 1101700123456', '1-1017-00123-45-6', '１１０１７００１２３４５６']) {
    assert.equal(authMod.isValidThaiId(v), false, JSON.stringify(v));
  }
  assert.equal(authMod.isValidThaiId(1101700123456), false, 'number ไม่รับ');
  assert.equal(authMod.isValidThaiId(null), false);
});

test('BR-01 · isValidThaiId: หลักตรวจที่คำนวณได้ 10/11 → mod 10', () => {
  // หาเลขที่ sum mod 11 = 1 → (11-1)%10 = 0 และ sum mod 11 = 0 → (11-0)%10 = 1
  const calc = (s12) => {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(s12[i]) * (13 - i);
    return (11 - (sum % 11)) % 10;
  };
  let checked = 0;
  for (let n = 100000000000; n < 100000000200; n++) {
    const s12 = String(n);
    const d = calc(s12);
    assert.equal(authMod.isValidThaiId(s12 + d), true, s12 + d);
    assert.equal(authMod.isValidThaiId(s12 + ((d + 1) % 10)), false, s12 + ((d + 1) % 10));
    checked++;
  }
  assert.equal(checked, 200);
});

test('BR-03 · isValidMobile: 9/10/11 หลัก · ไม่ขึ้นต้น 0', () => {
  assert.equal(authMod.isValidMobile('0812345678'), true);
  for (const v of ['081234567', '08123456789', '1812345678', '08123abcde', '']) assert.equal(authMod.isValidMobile(v), false, v);
});

// ---------- HTTP (เว็บจริง + DB ชั่วคราว · โหลดเฉพาะโมดูล auth) ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'egov-auth-'));
const modDir = path.join(tmp, 'modules');
// loader ข้าม symlink (isDirectory) → สร้างโฟลเดอร์จริงที่ re-export โมดูลนี้ + ลิงก์ public/
fs.mkdirSync(path.join(modDir, 'auth'), { recursive: true });
fs.writeFileSync(path.join(modDir, 'auth', 'index.js'), `module.exports = require(${JSON.stringify(path.join(__dirname, 'index.js'))});`);
fs.symlinkSync(path.join(__dirname, 'public'), path.join(modDir, 'auth', 'public'), 'dir');

let base;
let srv;
let ctx;

test.before(async () => {
  const { createServer } = require('../../server');
  const r = await createServer({
    env: { DB_PATH: path.join(tmp, 'app.db'), TEST_MODE: '1', STRICT_MODULES: '1' },
    modulesDir: modDir,
    log: () => {},
  });
  ctx = r.ctx;
  srv = await new Promise((resolve) => {
    const s = r.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${srv.address().port}`;
});

test.after(() => {
  if (srv) srv.close();
  if (ctx && ctx.db && ctx.db.close) {
    try { ctx.db.close(); } catch (_) { /* ignore */ }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function call(method, url, { body, cookie } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const res = await fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) { data = text; }
  const sc = res.headers.get('set-cookie') || '';
  const m = /eg_sid=([^;]*)/.exec(sc);
  return { status: res.status, data, cookie: m && m[1] ? `eg_sid=${m[1]}` : null, location: res.headers.get('location') };
}
const reset = () => call('POST', '/api/test/reset');
const setClock = (now) => call('PUT', '/api/test/clock', { body: { now } });
async function loginC(idNo) {
  assert.equal((await call('POST', '/api/auth/thaid/start', { body: { idNo } })).status, 200);
  return call('POST', '/api/auth/thaid/verify', { body: { idNo, otp: '123456' } });
}

test('§6.1 thaid/start: ผิด → 400 INVALID_ID ข้อความตรง · ถูก → {status:OTP_SENT}', async () => {
  await reset();
  for (const idNo of ['110170012345', '11017001234567', '1101700123457', '11017001234ab', undefined, null, '1101700123457 ']) {
    const r = await call('POST', '/api/auth/thaid/start', { body: { idNo } });
    assert.equal(r.status, 400, String(idNo));
    assert.deepEqual(r.data, { code: 'INVALID_ID', message: 'เลขบัตรประชาชนไม่ถูกต้อง' });
  }
  for (const idNo of Object.values(ID)) {
    const r = await call('POST', '/api/auth/thaid/start', { body: { idNo } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { status: 'OTP_SENT' });
  }
});

test('BR-02 · OTP ผิด 3 ครั้ง → 423 ล็อก 15 นาทีตามนาฬิกาทดสอบ · 14:59 ยังล็อก · 15:00 ปลด ตัวนับเริ่มใหม่', async () => {
  await reset();
  await call('POST', '/api/auth/thaid/start', { body: { idNo: ID.PITI } });
  let r = await call('POST', '/api/auth/thaid/verify', { body: { idNo: ID.PITI, otp: '000000' } });
  assert.equal(r.status, 401);
  assert.deepEqual(r.data, { code: 'OTP_INVALID', message: 'รหัส OTP ไม่ถูกต้อง', attemptsLeft: 2 });
  assert.equal(r.cookie, null);
  r = await call('POST', '/api/auth/thaid/verify', { body: { idNo: ID.PITI, otp: '000000' } });
  assert.equal(r.data.attemptsLeft, 1);
  await setClock('2026-12-01T09:02:00+07:00'); // ครั้งที่ 3 เวลา 09:02 → ปลด 09:17
  r = await call('POST', '/api/auth/thaid/verify', { body: { idNo: ID.PITI, otp: '000000' } });
  assert.equal(r.status, 423);
  assert.deepEqual(r.data, { code: 'LOCKED', message: LOCKED_MSG, lockedUntil: '2026-12-01T09:17:00+07:00' });

  // ระหว่างล็อก: OTP ถูกก็ยัง 423 · start ก็ 423 · คนอื่นล็อกอินได้
  r = await call('POST', '/api/auth/thaid/verify', { body: { idNo: ID.PITI, otp: '123456' } });
  assert.equal(r.status, 423);
  assert.equal(r.data.lockedUntil, '2026-12-01T09:17:00+07:00');
  r = await call('POST', '/api/auth/thaid/start', { body: { idNo: ID.PITI } });
  assert.equal(r.status, 423);
  assert.equal((await loginC(ID.SOMCHAI)).data.registered, true);

  await setClock('2026-12-01T09:16:59+07:00');
  r = await call('POST', '/api/auth/thaid/verify', { body: { idNo: ID.PITI, otp: '123456' } });
  assert.equal(r.status, 423, '+14:59 ยังล็อก');

  await setClock('2026-12-01T09:17:00+07:00');
  r = await call('POST', '/api/auth/thaid/start', { body: { idNo: ID.PITI } });
  assert.equal(r.status, 200, '+15:00 ปลดล็อก');
  r = await call('POST', '/api/auth/thaid/verify', { body: { idNo: ID.PITI, otp: '000000' } });
  assert.equal(r.data.attemptsLeft, 2, 'ผิดทันทีหลังปลดล็อก = ครั้งที่ 1');
  r = await call('POST', '/api/auth/thaid/verify', { body: { idNo: ID.PITI, otp: '123456' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { registered: true });
  assert.ok(r.cookie);
  const me = await call('GET', '/api/me', { cookie: r.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.data.role, 'citizen');
  assert.equal(me.data.name, 'ปิติ มีสุข');
  assert.equal(me.data.dept, null);
  assert.ok(!JSON.stringify(me.data).includes(ID.PITI), '/api/me ไม่มีเลขบัตร');
});

test('BR-02 · ผิด 2 → ถูก → ผิด 2 ไม่ล็อก · reset ล้างการล็อก', async () => {
  await reset();
  const v = (otp) => call('POST', '/api/auth/thaid/verify', { body: { idNo: ID.PITI, otp } });
  await v('1'); await v('2');
  assert.equal((await v('123456')).status, 200);
  assert.equal((await v('1')).data.attemptsLeft, 2);
  assert.equal((await v('1')).data.attemptsLeft, 1);
  assert.equal((await v('1')).status, 423);
  await reset();
  assert.equal((await v('123456')).status, 200, 'reset ล้างการล็อก');
});

test('BR-02 · ล็อกแยกตามเลขบัตร และ otp_attempts ไม่เก็บเลขบัตรตรง', async () => {
  await reset();
  for (let i = 0; i < 3; i++) await call('POST', '/api/auth/thaid/verify', { body: { idNo: ID.PITI, otp: 'x' } });
  assert.equal((await loginC(ID.SOMYING)).status, 200);
  const rows = ctx.db.prepare('SELECT * FROM otp_attempts').all();
  assert.ok(rows.length >= 1);
  assert.ok(!JSON.stringify(rows).includes(ID.PITI));
});

test('FR-02 · ผู้ใช้ยังไม่ลงทะเบียน → registered:false + cookie เฉพาะ /register · BR-03 ตรวจฝั่งเซิร์ฟเวอร์', async () => {
  await reset();
  const v = await loginC(ID.MANA);
  assert.equal(v.status, 200);
  assert.deepEqual(v.data, { registered: false });
  const c = v.cookie;
  assert.ok(c);
  // cookie scope register: หน้าอื่น → /register · API อื่น → 401
  let r = await call('GET', '/', { cookie: c });
  assert.equal(r.status, 302);
  assert.equal(r.location, '/register');
  assert.equal((await call('GET', '/api/me', { cookie: c })).status, 401);
  r = await call('GET', '/register', { cookie: c });
  assert.equal(r.status, 200);
  assert.match(r.data, /data-testid="reg-name"/);
  assert.match(r.data, /value="มานะ ตั้งใจ"/);
  assert.match(r.data, /readonly/);

  const bad = [
    [{ mobile: '081234567', email: '', consent: true }, 'INVALID_MOBILE', 'เบอร์มือถือต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0'],
    [{ mobile: '08123456789', email: '', consent: true }, 'INVALID_MOBILE'],
    [{ mobile: '1812345678', email: '', consent: true }, 'INVALID_MOBILE'],
    [{ mobile: '0845678901', email: '', consent: false }, 'CONSENT_REQUIRED', 'กรุณายินยอมการประมวลผลข้อมูลส่วนบุคคล (PDPA)'],
    [{ mobile: '0845678901', email: '' }, 'CONSENT_REQUIRED'],
  ];
  for (const [body, code, msg] of bad) {
    r = await call('POST', '/api/auth/register', { body, cookie: c });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.data.code, code);
    if (msg) assert.equal(r.data.message, msg);
  }
  r = await call('POST', '/api/auth/register', { body: { mobile: '0845678901', email: '', consent: true }, cookie: c });
  assert.equal(r.status, 201);
  const c2 = r.cookie;
  assert.ok(c2);
  assert.equal((await call('GET', '/api/me', { cookie: c2 })).data.username.startsWith('cit-'), true);
  assert.equal((await call('GET', '/api/me', { cookie: c })).status, 401, 'cookie เดิมใช้ไม่ได้แล้ว');
  const row = ctx.db.prepare("SELECT * FROM users WHERE name = 'มานะ ตั้งใจ'").get();
  assert.equal(row.registered, 1);
  assert.ok(row.consent_at);
  assert.ok(!JSON.stringify(row).includes('0845678901'), 'เบอร์เก็บแบบเข้ารหัส');
  // ล็อกอินครั้งถัดไปไม่ต้องลงทะเบียนซ้ำ
  assert.deepEqual((await loginC(ID.MANA)).data, { registered: true });
  // ประชาชนที่ลงทะเบียนแล้ว/ไม่ล็อกอิน เปิด /register → redirect
  r = await call('GET', '/register', { cookie: c2 });
  assert.equal(r.status, 302);
  assert.equal(r.location, '/citizen');
  r = await call('GET', '/register');
  assert.equal(r.location, '/login');
  assert.equal((await call('POST', '/api/auth/register', { body: { mobile: '0845678901', consent: true } })).status, 401);
});

test('FR-01 · เลขบัตร checksum ถูกแต่ไม่มีในระบบ → สร้างบัญชีใหม่ registered:false', async () => {
  await reset();
  const s12 = '123456789012';
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s12[i]) * (13 - i);
  const idNo = s12 + ((11 - (sum % 11)) % 10);
  const v = await loginC(idNo);
  assert.equal(v.status, 200);
  assert.deepEqual(v.data, { registered: false });
  const u = ctx.auth.findCitizenByIdNo(idNo);
  assert.equal(u.username, 'cit-0005');
  assert.equal(u.registered, 0);
  assert.equal(ctx.auth.citizenIdNo(u), idNo);
});

test('FR-03 · staff/login ทุกบทบาท → role/dept/landing + Audit STAFF_LOGIN · ผิด → 401', async () => {
  await reset();
  const rows = [
    ['off.reg1', 'officer', 'registry', '/officer/queue'],
    ['off.reg2', 'officer', 'registry', '/officer/queue'],
    ['off.works1', 'officer', 'works', '/officer/queue'],
    ['head1', 'head', null, '/head/approvals'],
    ['exec1', 'executive', null, '/dashboard'],
    ['audit1', 'auditor', null, '/audit'],
    ['admin1', 'admin', null, '/admin/services'],
  ];
  for (const [username, role, dept, landing] of rows) {
    const r = await call('POST', '/api/auth/staff/login', { body: { username, password: 'Test@1234' } });
    assert.equal(r.status, 200, username);
    assert.deepEqual(r.data, { role, dept, landing });
    const me = await call('GET', '/api/me', { cookie: r.cookie });
    assert.equal(me.data.username, username);
    assert.equal(me.data.role, role);
    // หน้า / → landing
    const root = await call('GET', '/', { cookie: r.cookie });
    assert.equal(root.location, landing);
  }
  const audit = ctx.db.prepare("SELECT * FROM audit WHERE event = 'STAFF_LOGIN' ORDER BY id").all();
  assert.deepEqual(audit.map((a) => a.username), rows.map((x) => x[0]));
  assert.deepEqual(audit.map((a) => a.role), rows.map((x) => x[1]));
  assert.ok(audit.every((a) => a.at === '2026-12-01T09:00:00+07:00' && a.detail === ''));

  for (const [username, password] of [['off.reg1', 'wrong'], ['nobody', 'Test@1234'], [ID.SOMCHAI, 'Test@1234'], ['cit-0001', ''], ['', ''], ['off.reg1', undefined]]) {
    const r = await call('POST', '/api/auth/staff/login', { body: { username, password } });
    assert.equal(r.status, 401, `${username}/${password}`);
    assert.deepEqual(r.data, { code: 'INVALID_CREDENTIALS', message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  }
  assert.equal(ctx.db.prepare("SELECT COUNT(*) n FROM audit WHERE event = 'STAFF_LOGIN'").get().n, rows.length, 'ล็อกอินไม่สำเร็จไม่บันทึก');
});

test('§6.1 logout → 204 แล้ว /api/me 401 · ไม่ล็อกอิน /api/me 401', async () => {
  await reset();
  const r = await call('POST', '/api/auth/staff/login', { body: { username: 'head1', password: 'Test@1234' } });
  const lo = await call('POST', '/api/auth/logout', { cookie: r.cookie });
  assert.equal(lo.status, 204);
  const me = await call('GET', '/api/me', { cookie: r.cookie });
  assert.equal(me.status, 401);
  assert.deepEqual(me.data, { code: 'UNAUTHENTICATED', message: 'กรุณาเข้าสู่ระบบ' });
  assert.equal((await call('POST', '/api/auth/logout')).status, 204);
});

test('§2.2 หน้า /login มี testid และข้อความปุ่มตรงสัญญา', async () => {
  const r = await call('GET', '/login');
  assert.equal(r.status, 200);
  for (const t of ['login-tab-citizen', 'login-tab-staff', 'thaid-id-input', 'thaid-submit', 'thaid-error', 'otp-step', 'otp-input', 'otp-submit', 'otp-error', 'otp-attempts-left', 'lock-message', 'lock-until', 'staff-username', 'staff-password', 'staff-submit', 'staff-error']) {
    assert.match(r.data, new RegExp(`data-testid="${t}"`), t);
  }
  assert.match(r.data, />เข้าสู่ระบบด้วย ThaiD \(จำลอง\)</);
  assert.match(r.data, />ยืนยัน OTP</);
  assert.match(r.data, />เข้าสู่ระบบเจ้าหน้าที่ \(SSO ภาครัฐ จำลอง\)</);
  assert.ok(!/data-testid="thaid-id-input"[^>]*maxlength/.test(r.data), 'ไม่มี maxlength (A-45)');
  // ทุก input มี label for
  for (const m of r.data.matchAll(/<input\s(?:[^>]*\s)?id="([^"]+)"/g)) assert.match(r.data, new RegExp(`<label for="${m[1]}"`), m[1]);
  const js = await fetch(base + '/static/auth/login.js');
  assert.equal(js.status, 200);
});

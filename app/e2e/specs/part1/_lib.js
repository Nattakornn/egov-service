// part1/_lib.js — helper ของชุด 1 (AUTH FEE SUBMIT UPLOAD PAY QUEUE SLA NOTI)
// เขียนจาก CONTRACT.md / TEST-DATA.md / TEST-PLAN.md §0 เท่านั้น (ไม่อ่านโค้ดเว็บ) · ห้าม import จาก part2
const fs = require('fs');
const path = require('path');
const { test: base, expect, request } = require('@playwright/test');
const { ensureTestFiles, TESTFILES_DIR } = require('../../global-setup');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const T0 = '2026-12-01T09:00:00+07:00';
const OTP_OK = '123456';
const PASSWORD = 'Test@1234';

// TEST-DATA §1.1
const ID = {
  SOMCHAI: '1101700123456',
  SOMYING: '3100600987659',
  MANA: '5500400111221',
  PITI: '1909900555015',
};
// TEST-DATA §1.2 / CONTRACT §3
const STAFF_NAME = {
  'off.reg1': 'เจ้าหน้าที่ทะเบียน 1',
  'off.reg2': 'เจ้าหน้าที่ทะเบียน 2',
  'off.works1': 'เจ้าหน้าที่โยธา 1',
  head1: 'หัวหน้าฝ่าย',
  exec1: 'ผู้บริหาร',
  audit1: 'ผู้ตรวจสอบภายใน',
  admin1: 'ผู้ดูแลระบบ',
};

// CONTRACT §5 (ตรงตัวอักษร · "–" = en dash U+2013)
const MSG = {
  INVALID_ID: 'เลขบัตรประชาชนไม่ถูกต้อง',
  OTP_INVALID: 'รหัส OTP ไม่ถูกต้อง',
  LOCKED: 'ผิดเกินกำหนด เลขบัตรนี้ถูกล็อก 15 นาที',
  INVALID_CREDENTIALS: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
  INVALID_MOBILE: 'เบอร์มือถือต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0',
  CONSENT_REQUIRED: 'กรุณายินยอมการประมวลผลข้อมูลส่วนบุคคล (PDPA)',
  INVALID_QTY: 'จำนวนฉบับต้อง 1–5 ฉบับ',
  INVALID_AREA: 'กรุณาระบุพื้นที่ 1–500 ตร.ม.',
  AREA_TOO_LARGE: 'พื้นที่เกิน 500 ตร.ม. กรุณายื่นที่สำนักงาน',
  FILE_TOO_LARGE: 'ไฟล์ใหญ่เกิน 5 MB',
  FILE_TYPE: 'รองรับเฉพาะไฟล์ PDF, JPG, PNG',
  FILE_COUNT: 'แนบได้สูงสุด 5 ไฟล์ต่อคำขอ',
  PLAN_NOT_PDF: 'แบบแปลนต้องเป็นไฟล์ PDF เท่านั้น',
  QR_EXPIRED: 'QR หมดอายุ กรุณาสร้าง QR ใหม่',
  AMOUNT_MISMATCH: 'ยอดเงินไม่ตรงกับค่าธรรมเนียม',
  NOT_FOUND: 'ไม่พบคำขอ',
  CANNOT_CANCEL: 'ยกเลิกไม่ได้ คำขอมีเจ้าหน้าที่รับเรื่องแล้ว',
  ALREADY_CLAIMED: 'มีเจ้าหน้าที่รับเรื่องนี้แล้ว',
  WORKLOAD_LIMIT: 'รับงานได้สูงสุด 10 เรื่อง',
  INVALID_STATE: 'สถานะคำขอไม่ถูกต้องสำหรับรายการนี้',
  NO_REFUND: 'ค่าธรรมเนียมที่ชำระแล้วไม่คืน',
  NOTI_EMPTY: 'ไม่มีแจ้งเตือน',
};

// CONTRACT §4.1 / §4.2
const STATUS_TH = {
  DRAFT: 'ร่าง', PENDING_PAYMENT: 'รอชำระเงิน', SUBMITTED: 'ส่งคำขอแล้ว', IN_REVIEW: 'กำลังตรวจสอบ',
  NEED_FIX: 'รอแก้ไขเอกสาร', PENDING_APPROVAL: 'รออนุมัติ', APPROVED: 'อนุมัติ', COMPLETED: 'เสร็จสิ้น',
  REJECTED: 'ไม่อนุมัติ', CANCELLED: 'ยกเลิก',
};
const LEVEL_TH = { normal: 'ปกติ', near: 'ใกล้ครบกำหนด', overdue: 'เกินกำหนด', paused: 'หยุดนับ', closed: 'ปิดแล้ว' };

// TEST-DATA §11 · ไฟล์บังคับตาม TEST-PLAN §0 NEW_PAID
const REQUIRED_FILES = {
  'SV-01': [['id-card', 'id-card.pdf']],
  'SV-02': [['id-card', 'id-card.pdf'], ['map', 'map.pdf']],
  'SV-03': [['id-card', 'id-card.pdf'], ['plan', 'plan.pdf'], ['deed', 'deed.pdf']],
};

/** เลขคำขอปี 2569 จากลำดับ เช่น cn(31) = EG-2569-000031 */
const cn = (n, year = 2569) => `EG-${year}-${String(n).padStart(6, '0')}`;
const rc = (n, year = 2569) => `RC-${year}-${String(n).padStart(6, '0')}`;

// ---------------------------------------------------------------- files
function testFile(name) {
  const p = path.join(TESTFILES_DIR, name);
  if (!fs.existsSync(p)) ensureTestFiles(false);
  return p;
}
function mimeOf(name) {
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  return 'text/plain';
}
function filePayload(name, mimeType) {
  return { name, mimeType: mimeType || mimeOf(name), buffer: fs.readFileSync(testFile(name)) };
}

// ---------------------------------------------------------------- HTTP helpers
async function readBody(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}
const short = (v) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > 400 ? s.slice(0, 400) + '…' : s; };

/** assert HTTP status (+ code/message ของ error) แล้วคืน body · ข้อความล้มบอก expected/received และ body จริง */
async function expectStatus(res, status, code, label, message) {
  const body = await readBody(res);
  // APIResponse (request context) ไม่มี .request() · Response ของหน้า (waitForResponse) มี
  const method = typeof res.request === 'function' ? res.request().method() : '';
  const where = `${label} [${(method ? method + ' ' : '')}${new URL(res.url()).pathname}]`;
  expect(res.status(), `${where}: HTTP status ควรเป็น ${status} (body=${short(body)})`).toBe(status);
  if (code) expect(body && body.code, `${where}: error code`).toBe(code);
  if (message) expect(body && body.message, `${where}: error message`).toBe(message);
  return body;
}

/** context แยกสำหรับ /api/test/* (ไม่ต้องมี cookie) */
async function withHook(fn) {
  const ctx = await request.newContext({ baseURL: BASE_URL });
  try { return await fn(ctx); } finally { await ctx.dispose(); }
}

/** RESET (TEST-PLAN §0): POST /api/test/reset → 200 now = T0 · หลังจากนี้ cookie เดิมใช้ไม่ได้ ต้องล็อกอินใหม่ */
async function reset() {
  return withHook(async (h) => {
    const body = await expectStatus(await h.post('/api/test/reset'), 200, null, 'RESET');
    expect(body.ok, 'RESET: ok').toBe(true);
    expect(body.now, 'RESET: now หลัง reset').toBe(T0);
    return body;
  });
}

/** CLOCK(t): PUT /api/test/clock {"now":t} (นาฬิกาแช่แข็ง) */
async function clock(iso) {
  return withHook(async (h) => {
    const body = await expectStatus(await h.put('/api/test/clock', { data: { now: iso } }), 200, null, `CLOCK(${iso})`);
    expect(new Date(body.now).getTime(), `CLOCK(${iso}): now ที่ตั้งได้ (received ${body.now})`).toBe(new Date(iso).getTime());
    return body;
  });
}

/** ทุก test เริ่มด้วยสูตรนี้: RESET แล้วตั้งนาฬิกา */
async function start(at = T0) {
  await reset();
  await clock(at);
}

/** POST /api/test/payments/<ref>/pay — คืน response (ให้ผู้เรียก assert เอง) */
async function payRaw(ref, amount) {
  return withHook(async (h) => {
    const res = await h.post(`/api/test/payments/${ref}/pay`, { data: { amount } });
    const body = await readBody(res);
    return { status: res.status(), body };
  });
}
async function payOk(ref, amount, label = `pay ${ref}`) {
  const r = await payRaw(ref, amount);
  expect(r.status, `${label}: HTTP status (body=${short(r.body)})`).toBe(200);
  expect(r.body.status, `${label}: status`).toBe('PAID');
  return r.body;
}

// ---------------------------------------------------------------- auth
async function loginC(api, idNo = ID.SOMCHAI) {
  await expectStatus(await api.post('/api/auth/thaid/start', { data: { idNo } }), 200, null, `LOGIN_C(${idNo}) start`);
  return expectStatus(await api.post('/api/auth/thaid/verify', { data: { idNo, otp: OTP_OK } }), 200, null, `LOGIN_C(${idNo}) verify`);
}
async function loginS(api, username) {
  return expectStatus(
    await api.post('/api/auth/staff/login', { data: { username, password: PASSWORD } }),
    200, null, `LOGIN_S(${username})`,
  );
}

// ---------------------------------------------------------------- drafts / payment (API)
async function newDraft(api, serviceId = 'SV-01', { qty = 1, areaSqm = 100 } = {}) {
  const data = { serviceId };
  if (serviceId === 'SV-01') data.qty = qty;
  if (serviceId === 'SV-03') data.areaSqm = areaSqm;
  const body = await expectStatus(await api.post('/api/drafts', { data }), 201, null, `POST /api/drafts ${JSON.stringify(data)}`);
  expect(body.draftId, 'draftId').toMatch(/^DR-\d{4}$/);
  return body;
}
async function uploadRaw(api, draftId, docKey, name, mimeType) {
  return api.post(`/api/drafts/${draftId}/files`, { multipart: { docKey, file: filePayload(name, mimeType) } });
}
async function uploadOk(api, draftId, docKey, name) {
  return expectStatus(await uploadRaw(api, draftId, docKey, name), 201, null, `upload ${name} → ${draftId}/${docKey}`);
}
async function createQr(api, draftId) {
  return expectStatus(await api.post(`/api/drafts/${draftId}/payment`), 201, null, `POST /api/drafts/${draftId}/payment`);
}
/** ร่าง + ไฟล์บังคับ + QR (ยังไม่ชำระ) */
async function newQr(api, serviceId = 'SV-01', opts = {}) {
  const d = await newDraft(api, serviceId, opts);
  for (const [docKey, name] of REQUIRED_FILES[serviceId]) await uploadOk(api, d.draftId, docKey, name);
  const qr = await createQr(api, d.draftId);
  return { draftId: d.draftId, fee: d.fee, ref: qr.ref, amount: qr.amount, qr };
}
/** NEW_PAID (TEST-PLAN §0) โดยไม่ตั้งนาฬิกา/ล็อกอิน (ผู้เรียกทำก่อน) */
async function newPaid(api, serviceId = 'SV-01', opts = {}) {
  const q = await newQr(api, serviceId, opts);
  const paid = await payOk(q.ref, q.fee, `NEW_PAID pay ${q.ref}`);
  const p = await expectStatus(await api.get(`/api/payments/${q.ref}`), 200, null, `GET /api/payments/${q.ref}`);
  expect(p.caseNo, `GET /api/payments/${q.ref}: caseNo ตรงกับผล pay`).toBe(paid.caseNo);
  return { ...q, caseNo: paid.caseNo, receiptNo: paid.receiptNo };
}
async function getCase(api, caseNo, label = '') {
  return expectStatus(await api.get(`/api/cases/${caseNo}`), 200, null, `GET /api/cases/${caseNo} ${label}`);
}
async function myCases(api) {
  const b = await expectStatus(await api.get('/api/cases'), 200, null, 'GET /api/cases');
  return b.items;
}
async function claimApi(api, caseNo) {
  // APIRequestContext ไม่ผูกกับหน้าเว็บ (ไม่มีการเปลี่ยนหน้า) → อ่าน body ได้เสมอ · อ่านไม่ได้ = ล้ม
  const res = await api.post(`/api/officer/cases/${caseNo}/claim`);
  return { status: res.status(), body: await readBody(res) };
}
async function returnApi(api, caseNo, reason = 'xxxxxxxxxx') {
  return expectStatus(await api.post(`/api/officer/cases/${caseNo}/return`, { data: { reason } }), 200, null, `return ${caseNo}`);
}
async function queueApi(api, filter = 'all') {
  const b = await expectStatus(await api.get(`/api/officer/queue?filter=${filter}`), 200, null, `GET /api/officer/queue?filter=${filter}`);
  return b.items;
}
async function notisApi(api, label = '') {
  const b = await expectStatus(await api.get('/api/notifications'), 200, null, `GET /api/notifications ${label}`);
  return b.items;
}
/** ชุด "caseNo:level" เรียงแล้ว */
const notiKeys = (items) => items.map((i) => `${i.caseNo}:${i.level}`).sort();

async function auditApi(api, query) {
  const qs = new URLSearchParams(query).toString();
  const b = await expectStatus(await api.get(`/api/audit?${qs}`), 200, null, `GET /api/audit?${qs}`);
  return b.items;
}

// ---------------------------------------------------------------- UI helpers
const tid = (scope, id) => scope.getByTestId(id);
/** แถวที่ data-testid ซ้ำได้ กรองด้วยแอตทริบิวต์ data-* (CONTRACT 0.1) */
const byAttr = (scope, testid, attr, value) => scope.locator(`[data-testid="${testid}"][${attr}="${value}"]`);
const queueRow = (page, caseNo) => byAttr(page, 'queue-row', 'data-case-no', caseNo);

async function attrList(locator, attr) {
  return locator.evaluateAll((els, a) => els.map((e) => e.getAttribute(a)), attr);
}
/** รอจนรายการ data-* ตรงลำดับที่คาดหวัง (ข้อความล้มแสดง expected/received) */
async function expectAttrList(locator, attr, expected, message) {
  // หน้าอาจกำลังเปลี่ยน (เช่น queue-filter ส่งฟอร์ม GET) → evaluate ล้มชั่วคราว ให้ poll ลองใหม่แทนการล้มทันที
  await expect.poll(() => attrList(locator, attr).catch((e) => `(อ่านไม่ได้ระหว่างโหลดหน้า: ${String(e.message || e).split('\n')[0]})`), { message, timeout: 10_000 }).toEqual(expected);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** URL path ตรงตัว (ยอม query/hash ต่อท้าย) */
async function expectPath(page, p, message) {
  await expect(page, message || `URL ควรเป็น ${p}`).toHaveURL(new RegExp(`^https?://[^/]+${escapeRe(p)}(?:[?#].*)?$`));
}

/** คลิกแล้วจับ response ของ API ที่ URL มี urlPart (สำหรับ assert HTTP code ของการกระทำผ่านหน้าจอ) */
async function clickAndCapture(page, locator, urlPart, method = 'POST') {
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes(urlPart) && r.request().method() === method, { timeout: 15_000 }),
    locator.click(),
  ]);
  const status = res.status();
  let body;
  try {
    body = await readBody(res);
  } catch (e) {
    // ยอมเฉพาะกรณีสำเร็จ (200) แล้วหน้าเปลี่ยน URL ทันที (location.assign) → browser ทิ้ง body ไปแล้ว
    // error response (≠ 200) ต้องอ่าน body ได้เสมอ เพื่อให้ข้อความล้มบอก code ที่คาด/ที่ได้
    if (status !== 200) throw new Error(`${method} ${res.url()} → HTTP ${status}: อ่าน body ไม่ได้ (${String(e && e.message).split('\n')[0]})`);
    body = null;
  }
  return { status, body };
}

/** ล็อกอินประชาชนผ่านหน้า /login (ThaiD จำลอง) */
async function uiLoginCitizen(page, idNo, otp = OTP_OK) {
  await page.goto('/login');
  await tid(page, 'login-tab-citizen').click();
  await tid(page, 'thaid-id-input').fill(idNo);
  await tid(page, 'thaid-submit').click();
  await expect(tid(page, 'otp-step'), `otp-step ควรแสดงหลังกรอกเลขบัตร ${idNo}`).toBeVisible();
  await tid(page, 'otp-input').fill(otp);
  await tid(page, 'otp-submit').click();
}
/** ล็อกอินเจ้าหน้าที่ผ่านแท็บเจ้าหน้าที่ */
async function uiLoginStaff(page, username, password = PASSWORD) {
  await page.goto('/login');
  await tid(page, 'login-tab-staff').click();
  await tid(page, 'staff-username').fill(username);
  await tid(page, 'staff-password').fill(password);
  await tid(page, 'staff-submit').click();
}

/** อ่าน workload-count จากหน้า /officer/queue (โหลดหน้าใหม่) */
async function expectWorkload(page, n, message) {
  await page.goto('/officer/queue');
  await expect(tid(page, 'workload-count'), message || `workload-count ควรเป็น ${n}`).toHaveText(String(n));
}

/** ตรวจ sla-level บนหน้าเคส (ข้อความไทย + data-level) */
async function expectSlaLevel(locator, level, message) {
  await expect(locator, `${message || ''} sla-level ข้อความ`).toHaveText(LEVEL_TH[level]);
  await expect(locator, `${message || ''} sla-level data-level`).toHaveAttribute('data-level', level);
}
async function expectCaseStatus(page, status, message) {
  await expect(tid(page, 'case-status'), `${message || ''} case-status ข้อความ`).toHaveText(STATUS_TH[status]);
  await expect(tid(page, 'case-status'), `${message || ''} case-status data-status`).toHaveAttribute('data-status', status);
}

/** แนบไฟล์ผ่านหน้าจอ (setInputFiles) */
async function uiAttach(page, inputTestId, nameOrPayload) {
  const input = tid(page, inputTestId);
  if (typeof nameOrPayload === 'string') await input.setInputFiles(testFile(nameOrPayload));
  else await input.setInputFiles(nameOrPayload);
}
/** ลบไฟล์ในแถว file-item ที่ data-name ตรง */
async function uiRemoveFile(page, name) {
  const items = tid(page, 'file-item');
  const before = await items.count();
  await byAttr(page, 'file-item', 'data-name', name).getByTestId('file-remove-btn').click();
  await expect(items, `file-item ควรลดลงหลังลบ ${name}`).toHaveCount(before - 1);
}

// ---------------------------------------------------------------- fixture
/**
 * fixture `tc`: สร้าง browser context ใหม่ต่อผู้ใช้ (cookie แยกกัน) แล้วล็อกอินด้วย context.request
 * (cookie ใช้ร่วมกับหน้าเว็บของ context เดียวกัน) · ปิดทุก context เมื่อจบ test
 */
const test = base.extend({
  tc: async ({ browser }, use) => {
    const contexts = [];
    const anon = async () => {
      const ctx = await browser.newContext({ baseURL: BASE_URL, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
      contexts.push(ctx);
      const page = await ctx.newPage();
      return { ctx, page, api: ctx.request };
    };
    const citizen = async (idNo = ID.SOMCHAI) => { const a = await anon(); a.login = await loginC(a.api, idNo); return a; };
    const staff = async (username) => { const a = await anon(); a.login = await loginS(a.api, username); a.username = username; return a; };
    await use({ anon, citizen, staff });
    for (const c of contexts) await c.close().catch(() => {});
  },
});

module.exports = {
  test, expect, BASE_URL, T0, OTP_OK, PASSWORD, ID, STAFF_NAME, MSG, STATUS_TH, LEVEL_TH, REQUIRED_FILES,
  cn, rc, testFile, filePayload, readBody, expectStatus, reset, clock, start, payRaw, payOk,
  loginC, loginS, newDraft, uploadRaw, uploadOk, createQr, newQr, newPaid, getCase, myCases,
  claimApi, returnApi, queueApi, notisApi, notiKeys, auditApi,
  tid, byAttr, queueRow, attrList, expectAttrList, expectPath, clickAndCapture,
  uiLoginCitizen, uiLoginStaff, expectWorkload, expectSlaLevel, expectCaseStatus, uiAttach, uiRemoveFile,
};

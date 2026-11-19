// @ts-check
// part2/_lib.js · helper ของชุด 2 (WORKFLOW DOC PDPA DASH AUDIT RBAC NFR)
// เขียนจาก TEST-PLAN.md §0 · CONTRACT.md · TEST-DATA.md เท่านั้น (ไม่อ่านโค้ดเว็บ)
// ห้าม import จาก part1 · ใช้ dependency ใน e2e/package.json เท่านั้น
'use strict';

const fs = require('fs');
const path = require('path');
const base = require('@playwright/test');

const { expect, request } = base;
const {
  SEED_NAMES, NFR04_NEEDLES, pdfText, assertPdfText, textLines, piiFindings, pdfPiiFindings, needleFindings,
} = require('./pii');

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const T0 = '2026-12-01T09:00:00+07:00';
const PASSWORD = 'Test@1234';
const OTP = '123456';

const ID = {
  somchai: '1101700123456',
  somying: '3100600987659',
  mana: '5500400111221',
  piti: '1909900555015',
};

/** เลขคำขอปี 2569 จากลำดับ เช่น C(25) = EG-2569-000025 */
const C = (n) => `EG-2569-${String(n).padStart(6, '0')}`;

const STATUS_TH = {
  DRAFT: 'ร่าง',
  PENDING_PAYMENT: 'รอชำระเงิน',
  SUBMITTED: 'ส่งคำขอแล้ว',
  IN_REVIEW: 'กำลังตรวจสอบ',
  NEED_FIX: 'รอแก้ไขเอกสาร',
  PENDING_APPROVAL: 'รออนุมัติ',
  APPROVED: 'อนุมัติ',
  COMPLETED: 'เสร็จสิ้น',
  REJECTED: 'ไม่อนุมัติ',
  CANCELLED: 'ยกเลิก',
};

const LEVEL_TH = {
  normal: 'ปกติ',
  near: 'ใกล้ครบกำหนด',
  overdue: 'เกินกำหนด',
  paused: 'หยุดนับ',
  closed: 'ปิดแล้ว',
};

const REASON9 = 'xxxxxxxxx';
const REASON10 = 'xxxxxxxxxx';

// ---------------------------------------------------------------------------
// ไฟล์ทดสอบ (TEST-DATA §11) · อ่านจาก app/e2e/testfiles/<ชื่อ> (global-setup สร้างให้)
// ไม่มีไฟล์ → throw (ไม่สร้างไฟล์แทนเอง เพื่อไม่ให้ใช้ไฟล์ผิดสเปกโดยไม่รู้ตัว)
// ---------------------------------------------------------------------------
const TESTFILES_DIR = path.resolve(__dirname, '..', '..', 'testfiles');

function testFilePath(name) {
  const p = path.join(TESTFILES_DIR, name);
  if (!fs.existsSync(p)) throw new Error(`ไม่พบไฟล์ทดสอบ ${p} (TEST-DATA §11 · global-setup ต้องสร้างไว้ก่อน)`);
  return p;
}

function testFile(name) {
  return fs.readFileSync(testFilePath(name));
}

/** payload สำหรับ setInputFiles (ไฟล์ต้องมีใน testfiles/) */
function inputFile(name) {
  return { name, mimeType: /\.pdf$/i.test(name) ? 'application/pdf' : 'application/octet-stream', buffer: testFile(name) };
}

const REQUIRED_FILES = {
  'SV-01': [['id-card', 'id-card.pdf']],
  'SV-02': [['id-card', 'id-card.pdf'], ['map', 'map.pdf']],
  'SV-03': [['id-card', 'id-card.pdf'], ['plan', 'plan.pdf'], ['deed', 'deed.pdf']],
};

// ---------------------------------------------------------------------------
// การตรวจ HTTP (ข้อความล้มบอก expected / received เสมอ)
// ---------------------------------------------------------------------------
async function bodyOf(res) {
  try {
    return (await res.text()).slice(0, 400);
  } catch {
    return '<no body>';
  }
}

/** ตรวจ HTTP status · ล้มพร้อม expected/received + body */
async function expectHttp(res, status, label) {
  const got = res.status();
  if (got !== status) {
    throw new Error(`${label}: expected HTTP ${status}, received HTTP ${got} · body=${await bodyOf(res)}`);
  }
}

/** ตรวจ error JSON `{code,message}` */
async function expectApiError(res, status, code, label, message) {
  await expectHttp(res, status, label);
  let j;
  try {
    j = await res.json();
  } catch {
    throw new Error(`${label}: expected JSON {"code":"${code}"}, received non-JSON body=${await bodyOf(res)}`);
  }
  expect(j && j.code, `${label}: expected code "${code}", received ${JSON.stringify(j)}`).toBe(code);
  if (message !== undefined) {
    expect(j.message, `${label}: expected message "${message}", received "${j.message}"`).toBe(message);
  }
  return j;
}

async function okJson(res, label, status = 200) {
  await expectHttp(res, status, label);
  try {
    return await res.json();
  } catch {
    throw new Error(`${label}: expected JSON body, received ${await bodyOf(res)}`);
  }
}

// ---------------------------------------------------------------------------
// Kit: RESET + CLOCK + ล็อกอิน + context ใหม่ (CONTRACT 0.9 · TEST-PLAN §0)
// ---------------------------------------------------------------------------
class Kit {
  /** @param {import('@playwright/test').Browser} browser */
  constructor(browser) {
    this.browser = browser;
    /** @type {import('@playwright/test').APIRequestContext[]} */
    this.apis = [];
    /** @type {import('@playwright/test').BrowserContext[]} */
    this.contexts = [];
    this._hook = null;
  }

  async newApi() {
    const api = await request.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true });
    this.apis.push(api);
    return api;
  }

  /** context ไม่มี cookie ใช้เรียก /api/test/* และ API ที่ไม่ต้องล็อกอิน */
  async anon() {
    if (!this._hook) this._hook = await this.newApi();
    return this._hook;
  }

  /** RESET (ล้าง session ทุกคน → ต้องล็อกอินใหม่และใช้ context ใหม่) */
  async reset() {
    const h = await this.anon();
    const res = await h.post('/api/test/reset');
    const j = await okJson(res, 'RESET POST /api/test/reset');
    expect(j.now, `RESET: expected now "${T0}", received "${j.now}"`).toBe(T0);
  }

  /** CLOCK(t) */
  async clock(iso) {
    const h = await this.anon();
    const res = await h.put('/api/test/clock', { data: { now: iso } });
    await expectHttp(res, 200, `CLOCK(${iso})`);
  }

  /** RESET + CLOCK(T0) (ใช้ทั้งต้น test และ RESET กลาง TC) */
  async fresh(clockIso = T0) {
    await this.reset();
    await this.clock(clockIso);
  }

  /** LOGIN_S(user) → API context ใหม่ที่มี cookie */
  async loginS(username) {
    const api = await this.newApi();
    const res = await api.post('/api/auth/staff/login', { data: { username, password: PASSWORD } });
    await expectHttp(res, 200, `LOGIN_S ${username}`);
    return api;
  }

  /** LOGIN_C(เลขบัตร) → API context ใหม่ (ประชาชนที่ลงทะเบียนแล้วต้องได้ registered=true) */
  async loginC(idNo, { expectRegistered = true } = {}) {
    const api = await this.newApi();
    const r1 = await api.post('/api/auth/thaid/start', { data: { idNo } });
    await expectHttp(r1, 200, `LOGIN_C ${idNo} thaid/start`);
    const r2 = await api.post('/api/auth/thaid/verify', { data: { idNo, otp: OTP } });
    const j = await okJson(r2, `LOGIN_C ${idNo} thaid/verify`);
    if (expectRegistered !== null) {
      expect(j.registered, `LOGIN_C ${idNo}: expected registered=${expectRegistered}, received ${JSON.stringify(j)}`).toBe(expectRegistered);
    }
    return api;
  }

  /** เปิด browser context ใหม่ที่ใช้ cookie ของ API context (ไม่ล็อกอินซ้ำ → ไม่เกิด STAFF_LOGIN เพิ่ม) */
  async pageFor(api, opts = {}) {
    const storageState = api ? await api.storageState() : undefined;
    const ctx = await this.browser.newContext({ baseURL: BASE_URL, storageState, acceptDownloads: true, ...opts });
    this.contexts.push(ctx);
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept().catch(() => {}));
    return page;
  }

  /** browser context ไม่ล็อกอิน */
  async anonPage(opts = {}) {
    return this.pageFor(null, opts);
  }

  async close() {
    for (const c of this.contexts) await c.close().catch(() => {});
    for (const a of this.apis) await a.dispose().catch(() => {});
    this.contexts = [];
    this.apis = [];
    this._hook = null;
  }
}

// ทุก test เริ่มด้วย RESET + CLOCK(T0) อัตโนมัติ แล้วล็อกอินใหม่ในตัว test
const test = base.test.extend({
  kit: async ({ browser }, use) => {
    const kit = new Kit(browser);
    await kit.fresh();
    await use(kit);
    await kit.close();
  },
});

// ---------------------------------------------------------------------------
// สูตร NEW_PAID (TEST-PLAN §0)
// ---------------------------------------------------------------------------
/**
 * @param {Kit} kit
 * @param {{idNo?:string, serviceId?:string, qty?:number, areaSqm?:number, at?:string, expectFee?:number}} o
 */
async function newPaid(kit, o = {}) {
  const idNo = o.idNo || ID.somchai;
  const serviceId = o.serviceId || 'SV-01';
  if (o.at) await kit.clock(o.at);
  const api = await kit.loginC(idNo);
  const body = { serviceId };
  if (serviceId === 'SV-01') body.qty = o.qty || 1;
  if (serviceId === 'SV-03') body.areaSqm = o.areaSqm || 100;
  const d = await okJson(await api.post('/api/drafts', { data: body }), `NEW_PAID POST /api/drafts ${JSON.stringify(body)}`, 201);
  if (o.expectFee !== undefined) {
    expect(d.fee, `NEW_PAID fee: expected ${o.expectFee}, received ${d.fee}`).toBe(o.expectFee);
  }
  for (const [docKey, name] of REQUIRED_FILES[serviceId]) {
    const r = await api.post(`/api/drafts/${d.draftId}/files`, {
      multipart: { file: { name, mimeType: 'application/pdf', buffer: testFile(name) }, docKey },
    });
    await expectHttp(r, 201, `NEW_PAID upload ${name}`);
  }
  const p = await okJson(await api.post(`/api/drafts/${d.draftId}/payment`), 'NEW_PAID POST payment', 201);
  const h = await kit.anon();
  const paid = await okJson(await h.post(`/api/test/payments/${p.ref}/pay`, { data: { amount: p.amount } }), `NEW_PAID pay ${p.ref}`);
  const st = await okJson(await api.get(`/api/payments/${p.ref}`), `NEW_PAID GET /api/payments/${p.ref}`);
  expect(st.caseNo, `NEW_PAID caseNo: expected ${paid.caseNo}, received ${st.caseNo}`).toBe(paid.caseNo);
  return { api, caseNo: st.caseNo, fee: d.fee, ref: p.ref, draftId: d.draftId };
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
const tid = (scope, id) => scope.getByTestId(id);

async function gotoStatus(page, url, status, label) {
  const res = await page.goto(url);
  const got = res ? res.status() : -1;
  expect(got, `${label || url}: expected HTTP ${status}, received HTTP ${got}`).toBe(status);
  return res;
}

async function expectCaseStatus(page, code, label = '') {
  const loc = tid(page, 'case-status');
  await expect(loc, `${label} case-status data-status: expected ${code}`).toHaveAttribute('data-status', code);
  await expect(loc, `${label} case-status text: expected "${STATUS_TH[code]}"`).toHaveText(STATUS_TH[code]);
}

async function expectLevel(page, level, label = '') {
  const loc = tid(page, 'sla-level');
  await expect(loc, `${label} sla-level data-level: expected ${level}`).toHaveAttribute('data-level', level);
  await expect(loc, `${label} sla-level text: expected "${LEVEL_TH[level]}"`).toHaveText(LEVEL_TH[level]);
}

async function expectCount(loc, n, label) {
  await expect(loc, `${label}: expected count ${n}`).toHaveCount(n);
}

async function expectText(loc, text, label) {
  await expect(loc, `${label}: expected text "${text}"`).toHaveText(text);
}

/** data-* ของทุกแถว */
async function rowAttr(loc, attr) {
  return loc.evaluateAll((els, a) => els.map((e) => e.getAttribute(a)), attr);
}

/** ตีกลับผ่านหน้า (return-btn → return-reason → return-submit) */
async function uiReturn(page, reason) {
  if (!(await tid(page, 'return-reason').isVisible().catch(() => false))) await tid(page, 'return-btn').click();
  await tid(page, 'return-reason').fill(reason);
  await tid(page, 'return-submit').click();
}

/** ไม่อนุมัติผ่านหน้า */
async function uiReject(page, reason) {
  if (!(await tid(page, 'reject-reason').isVisible().catch(() => false))) await tid(page, 'reject-btn').click();
  await tid(page, 'reject-reason').fill(reason);
  await tid(page, 'reject-submit').click();
}

/** ประชาชนส่งแก้ไขผ่านหน้า → IN_REVIEW */
async function uiResubmit(page, caseNo) {
  await gotoStatus(page, `/citizen/cases/${caseNo}`, 200, `citizen open ${caseNo}`);
  await expectCaseStatus(page, 'NEED_FIX', `${caseNo} ก่อนส่งแก้`);
  await tid(page, 'submit-fix-btn').click();
  await expectCaseStatus(page, 'IN_REVIEW', `${caseNo} หลังส่งแก้`);
}

/** ตั้งตัวกรอง /audit แล้วกดค้นหา · คืนค่า audit-count ที่คาด (ตรวจด้วย) */
async function auditFilter(page, f, expectedCount, label) {
  await tid(page, 'audit-filter-actor').fill(f.actor || '');
  await tid(page, 'audit-filter-event').selectOption(f.event || '');
  await tid(page, 'audit-filter-from').fill(f.from || '');
  await tid(page, 'audit-filter-to').fill(f.to || '');
  await tid(page, 'audit-apply-btn').click();
  if (expectedCount !== undefined) {
    await expectText(tid(page, 'audit-count'), String(expectedCount), `${label} audit-count`);
    await expectCount(tid(page, 'audit-row'), expectedCount, `${label} audit-row`);
  }
}

/** อ่านแถว audit บนจอ */
async function auditRows(page) {
  return tid(page, 'audit-row').evaluateAll((rows) =>
    rows.map((r) => {
      const cell = (id) => r.querySelector(`[data-testid="${id}"]`);
      const txt = (id) => (cell(id) ? cell(id).textContent.replace(/\s+/g, ' ').trim() : null);
      return {
        id: r.getAttribute('data-id'),
        event: r.getAttribute('data-event'),
        actor: r.getAttribute('data-actor'),
        caseNo: r.getAttribute('data-case-no'),
        iso: cell('audit-time') ? cell('audit-time').getAttribute('data-iso') : null,
        actorText: txt('audit-actor'),
        role: txt('audit-role'),
        eventText: txt('audit-event'),
        caseText: txt('audit-case-no'),
        transition: txt('audit-transition'),
        detail: txt('audit-detail'),
      };
    }),
  );
}

/** ดาวน์โหลดจากปุ่ม/ลิงก์ (รอ event download · ถ้าหน้าเปิดไฟล์แทน ใช้ href ดึงด้วย cookie เดียวกัน) */
async function grabDownload(page, locator, label) {
  const href = await locator.getAttribute('href').catch(() => null);
  const wait = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  await locator.click();
  const dl = await wait;
  if (dl) {
    const p = await dl.path();
    return { name: dl.suggestedFilename(), buf: fs.readFileSync(p), headers: null };
  }
  if (!href) throw new Error(`${label}: expected a download, received no download event and no href`);
  const res = await page.request.get(href);
  await expectHttp(res, 200, `${label} GET ${href}`);
  const cd = res.headers()['content-disposition'] || '';
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  return { name: m ? decodeURIComponent(m[1]) : '', buf: await res.body(), headers: res.headers() };
}

// ---------------------------------------------------------------------------
// PDF / XLSX
// ---------------------------------------------------------------------------
/** ข้อความที่ดึงจาก PDF ด้วย pdf-parse เท่านั้น (ไม่ใช้ไบต์ดิบ/Info dictionary) · ดึงไม่ได้หรือว่าง → throw */
async function pdfLines(buf, label = 'PDF') {
  const text = assertPdfText(await pdfText(buf), label);
  return { text, lines: textLines(text) };
}

/** PDF ต้องมีบรรทัดที่มี line ในข้อความที่ดึงออกมา (pdf-parse) */
async function expectPdfLine(buf, line, label) {
  const { text, lines } = await pdfLines(buf, label);
  const ok = lines.some((l) => l.includes(line));
  const ascii = lines.filter((l) => /^[\x20-\x7e]+$/.test(l)).slice(0, 15);
  expect(ok, `${label}: expected extracted PDF text to contain line "${line}", received ASCII lines ${JSON.stringify(ascii)}`).toBe(true);
  return { text, lines };
}

async function readXlsx(buf) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  const cells = [];
  const grid = {};
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    row.eachCell({ includeEmpty: false }, (cell, c) => {
      const t = cell.text !== undefined && cell.text !== null ? String(cell.text) : String(cell.value ?? '');
      grid[`${r}:${c}`] = t.trim();
      cells.push(t);
    });
  });
  return { get: (r, c) => grid[`${r}:${c}`], cells };
}

// ---------------------------------------------------------------------------
// ข้อมูลส่วนบุคคล (ตัวตรวจอยู่ใน ./pii.js · มี unit test ตัวควบคุมบวกที่ app/test/pii-check.test.js)
// ---------------------------------------------------------------------------
/** หา key ชื่อ name ทุกชั้น */
function deepKeyPaths(obj, name, pre = '$') {
  const out = [];
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const p = Array.isArray(obj) ? `${pre}[${k}]` : `${pre}.${k}`;
      if (k === name) out.push(p);
      out.push(...deepKeyPaths(v, name, p));
    }
  }
  return out;
}

module.exports = {
  test,
  expect,
  BASE_URL,
  T0,
  PASSWORD,
  OTP,
  ID,
  C,
  STATUS_TH,
  LEVEL_TH,
  REASON9,
  REASON10,
  TESTFILES_DIR,
  testFile,
  testFilePath,
  inputFile,
  Kit,
  newPaid,
  tid,
  gotoStatus,
  expectHttp,
  expectApiError,
  okJson,
  expectCaseStatus,
  expectLevel,
  expectCount,
  expectText,
  rowAttr,
  uiReturn,
  uiReject,
  uiResubmit,
  auditFilter,
  auditRows,
  grabDownload,
  pdfText,
  pdfLines,
  expectPdfLine,
  readXlsx,
  piiFindings,
  pdfPiiFindings,
  needleFindings,
  NFR04_NEEDLES,
  deepKeyPaths,
  SEED_NAMES,
};

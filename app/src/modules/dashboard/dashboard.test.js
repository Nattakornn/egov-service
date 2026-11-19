'use strict';
// P11 · unit test ตัวเลข Dashboard ทุกตัวอย่างใน REQUIREMENTS BR-25 BR-26 · TEST-DATA §7 (7.1 7.2 7.2.1 7.3) · BUGS B10
// + HTTP (API · หน้า · ส่งออก xlsx/pdf · Audit EXPORT · RBAC · ไม่มีข้อมูลส่วนบุคคล)
// รัน: node --test src/modules/dashboard   หรือ   npm test -- src/modules/dashboard
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const M = require('./metrics');
const APP_ROOT = path.resolve(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// TEST-DATA §4.1 ถอดด้วยมือ (แยกจาก seed ของ core เพื่อตรวจสูตรกับสเปกตรง ๆ)
// [เลข, บริการ, สถานะ, ผู้ถือ, ชำระเมื่อ, กำหนดเสร็จ, ปิดงาน]
// ---------------------------------------------------------------------------
const T = (s) => (s ? `2026-${s}:00+07:00` : null); // 'MM-DDTHH:MM' → ISO
const TD41 = [
  [1, 'SV-01', 'COMPLETED', null, '10-14T10:00', '10-19T16:30', '10-16T14:00'],
  [2, 'SV-03', 'COMPLETED', null, '11-02T09:00', '11-23T16:30', '11-20T11:00'],
  [3, 'SV-01', 'COMPLETED', null, '11-02T09:30', '11-05T16:30', '11-04T15:00'],
  [4, 'SV-02', 'COMPLETED', null, '11-02T14:00', '11-16T16:30', '11-13T15:00'],
  [5, 'SV-01', 'COMPLETED', null, '11-03T11:00', '11-06T16:30', '11-05T10:00'],
  [6, 'SV-02', 'COMPLETED', null, '11-03T15:00', '11-17T16:30', '11-19T10:00'], // ไม่ทัน
  [7, 'SV-02', 'COMPLETED', null, '11-04T10:00', '11-18T16:30', '11-18T16:00'],
  [8, 'SV-01', 'REJECTED', null, '11-09T10:00', '11-12T16:30', '11-11T09:00'],
  [9, 'SV-01', 'CANCELLED', null, '11-09T14:30', '11-12T16:30', null],
  [10, 'SV-03', 'IN_REVIEW', null, '11-12T10:00', '12-03T16:30', null],
  [11, 'SV-03', 'PENDING_APPROVAL', null, '11-16T10:00', '12-08T16:30', null],
  [12, 'SV-03', 'IN_REVIEW', 'off.reg2', '11-18T10:00', '12-11T16:30', null],
  [13, 'SV-02', 'IN_REVIEW', 'off.reg2', '11-20T10:00', '12-04T16:30', null],
  [14, 'SV-02', 'PENDING_APPROVAL', null, '11-20T11:00', '12-04T16:30', null],
  [15, 'SV-02', 'IN_REVIEW', 'off.reg2', '11-20T15:00', '12-04T16:30', null],
  [16, 'SV-02', 'IN_REVIEW', 'off.reg2', '11-23T09:00', '12-08T16:30', null],
  [17, 'SV-01', 'NEED_FIX', 'off.reg1', '11-23T10:00', '11-27T16:30', null],
  [18, 'SV-02', 'IN_REVIEW', 'off.reg2', '11-24T10:00', '12-09T16:30', null],
  [19, 'SV-02', 'APPROVED', null, '11-24T14:00', '12-09T16:30', null],
  [20, 'SV-01', 'IN_REVIEW', 'off.reg1', '11-25T10:00', '11-30T16:30', null],
  [21, 'SV-02', 'IN_REVIEW', 'off.reg2', '11-25T12:00', '12-11T16:30', null],
  [22, 'SV-01', 'IN_REVIEW', 'off.reg1', '11-26T10:00', '12-01T16:30', null],
  [23, 'SV-01', 'IN_REVIEW', 'off.reg1', '11-26T10:30', '12-03T16:30', null],
  [24, 'SV-01', 'SUBMITTED', null, '11-27T11:00', '12-02T16:30', null],
  [25, 'SV-01', 'IN_REVIEW', 'off.reg2', '11-30T10:00', '12-03T16:30', null],
  [26, 'SV-01', 'IN_REVIEW', 'off.reg2', '11-30T16:29', '12-03T16:30', null],
  [27, 'SV-01', 'IN_REVIEW', 'off.reg2', '11-30T16:30', '12-04T16:30', null],
  [28, 'SV-01', 'SUBMITTED', null, '12-01T08:10', '12-04T16:30', null],
  [29, 'SV-01', 'SUBMITTED', null, '12-01T08:20', '12-04T16:30', null],
  [30, 'SV-01', 'SUBMITTED', null, '12-01T08:30', '12-04T16:30', null],
];
const caseNo = (n) => `EG-2569-${String(n).padStart(6, '0')}`;
const seedRows = () =>
  TD41.map(([n, service_id, status, owner, paid, due, closed]) => ({
    case_no: caseNo(n), service_id, status, owner, paid_at: T(paid), due_at: T(due), closed_at: T(closed),
  }));
const NOW0 = '2026-12-01T09:00:00+07:00';
const OFFICERS = [
  { username: 'off.reg1', name: 'เจ้าหน้าที่ทะเบียน 1' },
  { username: 'off.reg2', name: 'เจ้าหน้าที่ทะเบียน 2' },
  { username: 'off.works1', name: 'เจ้าหน้าที่โยธา 1' },
];

// [period, service, received, closed, onTime, จอทันกำหนด %, backlog, overdue] · TEST-DATA §7.1 §7.2 §7.3 ที่นาฬิกา 1 ธ.ค. 09:00
const TABLE7 = [
  ['2026-12', 'ALL', 3, 0, 0, '–', 21, 1],
  ['2026-12', 'SV-01', 3, 0, 0, '–', 11, 1],
  ['2026-12', 'SV-02', 0, 0, 0, '–', 7, 0],
  ['2026-12', 'SV-03', 0, 0, 0, '–', 3, 0],
  ['2026-10', 'ALL', 1, 1, 1, '100.0%', 21, 1],
  ['2026-11', 'ALL', 26, 7, 6, '85.7%', 21, 1],
  ['2026-11', 'SV-01', 12, 3, 3, '100.0%', 11, 1],
  ['2026-11', 'SV-02', 10, 3, 2, '66.7%', 7, 0],
  ['2026-11', 'SV-03', 4, 1, 1, '100.0%', 3, 0],
  ['2026', 'ALL', 30, 8, 7, '87.5%', 21, 1],
  ['2026', 'SV-01', 16, 4, 4, '100.0%', 11, 1],
  ['2026', 'SV-02', 10, 3, 2, '66.7%', 7, 0],
  ['2026', 'SV-03', 4, 1, 1, '100.0%', 3, 0],
];
const pctNum = (s) => (s === '–' ? null : Number(s.replace('%', '')));

// BUGS B10: [period, service, จอ]
const B10_TABLE = [
  ['2026-11', 'ALL', '23.1%'],
  ['2026', 'ALL', '23.3%'],
  ['2026-12', 'ALL', '0.0%'],
  ['2026-10', 'ALL', '100.0%'],
];

const SEED_NAMES = ['สมชาย', 'สมหญิง', 'ปิติ', 'มานะ'];
function piiFindings(texts) {
  const found = [];
  for (const t of texts) {
    const s = String(t);
    if (/\d{13}/.test(s)) found.push(`13 หลัก: ${s.slice(0, 80)}`);
    if (/0\d{9}/.test(s)) found.push(`เบอร์: ${s.slice(0, 80)}`);
    if (/\d-\d{4}-\d{5}-\d{2}-\d/.test(s)) found.push(`เลขบัตรมีขีด: ${s.slice(0, 80)}`);
    for (const n of SEED_NAMES) if (s.includes(n)) found.push(`ชื่อ ${n}: ${s.slice(0, 80)}`);
  }
  return found;
}

// ===========================================================================
// 1) ฟังก์ชันบริสุทธิ์ (metrics.js)
// ===========================================================================
test('pctHalfUp: ทศนิยม 1 ตำแหน่ง ปัดครึ่งขึ้น · ตัวหาร 0 → null', () => {
  assert.equal(M.pctHalfUp(6, 7), 85.7); // พ.ย.
  assert.equal(M.pctHalfUp(2, 3), 66.7); // SV-02 พ.ย.
  assert.equal(M.pctHalfUp(1, 1), 100); // ต.ค.
  assert.equal(M.pctHalfUp(7, 8), 87.5); // ปี 2569
  assert.equal(M.pctHalfUp(6, 26), 23.1); // B10 พ.ย.
  assert.equal(M.pctHalfUp(7, 30), 23.3); // B10 ปี
  assert.equal(M.pctHalfUp(0, 3), 0); // B10 ธ.ค.
  assert.equal(M.pctHalfUp(1, 16), 6.3); // 6.25 → 6.3 (ครึ่งขึ้น ไม่ใช่ banker's)
  assert.equal(M.pctHalfUp(1, 8), 12.5);
  assert.equal(M.pctHalfUp(1, 40), 2.5); // 2.5 พอดี
  assert.equal(M.pctHalfUp(3, 80), 3.8); // 3.75 → 3.8
  assert.equal(M.pctHalfUp(0, 0), null);
  assert.equal(M.pctHalfUp(5, 0), null);
});

test('fmtPct / displayValues: 85.7% · 100.0% · 0.0% · null → – (U+2013 ห้าม NaN/0%)', () => {
  assert.equal(M.fmtPct(85.7), '85.7%');
  assert.equal(M.fmtPct(100), '100.0%');
  assert.equal(M.fmtPct(0), '0.0%');
  assert.equal(M.fmtPct(null), '–');
  assert.equal(M.fmtPct(null).charCodeAt(0), 0x2013);
  assert.equal(M.fmtPct(NaN), '–');
  const d = M.displayValues({ received: 3, closed: 0, ontimePct: null, backlog: 21, overdue: 1 });
  assert.deepEqual(d, { received: '3', closed: '0', ontimePct: '–', backlog: '21', overdue: '1' });
});

test('parsePeriod: YYYY-MM | YYYY เท่านั้น', () => {
  assert.deepEqual(M.parsePeriod('2026-11'), { kind: 'month', value: '2026-11', year: 2026, month: 11 });
  assert.deepEqual(M.parsePeriod('2026'), { kind: 'year', value: '2026', year: 2026 });
  for (const bad of ['2026-13', '2026-00', '2026-1', '26-11', '2026/11', '', 'ALL', null, undefined, 202611]) {
    assert.equal(M.parsePeriod(bad), null, `parsePeriod(${bad})`);
  }
});

test('TEST-DATA §7.1 §7.2 §7.3: ทุกช่วง/บริการ ตรงตาราง (คำนวณจากตาราง 4.1 ที่ถอดเอง)', () => {
  const rows = seedRows();
  for (const [period, service, received, closed, onTime, pct, backlog, overdue] of TABLE7) {
    const k = M.computeKpis(rows, { period, service, now: NOW0 });
    assert.deepEqual(
      k,
      { received, closed, onTime, ontimePct: pctNum(pct), backlog, overdue },
      `${period} ${service}`
    );
    assert.equal(M.displayValues(k).ontimePct, pct, `${period} ${service} จอ`);
  }
});

test('BR-25: CANCELLED (…009) นับรับเรื่องแต่ไม่นับปิดงาน · ชำระแล้วทุกใบนับครบ 30 ในปี', () => {
  const rows = seedRows();
  const without9 = rows.filter((r) => r.case_no !== caseNo(9));
  const a = M.computeKpis(rows, { period: '2026-11', now: NOW0 });
  const b = M.computeKpis(without9, { period: '2026-11', now: NOW0 });
  assert.equal(a.received - b.received, 1);
  assert.equal(a.closed, b.closed);
  assert.equal(M.computeKpis(rows, { period: '2026', now: NOW0 }).received, 30);
});

test('BR-26: รายปีรวมยอดแล้วคิด % (87.5) ไม่ใช่เฉลี่ย % รายเดือน (92.9)', () => {
  const rows = seedRows();
  const y = M.computeKpis(rows, { period: '2026', now: NOW0 });
  assert.equal(y.ontimePct, 87.5);
  const monthly = ['2026-10', '2026-11']
    .map((p) => M.computeKpis(rows, { period: p, now: NOW0 }).ontimePct);
  const avg = Math.round(((monthly[0] + monthly[1]) / 2) * 10) / 10;
  assert.equal(avg, 92.9); // ค่าผิดที่ต้องไม่ได้
  assert.notEqual(y.ontimePct, avg);
  // รวมทุกเดือนของปี = ค่ารายปี (ทุกตัวนับ)
  let rec = 0;
  let clo = 0;
  let ont = 0;
  for (let m = 1; m <= 12; m++) {
    const k = M.computeKpis(rows, { period: `2026-${String(m).padStart(2, '0')}`, now: NOW0 });
    rec += k.received;
    clo += k.closed;
    ont += k.onTime;
  }
  assert.deepEqual([rec, clo, ont], [y.received, y.closed, y.onTime]);
});

test('ทันกำหนด (DECISIONS ข้อ 18): 16:29:59 ทัน · 16:30:00 ทัน · 16:30:01 ไม่ทัน · 16:31 ไม่ทัน · ตรงกับ rules.isOnTime', () => {
  const due = '2026-12-03T16:30:00+07:00';
  const cases = [
    ['2026-12-03T16:29:00+07:00', true],
    ['2026-12-03T16:29:59+07:00', true],
    ['2026-12-03T16:30:00+07:00', true],
    ['2026-12-03T16:30:01+07:00', false],
    ['2026-12-03T16:31:00+07:00', false],
    ['2026-12-03T09:30:00Z', true], // = 16:30:00+07:00 พอดี (คนละ offset) → ทัน
  ];
  let rules = null;
  try {
    rules = require('../../rules');
  } catch (e) {
    rules = null;
  }
  for (const [closedAt, want] of cases) {
    assert.equal(M.isOnTime(closedAt, due), want, `metrics ${closedAt}`);
    if (rules && rules.isOnTime) assert.equal(rules.isOnTime(closedAt, due), want, `rules ${closedAt}`);
  }
  assert.equal(M.isOnTime(null, due), false);
  // H07 …007 ปิด 18 พ.ย. 16:00 ≤ 16:30 ทัน · H08 …006 ปิด 19 พ.ย. 10:00 ไม่ทัน
  assert.equal(M.isOnTime(T('11-18T16:00'), T('11-18T16:30')), true);
  assert.equal(M.isOnTime(T('11-19T10:00'), T('11-17T16:30')), false);
});

test('TEST-DATA §7.2.1 (TC-DASH-04): ปิด 3 ใบที่กำหนด 3 ธ.ค. 16:30 → สะสม 1/1 · 2/2 · 3/2 · backlog 18 · นับ REJECTED ด้วย', () => {
  const rows = seedRows();
  const by = (n) => rows.find((r) => r.case_no === caseNo(n));
  const steps = [
    [25, 'COMPLETED', '2026-12-03T16:29:59+07:00', 1, 1, 20],
    [26, 'REJECTED', '2026-12-03T16:30:00+07:00', 2, 2, 19],
    [23, 'COMPLETED', '2026-12-03T16:30:01+07:00', 3, 2, 18],
  ];
  for (const [n, status, at, closed, onTime, backlog] of steps) {
    Object.assign(by(n), { status, closed_at: at, owner: null });
    const k = M.computeKpis(rows, { period: '2026-12', service: 'ALL', now: at });
    assert.equal(k.closed, closed, `${caseNo(n)} closed`);
    assert.equal(k.onTime, onTime, `${caseNo(n)} onTime`);
    assert.equal(k.backlog, backlog, `${caseNo(n)} backlog`);
  }
  const last = M.computeKpis(rows, { period: '2026-12', now: '2026-12-03T16:30:01+07:00' });
  assert.equal(last.ontimePct, 66.7);
});

test('เกินกำหนดคงค้าง: ตอนนี้ > กำหนดเสร็จ (เท่ากันยังไม่เกิน) · NEED_FIX ไม่นับ · ไม่ขึ้นกับช่วง', () => {
  const rows = seedRows();
  const at = (now) => M.computeKpis(rows, { period: '2026-12', now }).overdue;
  assert.equal(at(NOW0), 1); // …020 เท่านั้น (…017 NEED_FIX ไม่นับ)
  assert.equal(at('2026-12-01T16:30:00+07:00'), 1); // …022 กำหนด 1 ธ.ค. 16:30 พอดี ยังไม่เกิน
  assert.equal(at('2026-12-01T16:30:01+07:00'), 2);
  for (const p of ['2026-10', '2026-11', '2026', '2025-01']) {
    const k = M.computeKpis(rows, { period: p, now: NOW0 });
    assert.deepEqual([k.backlog, k.overdue], [21, 1], `ณ ตอนนี้ไม่ขึ้นกับช่วง ${p}`);
  }
});

test('BUGS B10: หารด้วยรับเรื่อง → พ.ย. 23.1% · ปี 23.3% · ธ.ค. 0.0% · ต.ค. 100.0%', () => {
  const rows = seedRows();
  for (const [period, service, want] of B10_TABLE) {
    const k = M.computeKpis(rows, { period, service, now: NOW0, divideByReceived: true });
    assert.equal(M.fmtPct(k.ontimePct), want, `${period} ${service}`);
  }
  // ปิดบั๊ก → ค่าถูก
  assert.equal(M.fmtPct(M.computeKpis(rows, { period: '2026-12', now: NOW0 }).ontimePct), '–');
});

test('งานในมือ: off.reg1 3 · off.reg2 9 · off.works1 0 · ไม่ขึ้นกับตัวกรอง (A-41)', () => {
  const rows = seedRows();
  const wl = M.computeWorkload(rows, OFFICERS);
  assert.deepEqual(wl.map((w) => [w.username, w.count]), [['off.reg1', 3], ['off.reg2', 9], ['off.works1', 0]]);
  // ผู้ถือที่ไม่อยู่ในรายชื่อเจ้าหน้าที่ (เช่นถูกเปลี่ยนบทบาท) ต่อท้าย พร้อมชื่อแสดง
  const extra = rows.concat([{ case_no: 'X', service_id: 'SV-01', status: 'IN_REVIEW', owner: 'head1' }]);
  const wl2 = M.computeWorkload(extra, OFFICERS, new Map([['head1', 'หัวหน้าฝ่าย']]));
  assert.deepEqual(wl2[3], { username: 'head1', name: 'หัวหน้าฝ่าย', count: 1 });
});

test('kpiLine (CONTRACT §7): พ.ย. ตรงตัว · ปิดงาน 0 → ontime=- · ASCII ล้วน', () => {
  const rows = seedRows();
  const nov = M.computeKpis(rows, { period: '2026-11', now: NOW0 });
  assert.equal(M.kpiLine(nov), 'kpi received=26 closed=7 ontime=85.7% backlog=21 overdue=1');
  const dec = M.computeKpis(rows, { period: '2026-12', now: NOW0 });
  assert.equal(M.kpiLine(dec), 'kpi received=3 closed=0 ontime=- backlog=21 overdue=1');
  assert.match(M.kpiLine(dec), /^[\x20-\x7e]+$/);
});

test('periodOptions: ค่าเริ่มต้นมี 2026-12 2026-11 2026-10 2026 · ป้ายไทย', () => {
  const opts = M.periodOptions(NOW0);
  const values = opts.map((o) => o.value);
  for (const v of ['2026-12', '2026-11', '2026-10', '2026']) assert.ok(values.includes(v), v);
  assert.equal(values[0], '2026-12');
  assert.equal(new Set(values).size, values.length);
  assert.equal(M.periodLabel('2026-11'), 'พ.ย. 2569');
  assert.equal(M.periodLabel('2026'), 'ทั้งปี 2569');
  assert.ok(M.periodOptions(NOW0, '2020-05').some((o) => o.value === '2020-05'));
});

// ===========================================================================
// 2) HTTP บน seed จริง (โหลดเฉพาะโมดูล dashboard)
// ===========================================================================
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'egov-dash-'));
const modDir = path.join(tmp, 'modules');
fs.mkdirSync(path.join(modDir, 'dashboard'), { recursive: true });
fs.writeFileSync(path.join(modDir, 'dashboard', 'index.js'), `module.exports = require(${JSON.stringify(path.join(__dirname, 'index.js'))});`);

let srv;
let ctx;
let base;
let bugs;

function loginAs(username) {
  const u = ctx.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const sid = ctx.crypto.randomHex(16) + username.replace(/\W/g, '');
  ctx.db
    .prepare('INSERT INTO sessions(sid, user_id, role, dept, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sid, u.id, u.role, u.dept, 'full', ctx.clock.nowIso());
  return `eg_sid=${sid}`;
}
const get = (url, cookie) => fetch(base + url, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
async function getJson(url, cookie) {
  const r = await get(url, cookie);
  assert.equal(r.status, 200, `GET ${url} → ${r.status}`);
  return r.json();
}
const exportRows = () => ctx.db.prepare("SELECT * FROM audit WHERE event = 'EXPORT' ORDER BY id").all();
const pageText = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&[a-z#0-9]+;/g, ' ')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
/** ค่า kpi บนจอ (data-testid → ข้อความ) */
function kpisFromHtml(html) {
  const out = {};
  for (const id of ['kpi-received', 'kpi-closed', 'kpi-ontime-pct', 'kpi-backlog', 'kpi-overdue']) {
    const m = new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`).exec(html);
    out[id] = m ? m[1] : undefined;
  }
  return out;
}
async function readXlsx(buf) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const grid = {};
  const cells = [];
  wb.worksheets.forEach((ws, i) =>
    ws.eachRow({ includeEmpty: false }, (row, r) =>
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        const t = cell.text !== undefined && cell.text !== null ? String(cell.text) : String(cell.value ?? '');
        if (i === 0) grid[`${r}:${c}`] = t.trim();
        cells.push(t);
      })
    )
  );
  return { get: (r, c) => grid[`${r}:${c}`], cells, firstSheetType: (r, c) => typeof wb.worksheets[0].getCell(r, c).value };
}
/** แยกข้อความจาก PDF ด้วย pdf-parse ของชุด e2e (ถ้ามี) */
function pdfParser() {
  const cands = [path.join(APP_ROOT, 'e2e', 'node_modules', 'pdf-parse', 'lib', 'pdf-parse.js'), 'pdf-parse/lib/pdf-parse.js'];
  for (const c of cands) {
    try {
      return require(c);
    } catch (e) {
      /* ลองตัวถัดไป */
    }
  }
  return null;
}

test.describe('HTTP · seed จริง', () => {
  test.before(async () => {
    const { createServer } = require('../../server');
    const r = await createServer({ env: { DB_PATH: path.join(tmp, 'app.db'), TEST_MODE: '1' }, modulesDir: modDir, log: () => {} });
    ctx = r.ctx;
    bugs = ctx.bugs;
    srv = await new Promise((resolve) => {
      const s = r.app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${srv.address().port}`;
  });
  test.after(() => {
    if (bugs && bugs.set) bugs.set('');
    if (srv) srv.close();
    if (ctx && ctx.db && ctx.db.close) ctx.db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  test.beforeEach(() => {
    if (bugs && bugs.set) bugs.set('');
    ctx.reset();
  });

  test('seed ของ core ตรงกับ TEST-DATA §4.1 ที่ถอดเอง (บริการ สถานะ ผู้ถือ ชำระ กำหนด ปิด)', () => {
    const db = ctx.db
      .prepare('SELECT case_no, service_id, status, owner, paid_at, due_at, closed_at FROM cases ORDER BY case_no')
      .all();
    assert.deepEqual(db, seedRows().sort((a, b) => a.case_no.localeCompare(b.case_no)).map((r) => ({
      case_no: r.case_no, service_id: r.service_id, status: r.status, owner: r.owner, paid_at: r.paid_at, due_at: r.due_at, closed_at: r.closed_at,
    })));
  });

  test('GET /api/dashboard: ค่าเริ่มต้น = ธ.ค. ALL (§7.1) · ontimePct null · งานในมือ 3/9/0', async () => {
    const exec = loginAs('exec1');
    const j = await getJson('/api/dashboard', exec);
    assert.equal(j.period, '2026-12');
    assert.equal(j.service, 'ALL');
    assert.deepEqual(
      { received: j.received, closed: j.closed, onTime: j.onTime, ontimePct: j.ontimePct, backlog: j.backlog, overdue: j.overdue },
      { received: 3, closed: 0, onTime: 0, ontimePct: null, backlog: 21, overdue: 1 }
    );
    assert.equal(j.display.ontimePct, '–');
    assert.deepEqual(Object.fromEntries(j.workload.map((w) => [w.username, w.count])), { 'off.reg1': 3, 'off.reg2': 9, 'off.works1': 0 });
    assert.deepEqual(piiFindings([JSON.stringify(j)]), []);
  });

  test('GET /api/dashboard: ทุกแถวของ TEST-DATA §7.2 §7.3 (CONTRACT §6.4)', async () => {
    const exec = loginAs('exec1');
    for (const [period, service, received, closed, onTime, pct, backlog, overdue] of TABLE7) {
      const j = await getJson(`/api/dashboard?period=${period}&service=${service}`, exec);
      assert.deepEqual(
        { received: j.received, closed: j.closed, onTime: j.onTime, ontimePct: j.ontimePct, backlog: j.backlog, overdue: j.overdue },
        { received, closed, onTime, ontimePct: pctNum(pct), backlog, overdue },
        `${period} ${service}`
      );
      assert.equal(j.display.ontimePct, pct, `${period} ${service} display`);
      // งานในมือไม่ขึ้นกับตัวกรอง (A-41)
      assert.deepEqual(j.workload.map((w) => w.count), [3, 9, 0], `${period} ${service} workload`);
    }
  });

  test('BUG_MODE B10: พ.ย. 23.1% · ปี 23.3% · ธ.ค. 0.0% · ต.ค. 100.0% (ทั้ง API และหน้า)', async () => {
    bugs.set(['B10']);
    const exec = loginAs('exec1');
    for (const [period, service, want] of B10_TABLE) {
      const j = await getJson(`/api/dashboard?period=${period}&service=${service}`, exec);
      assert.equal(j.display.ontimePct, want, `API ${period}`);
      assert.equal(j.ontimePct, pctNum(want), `API num ${period}`);
      const html = await (await get(`/dashboard?period=${period}&service=${service}`, exec)).text();
      assert.equal(kpisFromHtml(html)['kpi-ontime-pct'], want, `หน้า ${period}`);
    }
    bugs.set('');
    assert.equal((await getJson('/api/dashboard?period=2026-11&service=ALL', exec)).display.ontimePct, '85.7%');
  });

  test('§7.2.1 ค่าขอบตามนาฬิกาทดสอบ: ปิด 16:29:59 / 16:30:00 (REJECTED) / 16:30:01 → 1/1 · 2/2 · 3/2 · backlog 18', async () => {
    const exec = loginAs('exec1');
    const close = ctx.db.prepare("UPDATE cases SET status = ?, closed_at = ?, owner = NULL, dept = NULL WHERE case_no = ?");
    const steps = [
      [25, 'COMPLETED', '2026-12-03T16:29:59+07:00', 1, 1],
      [26, 'REJECTED', '2026-12-03T16:30:00+07:00', 2, 2],
      [23, 'COMPLETED', '2026-12-03T16:30:01+07:00', 3, 2],
    ];
    for (const [n, status, at, closed, onTime] of steps) {
      ctx.clock.set(at);
      close.run(status, at, caseNo(n));
      const j = await getJson('/api/dashboard?period=2026-12&service=ALL', exec);
      assert.deepEqual({ closed: j.closed, onTime: j.onTime }, { closed, onTime }, `${caseNo(n)} @ ${at}`);
      const html = await (await get('/dashboard', exec)).text();
      assert.equal(kpisFromHtml(html)['kpi-closed'], String(closed));
    }
    const j = await getJson('/api/dashboard', exec);
    assert.equal(j.backlog, 18);
    assert.equal(j.ontimePct, 66.7);
    assert.match(await (await get('/dashboard', exec)).text(), /data-testid="kpi-backlog"[^>]*>18</);
  });

  test('หน้า /dashboard: ตัวกรองเริ่มต้น 2026-12/ALL · kpi 5 ช่องตาม §7.1 · workload-row 3 แถว · ปุ่มส่งออก · ไม่มี PII', async () => {
    const exec = loginAs('exec1');
    const r = await get('/dashboard', exec);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /<select[^>]*data-testid="period-select"[^>]*>/);
    assert.match(html, /<option value="2026-12" selected>/);
    for (const v of ['2026-11', '2026-10', '2026']) assert.match(html, new RegExp(`<option value="${v}"`));
    assert.match(html, /<option value="ALL" selected>/);
    for (const v of ['SV-01', 'SV-02', 'SV-03']) assert.match(html, new RegExp(`<option value="${v}"`));
    assert.deepEqual(kpisFromHtml(html), {
      'kpi-received': '3', 'kpi-closed': '0', 'kpi-ontime-pct': '–', 'kpi-backlog': '21', 'kpi-overdue': '1',
    });
    const rows = [...html.matchAll(/<tr data-testid="workload-row" data-username="([^"]+)">[\s\S]*?data-testid="workload-value">(\d+)</g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(rows, [['off.reg1', '3'], ['off.reg2', '9'], ['off.works1', '0']]);
    assert.match(html, /data-testid="export-xlsx-btn"[^>]*>ส่งออก Excel</);
    assert.match(html, /data-testid="export-pdf-btn"[^>]*>ส่งออก PDF</);
    assert.match(html, /href="\/api\/dashboard\/export\?format=xlsx&amp;period=2026-12&amp;service=ALL"/);
    assert.match(html, /\/static\/dashboard\/dashboard\.js/);
    assert.deepEqual(piiFindings(pageText(html)), []);
    // ทุก select มี label
    for (const id of ['period-select', 'service-select']) assert.match(html, new RegExp(`<label for="${id}">`));
  });

  test('หน้า /dashboard?period=2026-11&service=SV-02 → 10 · 3 · 66.7% · 7 · 0 · ค่าผิด → ใช้ค่าเริ่มต้น', async () => {
    const exec = loginAs('exec1');
    const html = await (await get('/dashboard?period=2026-11&service=SV-02', exec)).text();
    assert.deepEqual(Object.values(kpisFromHtml(html)), ['10', '3', '66.7%', '7', '0']);
    assert.match(html, /<option value="2026-11" selected>/);
    assert.match(html, /<option value="SV-02" selected>/);
    const bad = await get('/dashboard?period=xx&service=SV-99', exec);
    assert.equal(bad.status, 200);
    assert.deepEqual(Object.values(kpisFromHtml(await bad.text())), ['3', '0', '–', '21', '1']);
  });

  test('RBAC: /dashboard และ /api/dashboard* เฉพาะ executive · ค่าผิด 400', async () => {
    assert.equal((await get('/dashboard')).status, 302);
    assert.equal((await get('/api/dashboard')).status, 401);
    assert.equal((await get('/api/dashboard/export?format=xlsx&period=2026-11&service=ALL')).status, 401);
    for (const u of ['off.reg1', 'head1', 'audit1', 'admin1']) {
      const c = loginAs(u);
      const page = await get('/dashboard', c);
      assert.equal(page.status, 403, `${u} หน้า`);
      assert.match(await page.text(), /data-testid="forbidden-msg"[^>]*>ไม่มีสิทธิ์เข้าถึงหน้านี้</);
      assert.equal((await get('/api/dashboard', c)).status, 403, `${u} API`);
      assert.equal((await get('/api/dashboard/export?format=pdf&period=2026-11&service=ALL', c)).status, 403, `${u} export`);
    }
    const exec = loginAs('exec1');
    for (const q of ['period=2026-13', 'period=11-2026', 'service=SV-09', 'period=2026-11&service=x']) {
      const r = await get(`/api/dashboard?${q}`, exec);
      assert.equal(r.status, 400, q);
      assert.equal((await r.json()).code, 'BAD_REQUEST');
    }
    assert.equal((await get('/api/dashboard/export?format=csv&period=2026-11&service=ALL', exec)).status, 400);
    assert.equal(exportRows().length, 0, 'คำขอที่ไม่สำเร็จไม่บันทึก EXPORT');
  });

  test('ส่งออก xlsx (CONTRACT §7): ชีตแรก ตัวชี้วัด/ค่า · แถว 2–6 = จอ (ข้อความ) · ธ.ค. – · ไม่มี PII · Audit EXPORT 1 แถว/ครั้ง', async () => {
    const exec = loginAs('exec1');
    const LABELS = ['รับเรื่อง', 'ปิดงาน', 'ทันกำหนด %', 'งานคงค้าง', 'เกินกำหนดคงค้าง'];
    for (const [period, service, want, auditCount] of [
      ['2026-11', 'ALL', ['26', '7', '85.7%', '21', '1'], 1],
      ['2026-12', 'ALL', ['3', '0', '–', '21', '1'], 2],
      ['2026', 'SV-02', ['10', '3', '66.7%', '7', '0'], 3],
    ]) {
      const screen = Object.values(kpisFromHtml(await (await get(`/dashboard?period=${period}&service=${service}`, exec)).text()));
      assert.deepEqual(screen, want, `จอ ${period} ${service}`);
      const r = await get(`/api/dashboard/export?format=xlsx&period=${period}&service=${service}`, exec);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /spreadsheetml\.sheet/);
      assert.match(r.headers.get('content-disposition') || '', /attachment; filename="dashboard-.*\.xlsx"/);
      const x = await readXlsx(Buffer.from(await r.arrayBuffer()));
      assert.deepEqual([x.get(1, 1), x.get(1, 2)], ['ตัวชี้วัด', 'ค่า']);
      assert.deepEqual([2, 3, 4, 5, 6].map((i) => x.get(i, 1)), LABELS);
      assert.deepEqual([2, 3, 4, 5, 6].map((i) => x.get(i, 2)), screen, `xlsx = จอ ${period} ${service}`);
      for (let i = 2; i <= 6; i++) assert.equal(x.firstSheetType(i, 2), 'string', 'คอลัมน์ B เป็นข้อความ');
      assert.deepEqual(piiFindings(x.cells), []);
      const rows = exportRows();
      assert.equal(rows.length, auditCount);
      const last = rows[rows.length - 1];
      assert.equal(last.username, 'exec1');
      assert.equal(last.role, 'executive');
      assert.equal(last.detail, `xlsx ${period} ${service}`);
      assert.equal(last.at, ctx.clock.nowIso());
    }
  });

  test('ส่งออก pdf (CONTRACT §7): application/pdf · %PDF · บรรทัด kpi ASCII · ธ.ค. ontime=- · ไม่มี PII · Audit EXPORT', async () => {
    const exec = loginAs('exec1');
    const parse = pdfParser();
    for (const [period, line] of [
      ['2026-11', 'kpi received=26 closed=7 ontime=85.7% backlog=21 overdue=1'],
      ['2026-12', 'kpi received=3 closed=0 ontime=- backlog=21 overdue=1'],
      ['2026', 'kpi received=30 closed=8 ontime=87.5% backlog=21 overdue=1'],
    ]) {
      const r = await get(`/api/dashboard/export?format=pdf&period=${period}&service=ALL`, exec);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /^application\/pdf/);
      const buf = Buffer.from(await r.arrayBuffer());
      assert.equal(buf.subarray(0, 4).toString('latin1'), '%PDF');
      assert.ok(buf.toString('latin1').includes(line), `raw PDF มี ${line}`);
      if (parse) {
        const text = String((await parse(buf)).text || '');
        const lines = text.split(/\r?\n/).map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
        assert.ok(lines.includes(line), `ข้อความที่แยกได้มีบรรทัด "${line}" · ได้ ${JSON.stringify(lines.filter((l) => /^[\x20-\x7e]+$/.test(l)))}`);
        assert.deepEqual(piiFindings(lines), []);
        // ป้ายไทยตามจอ (A-50) แยกข้อความได้
        assert.ok(lines.some((l) => l.includes('รับเรื่อง')), 'มีป้ายภาษาไทย');
      }
      const last = exportRows().pop();
      assert.equal(last.detail, `pdf ${period} ALL`);
      assert.equal(last.username, 'exec1');
    }
    assert.equal(exportRows().length, 3);
  });

  test('ส่งออกตามนาฬิกาทดสอบ: ปิดงานใหม่แล้วไฟล์ตรงกับจอ ณ ตอนนั้น', async () => {
    const exec = loginAs('exec1');
    ctx.clock.set('2026-12-03T16:30:01+07:00');
    ctx.db.prepare("UPDATE cases SET status='COMPLETED', closed_at=?, owner=NULL, dept=NULL WHERE case_no=?").run('2026-12-03T16:30:01+07:00', caseNo(23));
    const screen = Object.values(kpisFromHtml(await (await get('/dashboard', exec)).text()));
    assert.deepEqual(screen, ['3', '1', '0.0%', '20', '6']);
    const x = await readXlsx(Buffer.from(await (await get('/api/dashboard/export?format=xlsx&period=2026-12&service=ALL', exec)).arrayBuffer()));
    assert.deepEqual([2, 3, 4, 5, 6].map((i) => x.get(i, 2)), screen);
  });
});

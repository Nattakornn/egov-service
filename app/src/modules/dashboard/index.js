'use strict';
// P11 · Dashboard ผู้บริหาร + ส่งออกรายงาน Excel/PDF
// FR-22 FR-23 · BR-24 (ไม่มีข้อมูลส่วนบุคคล) BR-25 BR-26 · CONTRACT §2.9 §6.4 §6.8 §7 · DECISIONS ข้อ 12 ข้อ 18 · BUGS B10
//
// หน้า   GET /dashboard?period=&service=                        auth.page('executive')
// API    GET /api/dashboard?period=2026-11&service=ALL           auth.api('executive')
//        → {period, service, asOf, received, closed, onTime, ontimePct (null เมื่อปิดงาน 0), backlog, overdue,
//           workload:[{username, name, count}], display:{received, closed, ontimePct, backlog, overdue}}
// ส่งออก GET /api/dashboard/export?format=xlsx|pdf&period=&service=  → ไฟล์ + Audit EXPORT (detail 'xlsx 2026-11 ALL')
//
// period: 'YYYY-MM' (เดือน) หรือ 'YYYY' (ทั้งปี ค.ศ.) · ไม่ส่ง = เดือนของนาฬิการะบบ · service: ALL | SV-01 … (ไม่ส่ง = ALL)
// ตัวเลขทุกตัวคำนวณที่เซิร์ฟเวอร์ (metrics.js) ตามนาฬิการะบบ ctx.clock · หน้าเว็บแค่แสดงค่า display จาก API
const fs = require('fs');
const M = require('./metrics');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const FORMATS = ['xlsx', 'pdf'];
const ALL_LABEL = 'ทุกบริการ';

/** คำอธิบายวิธีคิด (แสดงบนจอ/ท้าย PDF) · ห้ามมีข้อมูลส่วนบุคคล */
const DEFINITIONS = [
  'รับเรื่อง = คำขอที่ชำระสำเร็จ (มีเลขคำขอ) ในช่วงที่เลือก รวมคำขอที่ยกเลิกภายหลัง',
  'ปิดงาน = อนุมัติจนออกเอกสาร (เสร็จสิ้น) + ไม่อนุมัติ ที่ปิดในช่วงที่เลือก (ยกเลิกไม่นับ)',
  'ทันกำหนด % = ปิดงานที่ปิดไม่เกินกำหนดเสร็จ (รวม 16:30:00 พอดี) ÷ ปิดงาน · ปิดงาน 0 แสดง –',
  'รายปี = รวมทุกเดือนแล้วคิดร้อยละจากยอดรวม (ไม่เฉลี่ยร้อยละรายเดือน)',
  'งานคงค้าง และ เกินกำหนดคงค้าง เป็นค่า ณ ตอนนี้ ไม่ขึ้นกับช่วงที่เลือก (รอแก้ไขเอกสารไม่นับเป็นเกินกำหนด)',
];

// ---------------------------------------------------------------------------
// PDF: ฟอนต์ไทย NotoSansThai ไม่มีตัวละติน/ตัวเลข → สลับฟอนต์ตามช่วงอักขระ (ไทย = Noto · อื่น = Helvetica)
// ---------------------------------------------------------------------------
const THAI_RUN = /[฀-๿]+/g;

function splitRuns(str) {
  const s = String(str);
  const out = [];
  let last = 0;
  for (const m of s.matchAll(THAI_RUN)) {
    if (m.index > last) out.push({ thai: false, t: s.slice(last, m.index) });
    out.push({ thai: true, t: m[0] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ thai: false, t: s.slice(last) });
  return out;
}

/**
 * สร้าง PDF รายงาน · มีบรรทัด ASCII `kpi received=… closed=… ontime=…% backlog=… overdue=…` (CONTRACT §7)
 * และบรรทัด `<ป้าย>: <ค่า>` ภาษาไทยตามจอ (A-50)
 */
function buildPdf(report, { fonts = {}, now } = {}) {
  const PDFDocument = require('pdfkit');
  const line = M.kpiLine(report);
  const pdf = new PDFDocument({
    size: 'A4',
    margin: 56,
    info: {
      Title: `Dashboard ${report.period} ${report.service}`,
      Subject: line, // ASCII literal สำรอง (เครื่องอ่านได้แม้ไม่ถอด content stream)
      Keywords: line,
      Author: 'e-Service (simulated)',
      Creator: 'egov-eservice dashboard',
      CreationDate: now || new Date(0),
      ModDate: now || new Date(0),
    },
  });
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    pdf.on('data', (c) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });

  const hasThai = !!(fonts.regular && fs.existsSync(fonts.regular));
  if (hasThai) {
    pdf.registerFont('th', fonts.regular);
    pdf.registerFont('th-bold', fonts.bold && fs.existsSync(fonts.bold) ? fonts.bold : fonts.regular);
  }
  const fontFor = (thai, bold) => (thai && hasThai ? (bold ? 'th-bold' : 'th') : bold ? 'Helvetica-Bold' : 'Helvetica');
  const left = pdf.page.margins.left;
  const bottom = pdf.page.height - pdf.page.margins.bottom;
  let y = pdf.page.margins.top;

  /** 1 บรรทัด (ผสมฟอนต์บน baseline เดียวกัน · ไม่ตัดบรรทัด) */
  function drawLine(str, { size = 12, bold = false, color = '#111111', gap = 1.6 } = {}) {
    if (y + size * gap > bottom) {
      pdf.addPage();
      y = pdf.page.margins.top;
    }
    y += size * gap;
    let x = left;
    pdf.fillColor(color);
    for (const r of splitRuns(str)) {
      if (!r.t) continue;
      pdf.font(fontFor(r.thai, bold)).fontSize(size);
      pdf.text(r.t, x, y, { lineBreak: false, baseline: 'alphabetic' });
      x += pdf.widthOfString(r.t);
    }
  }
  /** บรรทัด ASCII ล้วน (Helvetica · วาดครั้งเดียว → pdf-parse ได้ 1 บรรทัดตรงตัว) */
  function asciiLine(str, size = 11) {
    y += size * 1.8;
    pdf.fillColor('#000000').font('Helvetica').fontSize(size);
    pdf.text(str, left, y, { lineBreak: false, baseline: 'alphabetic' });
  }

  pdf.rect(left, 40, pdf.page.width - left * 2, 4).fill('#1f4e79');
  drawLine('รายงาน Dashboard ผู้บริหาร', { size: 18, bold: true });
  drawLine('เทศบาลนครตัวอย่าง (หน่วยงานสมมติ) · ระบบ e-Service', { size: 11, color: '#333333' });
  y += 6;
  drawLine(`ช่วง: ${report.periodLabel} (${report.period})`);
  drawLine(`บริการ: ${report.serviceLabel} (${report.service})`);
  drawLine(`ข้อมูล ณ: ${report.asOfText}`);
  y += 8;
  for (const k of M.KPI_ROWS) drawLine(`${k.label}: ${report.display[k.key]}`, { size: 13, bold: true });
  drawLine(`ทันกำหนด (เรื่อง): ${report.onTime}`, { size: 11, color: '#333333' });
  y += 4;
  asciiLine(line);
  asciiLine(`period=${report.period} service=${report.service} asof=${report.asOf}`, 9);
  y += 10;
  drawLine('งานในมือรายเจ้าหน้าที่ (กำลังตรวจสอบที่รับไว้)', { size: 13, bold: true });
  for (const w of report.workload) drawLine(`${w.name} (${w.username}): ${w.count}`, { size: 12 });
  y += 10;
  drawLine('วิธีคิด', { size: 11, bold: true, color: '#333333' });
  for (const d of DEFINITIONS) drawLine(`- ${d}`, { size: 9, color: '#333333', gap: 1.7 });
  pdf.end();
  return done;
}

/** สร้าง xlsx: ชีตแรก แถว 1 `ตัวชี้วัด`/`ค่า` · แถว 2–6 ป้าย/ค่าตามจอ (ข้อความ) · ชีตที่ 2 รายละเอียด + งานในมือ */
async function buildXlsx(report, { now } = {}) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'e-Service (simulated)';
  wb.lastModifiedBy = 'e-Service (simulated)';
  wb.created = now || new Date(0);
  wb.modified = now || new Date(0);

  const ws = wb.addWorksheet('ตัวชี้วัด');
  ws.getColumn(1).width = 24;
  ws.getColumn(2).width = 16;
  const head = ws.addRow(['ตัวชี้วัด', 'ค่า']);
  head.font = { bold: true };
  for (const k of M.KPI_ROWS) {
    const row = ws.addRow([k.label, String(report.display[k.key])]); // ค่าเป็นข้อความตามที่แสดงบนจอ
    row.getCell(2).numFmt = '@';
    row.getCell(2).alignment = { horizontal: 'right' };
  }

  const ws2 = wb.addWorksheet('รายละเอียด');
  ws2.getColumn(1).width = 30;
  ws2.getColumn(2).width = 24;
  ws2.getColumn(3).width = 14;
  ws2.addRow(['ช่วง', `${report.periodLabel} (${report.period})`]);
  ws2.addRow(['บริการ', `${report.serviceLabel} (${report.service})`]);
  ws2.addRow(['ข้อมูล ณ', report.asOfText]);
  ws2.addRow(['ทันกำหนด (เรื่อง)', String(report.onTime)]);
  ws2.addRow([]);
  ws2.addRow(['งานในมือรายเจ้าหน้าที่', 'ชื่อผู้ใช้', 'งานในมือ']).font = { bold: true };
  for (const w of report.workload) ws2.addRow([w.name, w.username, String(w.count)]);
  ws2.addRow([]);
  for (const d of DEFINITIONS) ws2.addRow([d]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------
// คำนวณจาก DB
// ---------------------------------------------------------------------------
function createDashboard(ctx) {
  const { db, clock, catalog, errors, bugs, time, fmt } = ctx;

  function serviceList() {
    return catalog.services().map((s) => ({ id: s.id, name: s.name }));
  }

  /**
   * อ่าน period/service จาก query · strict=true (API) → ค่าผิด 400 BAD_REQUEST · strict=false (หน้า) → ใช้ค่าเริ่มต้น
   */
  function resolve(query = {}, strict = true) {
    const now = clock.now();
    const rawP = query.period;
    const rawS = query.service;
    let period = rawP === undefined || rawP === '' ? time.ym(now) : String(rawP).trim();
    let service = rawS === undefined || rawS === '' ? 'ALL' : String(rawS).trim().toUpperCase();
    const okPeriod = !!M.parsePeriod(period);
    const okService = service === 'ALL' || serviceList().some((s) => s.id === service);
    if (!okPeriod || !okService) {
      if (strict) errors.fail('BAD_REQUEST');
      if (!okPeriod) period = time.ym(now);
      if (!okService) service = 'ALL';
    }
    return { period, service, now };
  }

  function serviceLabel(service, list = serviceList()) {
    if (service === 'ALL') return ALL_LABEL;
    const s = list.find((x) => x.id === service);
    return s ? `${s.id} ${s.name}` : service;
  }

  // นิยาม "ทัน" ใช้ตัวเดียวกับ rules (DECISIONS ข้อ 18) ถ้ามี · ไม่มี → ตัวของ metrics (นิยามเดียวกัน)
  const onTimeFn = ctx.rules && typeof ctx.rules.isOnTime === 'function' ? ctx.rules.isOnTime : M.isOnTime;

  /** ตัวเลขทั้งหมดของช่วง/บริการ ณ นาฬิกาปัจจุบัน */
  function compute({ period, service, now }) {
    const rows = db.prepare('SELECT case_no, service_id, status, paid_at, due_at, closed_at, owner FROM cases').all();
    // BUG_MODE B10: ทันกำหนด % หารด้วยรับเรื่องแทนปิดงาน
    const k = M.computeKpis(rows, { period, service, now, divideByReceived: bugs.on('B10'), onTime: onTimeFn });
    // งานในมือ: เจ้าหน้าที่ทุกคนแม้ 0 · ไม่ขึ้นกับตัวกรอง (A-41) · ไม่มีข้อมูลผู้ยื่น
    const officers = db.prepare("SELECT username, name FROM users WHERE role = 'officer' AND active = 1 ORDER BY username").all();
    const staffNames = new Map(db.prepare("SELECT username, name FROM users WHERE role <> 'citizen'").all().map((u) => [u.username, u.name]));
    const workload = M.computeWorkload(rows, officers, staffNames);
    return {
      period,
      service,
      periodLabel: M.periodLabel(period),
      serviceLabel: serviceLabel(service),
      asOf: time.iso(now),
      received: k.received,
      closed: k.closed,
      onTime: k.onTime,
      ontimePct: k.ontimePct,
      backlog: k.backlog,
      overdue: k.overdue,
      workload,
      display: M.displayValues(k),
    };
  }

  /** ข้อมูลสำหรับไฟล์ส่งออก (= ค่าบนจอ + ข้อความเวลา) */
  function report(q) {
    const data = compute(q);
    return { ...data, asOfText: fmt.dateTime(data.asOf) };
  }

  return { resolve, compute, report, serviceList, serviceLabel };
}

// ---------------------------------------------------------------------------
// หน้า /dashboard
// ---------------------------------------------------------------------------
function exportHref(format, period, service) {
  return `/api/dashboard/export?format=${encodeURIComponent(format)}&period=${encodeURIComponent(period)}&service=${encodeURIComponent(service)}`;
}

function renderPage(ctx, dash, data) {
  const { ui } = ctx;
  const esc = ui.esc;
  const services = dash.serviceList();
  const periodOpts = M.periodOptions(data.asOf, data.period);
  const serviceOpts = [{ value: 'ALL', label: ALL_LABEL }, ...services.map((s) => ({ value: s.id, label: `${s.id} ${s.name}` }))];

  const kpis = M.KPI_ROWS.map(
    (k) => `<div class="kpi"><dt>${esc(k.label)}</dt><dd data-testid="${esc(k.testid)}" data-key="${esc(k.key)}">${esc(data.display[k.key])}</dd></div>`
  ).join('\n');

  const workloadRows = data.workload
    .map(
      (w) => `<tr data-testid="workload-row" data-username="${esc(w.username)}"><td>${esc(w.name)}</td><td>${esc(w.username)}</td><td class="num" data-testid="workload-value">${esc(String(w.count))}</td></tr>`
    )
    .join('\n');

  const body = `<div id="dashboard" class="stack dashboard" data-period="${esc(data.period)}" data-service="${esc(data.service)}">
<h1>Dashboard ผู้บริหาร</h1>
<p class="muted">ข้อมูล ณ ${ui.time(data.asOf, { testid: 'dash-as-of' })} · ตัวเลขไม่มีข้อมูลส่วนบุคคลของผู้ยื่น</p>
${ui.messages()}
<form id="dash-filter" class="card dash-filter" method="get" action="/dashboard" aria-label="ตัวกรอง Dashboard">
${ui.select({ id: 'period-select', name: 'period', label: 'เดือน/ปี', testid: 'period-select', options: periodOpts, value: data.period })}
${ui.select({ id: 'service-select', name: 'service', label: 'บริการ', testid: 'service-select', options: serviceOpts, value: data.service })}
<noscript><div class="actions"><button type="submit" class="btn">แสดงผล</button></div></noscript>
</form>
<section class="card" aria-labelledby="kpi-heading">
<h2 id="kpi-heading">ตัวชี้วัด</h2>
<p class="muted" id="dash-scope">ช่วง: <span data-field="periodLabel">${esc(data.periodLabel)}</span> · บริการ: <span data-field="serviceLabel">${esc(data.serviceLabel)}</span></p>
<dl class="kpi-grid">
${kpis}
</dl>
<p class="muted">ทันกำหนด <span data-field="onTime">${esc(String(data.onTime))}</span> เรื่อง จากปิดงาน <span data-field="closed">${esc(String(data.closed))}</span> เรื่อง</p>
<details class="dash-defs"><summary>วิธีคิดตัวชี้วัด</summary><ul>${DEFINITIONS.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></details>
</section>
<section class="card" aria-labelledby="workload-heading">
<h2 id="workload-heading">งานในมือรายเจ้าหน้าที่</h2>
<p class="muted">จำนวนคำขอสถานะกำลังตรวจสอบที่เจ้าหน้าที่แต่ละคนรับไว้ ณ ตอนนี้</p>
<div class="table-wrap"><table class="tbl" data-testid="workload-table">
<caption class="sr-only">งานในมือรายเจ้าหน้าที่</caption>
<thead><tr><th scope="col">เจ้าหน้าที่</th><th scope="col">ชื่อผู้ใช้</th><th scope="col" class="num">งานในมือ (เรื่อง)</th></tr></thead>
<tbody id="workload-body">
${workloadRows}
</tbody>
</table></div>
</section>
<section class="card" aria-labelledby="export-heading">
<h2 id="export-heading">ส่งออกรายงาน</h2>
<p class="muted">ไฟล์มีตัวเลขเท่ากับบนจอตามช่วงและบริการที่เลือก · การส่งออกถูกบันทึกใน Audit</p>
<div class="actions">
<a class="btn btn-primary" data-testid="export-xlsx-btn" data-export-format="xlsx" href="${esc(exportHref('xlsx', data.period, data.service))}" download>ส่งออก Excel</a>
<a class="btn" data-testid="export-pdf-btn" data-export-format="pdf" href="${esc(exportHref('pdf', data.period, data.service))}" download>ส่งออก PDF</a>
</div>
</section>
</div>`;
  return body;
}

// ---------------------------------------------------------------------------
// โมดูล
// ---------------------------------------------------------------------------
module.exports = {
  name: 'dashboard',
  order: 90,
  register(ctx) {
    const { app, auth, ui, audit, errors } = ctx;
    const dash = createDashboard(ctx);
    ctx.shared.dashboard = { compute: (q) => dash.compute(dash.resolve(q || {}, true)) };

    app.get('/dashboard', auth.page('executive'), (req, res) => {
      const data = dash.compute(dash.resolve(req.query, false));
      ui.send(req, res, {
        title: 'Dashboard ผู้บริหาร',
        body: renderPage(ctx, dash, data),
        scripts: ['/static/dashboard/dashboard.js'],
        styles: ['/static/dashboard/dashboard.css'],
      });
    });

    app.get('/api/dashboard', auth.api('executive'), (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json(dash.compute(dash.resolve(req.query, true)));
    });

    app.get(
      '/api/dashboard/export',
      auth.api('executive'),
      ctx.wrap(async (req, res) => {
        const format = String(req.query.format || '').trim().toLowerCase();
        if (!FORMATS.includes(format)) return errors.send(res, 'BAD_REQUEST');
        const q = dash.resolve(req.query, true);
        const rep = dash.report(q);
        const buf = format === 'xlsx' ? await buildXlsx(rep, { now: q.now }) : await buildPdf(rep, { fonts: ctx.paths.fonts, now: q.now });
        // BR-26 · CONTRACT §6.8: บันทึกเฉพาะเมื่อสร้างไฟล์สำเร็จ · detail '<format> <period> <service>'
        audit.logReq(req, { event: 'EXPORT', detail: `${format} ${q.period} ${q.service}` });
        res.set('Content-Type', format === 'xlsx' ? XLSX_MIME : 'application/pdf');
        res.set('Content-Disposition', `attachment; filename="dashboard-${q.period}-${q.service}.${format}"`);
        res.set('Cache-Control', 'no-store');
        res.send(buf);
      })
    );
  },
  // สำหรับ unit test
  _internal: { createDashboard, buildPdf, buildXlsx, renderPage, splitRuns, DEFINITIONS, metrics: M },
};

// Node 22 ตีความ `node --test src/modules/dashboard` เป็นไฟล์ index.js นี้ (Node 20 ค้น *.test.js ในโฟลเดอร์เอง)
// → ถ้าไฟล์นี้ถูกรันตรง ให้โหลดชุด unit test ของโมดูล เพื่อให้คำสั่งเดียวกันใช้ได้ทั้งสองเวอร์ชัน
if (require.main === module) require('./dashboard.test.js');

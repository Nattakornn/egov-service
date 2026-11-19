'use strict';
// P09 · เอกสารดิจิทัล (FR-17 · FR-18 · BR-23 · A-22 A-23 A-27 A-43 A-54 A-58 A-61 · CONTRACT §1 §2.13 §3 §5 §6.2 §6.3 §6.4 §8)
//
// POST /api/officer/cases/:caseNo/issue      ผู้ออกเอกสาร (A-27) → 200 {docNo, verifyCode, status:'COMPLETED'}
// GET  /api/documents/:docNo/pdf             citizen เจ้าของ · officer · head → application/pdf (DOC-….pdf) · คนอื่น 404
// GET  /verify/:code · GET /api/verify/:code ไม่ต้องล็อกอิน · VALID / EXPIRED / TAMPERED (200) · NOT_FOUND (404)
// POST /api/test/documents/:docNo/tamper     (TEST_MODE) แก้ applicant โดยไม่คำนวณลายเซ็นใหม่ → 200 {ok:true}
//
// ctx.shared.documents (ให้หน้าเคสของ P06/P08 ใช้):
//   forCase(caseNo)            → {docNo, caseNo, verifyCode, applicant, serviceId, issuedAt, validUntil, signer, issuedBy} | null
//   byCode(code) · byDocNo(no) → เช่นเดียวกัน
//   verifyUrl(req, code)       → '<BASE_URL>/verify/<code>' (ค่า data-url ของ doc-qr)
//   issuerOf(caseRow)          → username ผู้มีสิทธิ์กดออกเอกสาร (A-27) | null
//   canIssue(user, caseRow)    → true เมื่อ user เป็นผู้ออกเอกสารและคำขอ APPROVED (ใช้ตัดสิน render issue-btn)
//   qrSvg(text, {size})        → <svg> ของ QR (sync)
//   panelHtml(req, caseNo, {citizen})  → บล็อก HTML: doc-no · verify-code · doc-qr(data-url) · download-doc-btn (citizen)
//   validUntil(serviceId, issuedAt)    → 'YYYY-MM-DD' ตาม BR-23
//   evaluate(row, now)         → 'VALID' | 'EXPIRED' | 'TAMPERED'
const fs = require('fs');
const time = require('../../core/time');

const RESULT_TH = {
  VALID: 'เอกสารถูกต้อง',
  EXPIRED: 'เอกสารหมดอายุ',
  TAMPERED: 'ลายเซ็นไม่ถูกต้อง',
  NOT_FOUND: 'ไม่พบเอกสาร',
};
const CODE_RE = /^[A-Z0-9]{8}$/;
const DOC_NO_RE = /^DOC-\d{4}-\d{6}$/;
const TAMPER_MARK = ' (แก้ไข)';

// ---------------------------------------------------------------------------
// BR-23 · A-43 · A-61 : วันสุดท้ายที่ใช้ได้
// ---------------------------------------------------------------------------
/** อายุเอกสารของบริการ: SV-01 90 วัน · อื่น ๆ (SV-02/03) 1 ปี */
function validityOf(serviceId) {
  return serviceId === 'SV-01' ? { days: 90 } : { years: 1 };
}

/**
 * วันสุดท้ายที่ใช้ได้ ('YYYY-MM-DD' เวลาไทย)
 * SV-01: วันออก + 89 วัน · SV-02/03: วันครบรอบปีถัดไป − 1 วัน (ออก 29 ก.พ. → ครบรอบ 28 ก.พ.)
 * @param {string} serviceId
 * @param {Date|string} issuedAt เวลาออก (ISO +07:00 / Date / 'YYYY-MM-DD')
 */
function validUntilFor(serviceId, issuedAt) {
  const issuedYmd = typeof issuedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(issuedAt) ? issuedAt : time.ymd(issuedAt);
  const v = validityOf(serviceId);
  if (v.days) return time.addDaysYmd(issuedYmd, v.days - 1);
  const [y, m, d] = issuedYmd.split('-').map(Number);
  const ay = y + v.years;
  const leap = (ay % 4 === 0 && ay % 100 !== 0) || ay % 400 === 0;
  const ad = m === 2 && d === 29 && !leap ? 28 : d; // ไม่มีวันนั้นในปีครบรอบ → 28 ก.พ.
  const anniversary = `${ay}-${time.pad(m)}-${time.pad(ad)}`;
  return time.addDaysYmd(anniversary, -1);
}

/** หมดอายุตั้งแต่ 00:00 ของวันถัดจาก validUntil (เวลาไทย) */
function isExpired(validUntil, now) {
  return time.ymd(now) > String(validUntil);
}

// ---------------------------------------------------------------------------
// QR (sync จาก qrcode.create → วาดเอง ทั้ง SVG และ PDF)
// ---------------------------------------------------------------------------
function qrMatrix(text) {
  const QR = require('qrcode');
  const q = QR.create(String(text), { errorCorrectionLevel: 'M' });
  return q.modules; // {size, get(r,c)}
}

function qrSvg(text, { size = 168, margin = 4, title = 'QR ตรวจสอบเอกสาร' } = {}) {
  const m = qrMatrix(text);
  const n = m.size + margin * 2;
  let path = '';
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (m.get(r, c)) path += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${size}" height="${size}" role="img" aria-label="${esc(title)}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

// ---------------------------------------------------------------------------
// PDF (pdfkit · ฟอนต์ไทย Noto Sans Thai ไม่มีอักษรละติน/ตัวเลข → สลับฟอนต์ตามช่วงอักขระ)
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
  return out.length ? out : [{ thai: false, t: '' }];
}

function buildPdf({ doc, serviceName, verifyUrl, fonts }) {
  const PDFDocument = require('pdfkit');
  const asciiLine = `docNo=${doc.doc_no} caseNo=${doc.case_no} verify=${doc.verify_code} validUntil=${doc.valid_until}`;
  const pdf = new PDFDocument({
    size: 'A4',
    margin: 56,
    info: {
      Title: `${doc.doc_no}`,
      Subject: asciiLine, // literal ASCII ในไฟล์ (สำรองให้เครื่องอ่านได้แม้ไม่ถอด content stream)
      Keywords: asciiLine,
      Author: 'e-Service (simulated)',
      Creator: 'egov-eservice documents',
    },
  });
  const hasThai = !!(fonts.regular && fs.existsSync(fonts.regular));
  if (hasThai) {
    pdf.registerFont('th', fonts.regular);
    pdf.registerFont('th-bold', fonts.bold && fs.existsSync(fonts.bold) ? fonts.bold : fonts.regular);
  }
  const fontFor = (thai, bold) => (thai && hasThai ? (bold ? 'th-bold' : 'th') : bold ? 'Helvetica-Bold' : 'Helvetica');

  const width = (str, size, bold) =>
    splitRuns(str).reduce((w, r) => w + (r.t ? pdf.font(fontFor(r.thai, bold)).fontSize(size).widthOfString(r.t) : 0), 0);

  /** วาด 1 บรรทัด (ผสมฟอนต์ · baseline เดียวกัน) */
  function drawLine(str, x, baseline, size, bold, color) {
    let cx = x;
    pdf.fillColor(color);
    for (const r of splitRuns(str)) {
      if (!r.t) continue;
      pdf.font(fontFor(r.thai, bold)).fontSize(size);
      pdf.text(r.t, cx, baseline, { lineBreak: false, baseline: 'alphabetic' });
      cx += pdf.widthOfString(r.t);
    }
  }

  /** ย่อหน้า: ตัดบรรทัดที่ช่องว่าง · คืนค่า y ด้านล่าง */
  function para(str, { x, y, w, size = 12, bold = false, align = 'left', color = '#111111', lh = 1.55 }) {
    const words = String(str).split(' ');
    const lines = [];
    let cur = '';
    for (const word of words) {
      const t = cur ? `${cur} ${word}` : word;
      if (cur && width(t, size, bold) > w) {
        lines.push(cur);
        cur = word;
      } else cur = t;
    }
    lines.push(cur);
    let by = y;
    for (const line of lines) {
      by += size * lh;
      const lw = width(line, size, bold);
      const lx = align === 'center' ? x + (w - lw) / 2 : align === 'right' ? x + w - lw : x;
      drawLine(line, lx, by - size * 0.4, size, bold, color);
    }
    return by;
  }

  const left = pdf.page.margins.left;
  const contentW = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;

  // หัวเอกสาร
  pdf.rect(left, 48, contentW, 4).fill('#1f4e79');
  let y = 60;
  y = para('เทศบาลนครตัวอย่าง (หน่วยงานสมมติ)', { x: left, y, w: contentW, size: 14, bold: true, align: 'center' });
  y = para('เอกสารดิจิทัล', { x: left, y: y + 4, w: contentW, size: 22, bold: true, align: 'center' });
  y = para(serviceName, { x: left, y, w: contentW, size: 14, align: 'center', color: '#333333' });
  y += 18;

  // ตารางข้อมูล + QR ด้านขวา
  const qrSize = 130;
  const qrX = left + contentW - qrSize;
  const qrY = y + 6;
  const labelW = 110;
  const valueW = contentW - labelW - qrSize - 16;
  const rows = [
    ['เลขเอกสาร', doc.doc_no],
    ['เลขคำขอ', doc.case_no],
    ['ชื่อผู้ยื่น', doc.applicant],
    ['บริการ', serviceName],
    ['วันออก', fmtDateTime(doc.issued_at)],
    ['ใช้ได้ถึง', `${fmtDate(doc.valid_until)} (หมดอายุตั้งแต่ ${fmtDate(time.addDaysYmd(doc.valid_until, 1))} 00:00)`],
    ['ผู้ลงนาม', doc.signer],
    ['รหัสตรวจสอบ', doc.verify_code],
  ];
  for (const [k, v] of rows) {
    const y1 = para(k, { x: left, y, w: labelW, size: 12, bold: true });
    const y2 = para(String(v), { x: left + labelW, y, w: valueW, size: 12 });
    y = Math.max(y1, y2) + 4;
  }

  const m = qrMatrix(verifyUrl);
  const cell = qrSize / (m.size + 8);
  pdf.rect(qrX, qrY, qrSize, qrSize).fill('#ffffff');
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (m.get(r, c)) pdf.rect(qrX + (c + 4) * cell, qrY + (r + 4) * cell, cell, cell);
    }
  }
  pdf.fill('#000000');
  para('สแกนเพื่อตรวจสอบ', { x: qrX, y: qrY + qrSize - 4, w: qrSize, size: 10, align: 'center', color: '#333333' });

  y = Math.max(y, qrY + qrSize + 24) + 12;
  pdf.moveTo(left, y).lineTo(left + contentW, y).lineWidth(0.5).strokeColor('#b0b8c0').stroke();
  y += 4;
  y = para('ตรวจสอบความถูกต้องของเอกสารได้ที่', { x: left, y, w: contentW, size: 11, color: '#333333' });
  y = para(verifyUrl, { x: left, y, w: contentW, size: 11, color: '#1f4e79' });
  y = para('ลายเซ็นดิจิทัล (จำลอง · HMAC-SHA256)', { x: left, y: y + 6, w: contentW, size: 11, bold: true });
  y = para(String(doc.signature), { x: left, y, w: contentW, size: 8, color: '#333333' });

  // บรรทัด ASCII ที่เครื่องอ่านได้ (CONTRACT §3 · A-63) — บรรทัดเดียว ฟอนต์มาตรฐาน
  y += 12;
  pdf.font('Helvetica').fontSize(9).fillColor('#000000').text(asciiLine, left, y, { lineBreak: false });
  y += 22;
  para('เอกสารนี้ออกโดยระบบ e-Service ของหน่วยงานสมมติเพื่อการเรียนการสอน ลายเซ็นและ QR เป็นตัวจำลอง', {
    x: left,
    y,
    w: contentW,
    size: 9,
    color: '#4a5560',
  });

  return new Promise((resolve, reject) => {
    const chunks = [];
    pdf.on('data', (c) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    pdf.end();
  });
}

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function fmtDate(x) {
  const p = time.parts(x);
  return `${p.d} ${TH_MONTHS[p.m - 1]} ${p.y + 543}`;
}
function fmtDateTime(x) {
  const p = time.parts(x);
  return `${fmtDate(x)} ${time.pad(p.hh)}:${time.pad(p.mi)}`;
}

// ---------------------------------------------------------------------------
// โมดูล
// ---------------------------------------------------------------------------
function register(ctx) {
  const { app, db, auth, ui, errors, clock, fmt, catalog } = ctx;

  const getDocByNo = db.prepare('SELECT * FROM documents WHERE doc_no = ?');
  const getDocByCode = db.prepare('SELECT * FROM documents WHERE verify_code = ?');
  const getDocByCase = db.prepare('SELECT * FROM documents WHERE case_no = ?');
  const getCase = db.prepare('SELECT * FROM cases WHERE case_no = ?');
  const getUserById = db.prepare('SELECT id, username, name FROM users WHERE id = ?');
  const getUserByName = db.prepare('SELECT id, username, name FROM users WHERE username = ?');
  const codeExists = db.prepare('SELECT 1 FROM documents WHERE verify_code = ?');
  const insDoc = db.prepare(
    `INSERT INTO documents(doc_no, case_no, verify_code, applicant, service_id, issued_at, valid_until, signer, signer_username, signature, issued_by, created_at)
     VALUES (@docNo, @caseNo, @verifyCode, @applicant, @serviceId, @issuedAt, @validUntil, @signer, @signerUsername, @signature, @issuedBy, @issuedAt)`
  );

  const toJson = (r) =>
    r && {
      docNo: r.doc_no,
      caseNo: r.case_no,
      verifyCode: r.verify_code,
      applicant: r.applicant,
      serviceId: r.service_id,
      issuedAt: r.issued_at,
      validUntil: r.valid_until,
      signer: r.signer,
      issuedBy: r.issued_by,
    };

  /** A-27: SV-01 = ผู้ถือเรื่องที่อนุมัติ · SV-02/03 = เจ้าหน้าที่ทะเบียนที่รับเรื่องขั้นแรก (cases.issuer) */
  function issuerOf(c) {
    if (!c) return null;
    if (c.service_id === 'SV-01') return c.approved_by || c.issuer || null;
    return c.issuer || null;
  }
  function canIssue(user, c) {
    return !!(user && c && user.role === 'officer' && c.status === 'APPROVED' && issuerOf(c) && issuerOf(c) === user.username);
  }

  /** ผลตรวจ (A-43: ลายเซ็นไม่ตรงมาก่อนหมดอายุ) */
  function evaluate(row, now = clock.now()) {
    if (!ctx.sign.verifyDoc(row)) return 'TAMPERED';
    if (isExpired(row.valid_until, now)) return 'EXPIRED';
    return 'VALID';
  }

  function verifyUrl(req, code) {
    return `${ui.baseUrl(req)}/verify/${encodeURIComponent(code)}`;
  }

  function serviceLabel(serviceId) {
    const s = catalog.service(serviceId);
    return s ? `${s.id} ${s.name}` : String(serviceId);
  }

  function findByCode(raw) {
    const code = String(raw || '').trim().toUpperCase();
    if (!CODE_RE.test(code)) return null;
    return getDocByCode.get(code) || null;
  }

  function panelHtml(req, caseNo, { citizen = false } = {}) {
    const d = getDocByCase.get(caseNo);
    if (!d) return '';
    const url = verifyUrl(req, d.verify_code);
    return `<section class="card stack doc-panel" aria-labelledby="doc-panel-h">
<h2 id="doc-panel-h">เอกสารดิจิทัล</h2>
<dl class="kv">
<dt>เลขเอกสาร</dt><dd data-testid="doc-no">${ui.esc(d.doc_no)}</dd>
<dt>รหัสตรวจสอบ</dt><dd data-testid="verify-code">${ui.esc(d.verify_code)}</dd>
<dt>ใช้ได้ถึง</dt><dd>${ui.time(d.valid_until, { dateOnly: true })}</dd>
</dl>
<div class="qr-box" data-testid="doc-qr"${ui.attrs({ 'data-url': url })}>${qrSvg(url, { size: 160 })}<p class="muted"><a href="${ui.esc(url)}">${ui.esc(url)}</a></p></div>
${citizen ? `<p class="actions"><a class="btn btn-primary" data-testid="download-doc-btn" href="/api/documents/${encodeURIComponent(d.doc_no)}/pdf" download="${ui.esc(d.doc_no)}.pdf">ดาวน์โหลดเอกสาร</a></p>` : ''}
</section>`;
  }

  ctx.shared.documents = {
    RESULT_TH,
    forCase: (caseNo) => toJson(getDocByCase.get(caseNo)) || null,
    byCode: (code) => toJson(findByCode(code)) || null,
    byDocNo: (docNo) => toJson(getDocByNo.get(docNo)) || null,
    verifyUrl,
    issuerOf,
    canIssue,
    qrSvg,
    panelHtml,
    validUntil: validUntilFor,
    evaluate,
  };

  // ---- FR-17 ออกเอกสาร ----
  app.post('/api/officer/cases/:caseNo/issue', auth.api('officer', 'head'), (req, res) => {
    const caseNo = req.params.caseNo;
    const user = req.user;
    const out = db.tx(() => {
      const c = getCase.get(caseNo);
      if (!c) errors.fail('NOT_FOUND');
      const issuer = issuerOf(c);
      if (user.role !== 'officer') errors.fail('FORBIDDEN');
      if (c.status === 'APPROVED') {
        if (!issuer || issuer !== user.username) errors.fail('FORBIDDEN');
      } else {
        if (issuer && issuer !== user.username) errors.fail('FORBIDDEN');
        errors.fail('INVALID_STATE');
      }
      if (getDocByCase.get(caseNo)) errors.fail('INVALID_STATE');

      const citizen = getUserById.get(c.citizen_id);
      const signerUser = c.approved_by ? getUserByName.get(c.approved_by) : null;
      const issuedAt = clock.nowIso();
      const fields = {
        caseNo,
        applicant: citizen ? citizen.name : '',
        serviceId: c.service_id,
        issuedAt,
        validUntil: validUntilFor(c.service_id, issuedAt),
        signer: signerUser ? signerUser.name : c.approved_by || user.name,
        signerUsername: c.approved_by || null,
        issuedBy: user.username,
      };
      fields.docNo = ctx.ids.docNo(issuedAt);
      fields.verifyCode = ctx.ids.verifyCode((code) => !!codeExists.get(code));
      fields.signature = ctx.sign.signDoc(fields);
      insDoc.run(fields);

      ctx.caseEvents.transition(caseNo, {
        from: 'APPROVED',
        to: 'COMPLETED',
        event: 'ISSUE',
        actor: user,
        set: { closed_at: issuedAt, doc_no: fields.docNo, dept: null, owner: null },
        text: `ออกเอกสารดิจิทัล ${fields.docNo}`,
        detail: fields.docNo,
        audit: true,
        auditDetail: fields.docNo,
        at: issuedAt,
      });
      return fields;
    });
    res.status(200).json({
      docNo: out.docNo,
      verifyCode: out.verifyCode,
      status: 'COMPLETED',
      caseNo,
      issuedAt: out.issuedAt,
      validUntil: out.validUntil,
      closedAt: out.issuedAt,
    });
  });

  // ---- FR-17 ดาวน์โหลด PDF ----
  app.get(
    '/api/documents/:docNo/pdf',
    auth.api('citizen', 'officer', 'head'),
    ctx.wrap(async (req, res) => {
      const docNo = String(req.params.docNo || '');
      const d = DOC_NO_RE.test(docNo) ? getDocByNo.get(docNo) : null;
      if (!d) return errors.send(res, 'NOT_FOUND');
      const c = getCase.get(d.case_no);
      if (req.user.role === 'citizen' && (!c || c.citizen_id !== req.user.id)) return errors.send(res, 'NOT_FOUND');
      const buf = await buildPdf({
        doc: d,
        serviceName: serviceLabel(d.service_id),
        verifyUrl: verifyUrl(req, d.verify_code),
        fonts: (ctx.paths && ctx.paths.fonts) || {},
      });
      res.status(200);
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="${d.doc_no}.pdf"`);
      res.set('Cache-Control', 'private, no-store');
      res.set('Content-Length', String(buf.length));
      res.end(buf);
    })
  );

  // ---- FR-18 ตรวจเอกสาร (ไม่ต้องล็อกอิน · ไม่ขึ้นกับ TEST_MODE) ----
  app.get('/api/verify/:code', (req, res) => {
    const d = findByCode(req.params.code);
    if (!d) return res.status(404).json({ result: 'NOT_FOUND' });
    const result = evaluate(d);
    res.set('Cache-Control', 'no-store');
    if (result === 'TAMPERED') return res.status(200).json({ result });
    return res.status(200).json({
      result,
      docNo: d.doc_no,
      applicantMasked: fmt.maskName(d.applicant),
      serviceId: d.service_id,
      issuedAt: d.issued_at,
      validUntil: d.valid_until,
      signer: d.signer,
    });
  });

  app.get('/verify/:code', (req, res) => {
    const d = findByCode(req.params.code);
    const result = d ? evaluate(d) : 'NOT_FOUND';
    const cls = result === 'VALID' ? 'msg msg-ok' : result === 'EXPIRED' ? 'msg msg-info' : 'msg msg-error';
    let details = '';
    if (result === 'VALID' || result === 'EXPIRED') {
      details = `<dl class="kv">
<dt>เลขเอกสาร</dt><dd data-testid="verify-doc-no">${ui.esc(d.doc_no)}</dd>
<dt>ผู้ยื่น</dt><dd data-testid="verify-applicant">${ui.esc(fmt.maskName(d.applicant))}</dd>
<dt>บริการ</dt><dd data-testid="verify-service">${ui.esc(serviceLabel(d.service_id))}</dd>
<dt>วันออก</dt><dd>${ui.time(d.issued_at, { testid: 'verify-issued' })}</dd>
<dt>ใช้ได้ถึง</dt><dd>${ui.time(d.valid_until, { testid: 'verify-expires', dateOnly: true })}</dd>
<dt>ผู้ลงนาม</dt><dd data-testid="verify-signer">${ui.esc(d.signer)}</dd>
</dl>`;
    }
    const hint =
      result === 'NOT_FOUND'
        ? '<p class="muted">ตรวจสอบรหัส 8 ตัวบนเอกสารอีกครั้ง</p>'
        : result === 'TAMPERED'
          ? '<p class="muted">ข้อมูลของเอกสารไม่ตรงกับลายเซ็น อย่าใช้เอกสารฉบับนี้</p>'
          : '';
    const body = `<h1>ตรวจสอบเอกสารดิจิทัล</h1>
<section class="card stack" aria-live="polite">
<p class="${cls}" role="status" data-testid="verify-result" data-result="${result}">${RESULT_TH[result]}</p>
${details}
${hint}
</section>`;
    res.set('Cache-Control', 'no-store');
    ui.send(req, res, { title: 'ตรวจสอบเอกสาร', body, status: result === 'NOT_FOUND' ? 404 : 200 });
  });

  // ---- FR-28 test hook ----
  ctx.hooks.testRoute('post', '/api/test/documents/:docNo/tamper', (req, res) => {
    const d = getDocByNo.get(String(req.params.docNo || ''));
    if (!d) return errors.send(res, 'NOT_FOUND', undefined, RESULT_TH.NOT_FOUND);
    db.prepare('UPDATE documents SET applicant = ? WHERE doc_no = ?').run(d.applicant + TAMPER_MARK, d.doc_no);
    res.status(200).json({ ok: true });
  });
}

module.exports = {
  name: 'documents',
  order: 40,
  register,
  // สำหรับ unit test / โมดูลอื่น
  validUntilFor,
  isExpired,
  validityOf,
  qrSvg,
  splitRuns,
  RESULT_TH,
};

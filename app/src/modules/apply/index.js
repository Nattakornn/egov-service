'use strict';
// P04 · ประชาชนยื่นคำขอ: ฟอร์ม 3 ขั้น · ร่าง · ไฟล์แนบ · เอกสารบังคับ
// FR-04 FR-05 FR-06 FR-07 FR-10 (ลบร่าง) · BR-04..BR-08 · A-09 A-10 A-14 A-47 A-56
// CONTRACT §1 (/citizen/new/:service) · §2.5 · §4.3 · §5 · §6.2 (drafts + files)
//
// หน้า
//   GET  /citizen/new/:service[?draft=DR-xxxx]   citizen · ขั้น 1 กรอกข้อมูล → 2 แนบเอกสาร → 3 ชำระเงิน (เรียก API ของ P05)
// API (ทุกตัว auth.api('citizen') → ไม่ล็อกอิน 401 · บทบาทอื่นรวม admin 403)
//   POST   /api/drafts/fee            {serviceId, qty|areaSqm} → 200 {fee, qty, areaSqm} | 400 INVALID_QTY/INVALID_AREA/AREA_TOO_LARGE
//                                     (หน้าเว็บใช้คำนวณค่าธรรมเนียมทันที · คำนวณด้วย rules.computeFee ของ P03 เท่านั้น ไม่คำนวณใน browser → B01 เห็นบนจอ)
//   POST   /api/drafts                {serviceId, qty|areaSqm} → 201 {draftId, fee, serviceId, status}
//   GET    /api/drafts                → 200 {items:[{draftId, serviceId, serviceName, status, fee, amount, qty, areaSqm, ...}]} (DRAFT / PENDING_PAYMENT)
//   GET    /api/drafts/:id            → 200 {draftId, ..., files:[...], missing:[...], paymentRef} · ของคนอื่น/ไม่มี 404 NOT_FOUND
//   PATCH  /api/drafts/:id            {qty|areaSqm} → 200 (เฉพาะ DRAFT · อื่น 409 INVALID_STATE)
//   DELETE /api/drafts/:id            → 204 (DRAFT / PENDING_PAYMENT ที่ยังไม่ชำระ · ลบไฟล์ + ref ชำระของร่าง → GET /api/payments/:ref = 404) · ชำระแล้ว 409 INVALID_STATE
//   POST   /api/drafts/:id/files      multipart file + docKey → 201 {fileId, name, docKey, size, mime}
//                                     400 FILE_TOO_LARGE (> 5,242,880 · B02 ใช้ ≥) · FILE_TYPE (magic bytes) · PLAN_NOT_PDF · FILE_COUNT (> 5)
//   DELETE /api/drafts/:id/files/:fileId → 204 (เฉพาะ DRAFT)
//   GET    /api/drafts/:id/files/:fileId → เนื้อไฟล์ (เจ้าของร่าง · Content-Type ตามชนิดจริง)
//   GET    /api/drafts/:id/qr.svg?ref=PP-xxxx → รูป QR PromptPay จำลองของ ref นั้น (ใช้ใน qr-image)
//   POST   /api/drafts/:id/payment    ตรวจล่วงหน้า: ร่างของคนอื่น 404 · เอกสารบังคับไม่ครบ 409 MISSING_DOCS {missing:[ชื่อ]}
//                                     แล้ว next() ให้ route ของ P05 (payment) สร้าง QR ต่อ
//
// ctx.shared.apply (P05 / โมดูลอื่นเรียก):
//   missingDocs(draftOrId)        → ['แบบแปลน','โฉนด'] ตามลำดับ CONTRACT §4.3 ([] = ครบ)
//   requireDocs(draftOrId)        → throw 409 MISSING_DOCS 'ยังขาดเอกสาร: แบบแปลน, โฉนด' + {missing}
//   missingText(names)            → 'ยังขาดเอกสาร: แบบแปลน, โฉนด'
//   getDraft(id) · ownDraft(user, id) (404 ถ้าไม่ใช่ของ user) · draftJson(row)
//   validateUpload({buffer,size}, docKey, service, currentCount) → {type, mime, ext} หรือ throw AppError (FILE_TOO_LARGE/FILE_TYPE/PLAN_NOT_PDF/FILE_COUNT)
//   detectType(buffer)            → ctx.storage.detectType (magic bytes)
//   MAX_FILE_BYTES · MAX_FILES
const path = require('path');

let QRCode = null;
try {
  QRCode = require('qrcode');
} catch (_) {
  QRCode = null;
}

const DRAFT_RE = /^DR-\d{4,}$/;
const FILE_RE = /^F-\d{6,}$/;
const REF_RE = /^PP-\d{4,}$/;
const SERVICE_RE = /^SV-\d{2}$/;
const EXTRA_KEY = 'extra';
const ACCEPT_ANY = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
const ACCEPT_PDF = '.pdf,application/pdf';

/** ชื่อไฟล์จาก multer: multer ถอด header เป็น latin1 → แปลงกลับเป็น UTF-8 ถ้าเป็น UTF-8 ที่ถูกต้อง · ตัด path/อักขระควบคุม */
function cleanFileName(raw) {
  let name = String(raw || '');
  if (/[^\x00-\x7f]/.test(name)) {
    const b = Buffer.from(name, 'latin1');
    const u = b.toString('utf8');
    if (!u.includes('\uFFFD') && Buffer.from(u, 'utf8').equals(b)) name = u;
  }
  name = path.basename(name.replace(/\\/g, '/'));
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (name.length > 200) name = name.slice(0, 200);
  return name || 'file';
}

function sizeText(n) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} ไบต์`;
}

/** ค่าที่ส่งเข้า computeFee จาก body (รับ qty / areaSqm · ไม่ส่ง = undefined ให้ rules ตัดสิน) */
function feeInput(body) {
  const b = body || {};
  const input = {};
  if (b.qty !== undefined) input.qty = b.qty;
  if (b.areaSqm !== undefined) input.areaSqm = b.areaSqm;
  else if (b.area_sqm !== undefined) input.areaSqm = b.area_sqm;
  else if (b.area !== undefined) input.areaSqm = b.area;
  return input;
}

module.exports = {
  name: 'apply',
  order: 30,
  register(ctx) {
    const { app, db, auth, ui, errors, storage, catalog, clock } = ctx;
    const fmt = ctx.fmt;
    const MAX_FILE_BYTES = storage.MAX_FILE_BYTES; // 5,242,880
    const MAX_FILES = storage.MAX_FILES_PER_CASE; // 5

    // ------------------------------------------------------------------ กฎ
    function rules() {
      if (!ctx.rules || typeof ctx.rules.forContext !== 'function') throw new errors.AppError('INTERNAL');
      return ctx.rules.forContext(ctx);
    }

    function serviceOr400(id) {
      const svc = typeof id === 'string' && SERVICE_RE.test(id) ? catalog.service(id) : null;
      if (!svc) errors.fail('BAD_REQUEST', { field: 'serviceId' });
      return svc;
    }

    /** คำนวณค่าธรรมเนียมด้วย P03 · ผิด → throw 400 ตาม CONTRACT §5 */
    function feeOrFail(svc, input) {
      const r = rules().computeFee(svc.id, input);
      if (!r || !r.ok) errors.fail((r && r.code) || 'BAD_REQUEST');
      return r;
    }

    // ------------------------------------------------------------------ ข้อมูล
    const q = {
      draft: db.prepare('SELECT * FROM drafts WHERE id = ?'),
      draftsOf: db.prepare("SELECT * FROM drafts WHERE citizen_id = ? AND status IN ('DRAFT','PENDING_PAYMENT') ORDER BY id DESC"),
      files: db.prepare('SELECT * FROM files WHERE draft_id = ? ORDER BY uploaded_at, id'),
      file: db.prepare('SELECT * FROM files WHERE id = ? AND draft_id = ?'),
      countFiles: db.prepare('SELECT COUNT(*) AS n FROM files WHERE draft_id = ?'),
      latestPayment: db.prepare("SELECT * FROM payments WHERE draft_id = ? AND status <> 'VOID' ORDER BY qr_created_at DESC, ref DESC LIMIT 1"),
      payment: db.prepare('SELECT * FROM payments WHERE ref = ? AND draft_id = ?'),
      paidPayments: db.prepare("SELECT COUNT(*) AS n FROM payments WHERE draft_id = ? AND (status = 'PAID' OR case_no IS NOT NULL)"),
    };

    function getDraft(idOrRow) {
      if (idOrRow && typeof idOrRow === 'object') return idOrRow;
      if (typeof idOrRow !== 'string' || !DRAFT_RE.test(idOrRow)) return null;
      return q.draft.get(idOrRow) || null;
    }

    /** ร่างของ user (ไม่มี/ของคนอื่น → 404 NOT_FOUND · ไม่เผยว่ามีอยู่) */
    function ownDraft(user, id) {
      const d = getDraft(id);
      if (!d || !user || d.citizen_id !== user.id) errors.fail('NOT_FOUND');
      return d;
    }

    function docsOf(svc) {
      return Array.isArray(svc && svc.docs) ? svc.docs : [];
    }

    /** ชื่อเอกสารบังคับที่ยังขาด ตามลำดับ CONTRACT §4.3 (FR-06 · BR-08) */
    function missingDocs(draftOrId) {
      const d = getDraft(draftOrId);
      if (!d) return [];
      const svc = catalog.service(d.service_id);
      const have = new Set(q.files.all(d.id).map((f) => f.doc_key));
      return docsOf(svc)
        .filter((x) => x.required && !have.has(x.key))
        .map((x) => x.name || catalog.docName(x.key));
    }

    function missingText(names) {
      return `${errors.message('MISSING_DOCS')}: ${names.join(', ')}`;
    }

    function requireDocs(draftOrId) {
      const missing = missingDocs(draftOrId);
      if (missing.length) errors.fail('MISSING_DOCS', { missing }, missingText(missing));
      return true;
    }

    function fileJson(f) {
      return { fileId: f.id, name: f.name, docKey: f.doc_key, size: f.size, mime: f.mime, uploadedAt: f.uploaded_at };
    }

    function paymentJson(p) {
      if (!p) return null;
      return { ref: p.ref, amount: p.amount, qrCreatedAt: p.qr_created_at, qrExpiresAt: p.qr_expires_at };
    }

    /** ยอดที่ต้องชำระ: ล็อกแล้ว (BR-11 / A-42) ใช้ locked_amount ไม่เช่นนั้นค่าธรรมเนียมล่าสุด */
    function amountOf(d) {
      return d.locked_amount !== null && d.locked_amount !== undefined ? d.locked_amount : d.fee;
    }

    function draftJson(d, { full = false } = {}) {
      const svc = catalog.service(d.service_id);
      const out = {
        draftId: d.id,
        serviceId: d.service_id,
        serviceName: svc ? svc.name : d.service_id,
        status: d.status,
        fee: d.fee,
        amount: amountOf(d),
        qty: d.qty,
        areaSqm: d.area_sqm,
        caseNo: d.case_no || null,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
      };
      if (full) {
        out.files = q.files.all(d.id).map(fileJson);
        out.missing = missingDocs(d);
        const p = q.latestPayment.get(d.id);
        out.paymentRef = p ? p.ref : null;
        out.payment = paymentJson(p);
      }
      return out;
    }

    /** ตรวจไฟล์ (BR-06 BR-07 BR-08) · ลำดับ: ขนาด → ชนิดจากเนื้อไฟล์ → แบบแปลน PDF → จำนวน */
    function validateUpload(file, docKey, svc, currentCount) {
      const size = file.size !== undefined ? file.size : file.buffer.length;
      // BR-07: ≤ 5,242,880 ไบต์รับ · B02: ใช้ < แทน ≤ (5,242,880 พอดีถูกปฏิเสธ)
      const tooLarge = ctx.bugs.on('B02') ? size >= MAX_FILE_BYTES : size > MAX_FILE_BYTES;
      if (tooLarge) errors.fail('FILE_TOO_LARGE');
      // BR-06: magic bytes เท่านั้น (ไม่ดูนามสกุล/Content-Type)
      const type = storage.detectType(file.buffer);
      if (!type) errors.fail('FILE_TYPE');
      const doc = docsOf(svc).find((x) => x.key === docKey);
      if (doc && doc.pdfOnly && type.type !== 'pdf') errors.fail('PLAN_NOT_PDF');
      if (currentCount >= MAX_FILES) errors.fail('FILE_COUNT');
      return type;
    }

    ctx.shared.apply = {
      missingDocs,
      requireDocs,
      missingText,
      getDraft,
      ownDraft,
      draftJson: (d) => draftJson(getDraft(d), { full: true }),
      validateUpload,
      detectType: storage.detectType,
      MAX_FILE_BYTES,
      MAX_FILES,
    };

    // ------------------------------------------------------------------ API
    const citizenApi = auth.api('citizen');

    // คำนวณค่าธรรมเนียมทันที (หน้าเว็บเรียกทุกครั้งที่พิมพ์) · ไม่สร้างร่าง
    app.post('/api/drafts/fee', citizenApi, (req, res) => {
      const svc = serviceOr400((req.body || {}).serviceId);
      const r = feeOrFail(svc, feeInput(req.body));
      res.json({ serviceId: svc.id, fee: r.fee, qty: r.qty, areaSqm: r.areaSqm });
    });

    app.post('/api/drafts', citizenApi, (req, res) => {
      const svc = serviceOr400((req.body || {}).serviceId);
      const r = feeOrFail(svc, feeInput(req.body));
      const now = clock.nowIso();
      const draftId = db.tx(() => {
        const id = ctx.ids.draftId();
        db.prepare(
          `INSERT INTO drafts(id, citizen_id, service_id, status, qty, area_sqm, fee, locked_amount, case_no, created_at, updated_at)
           VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, NULL, NULL, ?, ?)`
        ).run(id, req.user.id, svc.id, svc.id === 'SV-01' ? r.qty : null, svc.id === 'SV-03' ? r.areaSqm : null, r.fee, now, now);
        return id;
      });
      res.status(201).json({ draftId, fee: r.fee, serviceId: svc.id, status: 'DRAFT' });
    });

    app.get('/api/drafts', citizenApi, (req, res) => {
      res.json({ items: q.draftsOf.all(req.user.id).map((d) => draftJson(d)) });
    });

    app.get('/api/drafts/:id', citizenApi, (req, res) => {
      res.json(draftJson(ownDraft(req.user, req.params.id), { full: true }));
    });

    function updateDraft(req, res) {
      const d = ownDraft(req.user, req.params.id);
      if (d.status !== 'DRAFT') errors.fail('INVALID_STATE');
      const svc = catalog.service(d.service_id);
      const r = feeOrFail(svc, feeInput(req.body));
      db.prepare('UPDATE drafts SET qty = ?, area_sqm = ?, fee = ?, updated_at = ? WHERE id = ? AND status = ?').run(
        svc.id === 'SV-01' ? r.qty : null,
        svc.id === 'SV-03' ? r.areaSqm : null,
        r.fee,
        clock.nowIso(),
        d.id,
        'DRAFT'
      );
      res.json(draftJson(q.draft.get(d.id), { full: true }));
    }
    app.patch('/api/drafts/:id', citizenApi, updateDraft);
    app.put('/api/drafts/:id', citizenApi, updateDraft);

    // FR-10 ลบร่าง (DRAFT / PENDING_PAYMENT ที่ยังไม่ชำระ) · ref ชำระของร่างนั้นหายไปด้วย (GET /api/payments/:ref → 404)
    app.delete('/api/drafts/:id', citizenApi, (req, res) => {
      const d = ownDraft(req.user, req.params.id);
      const removed = db.tx(() => {
        const cur = q.draft.get(d.id);
        if (!cur || !['DRAFT', 'PENDING_PAYMENT'].includes(cur.status) || cur.case_no || q.paidPayments.get(d.id).n > 0) {
          errors.fail('INVALID_STATE');
        }
        const files = q.files.all(d.id);
        db.prepare('DELETE FROM files WHERE draft_id = ? AND case_no IS NULL').run(d.id);
        db.prepare("DELETE FROM payments WHERE draft_id = ? AND status <> 'PAID'").run(d.id);
        db.prepare('DELETE FROM drafts WHERE id = ?').run(d.id);
        return files.filter((f) => !f.case_no);
      });
      for (const f of removed) storage.remove(f);
      res.status(204).end();
    });

    // แนบไฟล์ (guard ก่อน multer → admin ได้ 403 โดยไม่อ่าน body)
    app.post('/api/drafts/:id/files', citizenApi, ctx.upload.single('file'), (req, res) => {
      const d = ownDraft(req.user, req.params.id);
      if (d.status !== 'DRAFT') errors.fail('INVALID_STATE');
      const svc = catalog.service(d.service_id);
      const docKey = String((req.body || {}).docKey || '').trim();
      const keys = docsOf(svc).map((x) => x.key).concat(EXTRA_KEY);
      if (!keys.includes(docKey)) errors.fail('BAD_REQUEST', { field: 'docKey' });
      if (!req.file || !req.file.buffer) errors.fail('BAD_REQUEST', { field: 'file' });

      const name = cleanFileName(req.file.originalname);
      const now = clock.nowIso();
      let replaced = [];
      const row = db.tx(() => {
        // ช่องเอกสารเฉพาะ (ไม่ใช่ extra) มีได้ 1 ไฟล์: แนบใหม่ = แทนไฟล์เดิม (ไม่นับไฟล์เดิมในเพดาน 5 ไฟล์)
        const existing = docKey === EXTRA_KEY ? [] : q.files.all(d.id).filter((f) => f.doc_key === docKey);
        const count = q.countFiles.get(d.id).n - existing.length;
        const type = validateUpload(req.file, docKey, svc, count);
        const fileId = ctx.ids.fileId();
        const rel = storage.save(fileId, req.file.buffer);
        for (const f of existing) db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
        replaced = existing;
        db.prepare(
          `INSERT INTO files(id, draft_id, case_no, doc_key, name, mime, size, storage, seed, uploaded_by, uploaded_at)
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 0, ?, ?)`
        ).run(fileId, d.id, docKey, name, type.mime, req.file.size, rel, req.user.id, now);
        db.prepare('UPDATE drafts SET updated_at = ? WHERE id = ?').run(now, d.id);
        return q.file.get(fileId, d.id);
      });
      for (const f of replaced) storage.remove(f);
      res.status(201).json({ ...fileJson(row), missing: missingDocs(d.id) });
    });

    app.delete('/api/drafts/:id/files/:fileId', citizenApi, (req, res) => {
      const d = ownDraft(req.user, req.params.id);
      const f = FILE_RE.test(req.params.fileId) ? q.file.get(req.params.fileId, d.id) : null;
      if (!f) errors.fail('NOT_FOUND');
      if (d.status !== 'DRAFT') errors.fail('INVALID_STATE');
      db.prepare('DELETE FROM files WHERE id = ? AND draft_id = ?').run(f.id, d.id);
      db.prepare('UPDATE drafts SET updated_at = ? WHERE id = ?').run(clock.nowIso(), d.id);
      storage.remove(f);
      res.status(204).end();
    });

    app.get('/api/drafts/:id/files/:fileId', citizenApi, (req, res) => {
      const d = ownDraft(req.user, req.params.id);
      const f = FILE_RE.test(req.params.fileId) ? q.file.get(req.params.fileId, d.id) : null;
      if (!f || !storage.exists(f)) errors.fail('NOT_FOUND');
      res.set('Content-Type', f.mime);
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Content-Disposition', `inline; filename="${f.id}.${(storage.detectType(storage.read(f)) || { ext: 'bin' }).ext}"; filename*=UTF-8''${encodeURIComponent(f.name)}`);
      res.send(storage.read(f));
    });

    // รูป QR PromptPay จำลอง (เนื้อหาเป็นข้อความจำลอง ไม่ใช่ payload จริง)
    app.get(
      '/api/drafts/:id/qr.svg',
      citizenApi,
      ctx.wrap(async (req, res) => {
        const d = ownDraft(req.user, req.params.id);
        const ref = String(req.query.ref || '');
        const p = REF_RE.test(ref) ? q.payment.get(ref, d.id) : null;
        if (!p) errors.fail('NOT_FOUND');
        const text = `PROMPTPAY-SIMULATED|${p.ref}|${p.amount}.00|THB`;
        let svg;
        if (QRCode) {
          svg = await QRCode.toString(text, { type: 'svg', margin: 2, width: 200, errorCorrectionLevel: 'M' });
        } else {
          svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="#fff" stroke="#000"/><text x="100" y="105" text-anchor="middle" font-size="16">${ui.esc(p.ref)}</text></svg>`;
        }
        res.set('Content-Type', 'image/svg+xml');
        res.set('Cache-Control', 'no-store');
        res.send(svg);
      })
    );

    // FR-06 · BR-08: ตรวจเอกสารบังคับก่อนสร้าง QR (P05 สร้าง QR ใน route เดียวกันที่ลงทะเบียนหลังโมดูลนี้)
    app.post('/api/drafts/:id/payment', citizenApi, (req, res, next) => {
      const d = ownDraft(req.user, req.params.id);
      if (d.status === 'DRAFT' || d.status === 'PENDING_PAYMENT') requireDocs(d);
      next();
    });

    // ------------------------------------------------------------------ หน้า
    const STEP_TEXT = { 1: '1/3 กรอกข้อมูล', 2: '2/3 แนบเอกสาร', 3: '3/3 ชำระเงิน' };

    /** JSON ฝังในหน้า (กัน </script> และ XSS) */
    function jsonForScript(obj) {
      return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    }

    function feeInputField({ id, testid, label, value, hint, error, unit }) {
      const errId = `${id}-error`;
      const hintId = `${id}-hint`;
      return `<div class="field">
<label for="${ui.esc(id)}">${ui.esc(label)} <span class="req" aria-hidden="true">*</span></label>
<p class="hint" id="${hintId}">${ui.esc(hint)}</p>
<div class="row apply-num"><input${ui.attrs({
        id,
        name: id,
        type: 'text',
        inputmode: 'numeric',
        autocomplete: 'off',
        value,
        required: true,
        'data-testid': testid,
        'aria-describedby': `${hintId} ${errId}`,
        'aria-invalid': error ? 'true' : null,
        class: 'apply-fee-input',
      })}> <span>${ui.esc(unit)}</span></div>
<p class="field-error" id="${errId}" data-testid="fee-error" role="alert"${error ? '' : ' hidden'}>${ui.esc(error || '')}</p>
</div>`;
    }

    function uploadField(doc, svcId) {
      const key = doc.key;
      const id = `upload-${key}`;
      const isExtra = key === EXTRA_KEY;
      const label = doc.name || catalog.docName(key);
      const notes = [];
      if (doc.required) notes.push('บังคับ');
      else notes.push('ไม่บังคับ');
      if (doc.pdfOnly) notes.push('PDF เท่านั้น');
      if (isExtra) notes.push('เลือกได้หลายไฟล์');
      return `<div class="field apply-upload" data-doc-key="${ui.esc(key)}">
<label for="${id}">${ui.esc(label)}${doc.required ? ' <span class="req" aria-hidden="true">✱</span>' : ''} <span class="muted">(${ui.esc(notes.join(' · '))})</span></label>
<input${ui.attrs({
        id,
        type: 'file',
        name: id,
        'data-testid': `upload-input-${key}`,
        'data-doc-key': key,
        'data-service': svcId,
        accept: doc.pdfOnly ? ACCEPT_PDF : ACCEPT_ANY,
        multiple: isExtra || null,
        'aria-describedby': 'upload-rules',
      })}>
</div>`;
    }

    app.get('/citizen/new/:service', auth.page('citizen'), (req, res) => {
      const sid = String(req.params.service || '').toUpperCase();
      const svc = SERVICE_RE.test(sid) ? catalog.service(sid) : null;
      if (!svc) return ui.pageNotFound(req, res);
      if (sid !== req.params.service) return res.redirect(302, `/citizen/new/${encodeURIComponent(sid)}${req.query.draft ? `?draft=${encodeURIComponent(String(req.query.draft))}` : ''}`);

      let draft = null;
      if (req.query.draft !== undefined) {
        const d = getDraft(String(req.query.draft));
        if (!d || d.citizen_id !== req.user.id) return ui.notFound(req, res);
        if (d.status === 'PAID' || d.case_no) {
          return d.case_no ? res.redirect(302, `/citizen/cases/${encodeURIComponent(d.case_no)}`) : ui.notFound(req, res);
        }
        if (d.service_id !== svc.id) return res.redirect(302, `/citizen/new/${encodeURIComponent(d.service_id)}?draft=${encodeURIComponent(d.id)}`);
        draft = draftJson(d, { full: true });
      }

      // ค่าเริ่มต้นของขั้น 1 + ค่าธรรมเนียมจากเซิร์ฟเวอร์ (P03)
      let qtyVal = '';
      let areaVal = '';
      let input = {};
      if (svc.id === 'SV-01') {
        qtyVal = String(draft && draft.qty !== null && draft.qty !== undefined ? draft.qty : 1); // A-56 ค่าตั้งต้น 1
        input = { qty: qtyVal };
      } else if (svc.id === 'SV-03') {
        areaVal = draft && draft.areaSqm !== null && draft.areaSqm !== undefined ? String(draft.areaSqm) : '';
        input = { areaSqm: areaVal };
      }
      const blankArea = svc.id === 'SV-03' && areaVal === '';
      const fee = blankArea ? { ok: false } : rules().computeFee(svc.id, input);
      const feeText = fee.ok ? fmt.money(fee.fee) : fmt.DASH;
      const feeErr = !fee.ok && !blankArea ? fee.message || '' : '';

      const step = draft && draft.status === 'PENDING_PAYMENT' ? 3 : 1;
      const docs = docsOf(svc).concat([{ key: EXTRA_KEY, name: catalog.docName(EXTRA_KEY), required: false }]);
      const requiredNames = docsOf(svc).filter((x) => x.required).map((x) => x.name || catalog.docName(x.key));

      const state = {
        service: { id: svc.id, name: svc.name, docs: docs.map((x) => ({ key: x.key, name: x.name || catalog.docName(x.key), required: !!x.required, pdfOnly: !!x.pdfOnly })) },
        draft,
        step,
        maxFiles: MAX_FILES,
        maxBytes: MAX_FILE_BYTES,
      };

      let inputHtml = '';
      if (svc.id === 'SV-01') {
        inputHtml = feeInputField({ id: 'qty', testid: 'qty-input', label: 'จำนวนฉบับ', value: qtyVal, hint: `ฉบับละ ${fmt.money(svc.fee)} · 1–5 ฉบับ`, error: feeErr, unit: 'ฉบับ' });
      } else if (svc.id === 'SV-03') {
        inputHtml = feeInputField({
          id: 'area',
          testid: 'area-input',
          label: 'พื้นที่ก่อสร้าง/ต่อเติม',
          value: areaVal,
          hint: `จำนวนเต็ม 1–500 ตร.ม. · 1–100 ตร.ม. ${fmt.money(svc.fee)} · ส่วนที่เกิน 100 ตร.ม. คิดเพิ่ม ${fmt.money(svc.feePerSqm)} ต่อ ตร.ม.`,
          error: feeErr,
          unit: 'ตร.ม.',
        });
      } else {
        inputHtml = `<p class="msg msg-info">บริการนี้มีค่าธรรมเนียมคงที่ ไม่ต้องกรอกข้อมูลเพิ่ม</p>`;
      }

      const body = `<div class="apply-wizard stack" id="apply-root">
<p class="muted"><a href="/citizen">← กลับไปคำขอของฉัน</a></p>
<h1>ยื่นคำขอ: <span data-testid="service-name">${ui.esc(svc.name)}</span></h1>
<p class="wizard-step" data-testid="wizard-step" aria-live="polite">${ui.esc(STEP_TEXT[step])}</p>
<ol class="apply-progress" aria-label="ขั้นตอนการยื่น">
<li data-step="1"${step === 1 ? ' aria-current="step"' : ''}>กรอกข้อมูล</li>
<li data-step="2"${step === 2 ? ' aria-current="step"' : ''}>แนบเอกสาร</li>
<li data-step="3"${step === 3 ? ' aria-current="step"' : ''}>ชำระเงิน</li>
</ol>
${ui.messages()}
<p class="apply-draft" id="draft-box"${draft ? '' : ' hidden'}>รหัสร่าง <strong data-testid="draft-id" id="draft-id">${ui.esc(draft ? draft.draftId : '')}</strong> <span class="muted">(ยังไม่มีเลขคำขอ จะได้เลขคำขอเมื่อชำระเงินสำเร็จ)</span></p>

<section class="card stack" id="step-1" aria-labelledby="step-1-title"${step === 1 ? '' : ' hidden'}>
<h2 id="step-1-title" tabindex="-1">ขั้นที่ 1 กรอกข้อมูล</h2>
${inputHtml}
<p class="apply-fee">ค่าธรรมเนียม <strong data-testid="fee-total" id="fee-total" aria-live="polite">${ui.esc(feeText)}</strong></p>
<div class="actions">
<button type="button" class="btn" data-testid="save-draft-btn" id="save-draft-btn">บันทึกร่าง</button>
<button type="button" class="btn btn-primary" data-testid="to-upload-btn" id="to-upload-btn"${fee.ok ? '' : ' disabled'}>ถัดไป: แนบเอกสาร</button>
</div>
</section>

<section class="card stack" id="step-2" aria-labelledby="step-2-title" hidden>
<h2 id="step-2-title" tabindex="-1">ขั้นที่ 2 แนบเอกสาร</h2>
<p class="hint" id="upload-rules">รองรับไฟล์ PDF, JPG, PNG ขนาดไม่เกิน 5 MB ต่อไฟล์ และแนบได้สูงสุด ${MAX_FILES} ไฟล์ต่อคำขอ · ✱ = เอกสารบังคับ${requiredNames.length ? ` (${ui.esc(requiredNames.join(', '))})` : ''}</p>
${docs.map((d) => uploadField(d, svc.id)).join('\n')}
<p class="msg msg-error" data-testid="upload-error" id="upload-error" role="alert" hidden></p>
<h3 class="apply-files-title" id="files-title">ไฟล์ที่แนบแล้ว <span class="muted" id="files-count"></span></h3>
<ul class="apply-files" id="file-list" aria-labelledby="files-title"></ul>
<div id="missing-box" aria-live="polite"></div>
<div class="actions">
<button type="button" class="btn" id="back-to-1">ย้อนกลับ</button>
<button type="button" class="btn btn-primary" data-testid="to-payment-btn" id="to-payment-btn" disabled>ไปชำระเงิน</button>
</div>
</section>

<section class="card stack" id="step-3" aria-labelledby="step-3-title"${step === 3 ? '' : ' hidden'}>
<h2 id="step-3-title" tabindex="-1">ขั้นที่ 3 ชำระเงิน (PromptPay QR จำลอง)</h2>
<p class="apply-fee">ยอดที่ต้องชำระ <strong data-testid="payment-amount" id="payment-amount">${ui.esc(draft ? fmt.money(draft.amount) : feeText)}</strong></p>
<div id="pay-area" class="stack"></div>
<div class="actions" id="step-3-actions">
<button type="button" class="btn" id="back-to-2">ย้อนกลับ</button>
</div>
</section>
</div>
<script type="application/json" id="apply-state">${jsonForScript(state)}</script>`;

      ui.send(req, res, {
        title: `ยื่นคำขอ ${svc.name}`,
        body,
        scripts: ['/static/apply/apply.js'],
        styles: ['/static/apply/apply.css'],
      });
    });
  },

  // สำหรับ unit test
  _internal: { cleanFileName, sizeText, feeInput },
};

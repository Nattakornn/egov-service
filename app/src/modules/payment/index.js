'use strict';
// P05 · ชำระเงิน PromptPay QR จำลอง + ออกเลขคำขอ + ใบเสร็จ
// FR-08 · BR-09 (EG-<พ.ศ.>-<6 หลัก> ใน transaction เดียว · NFR-07) · BR-10 (QR ใช้ได้ถ้าอายุ < 15:00 นาที) · BR-11 (ยอดล็อก/ยอดตรงพอดี/callback ซ้ำ)
// BUG_MODE: B05 (อายุ QR ใช้ ≤ แทน < → อายุ 15:00 พอดียังจ่ายได้)
//
// API (CONTRACT §6.2 · §8)
//   POST /api/drafts/:id/payment          citizen เจ้าของ → 201 {ref, amount, qrCreatedAt, qrExpiresAt, status:'PENDING', draftId}
//                                         ร่างไม่มี/ของคนอื่น 404 NOT_FOUND · ชำระแล้ว 409 INVALID_STATE · เอกสารบังคับไม่ครบ 409 MISSING_DOCS {missing}
//                                         DRAFT → PENDING_PAYMENT + ล็อกยอด (ค่าธรรมเนียมปัจจุบันจาก rules) · PENDING_PAYMENT ใช้ยอดที่ล็อกไว้
//                                         สร้างซ้ำได้ (ref ใหม่) · ref เก่าที่ยังไม่หมดอายุยังจ่ายได้ จนกว่าร่างจะชำระสำเร็จ (ref อื่นของร่างนั้นกลายเป็น VOID)
//   GET  /api/payments/:ref               citizen เจ้าของ → 200 {ref, amount, status:PENDING|PAID|EXPIRED, qrCreatedAt, qrExpiresAt, caseNo, receiptNo, paidAt, draftId, serviceId}
//                                         ไม่มี/ของคนอื่น/ร่างถูกลบ → 404
//   POST /api/test/payments/:ref/pay      (TEST_MODE) {amount} → 200 {status:'PAID', caseNo, receiptNo, duplicate:false|true}
//                                         410 QR_EXPIRED · 422 AMOUNT_MISMATCH · 404 NOT_FOUND · 409 INVALID_STATE (ref ถูกยกเลิกเพราะร่างชำระด้วย ref อื่นแล้ว)
//   (เสริม) GET /api/drafts/:id/payment   citizen เจ้าของ → {draftId, serviceId, draftStatus, amount, caseNo, payment|null} · ?format=html → {html} (ส่วนขั้น 3)
//   (เสริม) GET /api/payments/:ref/qr.svg citizen เจ้าของ → รูป QR จำลอง (image/svg+xml)
//
// ctx.shared.payment (ให้หน้า /citizen/new/:service ของ P04 ใช้)
//   panelHtml(req, draftOrId)  → HTML ส่วน "ชำระเงิน" ครบ testid ของ CONTRACT §2.5 (payment-amount create-qr-btn qr-image qr-ref qr-expires
//                                qr-expired-msg regenerate-qr-btn payment-status refresh-payment-btn submitted-case-no receipt-no receipt-amount
//                                receipt-paid-at go-case-btn) · ใส่ script: ctx.shared.payment.script ('/static/payment/payment.js') ใน ui.send
//   forDraft(draftId)          → JSON ของ payment ล่าสุดของร่าง (PAID ก่อน) หรือ null
//   get(ref) · toJson(row) · statusOf(row) · isExpired(row) · amountForDraft(draft) · missingDocs(draft) · qrSvg(text)
const QRCode = require('qrcode');
const time = require('../../core/time');

const QR_TTL_MIN = 15;
const QR_TTL_MS = QR_TTL_MIN * 60 * 1000;
const SCRIPT_URL = '/static/payment/payment.js';

/** QR เป็น SVG (sync) จากไลบรารี qrcode */
function qrSvg(text, { size = 200, margin = 4, title = 'QR ชำระเงิน PromptPay (จำลอง)' } = {}) {
  const qr = QRCode.create(String(text), { errorCorrectionLevel: 'M' });
  const m = qr.modules;
  const n = m.size + margin * 2;
  let d = '';
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (m.get(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${size}" height="${size}" role="img" aria-label="${esc(title)}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/** ข้อความใน QR จำลอง (ไม่ใช่รูปแบบ PromptPay จริง · ไม่มีชื่อหน่วยงานจริง) */
function qrPayload(p) {
  return `EGOV-SIM-PROMPTPAY|${p.ref}|${Number(p.amount).toFixed(2)}|${p.qr_expires_at}`;
}

/** ยอดที่ส่งมาตรงกับยอดที่ล็อกพอดีหรือไม่ (รับตัวเลขหรือสตริงตัวเลข · ขาด/เกิน ฿1 = ไม่ตรง) */
function amountMatches(input, expected) {
  let v = input;
  if (typeof v === 'string' && v.trim() !== '') v = Number(v.trim());
  return typeof v === 'number' && Number.isFinite(v) && v === expected;
}

// ─── สคริปต์ฝั่ง browser (ส่วนชำระเงิน) · เสิร์ฟที่ SCRIPT_URL ─────────────────────
const CLIENT_JS = `(function () {
  'use strict';
  function panel() { return document.getElementById('payment-panel'); }
  function showError(msg) {
    if (window.EG && EG.showError) { EG.showError(msg); return; }
    var p = panel(); var box = p && p.querySelector('[data-pay-error]');
    if (box) { box.textContent = msg; box.hidden = false; }
  }
  function clear() { if (window.EG && EG.clearMessages) EG.clearMessages(); }
  function api(method, url) {
    if (window.EG && EG.api) return EG.api(method, url);
    return fetch(url, { method: method, credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; }); });
  }
  function rerender(focusSel) {
    var p = panel(); if (!p) return Promise.resolve();
    var id = p.getAttribute('data-draft-id');
    return api('GET', '/api/drafts/' + encodeURIComponent(id) + '/payment?format=html').then(function (r) {
      if (!r.ok || !r.data || typeof r.data.html !== 'string') { showError((r.data && r.data.message) || 'ไม่สามารถอ่านสถานะการชำระเงินได้'); return; }
      var tmp = document.createElement('div'); tmp.innerHTML = r.data.html;
      var fresh = tmp.firstElementChild; if (!fresh) return;
      p.replaceWith(fresh);
      var f = focusSel && fresh.querySelector(focusSel); if (f && f.focus) f.focus();
      document.dispatchEvent(new CustomEvent('eg:payment', { detail: { status: fresh.getAttribute('data-payment-status') } }));
    });
  }
  function createQr(btn) {
    var p = panel(); if (!p) return;
    clear(); btn.disabled = true;
    api('POST', '/api/drafts/' + encodeURIComponent(p.getAttribute('data-draft-id')) + '/payment').then(function (r) {
      if (!r.ok) { btn.disabled = false; showError((r.data && r.data.message) || 'สร้าง QR ไม่สำเร็จ'); return; }
      return rerender('[data-testid="qr-ref"]');
    }, function () { btn.disabled = false; showError('สร้าง QR ไม่สำเร็จ'); });
  }
  document.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-pay-action]') : null;
    if (!t || !panel() || !panel().contains(t)) return;
    ev.preventDefault();
    var a = t.getAttribute('data-pay-action');
    if (a === 'create') createQr(t);
    else if (a === 'refresh') { clear(); rerender('[data-testid="refresh-payment-btn"]'); }
  });
})();
`;

module.exports = {
  name: 'payment',
  order: 40,
  qrSvg,
  amountMatches,
  QR_TTL_MS,

  register(ctx) {
    const { app, db, auth, ui, errors } = ctx;
    const fmt = ctx.fmt;

    // ─── คำสั่ง SQL ───────────────────────────────────────────────────────────
    const getDraftStmt = db.prepare('SELECT * FROM drafts WHERE id = ?');
    // LEFT JOIN: ร่างถูกลบ (P04 DELETE) → draft_exists = 0 → ref นั้นเป็น 404 (ถ้ายังไม่ชำระ)
    const getPayStmt = db.prepare(
      `SELECT p.rowid AS _rowid, p.*, d.id AS d_id, d.citizen_id AS d_citizen, d.service_id AS d_service, d.status AS d_status,
              c.citizen_id AS c_citizen, c.service_id AS c_service, c.due_at AS c_due
         FROM payments p
         LEFT JOIN drafts d ON d.id = p.draft_id
         LEFT JOIN cases c ON c.case_no = p.case_no
        WHERE p.ref = ?`
    );
    const latestForDraftStmt = db.prepare(
      `SELECT ref FROM payments WHERE draft_id = ? ORDER BY (status = 'PAID') DESC, rowid DESC LIMIT 1`
    );
    const filesOfDraftStmt = db.prepare('SELECT DISTINCT doc_key FROM files WHERE draft_id = ?');
    const insPayStmt = db.prepare(
      `INSERT INTO payments(ref, draft_id, amount, status, qr_created_at, qr_expires_at, paid_at, case_no, receipt_no)
       VALUES (?, ?, ?, 'PENDING', ?, ?, NULL, NULL, NULL)`
    );
    const lockDraftStmt = db.prepare(
      `UPDATE drafts SET status = 'PENDING_PAYMENT', fee = ?, locked_amount = ?, updated_at = ? WHERE id = ? AND status IN ('DRAFT','PENDING_PAYMENT')`
    );
    const touchDraftStmt = db.prepare('UPDATE drafts SET updated_at = ? WHERE id = ?');
    const userStmt = db.prepare('SELECT id, username, name, role FROM users WHERE id = ?');
    const insCaseStmt = db.prepare(
      `INSERT INTO cases(case_no, draft_id, citizen_id, service_id, qty, area_sqm, fee, status, step, dept, owner, issuer,
                         approved_by, approved_at, payment_ref, receipt_no, paid_at, due_at, return_count, returned_at,
                         fix_deadline, closed_at, cancelled_at, doc_no, created_at, updated_at)
       VALUES (@case_no, @draft_id, @citizen_id, @service_id, @qty, @area_sqm, @fee, 'SUBMITTED', @step, @dept, NULL, NULL,
               NULL, NULL, @payment_ref, @receipt_no, @paid_at, @due_at, 0, NULL,
               NULL, NULL, NULL, NULL, @paid_at, @paid_at)`
    );
    const markPaidStmt = db.prepare(
      `UPDATE payments SET status = 'PAID', paid_at = ?, case_no = ?, receipt_no = ? WHERE ref = ? AND status = 'PENDING'`
    );
    const voidOthersStmt = db.prepare(`UPDATE payments SET status = 'VOID' WHERE draft_id = ? AND status = 'PENDING' AND ref <> ?`);
    const draftPaidStmt = db.prepare(
      `UPDATE drafts SET status = 'PAID', case_no = ?, updated_at = ? WHERE id = ? AND status = 'PENDING_PAYMENT'`
    );
    const filesToCaseStmt = db.prepare('UPDATE files SET case_no = ? WHERE draft_id = ? AND case_no IS NULL');

    const rules = () => {
      if (!ctx.rules || typeof ctx.rules.forContext !== 'function') throw new Error('payment: ต้องมี src/rules (P03)');
      return ctx.rules.forContext(ctx);
    };

    // ─── สถานะ / JSON ─────────────────────────────────────────────────────────
    /** BR-10: ใช้ได้ถ้า (เวลาชำระ − เวลาสร้าง) < 15:00 นาที · B05: ≤ 15:00 */
    function isExpired(p, now = ctx.clock.now()) {
      const age = time.toDate(now).getTime() - time.toDate(p.qr_created_at).getTime();
      return ctx.bugs.on('B05') ? age > QR_TTL_MS : age >= QR_TTL_MS;
    }
    /** PAID | EXPIRED | PENDING (VOID = ใช้ไม่ได้แล้ว → แสดง EXPIRED) */
    function statusOf(p, now) {
      if (p.status === 'PAID') return 'PAID';
      if (p.status === 'VOID') return 'EXPIRED';
      return isExpired(p, now) ? 'EXPIRED' : 'PENDING';
    }
    function ownerOf(p) {
      return p.d_citizen != null ? p.d_citizen : p.c_citizen != null ? p.c_citizen : null;
    }
    function toJson(p, now) {
      const status = statusOf(p, now);
      return {
        ref: p.ref,
        draftId: p.draft_id,
        serviceId: p.d_service || p.c_service || null,
        amount: p.amount,
        status,
        statusText: ctx.labels.PAYMENT_STATUS_TH[status],
        qrCreatedAt: p.qr_created_at,
        qrExpiresAt: p.qr_expires_at,
        paidAt: p.paid_at || null,
        caseNo: p.case_no || null,
        receiptNo: p.receipt_no || null,
        dueAt: p.c_due || null,
      };
    }
    /** แถว payment ที่ยังใช้อ้างได้ (ร่างยังอยู่ หรือชำระแล้วมีคำขอ) · ไม่มี → undefined */
    function loadPayment(ref) {
      const p = getPayStmt.get(String(ref || ''));
      if (!p) return undefined;
      if (!p.d_id && !(p.status === 'PAID' && p.case_no)) return undefined;
      return p;
    }
    function get(ref) {
      const p = loadPayment(ref);
      return p ? toJson(p) : null;
    }
    function forDraft(draftId) {
      const r = latestForDraftStmt.get(String(draftId || ''));
      return r ? get(r.ref) : null;
    }

    // ─── เอกสารบังคับ (FR-06/BR-08) · ใช้ตัวเช็กของ P04 ถ้ามี ─────────────────
    let externalCheckers = null;
    function resolveExternal() {
      if (externalCheckers) return externalCheckers;
      const list = [];
      const sh = ctx.shared && ctx.shared.apply;
      if (sh && typeof sh.missingDocs === 'function') list.push((...a) => sh.missingDocs(...a));
      for (const p of ['../apply/lib', '../apply']) {
        try {
          const m = require(p);
          if (m && typeof m.missingDocs === 'function' && !list.some((f) => f.src === m.missingDocs)) {
            const f = (...a) => m.missingDocs(...a);
            f.src = m.missingDocs;
            f.arity = m.missingDocs.length;
            list.push(f);
          }
        } catch (e) {
          if (!e || e.code !== 'MODULE_NOT_FOUND') ctx.log(`[payment] โหลดตัวเช็กเอกสารจาก ${p} ไม่ได้: ${e && e.message}`);
        }
      }
      // ตั้ง cache เฉพาะเมื่อโหลดโมดูลทั้งหมดเสร็จแล้ว (request แรก)
      externalCheckers = list;
      return list;
    }
    function normalizeMissing(r, svc) {
      if (r && typeof r.then === 'function') return null; // async ไม่รองรับ
      if (r && !Array.isArray(r) && typeof r === 'object') r = r.missing || r.items || r.names;
      if (!Array.isArray(r)) return null;
      const byKey = new Map((svc.docs || []).map((d) => [d.key, d.name || ctx.catalog.docName(d.key)]));
      const out = [];
      for (const x of r) {
        if (typeof x === 'string') out.push(byKey.get(x) || x);
        else if (x && typeof x === 'object' && (x.name || x.key)) out.push(x.name || byKey.get(x.key) || ctx.catalog.docName(x.key));
        else return null;
      }
      return out;
    }
    function localMissingDocs(draft, svc) {
      const have = new Set(filesOfDraftStmt.all(draft.id).map((r) => r.doc_key));
      return (svc.docs || []).filter((d) => d.required && !have.has(d.key)).map((d) => d.name || ctx.catalog.docName(d.key));
    }
    /** ชื่อเอกสารบังคับที่ยังขาด เรียงตาม CONTRACT §4.3 (ว่าง = ครบ) */
    function missingDocs(draft) {
      const svc = ctx.catalog.service(draft.service_id) || { docs: [] };
      for (const fn of resolveExternal()) {
        const tries = fn.arity >= 2 ? [[ctx, draft.id], [draft.id]] : [[draft.id], [draft]];
        for (const args of tries) {
          try {
            const r = normalizeMissing(fn(...args), svc);
            if (r) return r;
          } catch (e) {
            /* ลองรูปแบบถัดไป / ใช้ตัวเช็กในโมดูลนี้ */
          }
        }
      }
      return localMissingDocs(draft, svc);
    }

    // ─── ยอดชำระ (BR-11) ─────────────────────────────────────────────────────
    /** ยอดที่จะแสดง/ล็อก: PENDING_PAYMENT ที่ล็อกแล้ว = locked_amount · DRAFT = ค่าธรรมเนียมปัจจุบัน (ยังไม่ล็อก) */
    function amountForDraft(draft) {
      if (draft.status !== 'DRAFT' && Number.isInteger(draft.locked_amount)) return draft.locked_amount;
      const r = rules().computeFee(draft.service_id, { qty: draft.qty, areaSqm: draft.area_sqm });
      return r.ok ? r.fee : draft.fee;
    }
    function draftOf(req, id) {
      const d = getDraftStmt.get(String(id || ''));
      if (!d || !req.user || d.citizen_id !== req.user.id) return null;
      return d;
    }

    /** สร้าง QR ใหม่ (ทั้งก้อนเป็น sync + transaction → ไม่ชนกัน) */
    function createPayment(draftId, citizenId) {
      return db.tx(() => {
        const draft = getDraftStmt.get(String(draftId || ''));
        if (!draft || draft.citizen_id !== citizenId) errors.fail('NOT_FOUND');
        if (draft.status === 'PAID' || draft.case_no) errors.fail('INVALID_STATE');
        const missing = missingDocs(draft);
        if (missing.length) errors.fail('MISSING_DOCS', { missing }, `ยังขาดเอกสาร: ${missing.join(', ')}`);

        const now = ctx.clock.now();
        const nowIso = time.iso(now);
        let amount;
        if (draft.status === 'PENDING_PAYMENT' && Number.isInteger(draft.locked_amount)) {
          amount = draft.locked_amount; // QR ใหม่ของคำขอเดิมใช้ยอดที่ล็อกไว้ (BR-11)
          touchDraftStmt.run(nowIso, draft.id);
        } else {
          // เข้า PENDING_PAYMENT ตอนนี้ → ล็อกยอดจากค่าธรรมเนียมปัจจุบัน (rules ของ P03 · B01 แสดงผลได้)
          const r = rules().computeFee(draft.service_id, { qty: draft.qty, areaSqm: draft.area_sqm });
          if (!r.ok) errors.fail(r.code);
          amount = r.fee;
          lockDraftStmt.run(amount, amount, nowIso, draft.id);
        }
        const ref = ctx.ids.paymentRef();
        const createdAt = nowIso;
        const expiresAt = time.iso(time.addMinutes(time.toDate(createdAt), QR_TTL_MIN));
        insPayStmt.run(ref, draft.id, amount, createdAt, expiresAt);
        return { ref, draftId: draft.id, amount, status: 'PENDING', qrCreatedAt: createdAt, qrExpiresAt: expiresAt };
      });
    }

    /** callback ธนาคาร (จำลอง) · idempotent · ออกเลขคำขอ + ใบเสร็จใน transaction เดียวกัน (BR-09 · NFR-07) */
    function pay(ref, inputAmount) {
      return db.tx(() => {
        const p = loadPayment(ref);
        if (!p) errors.fail('NOT_FOUND');
        if (p.status === 'PAID') {
          return { status: 'PAID', caseNo: p.case_no, receiptNo: p.receipt_no, duplicate: true, paidAt: p.paid_at, amount: p.amount, dueAt: p.c_due || null };
        }
        if (p.status === 'VOID') errors.fail('INVALID_STATE'); // ร่างชำระด้วย ref อื่นไปแล้ว
        const now = ctx.clock.now();
        if (isExpired(p, now)) errors.fail('QR_EXPIRED');
        if (!amountMatches(inputAmount, p.amount)) errors.fail('AMOUNT_MISMATCH');

        const draft = getDraftStmt.get(p.draft_id);
        if (!draft || draft.status !== 'PENDING_PAYMENT') errors.fail('INVALID_STATE');
        const svc = ctx.catalog.service(draft.service_id);
        if (!svc) errors.fail('INVALID_STATE');

        const paidAt = time.iso(now);
        const caseNo = ctx.ids.caseNo(paidAt); // ปี พ.ศ. ของเวลาชำระ · เริ่มใหม่ทุกปี
        const receiptNo = ctx.ids.receiptNo(paidAt);
        const dueAt = rules().computeDueAt(paidAt, draft.service_id); // P03 (B03 แสดงผลได้)
        const route = Array.isArray(svc.route) ? svc.route : ['registry'];
        const dept = route[0] === 'registry' || route[0] === 'works' ? route[0] : 'registry';
        const step = route.includes('works') ? 1 : null; // SV-03 เท่านั้น

        insCaseStmt.run({
          case_no: caseNo,
          draft_id: draft.id,
          citizen_id: draft.citizen_id,
          service_id: draft.service_id,
          qty: draft.qty == null ? null : draft.qty,
          area_sqm: draft.area_sqm == null ? null : draft.area_sqm,
          fee: p.amount,
          step,
          dept,
          payment_ref: p.ref,
          receipt_no: receiptNo,
          paid_at: paidAt,
          due_at: dueAt,
        });
        if (markPaidStmt.run(paidAt, caseNo, receiptNo, p.ref).changes !== 1) errors.fail('INVALID_STATE');
        voidOthersStmt.run(draft.id, p.ref);
        if (draftPaidStmt.run(caseNo, paidAt, draft.id).changes !== 1) errors.fail('INVALID_STATE');
        filesToCaseStmt.run(caseNo, draft.id);

        const u = userStmt.get(draft.citizen_id);
        ctx.caseEvents.record(caseNo, {
          event: 'PAID',
          from: null,
          to: 'SUBMITTED',
          actor: u ? { username: u.username, name: u.name, role: u.role || 'citizen' } : null,
          text: `${ctx.labels.TIMELINE_TH.PAID} (ใบเสร็จ ${receiptNo})`,
          at: paidAt,
        });
        return { status: 'PAID', caseNo, receiptNo, duplicate: false, paidAt, amount: p.amount, dueAt };
      });
    }

    // ─── HTML ส่วนชำระเงิน (ขั้น 3/3) ─────────────────────────────────────────
    function receiptHtml(pj) {
      return `<div class="card stack" data-testid="receipt" aria-labelledby="receipt-title">
  <h3 id="receipt-title">ใบเสร็จรับเงิน (จำลอง)</h3>
  <dl class="kv">
    <dt>เลขคำขอ</dt><dd data-testid="submitted-case-no">${ui.esc(pj.caseNo)}</dd>
    <dt>เลขใบเสร็จ</dt><dd data-testid="receipt-no">${ui.esc(pj.receiptNo)}</dd>
    <dt>ยอดชำระ</dt><dd>${ui.money(pj.amount, { testid: 'receipt-amount' })}</dd>
    <dt>วันเวลาชำระ</dt><dd>${ui.time(pj.paidAt, { testid: 'receipt-paid-at' })}</dd>
  </dl>
  <p class="actions"><a class="btn btn-primary" data-testid="go-case-btn" href="/citizen/cases/${encodeURIComponent(pj.caseNo)}">ดูคำขอ</a></p>
</div>`;
    }

    /** ส่วน "ชำระเงิน" ของหน้า /citizen/new/:service (ต้องโหลด ctx.shared.payment.script ด้วย) */
    function panelHtml(req, draftOrId) {
      const draft = typeof draftOrId === 'object' && draftOrId ? draftOrId : getDraftStmt.get(String(draftOrId || ''));
      if (!draft) return '';
      if (req && req.user && draft.citizen_id !== req.user.id) return '';
      const pj = forDraft(draft.id);
      const amount = pj && pj.status === 'PAID' ? pj.amount : amountForDraft(draft);
      const st = pj ? pj.status : 'NONE';
      const statusBadge = (s) =>
        `<span class="badge pay-${s}" data-testid="payment-status" data-status="${s}">${ui.esc(ctx.labels.PAYMENT_STATUS_TH[s])}</span>`;
      const refreshBtn = `<button type="button" class="btn btn-ghost" data-testid="refresh-payment-btn" data-pay-action="refresh">ตรวจสอบการชำระเงิน</button>`;
      let inner = '';
      if (!pj) {
        inner = `<p class="actions"><button type="button" class="btn btn-primary" data-testid="create-qr-btn" data-pay-action="create">สร้าง QR</button></p>`;
      } else if (st === 'PAID') {
        inner = `<p>สถานะการชำระ ${statusBadge('PAID')}</p>
<p class="msg msg-ok" role="status">ชำระเงินสำเร็จ ส่งคำขอเรียบร้อยแล้ว</p>
${receiptHtml(pj)}
<p class="actions">${refreshBtn}</p>`;
      } else {
        const expired = st === 'EXPIRED';
        inner = `<div class="qr-box" data-testid="qr-image" data-ref="${ui.esc(pj.ref)}">${qrSvg(qrPayload({ ref: pj.ref, amount: pj.amount, qr_expires_at: pj.qrExpiresAt }), { size: 200 })}</div>
<dl class="kv">
  <dt>เลขอ้างอิง</dt><dd data-testid="qr-ref">${ui.esc(pj.ref)}</dd>
  <dt>เวลาหมดอายุ</dt><dd>${ui.time(pj.qrExpiresAt, { testid: 'qr-expires', prefix: 'หมดอายุ ' })}</dd>
  <dt>สถานะการชำระ</dt><dd>${statusBadge(st)}</dd>
</dl>
${expired ? `<p class="msg msg-error" data-testid="qr-expired-msg" role="alert">${ui.esc(errors.message('QR_EXPIRED'))}</p>` : '<p class="muted">สแกน QR ด้วยแอปธนาคารเพื่อชำระเงิน (ระบบจำลอง) แล้วกด "ตรวจสอบการชำระเงิน"</p>'}
<p class="actions">${expired ? '<button type="button" class="btn btn-primary" data-testid="regenerate-qr-btn" data-pay-action="create">สร้าง QR ใหม่</button>' : ''}${refreshBtn}</p>`;
      }
      return `<section class="card stack" id="payment-panel" aria-labelledby="payment-title" data-draft-id="${ui.esc(draft.id)}" data-payment-status="${st}"${pj ? ` data-payment-ref="${ui.esc(pj.ref)}"` : ''}>
<h2 id="payment-title">ชำระเงิน (PromptPay QR จำลอง)</h2>
<p>ยอดที่ต้องชำระ <strong>${ui.money(amount, { testid: 'payment-amount' })}</strong></p>
<p class="msg msg-error" data-pay-error role="alert" hidden></p>
${inner}
</section>`;
    }

    ctx.shared.payment = {
      script: SCRIPT_URL,
      panelHtml,
      receiptHtml,
      forDraft,
      get,
      toJson,
      statusOf,
      isExpired,
      amountForDraft,
      missingDocs,
      qrSvg,
      createPayment,
      pay,
    };

    // ─── routes ───────────────────────────────────────────────────────────────
    app.get(SCRIPT_URL, (req, res) => {
      res.type('application/javascript').set('Cache-Control', 'no-cache').send(CLIENT_JS);
    });

    app.post('/api/drafts/:id/payment', auth.api('citizen'), (req, res) => {
      const out = createPayment(req.params.id, req.user.id);
      res.status(201).json(out);
    });

    app.get('/api/drafts/:id/payment', auth.api('citizen'), (req, res) => {
      const d = draftOf(req, req.params.id);
      if (!d) return errors.send(res, 'NOT_FOUND');
      if (req.query.format === 'html') return res.json({ html: panelHtml(req, d) });
      const pj = forDraft(d.id);
      return res.json({
        draftId: d.id,
        serviceId: d.service_id,
        draftStatus: d.status,
        amount: pj && pj.status === 'PAID' ? pj.amount : amountForDraft(d),
        caseNo: d.case_no || null,
        payment: pj,
      });
    });

    app.get('/api/payments/:ref', auth.api('citizen'), (req, res) => {
      const p = loadPayment(req.params.ref);
      if (!p || ownerOf(p) !== req.user.id) return errors.send(res, 'NOT_FOUND');
      return res.json(toJson(p));
    });

    app.get('/api/payments/:ref/qr.svg', auth.api('citizen'), (req, res) => {
      const p = loadPayment(req.params.ref);
      if (!p || ownerOf(p) !== req.user.id) return errors.send(res, 'NOT_FOUND');
      res.type('image/svg+xml').set('Cache-Control', 'no-store').send(qrSvg(qrPayload(p)));
    });

    // CONTRACT §8 · FR-28 (ส่วน pay) · ใช้ได้เฉพาะ TEST_MODE=1 (core ตอบ 404 ให้เมื่อปิด)
    ctx.hooks.testRoute('post', '/api/test/payments/:ref/pay', (req, res) => {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const out = pay(req.params.ref, body.amount);
      res.status(200).json(out);
    });
  },
};

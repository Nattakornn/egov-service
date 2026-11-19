'use strict';
// P06 · คำขอของประชาชน: รายการ รายละเอียด ยกเลิก ส่งแก้ไข 168 ชม.
// FR-09 FR-10 FR-11 FR-19 (แสดงผลฝั่งประชาชน) · BR-13 BR-18 BR-20 BR-22 · A-21 A-29 A-30 A-33 A-40 A-46
//
// หน้า:  GET /citizen                       รายการคำขอ (my-case-row) + ร่าง (my-draft-row) + แคตตาล็อกบริการ
//        GET /citizen/cases/:caseNo         รายละเอียด สถานะ ไทม์ไลน์ กำหนดเสร็จ ระดับเตือน ยกเลิก ส่งแก้
// API:   GET  /api/cases                    {items:[{caseNo,serviceId,status,dueAt,slaLevel}]} เฉพาะของฉัน
//        GET  /api/cases/:caseNo            CONTRACT §6.7 (citizen เจ้าของได้ idNo · officer/head ได้ idMasked)
//        POST /api/cases/:caseNo/cancel     SUBMITTED ที่ไม่มีผู้รับ → CANCELLED · อื่น 409 CANNOT_CANCEL
//        POST /api/cases/:caseNo/resubmit   NEED_FIX → IN_REVIEW (ผู้ถือเดิม BR-18 · dueAt ขยายตาม BR-13 ผ่าน rules)
//                                           เลย 168 ชม. → 409 FIX_WINDOW_EXPIRED · multipart ไม่บังคับ (file/files + docKey)
// hook:  onRequest(10) ยกเลิกอัตโนมัติ NEED_FIX ที่ now ≥ fix_deadline (A-46 · เวลาไทม์ไลน์ = fix_deadline · idempotent)
// shared: ctx.shared.cases = { caseJson(row, viewer), autoCancelExpired(), stepText(row), getCase(caseNo) }
// BUG_MODE: B06 = ไม่ตรวจเจ้าของ (หน้า /citizen/cases/:caseNo และ GET /api/cases/:caseNo ของ citizen)
//           B04 อยู่ใน rules.extendDueForFix (บล็อกนี้เรียกใช้เท่านั้น)

const STEP_TEXT = {
  1: 'ขั้นตอน 1/3 · ฝ่ายทะเบียน',
  2: 'ขั้นตอน 2/3 · ฝ่ายโยธา',
  3: 'ขั้นตอน 3/3 · หัวหน้าฝ่าย',
};
const NO_REFUND = 'ค่าธรรมเนียมที่ชำระแล้วไม่คืน';

module.exports = {
  name: 'cases',
  order: 30,
  register(ctx) {
    const { app, db, auth, ui, errors, fmt, clock, labels } = ctx;
    const esc = ui.esc;
    const rulesLib = ctx.rules;
    const R = () => (rulesLib ? rulesLib.forContext(ctx) : null);

    const q = {
      caseByNo: db.prepare('SELECT * FROM cases WHERE case_no = ?'),
      myCases: db.prepare('SELECT * FROM cases WHERE citizen_id = ? ORDER BY case_no DESC'),
      myDrafts: db.prepare(
        "SELECT * FROM drafts WHERE citizen_id = ? AND status IN ('DRAFT','PENDING_PAYMENT') ORDER BY id DESC"
      ),
      needFix: db.prepare("SELECT case_no, fix_deadline, returned_at FROM cases WHERE status = 'NEED_FIX'"),
      user: db.prepare('SELECT id, username, name, id_enc FROM users WHERE id = ?'),
      lastReturn: db.prepare('SELECT * FROM returns WHERE case_no = ? ORDER BY seq DESC LIMIT 1'),
      openReturn: db.prepare(
        'SELECT * FROM returns WHERE case_no = ? AND resubmitted_at IS NULL ORDER BY seq DESC LIMIT 1'
      ),
      updReturn: db.prepare('UPDATE returns SET resubmitted_at = ?, paused_days = ? WHERE id = ?'),
      autoCancelled: db.prepare("SELECT 1 FROM case_timeline WHERE case_no = ? AND event = 'AUTO_CANCEL' LIMIT 1"),
      files: db.prepare('SELECT id, name, doc_key, size, mime FROM files WHERE case_no = ? ORDER BY uploaded_at, id'),
      fileCount: db.prepare('SELECT COUNT(*) AS n FROM files WHERE case_no = ?'),
      insFile: db.prepare(
        `INSERT INTO files(id, draft_id, case_no, doc_key, name, mime, size, storage, seed, uploaded_by, uploaded_at)
         VALUES (@id, NULL, @caseNo, @docKey, @name, @mime, @size, @storage, 0, @uploadedBy, @at)`
      ),
    };

    // ---------- ช่วยเหลือ ----------

    function nowDate() {
      return clock.now();
    }

    function isExpired(deadline) {
      if (!deadline) return false;
      const r = R();
      if (r) return r.isFixWindowExpired(deadline);
      return nowDate().getTime() >= ctx.time.toDate(deadline).getTime();
    }

    function levelOf(row, holidays) {
      if (!rulesLib) return null;
      if (holidays) return rulesLib.slaLevel(row, { holidays });
      return R().slaLevel(row);
    }

    function serviceLabel(serviceId) {
      const s = ctx.catalog.service(serviceId);
      return s ? `${serviceId} ${s.name}` : serviceId;
    }

    function stepText(row) {
      if (!row || row.service_id !== 'SV-03' || !row.step) return null;
      return STEP_TEXT[row.step] || null;
    }

    /** citizen เปิดได้ไหม (BR-22 · B06 ข้ามการตรวจเจ้าของเฉพาะการดู) */
    function canView(user, row, { viewOnly = false } = {}) {
      if (!row) return false;
      if (user.role !== 'citizen') return true;
      if (row.citizen_id === user.id) return true;
      return viewOnly && ctx.bugs.on('B06');
    }

    function docInfo(caseNo) {
      const sd = ctx.shared.documents;
      if (sd && typeof sd.forCase === 'function') {
        try {
          return sd.forCase(caseNo);
        } catch (_) {
          /* ignore */
        }
      }
      try {
        const d = db.prepare('SELECT doc_no, verify_code FROM documents WHERE case_no = ? ORDER BY doc_no DESC LIMIT 1').get(caseNo);
        return d ? { docNo: d.doc_no, verifyCode: d.verify_code } : null;
      } catch (_) {
        return null;
      }
    }

    /** CONTRACT §6.7 · viewer = req.user · owner citizen → idNo · staff → idMasked (BR-24) */
    function caseJson(row, viewer) {
      const applicant = q.user.get(row.citizen_id) || {};
      const idNo = applicant.id_enc ? ctx.crypto.dec(applicant.id_enc) : null;
      const doc = docInfo(row.case_no);
      const out = {
        caseNo: row.case_no,
        serviceId: row.service_id,
        status: row.status,
        step: row.service_id === 'SV-03' && row.step ? Number(row.step) : null,
        fee: row.fee,
        paidAt: row.paid_at,
        dueAt: row.due_at,
        slaLevel: levelOf(row),
        owner: row.owner || null,
        returnCount: row.return_count || 0,
        closedAt: row.closed_at || null,
        applicantName: applicant.name || null,
      };
      const isOwner = viewer && viewer.role === 'citizen' && viewer.id === row.citizen_id;
      if (isOwner) out.idNo = idNo;
      else out.idMasked = idNo ? fmt.maskId(idNo) : null;
      out.fixDeadline = row.status === 'NEED_FIX' ? row.fix_deadline || null : null;
      out.docNo = (doc && doc.docNo) || row.doc_no || null;
      out.verifyCode = (doc && doc.verifyCode) || null;
      out.cancelledAt = row.cancelled_at || null;
      out.receiptNo = row.receipt_no || null;
      return out;
    }

    // ---------- ยกเลิกอัตโนมัติ (A-46 · CONTRACT §0 ข้อ 7) ----------

    function autoCancelOne(caseNo, deadline) {
      try {
        ctx.caseEvents.transition(caseNo, {
          from: 'NEED_FIX',
          to: 'CANCELLED',
          event: 'AUTO_CANCEL',
          actor: null,
          at: deadline,
          set: { cancelled_at: deadline, dept: null, owner: null, fix_deadline: null },
          check: (row) => {
            if (!row.fix_deadline || row.fix_deadline !== deadline || !isExpired(row.fix_deadline)) {
              throw new errors.AppError('INVALID_STATE');
            }
          },
          audit: false,
        });
        return true;
      } catch (e) {
        if (e instanceof errors.AppError) return false; // มีคนเปลี่ยนสถานะไปแล้ว (idempotent)
        throw e;
      }
    }

    function autoCancelExpired() {
      let n = 0;
      for (const r of q.needFix.all()) {
        if (r.fix_deadline && isExpired(r.fix_deadline) && autoCancelOne(r.case_no, r.fix_deadline)) n++;
      }
      return n;
    }

    ctx.hooks.onRequest(10, () => {
      autoCancelExpired();
    });

    // ---------- API ----------

    app.get('/api/cases', auth.api('citizen'), (req, res) => {
      const h = rulesLib ? R().holidays() : null;
      const items = q.myCases.all(req.user.id).map((row) => ({
        caseNo: row.case_no,
        serviceId: row.service_id,
        status: row.status,
        dueAt: row.due_at,
        slaLevel: levelOf(row, h),
      }));
      res.json({ items });
    });

    app.get('/api/cases/:caseNo', auth.api('citizen', 'officer', 'head'), (req, res) => {
      const row = q.caseByNo.get(req.params.caseNo);
      if (!row || !canView(req.user, row, { viewOnly: true })) return errors.send(res, 'NOT_FOUND');
      res.json(caseJson(row, req.user));
    });

    app.post('/api/cases/:caseNo/cancel', auth.api('citizen'), (req, res) => {
      const caseNo = req.params.caseNo;
      const row = q.caseByNo.get(caseNo);
      if (!row || row.citizen_id !== req.user.id) return errors.send(res, 'NOT_FOUND');
      const now = clock.nowIso();
      // ทั้ง handler เป็น sync + UPDATE แบบมีเงื่อนไขสถานะเดิม → ชนกับ claim สำเร็จฝั่งเดียว (BR-22)
      ctx.caseEvents.transition(caseNo, {
        to: 'CANCELLED',
        event: 'CANCEL',
        actor: req.user,
        set: { cancelled_at: now, dept: null, owner: null },
        check: (r) => {
          if (r.status !== 'SUBMITTED' || r.owner) throw new errors.AppError('CANNOT_CANCEL');
        },
        audit: false,
      });
      res.json({ status: 'CANCELLED' });
    });

    function decodeName(n) {
      if (!n) return 'file';
      try {
        const u = Buffer.from(String(n), 'latin1').toString('utf8');
        return u.includes('�') ? String(n) : u;
      } catch (_) {
        return String(n);
      }
    }

    const DOC_KEYS = new Set(['id-card', 'map', 'site-photo', 'plan', 'deed', 'extra']);

    function resubmitHandler(req, res) {
      const caseNo = req.params.caseNo;
      const row = q.caseByNo.get(caseNo);
      if (!row || row.citizen_id !== req.user.id) return errors.send(res, 'NOT_FOUND');

      if (row.status === 'NEED_FIX' && isExpired(row.fix_deadline)) {
        autoCancelOne(caseNo, row.fix_deadline);
        return errors.send(res, 'FIX_WINDOW_EXPIRED');
      }
      if (row.status === 'CANCELLED' && q.autoCancelled.get(caseNo)) return errors.send(res, 'FIX_WINDOW_EXPIRED');
      if (row.status !== 'NEED_FIX') return errors.send(res, 'INVALID_STATE');

      // ไฟล์แนบใหม่ (ไม่บังคับ · A-29) ตรวจก่อนเปลี่ยนสถานะ
      const incoming = (Array.isArray(req.files) ? req.files : req.file ? [req.file] : []).filter((f) => f && f.buffer);
      const body = req.body || {};
      const docKeyIn = String(body.docKey || 'extra');
      const docKey = DOC_KEYS.has(docKeyIn) ? docKeyIn : 'extra';
      const prepared = [];
      if (incoming.length) {
        const existing = q.fileCount.get(caseNo).n;
        if (existing + incoming.length > ctx.storage.MAX_FILES_PER_CASE) return errors.send(res, 'FILE_COUNT');
        for (const f of incoming) {
          if (f.size > ctx.storage.MAX_FILE_BYTES || f.buffer.length > ctx.storage.MAX_FILE_BYTES) {
            return errors.send(res, 'FILE_TOO_LARGE');
          }
          const t = ctx.storage.detectType(f.buffer);
          if (!t) return errors.send(res, 'FILE_TYPE');
          if (docKey === 'plan' && t.type !== 'pdf') return errors.send(res, 'PLAN_NOT_PDF');
          prepared.push({ f, t });
        }
      }

      const now = clock.nowIso();
      const r = R();
      const ext = r
        ? r.fixExtension(row.due_at, row.returned_at, now)
        : { dueAt: row.due_at, pausedDays: 0 };
      const written = [];
      try {
        const result = db.tx(() => {
          for (const { f, t } of prepared) {
            const id = ctx.ids.fileId();
            const storage = ctx.storage.save(id, f.buffer);
            written.push(storage);
            q.insFile.run({
              id,
              caseNo,
              docKey,
              name: decodeName(f.originalname),
              mime: t.mime,
              size: f.buffer.length,
              storage,
              uploadedBy: req.user.id,
              at: now,
            });
          }
          const tr = ctx.caseEvents.transition(caseNo, {
            from: 'NEED_FIX',
            to: 'IN_REVIEW',
            event: 'RESUBMIT',
            actor: req.user,
            // BR-18 / A-29: ผู้ถือเดิม ขั้นเดิม ไม่ตรวจเพดาน 10 งาน
            set: { due_at: ext.dueAt, fix_deadline: null },
            check: (cur) => {
              if (isExpired(cur.fix_deadline)) throw new errors.AppError('FIX_WINDOW_EXPIRED');
            },
            detail: prepared.length ? `แนบไฟล์ใหม่ ${prepared.length} ไฟล์` : null,
            audit: false,
          });
          const ret = q.openReturn.get(caseNo);
          if (ret) q.updReturn.run(now, ext.pausedDays, ret.id);
          return tr.row;
        });
        res.json({ status: 'IN_REVIEW', dueAt: result.due_at });
      } catch (e) {
        for (const s of written) ctx.storage.remove(s);
        if (e instanceof errors.AppError && e.code === 'FIX_WINDOW_EXPIRED') {
          autoCancelOne(caseNo, row.fix_deadline);
        }
        throw e;
      }
    }

    app.post(
      '/api/cases/:caseNo/resubmit',
      auth.api('citizen'),
      (req, res, next) => {
        if (req.is('multipart/form-data') && ctx.upload) return ctx.upload.any()(req, res, next);
        next();
      },
      resubmitHandler
    );

    // ---------- หน้า /citizen ----------

    app.get('/citizen', auth.page('citizen'), (req, res) => {
      const user = req.user;
      const h = rulesLib ? R().holidays() : null;
      const services = ctx.catalog.services();
      const cases = q.myCases.all(user.id);
      const drafts = q.myDrafts.all(user.id);

      const catalogHtml = services
        .map(
          (s) => `<li class="card stack svc-card">
<h3>${esc(s.id)} ${esc(s.name)}</h3>
<p class="muted">กำหนดเสร็จ ${esc(s.sla)} วันทำการ</p>
<p><a class="btn btn-primary" data-testid="start-service-${esc(s.id)}" href="/citizen/new/${encodeURIComponent(s.id)}">เริ่มยื่นคำขอ</a></p>
</li>`
        )
        .join('');

      const caseRows = cases
        .map((row) => {
          const lv = levelOf(row, h);
          return `<tr data-testid="my-case-row"${ui.attrs({ 'data-case-no': row.case_no, 'data-status': row.status })}>
<td data-testid="row-case-no"><a href="/citizen/cases/${encodeURIComponent(row.case_no)}">${esc(row.case_no)}</a></td>
<td data-testid="row-service">${esc(serviceLabel(row.service_id))}</td>
<td>${ui.statusBadge(row.status, { testid: 'row-status' })}</td>
<td>${ui.time(row.due_at, { testid: 'row-due' })}</td>
<td>${lv ? ui.slaBadge(lv, { testid: 'row-sla-level' }) : esc(fmt.DASH)}</td>
</tr>`;
        })
        .join('');

      const draftRows = drafts
        .map((d) => {
          const amount = d.status === 'PENDING_PAYMENT' && d.locked_amount != null ? d.locked_amount : d.fee;
          const openHref = `/citizen/new/${encodeURIComponent(d.service_id)}?draft=${encodeURIComponent(d.id)}`;
          return `<tr data-testid="my-draft-row"${ui.attrs({ 'data-draft-id': d.id, 'data-status': d.status })}>
<td data-testid="row-draft-id">${esc(d.id)}</td>
<td data-testid="row-service">${esc(serviceLabel(d.service_id))}</td>
<td>${ui.statusBadge(d.status, { testid: 'row-status' })}</td>
<td>${amount != null ? ui.money(amount) : esc(fmt.DASH)}</td>
<td class="actions">
<a class="btn btn-small" data-testid="open-draft-btn" href="${esc(openHref)}">เปิดร่าง</a>
<button type="button" class="btn btn-small btn-danger" data-testid="delete-draft-btn"${ui.attrs({ 'data-draft-id': d.id })}>ลบร่าง</button>
</td>
</tr>`;
        })
        .join('');

      const body = `<h1>คำขอของฉัน</h1>
<p data-testid="citizen-welcome">สวัสดี ${esc(user.name)}</p>
${ui.messages()}
<section class="stack" aria-labelledby="svc-h">
<h2 id="svc-h">เริ่มยื่นคำขอ</h2>
<ul class="grid-2 svc-list" role="list">${catalogHtml}</ul>
</section>
<section class="card stack" aria-labelledby="cases-h">
<h2 id="cases-h">คำขอที่ยื่นแล้ว</h2>
${
  cases.length
    ? `<div class="table-wrap"><table class="tbl" data-testid="my-cases-table">
<caption class="sr-only">คำขอที่ยื่นแล้ว เรียงเลขคำขอล่าสุดก่อน</caption>
<thead><tr><th scope="col">เลขคำขอ</th><th scope="col">บริการ</th><th scope="col">สถานะ</th><th scope="col">กำหนดเสร็จ</th><th scope="col">ระดับเตือน</th></tr></thead>
<tbody>${caseRows}</tbody></table></div>`
    : '<p class="muted" data-testid="no-cases">ยังไม่มีคำขอ</p>'
}
</section>
<section class="card stack" aria-labelledby="drafts-h">
<h2 id="drafts-h">ร่างและรอชำระเงิน</h2>
${
  drafts.length
    ? `<div class="table-wrap"><table class="tbl" data-testid="my-drafts-table">
<caption class="sr-only">ร่างและคำขอที่รอชำระเงิน</caption>
<thead><tr><th scope="col">รหัสร่าง</th><th scope="col">บริการ</th><th scope="col">สถานะ</th><th scope="col">ค่าธรรมเนียม</th><th scope="col">ดำเนินการ</th></tr></thead>
<tbody>${draftRows}</tbody></table></div>`
    : '<p class="muted" data-testid="no-drafts">ไม่มีร่าง</p>'
}
</section>`;
      ui.send(req, res, { title: 'คำขอของฉัน', body, scripts: ['/static/cases/citizen.js'] });
    });

    // ---------- หน้า /citizen/cases/:caseNo ----------

    app.get('/citizen/cases/:caseNo', auth.page('citizen'), (req, res) => {
      const row = q.caseByNo.get(req.params.caseNo);
      if (!row || !canView(req.user, row, { viewOnly: true })) return ui.notFound(req, res);
      const isOwner = row.citizen_id === req.user.id;
      const applicant = q.user.get(row.citizen_id) || {};
      const idNo = applicant.id_enc ? ctx.crypto.dec(applicant.id_enc) : null;
      const lv = levelOf(row);
      const st = stepText(row);
      const timeline = ctx.caseEvents.timeline(row.case_no);
      const files = q.files.all(row.case_no);
      const docPanel =
        ctx.shared.documents && typeof ctx.shared.documents.panelHtml === 'function'
          ? ctx.shared.documents.panelHtml(req, row.case_no, { citizen: isOwner })
          : '';

      const kv = [];
      kv.push(`<dt>เลขคำขอ</dt><dd data-testid="case-no">${esc(row.case_no)}</dd>`);
      kv.push(`<dt>สถานะ</dt><dd>${ui.statusBadge(row.status, { testid: 'case-status' })}</dd>`);
      kv.push(`<dt>บริการ</dt><dd data-testid="case-service">${esc(serviceLabel(row.service_id))}</dd>`);
      if (st) kv.push(`<dt>ขั้นตอน</dt><dd data-testid="case-step">${esc(st)}</dd>`);
      if (row.service_id === 'SV-01' && row.qty) kv.push(`<dt>จำนวนฉบับ</dt><dd>${esc(row.qty)} ฉบับ</dd>`);
      if (row.service_id === 'SV-03' && row.area_sqm) kv.push(`<dt>พื้นที่</dt><dd>${esc(row.area_sqm)} ตร.ม.</dd>`);
      kv.push(`<dt>ค่าธรรมเนียม</dt><dd>${ui.money(row.fee, { testid: 'case-fee' })}</dd>`);
      if (row.receipt_no) kv.push(`<dt>เลขใบเสร็จ</dt><dd data-testid="case-receipt-no">${esc(row.receipt_no)}</dd>`);
      kv.push(`<dt>ชำระเมื่อ</dt><dd>${ui.time(row.paid_at, { testid: 'case-paid-at' })}</dd>`);
      kv.push(`<dt>กำหนดเสร็จ</dt><dd>${ui.time(row.due_at, { testid: 'sla-due' })}</dd>`);
      kv.push(`<dt>ระดับเตือน</dt><dd>${lv ? ui.slaBadge(lv, { testid: 'sla-level' }) : esc(fmt.DASH)}</dd>`);
      if (row.status === 'COMPLETED' || row.status === 'REJECTED') {
        kv.push(`<dt>ปิดงานเมื่อ</dt><dd>${ui.time(row.closed_at, { testid: 'closed-at' })}</dd>`);
      }
      if (row.status === 'CANCELLED' && row.cancelled_at) {
        kv.push(`<dt>ยกเลิกเมื่อ</dt><dd>${ui.time(row.cancelled_at, { testid: 'cancelled-at' })}</dd>`);
      }
      kv.push(`<dt>ผู้ยื่น</dt><dd>${esc(applicant.name || '')}</dd>`);
      if (isOwner && idNo) kv.push(`<dt>เลขบัตรประชาชน</dt><dd data-testid="case-id-full">${esc(fmt.idFull(idNo))}</dd>`);
      else if (idNo) kv.push(`<dt>เลขบัตรประชาชน</dt><dd>${esc(fmt.maskId(idNo))}</dd>`);

      // ไม่คืนค่าธรรมเนียม (BR-22 · A-13)
      let notes = '';
      if (row.status === 'REJECTED' || row.status === 'CANCELLED') {
        notes += `<p class="msg msg-info" data-testid="no-refund-note">${esc(NO_REFUND)}</p>`;
      }
      if (row.status === 'REJECTED') {
        const rj = timeline.filter((t) => t.event === 'REJECT' && t.detail).pop();
        if (rj) notes += `<p>เหตุผลที่ไม่อนุมัติ: <span data-testid="reject-reason-display">${esc(rj.detail)}</span></p>`;
      }

      // ยกเลิก (FR-10 · เฉพาะ SUBMITTED ที่ไม่มีผู้รับ)
      let cancelHtml = '';
      if (isOwner && row.status === 'SUBMITTED' && !row.owner) {
        cancelHtml = `<section class="card stack" aria-labelledby="cancel-h">
<h2 id="cancel-h">ยกเลิกคำขอ</h2>
<p><button type="button" class="btn btn-danger" data-testid="cancel-case-btn" aria-controls="cancel-confirm" aria-expanded="false">ยกเลิกคำขอ</button></p>
<div id="cancel-confirm" class="msg msg-info stack" role="alertdialog" aria-labelledby="cancel-confirm-text" data-testid="cancel-confirm" hidden>
<p id="cancel-confirm-text" data-testid="cancel-confirm-text">${esc(NO_REFUND)}</p>
<p>ยืนยันการยกเลิกคำขอ ${esc(row.case_no)} หรือไม่</p>
<p class="actions"><button type="button" class="btn btn-danger" data-testid="confirm-cancel-btn">ยืนยันยกเลิก</button>
<button type="button" class="btn btn-ghost" data-testid="cancel-cancel-btn">ไม่ยกเลิก</button></p>
</div>
</section>`;
      }

      // ส่งแก้ไข (FR-11 · BR-20)
      let fixHtml = '';
      if (row.status === 'NEED_FIX') {
        const ret = q.lastReturn.get(row.case_no);
        const reason = (ret && ret.reason) || (timeline.filter((t) => t.event === 'RETURN').pop() || {}).detail || '';
        const open = !isExpired(row.fix_deadline);
        fixHtml = `<section class="card stack" aria-labelledby="fix-h">
<h2 id="fix-h">ถูกตีกลับให้แก้ไขเอกสาร</h2>
<dl class="kv">
<dt>เหตุผล</dt><dd data-testid="return-reason-display">${esc(reason)}</dd>
<dt>ส่งแก้ไขได้ภายใน</dt><dd>${ui.time(row.fix_deadline, { testid: 'fix-deadline' })}</dd>
</dl>
${
  isOwner && open
    ? `<form class="stack" data-testid="fix-form" id="fix-form" enctype="multipart/form-data">
<div class="field">
<label for="fix-upload-input">แนบไฟล์ใหม่ (ไม่บังคับ · PDF, JPG, PNG ไม่เกิน 5 MB)</label>
<input type="file" id="fix-upload-input" name="file" data-testid="fix-upload-input" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" multiple>
</div>
<p class="actions"><button type="submit" class="btn btn-primary" data-testid="submit-fix-btn">ส่งแก้ไข</button></p>
</form>`
    : ''
}
</section>`;
      }

      const filesHtml = files.length
        ? `<ul class="stack doc-list">${files
            .map(
              (f) => `<li data-testid="doc-item"${ui.attrs({ 'data-name': f.name, 'data-file-id': f.id, 'data-doc-key': f.doc_key })}>
<span>${esc((labels.DOC_KEY_TH && labels.DOC_KEY_TH[f.doc_key]) || f.doc_key)}: </span>
<a data-testid="doc-download-link" href="/api/files/${encodeURIComponent(f.id)}" target="_blank" rel="noopener">${esc(f.name)}</a>
</li>`
            )
            .join('')}</ul>`
        : '<p class="muted">ไม่มีไฟล์แนบ</p>';

      const tlHtml = timeline
        .map(
          (t) => `<li data-testid="timeline-item"${ui.attrs({ 'data-iso': t.at, 'data-event': t.event })}>
${ui.time(t.at)} · <span>${esc(t.text)}</span>${t.actorName && t.actorRole !== 'system' ? ` <span class="muted">(${esc(t.actorName)})</span>` : ''}${
            t.detail && (t.event === 'RETURN' || t.event === 'REJECT') ? `<br><span class="muted">เหตุผล: ${esc(t.detail)}</span>` : ''
          }
</li>`
        )
        .join('');

      const body = `<p><a href="/citizen">← กลับรายการคำขอ</a></p>
<h1>คำขอ ${esc(row.case_no)}</h1>
${ui.messages()}
<div data-case-no="${esc(row.case_no)}" id="case-root" class="stack">
<section class="card stack" aria-labelledby="detail-h">
<h2 id="detail-h">รายละเอียดคำขอ</h2>
<dl class="kv">${kv.join('\n')}</dl>
${notes}
</section>
${fixHtml}
${cancelHtml}
${docPanel || ''}
<section class="card stack" aria-labelledby="files-h">
<h2 id="files-h">เอกสารแนบ</h2>
${filesHtml}
</section>
<section class="card stack" aria-labelledby="tl-h">
<h2 id="tl-h">ไทม์ไลน์</h2>
<ol class="timeline" data-testid="case-timeline">${tlHtml}</ol>
</section>
</div>`;
      ui.send(req, res, { title: `คำขอ ${row.case_no}`, body, scripts: ['/static/cases/case.js'] });
    });

    ctx.shared.cases = {
      caseJson,
      autoCancelExpired,
      stepText,
      getCase: (caseNo) => q.caseByNo.get(caseNo),
      STEP_TEXT,
    };
  },
};

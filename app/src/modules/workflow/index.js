'use strict';
// P08 · พิจารณาคำขอ: หน้าเจ้าหน้าที่ · ตีกลับ · ส่งต่อ · อนุมัติ/ไม่อนุมัติ · หัวหน้า · ไฟล์แนบ
// FR-14 FR-15 FR-16 FR-29 · BR-19 BR-21 BR-29 · A-12 A-20 A-27 A-28 A-40 A-44 A-59
// CONTRACT §1 §2.6 (ฝั่งเจ้าหน้าที่) §2.8 §5 §6.2 (files) §6.3 (return forward approve reject) §6.8
//
// หน้า
//   GET  /officer/cases/:caseNo                officer · head (ไม่มีเลข → 404 not-found-msg)
//   GET  /head/approvals                       head · แถว PENDING_APPROVAL เรียง due_at, case_no (BR-16)
// API
//   POST /api/officer/cases/:caseNo/return     ผู้ถือเรื่อง {reason} → 200 {status:'NEED_FIX', returnCount, fixDeadline}
//                                              403 FORBIDDEN · 409 INVALID_STATE · 409 RETURN_LIMIT · 400 REASON_TOO_SHORT (ตรวจตามลำดับนี้)
//   POST /api/officer/cases/:caseNo/forward    ผู้ถือเรื่อง {note?} → 200 {status:'IN_REVIEW', step:2} | {status:'PENDING_APPROVAL'(, step:3)}
//                                              ปลายทางคำนวณจาก services.route เท่านั้น (ฟิลด์ปลายทางใน body ถูกละเลย · FR-15)
//   POST /api/cases/:caseNo/approve            SV-01 ผู้ถือเรื่อง (IN_REVIEW) · SV-02/03 head (PENDING_APPROVAL) → 200 {status:'APPROVED'}
//   POST /api/cases/:caseNo/reject             อำนาจเดียวกับ approve {reason} → 200 {status:'REJECTED', closedAt}
//   GET  /api/cases/:caseNo/files              200 {items:[{fileId,name,docKey,size,mime}]}
//   GET  /api/files/:fileId                    เนื้อไฟล์ · Content-Type ตามชนิดจริง (magic bytes)
//     สิทธิ์ไฟล์ (BR-29): citizen เจ้าของ (อื่น 404) · head ทุกแผนก · officer แผนกตนเองที่เป็นขั้นปัจจุบันหรือเคยผ่าน (อื่น 403)
//                        executive/auditor/admin 403 · ไม่ล็อกอิน 401
//   GET  /api/head/approvals                   head · {items:[{caseNo,serviceId,applicantName,dueAt,slaLevel,step}]} (เสริม)
//
// ปุ่มบนหน้า /officer/cases/:caseNo (ไม่ render เมื่อทำไม่ได้ · CONTRACT §0 ข้อ 5)
//   claim-btn   officer แผนกที่เรื่องอยู่ · SUBMITTED/IN_REVIEW ที่ไม่มีผู้ถือ → POST /api/officer/cases/:no/claim (P07)
//   return-btn  ผู้ถือเรื่อง IN_REVIEW และตีกลับ < 2 ครั้ง (B12: แสดงต่อ)
//   forward-btn + forward-note  ผู้ถือเรื่อง IN_REVIEW ที่มีขั้นถัดไปตามเส้นทางบริการ (ไม่มีช่องเลือกปลายทาง)
//   approve-btn / reject-btn    ตามอำนาจ (BR-21) · เจ้าหน้าที่ SV-02/03 ไม่มีทั้งสองปุ่ม
//   issue-btn   ctx.shared.documents.canIssue (P09 · A-27) → POST /api/officer/cases/:no/issue
//   show-full-id-btn → POST /api/officer/cases/:no/unmask (P07) แล้วแสดง full-id เฉพาะในหน้านั้น
//
// BUG_MODE: B07 (approve ของ SV-02/03 ไม่ตรวจว่าเป็น head) · B12 (ตีกลับครั้งที่ 3 ได้ + return-btn ยังแสดง)
//
// ctx.shared.workflow (ให้หน้าประชาชนของ P06 / โมดูลอื่นใช้)
//   fileAccess(user, caseRow) → 'ok' | 'FORBIDDEN' | 'NOT_FOUND'
//   listFiles(caseNo)         → [{fileId,name,docKey,size,mime}]
//   docItemsHtml(caseNo, {heading})  → บล็อก doc-item + doc-download-link (ไม่ตรวจสิทธิ์ — ผู้เรียกตรวจเอง)
//   stepText(caseRow)         → 'ขั้นตอน 2/3 · ฝ่ายโยธา' | null (เฉพาะ SV-03 · A-40)
//   actionsFor(user, caseRow) → {claim, ret, forward, approve, reject, issue}
//   reasonOk(s)               → เหตุผล ≥ 10 ตัวอักษรหลัง trim (BR-19 · A-44)

const MIN_REASON = 10; // BR-19 · A-12
const MAX_RETURNS = 2; // BR-19 · A-20
const NOTE_MAX = 500;
const REASON_MAX = 1000;
const FIX_WINDOW_HOURS = 168; // BR-20 (สำรองเมื่อไม่มี src/rules)

const STEP_TEXT = {
  1: 'ขั้นตอน 1/3 · ฝ่ายทะเบียน',
  2: 'ขั้นตอน 2/3 · ฝ่ายโยธา',
  3: 'ขั้นตอน 3/3 · หัวหน้าฝ่าย',
};
const NO_OWNER_TEXT = 'ยังไม่มีผู้รับ';

// ---------------------------------------------------------------------------
// helper บริสุทธิ์ (export ไว้ทดสอบ)
// ---------------------------------------------------------------------------

/** ทำความสะอาดข้อความจาก body: ไม่ใช่สตริง → '' · ตัดช่องว่างหัวท้าย · จำกัดความยาว */
function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  return Array.from(t).slice(0, max).join('');
}

/** BR-19 · A-44: เหตุผลต้อง ≥ 10 ตัวอักษร นับหลังตัดช่องว่างหัวท้าย (นับเป็น code point) */
function reasonOk(v) {
  return typeof v === 'string' && Array.from(v.trim()).length >= MIN_REASON;
}

/** ข้อความ case-step (A-40) · เฉพาะคำขอที่มี step (SV-03) */
function stepText(c) {
  if (!c || c.step === null || c.step === undefined) return null;
  return STEP_TEXT[c.step] || null;
}

/** ดัชนีขั้นปัจจุบันในเส้นทางบริการ (route = ['registry','works','head']) */
function stageIndex(c, route) {
  if (c.step !== null && c.step !== undefined && Number(c.step) >= 1) return Math.min(Number(c.step), route.length) - 1;
  const i = route.indexOf(c.dept);
  if (i >= 0) return i;
  return route.length - 1; // ปิด/ยกเลิกแล้ว (dept NULL) ของบริการที่ไม่มี step → ถือว่าผ่านทุกขั้น
}

/** แผนกที่เป็นขั้นปัจจุบันหรือเคยผ่าน (BR-29) */
function passedDepts(c, route) {
  return route.slice(0, stageIndex(c, route) + 1);
}

/** ขั้นถัดไปตามเส้นทาง (FR-15 · BR-21) → {index, dept} | null */
function nextStage(c, route) {
  const i = stageIndex(c, route);
  if (c.dept && route[i] !== c.dept) return null; // ข้อมูลไม่สอดคล้อง → ไม่ส่งต่อ
  if (i + 1 >= route.length) return null;
  return { index: i + 1, dept: route[i + 1] };
}

function isOwner(user, c) {
  return !!(user && c && user.role === 'officer' && c.owner && c.owner === user.username);
}

/**
 * งานของผู้ถือเรื่อง (ตีกลับ/ส่งต่อ/อนุมัติ SV-01) · A-28
 * → null (ทำได้) | 'FORBIDDEN' | 'INVALID_STATE'
 */
function holderError(user, c) {
  if (!user || user.role !== 'officer') return 'FORBIDDEN';
  if (isOwner(user, c)) return c.status === 'IN_REVIEW' ? null : 'INVALID_STATE';
  if (c.status === 'IN_REVIEW' || c.status === 'NEED_FIX') return 'FORBIDDEN'; // คนอื่นถือ / ยังไม่มีผู้ถือ (ต้องรับเรื่องก่อน)
  if (user.dept && c.dept === user.dept) return 'INVALID_STATE'; // แผนกเดียวกันแต่สถานะไม่ใช่ขั้นพิจารณา
  return 'FORBIDDEN';
}

/**
 * อำนาจอนุมัติ/ไม่อนุมัติ (FR-16 · BR-21)
 * approver 'officer' (SV-01) = ผู้ถือเรื่องที่ IN_REVIEW · approver 'head' (SV-02/03) = head ที่ PENDING_APPROVAL
 * skipAuthority (B07 · approve เท่านั้น) = ไม่ตรวจว่าเป็น head
 */
function decideError(user, c, approver, { skipAuthority = false } = {}) {
  if (!user) return 'FORBIDDEN';
  if (approver === 'head') {
    if (user.role !== 'head' && !(skipAuthority && user.role === 'officer')) return 'FORBIDDEN';
    return c.status === 'PENDING_APPROVAL' ? null : 'INVALID_STATE';
  }
  return holderError(user, c);
}

/** สิทธิ์ไฟล์แนบ (BR-29) → 'ok' | 'FORBIDDEN' | 'NOT_FOUND' */
function fileAccessFor(user, c, route) {
  if (!user) return 'FORBIDDEN';
  if (user.role === 'citizen') return c && c.citizen_id === user.id ? 'ok' : 'NOT_FOUND';
  if (!c) return user.role === 'officer' || user.role === 'head' ? 'NOT_FOUND' : 'FORBIDDEN';
  if (user.role === 'head') return 'ok';
  if (user.role === 'officer') return user.dept && passedDepts(c, route).includes(user.dept) ? 'ok' : 'FORBIDDEN';
  return 'FORBIDDEN';
}

/** ปุ่มที่ผู้ใช้ทำได้ (ใช้ render · ตรรกะเดียวกับ API) */
function actionFlags(user, c, { approver, route, b12 = false, canIssue = false }) {
  const claim = !!(
    user && user.role === 'officer' && user.dept && c.dept === user.dept && !c.owner &&
    (c.status === 'SUBMITTED' || c.status === 'IN_REVIEW')
  );
  const holderOk = holderError(user, c) === null;
  const ret = holderOk && ((c.return_count || 0) < MAX_RETURNS || b12);
  const forward = holderOk && approver !== undefined && !!nextStage(c, route);
  const decide = decideError(user, c, approver) === null;
  return { claim, ret, forward, approve: decide, reject: decide, issue: !!canIssue };
}

function humanSize(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} ไบต์`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / (1024 * 1024)).toFixed(2)} MB`;
}

/** Content-Disposition ที่รองรับชื่อไทย (RFC 6266/5987) */
function contentDisposition(type, name) {
  const fallback = String(name || 'file').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(String(name || 'file'))}`;
}

// ---------------------------------------------------------------------------
// โมดูล
// ---------------------------------------------------------------------------
function register(ctx) {
  const { app, db, auth, ui, errors, clock, bugs, catalog, labels, fmt } = ctx;
  const esc = ui.esc;

  const qCase = db.prepare('SELECT * FROM cases WHERE case_no = ?');
  const qUserById = db.prepare('SELECT id, username, name, role, dept, id_enc FROM users WHERE id = ?');
  const qStaffName = db.prepare('SELECT name FROM users WHERE username = ?');
  const qFilesOfCase = db.prepare('SELECT id, case_no, draft_id, doc_key, name, mime, size, storage, uploaded_at FROM files WHERE case_no = ? ORDER BY uploaded_at, id');
  const qFile = db.prepare('SELECT * FROM files WHERE id = ?');
  const qDraftOwner = db.prepare('SELECT citizen_id FROM drafts WHERE id = ?');
  const qMaxSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM returns WHERE case_no = ?');
  const insReturn = db.prepare(
    `INSERT INTO returns(case_no, seq, returned_at, returned_by, reason, fix_deadline)
     VALUES (@caseNo, @seq, @returnedAt, @returnedBy, @reason, @fixDeadline)`
  );
  const qPending = db.prepare(
    `SELECT c.*, u.name AS applicant_name FROM cases c JOIN users u ON u.id = c.citizen_id
      WHERE c.status = 'PENDING_APPROVAL' ORDER BY c.due_at ASC, c.case_no ASC`
  );

  // ---- helper ที่ผูก ctx ----
  const svcOf = (serviceId) => catalog.service(serviceId) || { id: serviceId, name: '', approver: 'officer', route: ['registry'] };
  const routeOf = (serviceId) => {
    const r = svcOf(serviceId).route;
    return Array.isArray(r) && r.length ? r : ['registry'];
  };
  const serviceLabel = (serviceId) => {
    const s = catalog.service(serviceId);
    return s ? `${s.id} ${s.name}` : String(serviceId);
  };
  const rulesLib = () => ctx.rules;
  const rulesFor = () => {
    const R = rulesLib();
    return R ? R.forContext(ctx) : null;
  };
  const fixDeadlineOf = (returnedAt) => {
    const r = rulesFor();
    return r ? r.fixDeadline(returnedAt) : ctx.time.iso(ctx.time.addHours(returnedAt, FIX_WINDOW_HOURS));
  };
  const docs = () => ctx.shared.documents || null;
  const fileAccess = (user, c) => fileAccessFor(user, c, c ? routeOf(c.service_id) : ['registry']);
  const fileJson = (f) => ({ fileId: f.id, name: f.name, docKey: f.doc_key, size: f.size, mime: f.mime });
  const listFiles = (caseNo) => qFilesOfCase.all(caseNo).map(fileJson);
  const staffName = (username) => {
    const r = username ? qStaffName.get(username) : null;
    return r ? r.name : null;
  };
  const getCaseOr404 = (caseNo) => {
    const c = qCase.get(String(caseNo || ''));
    if (!c) errors.fail('NOT_FOUND');
    return c;
  };

  function actionsFor(user, c) {
    const d = docs();
    let canIssue = false;
    try {
      canIssue = !!(d && typeof d.canIssue === 'function' && d.canIssue(user, c));
    } catch (_) {
      canIssue = false;
    }
    const svc = svcOf(c.service_id);
    return actionFlags(user, c, { approver: svc.approver, route: routeOf(c.service_id), b12: bugs.on('B12'), canIssue });
  }

  function docItemsHtml(caseNo, { heading = 'เอกสารแนบ', headingId = 'wf-files-h' } = {}) {
    const files = qFilesOfCase.all(caseNo);
    const items = files
      .map((f) => {
        const href = `/api/files/${encodeURIComponent(f.id)}`;
        return `<li${ui.attrs({ 'data-testid': 'doc-item', 'data-name': f.name, 'data-file-id': f.id, 'data-doc-key': f.doc_key })}>
<span class="wf-doc-kind">${esc(catalog.docName(f.doc_key))}</span>
<a${ui.attrs({ 'data-testid': 'doc-download-link', href, download: f.name })}>${esc(f.name)}</a>
<span class="muted">(${esc(humanSize(f.size))})</span>
</li>`;
      })
      .join('\n');
    return `<section class="card wf-files" aria-labelledby="${esc(headingId)}">
<h2 id="${esc(headingId)}">${esc(heading)}</h2>
${files.length ? `<ul class="wf-doc-list">\n${items}\n</ul>` : '<p class="muted">ไม่มีไฟล์แนบ</p>'}
</section>`;
  }

  ctx.shared.workflow = {
    MIN_REASON,
    MAX_RETURNS,
    reasonOk,
    stepText,
    fileAccess,
    listFiles,
    docItemsHtml,
    actionsFor,
    passedDepts: (c) => passedDepts(c, routeOf(c.service_id)),
  };

  // =========================================================================
  // API: ตีกลับ (FR-14 · BR-19 · BR-20 เวลาตีกลับ → fix_deadline)
  // =========================================================================
  app.post('/api/officer/cases/:caseNo/return', auth.api('officer', 'head'), (req, res) => {
    const user = req.user;
    const caseNo = req.params.caseNo;
    const raw = req.body && req.body.reason;
    const out = db.tx(() => {
      const c = getCaseOr404(caseNo);
      const e = holderError(user, c);
      if (e) errors.fail(e);
      if ((c.return_count || 0) >= MAX_RETURNS && !bugs.on('B12')) errors.fail('RETURN_LIMIT');
      if (!reasonOk(raw)) errors.fail('REASON_TOO_SHORT');
      const reason = cleanText(raw, REASON_MAX);
      const now = clock.nowIso();
      const count = (c.return_count || 0) + 1;
      const seq = Math.max(count, qMaxSeq.get(caseNo).m + 1);
      const fixDeadline = fixDeadlineOf(now);
      ctx.caseEvents.transition(caseNo, {
        from: 'IN_REVIEW',
        to: 'NEED_FIX',
        event: 'RETURN',
        actor: user,
        set: { return_count: count, returned_at: now, fix_deadline: fixDeadline },
        check: (row) => {
          if (!isOwner(user, row)) errors.fail('FORBIDDEN');
        },
        text: `ตีกลับให้แก้ไขเอกสาร (ครั้งที่ ${count})`,
        detail: reason,
        audit: true,
        auditDetail: reason,
        at: now,
      });
      insReturn.run({ caseNo, seq, returnedAt: now, returnedBy: user.username, reason, fixDeadline });
      return { count, fixDeadline };
    });
    res.status(200).json({ status: 'NEED_FIX', returnCount: out.count, fixDeadline: out.fixDeadline });
  });

  // =========================================================================
  // API: ส่งต่ออัตโนมัติตามเส้นทาง (FR-15 · BR-21) · ผู้ใช้เลือกปลายทางไม่ได้
  // =========================================================================
  app.post('/api/officer/cases/:caseNo/forward', auth.api('officer', 'head'), (req, res) => {
    const user = req.user;
    const caseNo = req.params.caseNo;
    const note = cleanText(req.body && req.body.note, NOTE_MAX);
    const out = db.tx(() => {
      const c = getCaseOr404(caseNo);
      const e = holderError(user, c);
      if (e) errors.fail(e);
      const next = nextStage(c, routeOf(c.service_id));
      if (!next) errors.fail('INVALID_STATE');
      const hasStep = c.step !== null && c.step !== undefined;
      const set = { dept: next.dept, owner: null };
      if (hasStep) set.step = next.index + 1;
      const toHead = next.dept === 'head';
      const to = toHead ? 'PENDING_APPROVAL' : 'IN_REVIEW';
      const deptTh = (labels.DEPT_TH && labels.DEPT_TH[next.dept]) || next.dept;
      ctx.caseEvents.transition(caseNo, {
        from: 'IN_REVIEW',
        to,
        event: 'FORWARD',
        actor: user,
        set,
        check: (row) => {
          if (!isOwner(user, row)) errors.fail('FORBIDDEN');
        },
        text: toHead ? `ส่งต่อ${deptTh}พิจารณาอนุมัติ` : `ส่งต่อไป${deptTh}`,
        detail: note || null,
        audit: true,
        auditDetail: note,
      });
      return { to, step: hasStep ? set.step : undefined };
    });
    const body = { status: out.to };
    if (out.step !== undefined) body.step = out.step;
    res.status(200).json(body);
  });

  // =========================================================================
  // API: อนุมัติ / ไม่อนุมัติ (FR-16 · BR-19 · BR-21 · A-28)
  // =========================================================================
  app.post('/api/cases/:caseNo/approve', auth.api('officer', 'head'), (req, res) => {
    const user = req.user;
    const caseNo = req.params.caseNo;
    db.tx(() => {
      const c = getCaseOr404(caseNo);
      const svc = svcOf(c.service_id);
      // B07: API ไม่ตรวจว่าผู้อนุมัติ SV-02/03 เป็นหัวหน้า (ปุ่มบนหน้ายังซ่อนตามสิทธิ์จริง)
      const e = decideError(user, c, svc.approver, { skipAuthority: bugs.on('B07') });
      if (e) errors.fail(e);
      const now = clock.nowIso();
      ctx.caseEvents.transition(caseNo, {
        from: svc.approver === 'head' ? 'PENDING_APPROVAL' : 'IN_REVIEW',
        to: 'APPROVED',
        event: 'APPROVE',
        actor: user,
        set: { approved_by: user.username, approved_at: now, dept: 'registry', owner: null, fix_deadline: null },
        text: `อนุมัติโดย ${user.name || user.username}`,
        audit: true,
        auditDetail: '',
        at: now,
      });
    });
    res.status(200).json({ status: 'APPROVED' });
  });

  app.post('/api/cases/:caseNo/reject', auth.api('officer', 'head'), (req, res) => {
    const user = req.user;
    const caseNo = req.params.caseNo;
    const raw = req.body && req.body.reason;
    const out = db.tx(() => {
      const c = getCaseOr404(caseNo);
      const svc = svcOf(c.service_id);
      const e = decideError(user, c, svc.approver);
      if (e) errors.fail(e);
      if (!reasonOk(raw)) errors.fail('REASON_TOO_SHORT');
      const reason = cleanText(raw, REASON_MAX);
      const now = clock.nowIso();
      ctx.caseEvents.transition(caseNo, {
        from: svc.approver === 'head' ? 'PENDING_APPROVAL' : 'IN_REVIEW',
        to: 'REJECTED',
        event: 'REJECT',
        actor: user,
        set: { closed_at: now, dept: null, owner: null, fix_deadline: null },
        text: `ไม่อนุมัติโดย ${user.name || user.username}`,
        detail: reason,
        audit: true,
        auditDetail: reason,
        at: now,
      });
      return { closedAt: now };
    });
    res.status(200).json({ status: 'REJECTED', closedAt: out.closedAt });
  });

  // =========================================================================
  // API: ไฟล์แนบ (FR-29 · BR-29)
  // =========================================================================
  const FILE_ROLES = ['citizen', 'officer', 'head'];

  app.get('/api/cases/:caseNo/files', auth.api(), (req, res) => {
    const user = req.user;
    if (!FILE_ROLES.includes(user.role)) errors.fail('FORBIDDEN');
    const c = qCase.get(String(req.params.caseNo || ''));
    if (!c) errors.fail('NOT_FOUND');
    const a = fileAccess(user, c);
    if (a !== 'ok') errors.fail(a);
    res.status(200).json({ caseNo: c.case_no, items: listFiles(c.case_no) });
  });

  app.get('/api/files/:fileId', auth.api(), (req, res) => {
    const user = req.user;
    if (!FILE_ROLES.includes(user.role)) errors.fail('FORBIDDEN');
    const f = qFile.get(String(req.params.fileId || ''));
    if (!f) errors.fail('NOT_FOUND');
    if (f.case_no) {
      const c = qCase.get(f.case_no);
      const a = fileAccess(user, c);
      if (a !== 'ok') errors.fail(a);
    } else {
      // ไฟล์ของร่าง (ยังไม่มีเลขคำขอ): เฉพาะประชาชนเจ้าของร่าง
      const d = f.draft_id ? qDraftOwner.get(f.draft_id) : null;
      if (!(user.role === 'citizen' && d && d.citizen_id === user.id)) errors.fail('NOT_FOUND');
    }
    let buf;
    try {
      buf = ctx.storage.read(f);
    } catch (_) {
      errors.fail('NOT_FOUND');
    }
    const t = ctx.storage.detectType(buf);
    res.status(200);
    res.set('Content-Type', t ? t.mime : f.mime || 'application/octet-stream');
    res.set('Content-Length', String(buf.length));
    res.set('Content-Disposition', contentDisposition('inline', f.name));
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'private, no-store');
    res.end(buf);
  });

  // =========================================================================
  // API: รายการรออนุมัติ (เสริมให้หน้า /head/approvals)
  // =========================================================================
  function pendingRows() {
    const R = rulesLib();
    const h = R ? R.forContext(ctx).holidays() : [];
    return qPending.all().map((c) => ({ c, level: R ? R.slaLevel(c, { holidays: h }) : null }));
  }

  app.get('/api/head/approvals', auth.api('head'), (req, res) => {
    const items = pendingRows().map(({ c, level }) => ({
      caseNo: c.case_no,
      serviceId: c.service_id,
      applicantName: c.applicant_name,
      status: c.status,
      step: c.step === undefined ? null : c.step,
      dueAt: c.due_at,
      slaLevel: level,
    }));
    res.status(200).json({ count: items.length, items });
  });

  // =========================================================================
  // หน้า /head/approvals (CONTRACT §2.8)
  // =========================================================================
  app.get('/head/approvals', auth.page('head'), (req, res) => {
    const rows = pendingRows();
    const trs = rows
      .map(({ c, level }) => {
        const step = stepText(c);
        return `<tr${ui.attrs({ 'data-testid': 'approval-row', 'data-case-no': c.case_no, 'data-service': c.service_id })}>
<td data-testid="row-case-no">${esc(c.case_no)}</td>
<td data-testid="row-service">${esc(serviceLabel(c.service_id))}${step ? `<br><span class="muted">${esc(step)}</span>` : ''}</td>
<td data-testid="row-applicant">${esc(c.applicant_name)}</td>
<td>${ui.time(c.due_at, { testid: 'row-due' })}</td>
<td>${level ? ui.slaBadge(level, { testid: 'row-sla-level' }) : esc(fmt.DASH)}</td>
<td><a class="btn btn-small btn-primary" data-testid="approval-open" href="/officer/cases/${encodeURIComponent(c.case_no)}">เปิดคำขอ</a></td>
</tr>`;
      })
      .join('\n');
    const table = rows.length
      ? `<div class="table-wrap">
<table class="tbl" data-testid="approval-table">
<caption>คำขอสถานะ "รออนุมัติ" เรียงตามกำหนดเสร็จ (เร็วสุดก่อน)</caption>
<thead><tr><th scope="col">เลขคำขอ</th><th scope="col">บริการ</th><th scope="col">ผู้ยื่น</th><th scope="col">กำหนดเสร็จ</th><th scope="col">ระดับเตือน</th><th scope="col">ดำเนินการ</th></tr></thead>
<tbody>
${trs}
</tbody>
</table>
</div>`
      : '<p class="msg msg-info" data-testid="approvals-empty">ไม่มีคำขอรออนุมัติ</p>';
    ui.send(req, res, {
      title: 'รออนุมัติ',
      styles: ['/static/workflow/workflow.css'],
      body: `<h1>รายการรออนุมัติ</h1>
<p>จำนวน <span data-testid="approval-count">${esc(rows.length)}</span> รายการ · หัวหน้าฝ่ายอนุมัติ/ไม่อนุมัติคำขอ SV-02 และ SV-03 ที่หน้ารายละเอียดคำขอ</p>
${table}`,
    });
  });

  // =========================================================================
  // หน้า /officer/cases/:caseNo (CONTRACT §2.6 ฝั่งเจ้าหน้าที่)
  // =========================================================================
  app.get('/officer/cases/:caseNo', auth.page('officer', 'head'), (req, res) => {
    const user = req.user;
    const c = qCase.get(String(req.params.caseNo || ''));
    if (!c) return ui.notFound(req, res);
    const svc = svcOf(c.service_id);
    const citizen = qUserById.get(c.citizen_id) || {};
    let masked = 'X-XXXX-XXXXX-XX-X';
    try {
      masked = fmt.maskId(auth.citizenIdNo(citizen) || '');
    } catch (_) {
      /* เลขถอดไม่ได้ → แสดงแบบปิดบังทั้งหมด */
    }
    const r = rulesFor();
    const level = r ? r.slaLevel(c) : null;
    const act = actionsFor(user, c);
    const step = stepText(c);
    const closed = c.status === 'COMPLETED' || c.status === 'REJECTED';
    const ownerName = c.owner ? staffName(c.owner) : null;
    const ownerText = c.owner || (c.status === 'SUBMITTED' || c.status === 'IN_REVIEW' ? NO_OWNER_TEXT : fmt.DASH);
    const enc = encodeURIComponent(c.case_no);

    let detailExtra = '';
    if (c.qty !== null && c.qty !== undefined && svc.feeType === 'per_copy') detailExtra += `<dt>จำนวน</dt><dd>${esc(c.qty)} ฉบับ</dd>`;
    if (c.area_sqm !== null && c.area_sqm !== undefined) detailExtra += `<dt>พื้นที่</dt><dd>${esc(c.area_sqm)} ตร.ม.</dd>`;

    // ---- สรุป ----
    const summary = `<section class="card" aria-labelledby="wf-sum-h">
<h2 id="wf-sum-h">ข้อมูลคำขอ</h2>
<dl class="kv">
<dt>สถานะ</dt><dd>${ui.statusBadge(c.status, { testid: 'case-status' })}</dd>
<dt>บริการ</dt><dd data-testid="case-service">${esc(serviceLabel(c.service_id))}</dd>
${step ? `<dt>ขั้นตอน</dt><dd data-testid="case-step">${esc(step)}</dd>` : ''}
${detailExtra}
<dt>ค่าธรรมเนียม</dt><dd>${ui.money(c.fee, { testid: 'case-fee' })}${c.receipt_no ? ` <span class="muted">ใบเสร็จ ${esc(c.receipt_no)}</span>` : ''}</dd>
<dt>ผู้ยื่น</dt><dd data-testid="applicant-name">${esc(citizen.name || '')}</dd>
<dt>เลขบัตรประชาชน</dt><dd><span data-testid="applicant-id">${esc(masked)}</span> <span id="wf-full-id-slot"></span></dd>
<dt>ชำระเมื่อ</dt><dd>${ui.time(c.paid_at, { testid: 'paid-at' })}</dd>
<dt>กำหนดเสร็จ</dt><dd>${ui.time(c.due_at, { testid: 'sla-due' })}</dd>
<dt>ระดับเตือน</dt><dd>${level ? ui.slaBadge(level, { testid: 'sla-level' }) : esc(fmt.DASH)}</dd>
${closed ? `<dt>ปิดงานเมื่อ</dt><dd>${ui.time(c.closed_at, { testid: 'closed-at' })}</dd>` : ''}
${c.status === 'CANCELLED' && c.cancelled_at ? `<dt>ยกเลิกเมื่อ</dt><dd>${ui.time(c.cancelled_at, { testid: 'cancelled-at' })}</dd>` : ''}
<dt>ผู้ถือเรื่อง</dt><dd><span data-testid="case-owner">${esc(ownerText)}</span>${ownerName ? ` <span class="muted">(${esc(ownerName)})</span>` : ''}</dd>
<dt>ตีกลับแล้ว</dt><dd><span data-testid="return-count">${esc(c.return_count || 0)}</span> ครั้ง <span class="muted">(สูงสุด ${MAX_RETURNS} ครั้ง)</span></dd>
${c.status === 'NEED_FIX' && c.fix_deadline ? `<dt>เส้นตายแก้ไขของประชาชน</dt><dd>${ui.time(c.fix_deadline, { testid: 'fix-deadline' })}</dd>` : ''}
</dl>
<div class="wf-unmask">
<button type="button" class="btn btn-small" data-testid="show-full-id-btn" aria-expanded="false" aria-controls="wf-unmask-form">แสดงเลขเต็ม</button>
<div id="wf-unmask-form" class="wf-form" hidden>
<div class="field">
<label for="wf-unmask-reason">เหตุผลที่ขอดูเลขบัตรประชาชนเต็ม (บันทึกใน Audit)</label>
<input id="wf-unmask-reason" name="reason" type="text" maxlength="200" data-testid="unmask-reason" aria-describedby="wf-unmask-error" autocomplete="off">
<p class="field-error" id="wf-unmask-error" data-testid="unmask-error" hidden></p>
</div>
<div class="actions"><button type="button" class="btn btn-primary" data-testid="unmask-submit">ยืนยันแสดงเลขเต็ม</button></div>
</div>
</div>
</section>`;

    // ---- ปุ่มดำเนินการ ----
    const parts = [];
    if (act.claim) {
      parts.push(`<div class="actions"><button type="button" class="btn btn-primary" data-testid="claim-btn" data-wf-action="claim">รับเรื่อง</button></div>`);
    }
    if (act.forward) {
      const next = nextStage(c, routeOf(c.service_id));
      const nextTh = next ? (next.dept === 'head' ? 'หัวหน้าฝ่าย (รออนุมัติ)' : (labels.DEPT_TH && labels.DEPT_TH[next.dept]) || next.dept) : '';
      parts.push(`<div class="wf-group">
<p class="hint">ส่งต่ออัตโนมัติตามเส้นทางของบริการ → <strong>${esc(nextTh)}</strong> (เลือกปลายทางเองไม่ได้)</p>
<div class="field">
<label for="wf-forward-note">หมายเหตุส่งต่อ (ไม่บังคับ)</label>
<textarea id="wf-forward-note" name="note" rows="2" maxlength="${NOTE_MAX}" data-testid="forward-note"></textarea>
</div>
<div class="actions"><button type="button" class="btn btn-primary" data-testid="forward-btn" data-wf-action="forward">ผ่าน/ส่งต่อ</button></div>
</div>`);
    }
    if (act.approve) {
      parts.push(`<div class="actions"><button type="button" class="btn btn-primary" data-testid="approve-btn" data-wf-action="approve">อนุมัติ</button></div>`);
    }
    if (act.ret) {
      parts.push(`<div class="wf-group">
<div class="actions"><button type="button" class="btn" data-testid="return-btn" aria-expanded="false" aria-controls="wf-return-form">ตีกลับ</button></div>
<div id="wf-return-form" class="wf-form" hidden>
<div class="field">
<label for="wf-return-reason">เหตุผลที่ตีกลับ (อย่างน้อย ${MIN_REASON} ตัวอักษร)</label>
<textarea id="wf-return-reason" name="reason" rows="3" maxlength="${REASON_MAX}" data-testid="return-reason" aria-describedby="wf-return-error"></textarea>
<p class="field-error" id="wf-return-error" data-testid="return-reason-error" hidden></p>
</div>
<div class="actions"><button type="button" class="btn btn-primary" data-testid="return-submit" data-wf-action="return">ยืนยันตีกลับ</button></div>
</div>
</div>`);
    }
    if (act.reject) {
      parts.push(`<div class="wf-group">
<div class="actions"><button type="button" class="btn btn-danger" data-testid="reject-btn" aria-expanded="false" aria-controls="wf-reject-form">ไม่อนุมัติ</button></div>
<div id="wf-reject-form" class="wf-form" hidden>
<div class="field">
<label for="wf-reject-reason">เหตุผลที่ไม่อนุมัติ (อย่างน้อย ${MIN_REASON} ตัวอักษร)</label>
<textarea id="wf-reject-reason" name="reason" rows="3" maxlength="${REASON_MAX}" data-testid="reject-reason" aria-describedby="wf-reject-error"></textarea>
<p class="field-error" id="wf-reject-error" data-testid="reject-reason-error" hidden></p>
</div>
<div class="actions"><button type="button" class="btn btn-danger" data-testid="reject-submit" data-wf-action="reject">ยืนยันไม่อนุมัติ</button></div>
</div>
</div>`);
    }
    if (act.issue) {
      parts.push(`<div class="actions"><button type="button" class="btn btn-primary" data-testid="issue-btn" data-wf-action="issue">ออกเอกสาร</button></div>`);
    }
    let note = '';
    if (!parts.length) {
      if (user.role === 'head' && c.status !== 'PENDING_APPROVAL') note = 'หัวหน้าฝ่ายดูได้อย่างเดียวในขั้นนี้ (อนุมัติ/ไม่อนุมัติเฉพาะคำขอ SV-02/SV-03 ที่รออนุมัติ)';
      else note = 'ไม่มีรายการที่คุณดำเนินการได้ในขั้นนี้';
    } else if (user.role === 'officer' && act.forward && !act.ret && (c.return_count || 0) >= MAX_RETURNS) {
      note = `ตีกลับครบ ${MAX_RETURNS} ครั้งแล้ว เจ้าหน้าที่ส่งต่อพร้อมหมายเหตุได้เท่านั้น ผู้ตัดสินไม่อนุมัติคือหัวหน้าฝ่าย`;
    } else if (act.ret === false && act.approve && (c.return_count || 0) >= MAX_RETURNS) {
      note = `ตีกลับครบ ${MAX_RETURNS} ครั้งแล้ว`;
    }
    const actions = `<section class="card" aria-labelledby="wf-act-h">
<h2 id="wf-act-h">ดำเนินการ</h2>
${note ? `<p class="muted">${esc(note)}</p>` : ''}
${parts.join('\n')}
</section>`;

    // ---- ไฟล์แนบ (BR-29) ----
    const files =
      fileAccess(user, c) === 'ok'
        ? docItemsHtml(c.case_no)
        : `<section class="card wf-files" aria-labelledby="wf-files-h"><h2 id="wf-files-h">เอกสารแนบ</h2>
<p class="muted">ไม่มีสิทธิ์เปิดไฟล์แนบของคำขอนี้ (เปิดได้เฉพาะแผนกที่เป็นขั้นปัจจุบันหรือเคยผ่าน)</p></section>`;

    // ---- เอกสารดิจิทัล (P09) ----
    let docPanel = '';
    try {
      const d = docs();
      if (d && typeof d.panelHtml === 'function') docPanel = d.panelHtml(req, c.case_no, { citizen: false }) || '';
    } catch (_) {
      docPanel = '';
    }

    // ---- ไทม์ไลน์ ----
    const tl = ctx.caseEvents.timeline(c.case_no);
    const tlItems = tl
      .map((t) => {
        const who = t.actorName ? ` · โดย ${t.actorName}` : '';
        return `<li${ui.attrs({ 'data-testid': 'timeline-item', 'data-iso': t.at, 'data-event': t.event, 'data-to-status': t.toStatus })}>
${ui.time(t.at)} · <span>${esc(t.text)}</span><span class="muted">${esc(who)}</span>${t.detail ? `<br><span class="wf-tl-detail">${esc(t.event === 'FORWARD' ? 'หมายเหตุ: ' : t.event === 'ISSUE' ? 'เลขเอกสาร: ' : 'เหตุผล: ')}${esc(t.detail)}</span>` : ''}
</li>`;
      })
      .join('\n');
    const timeline = `<section class="card" aria-labelledby="wf-tl-h">
<h2 id="wf-tl-h">ไทม์ไลน์</h2>
<ol class="wf-timeline" data-testid="case-timeline">
${tlItems}
</ol>
</section>`;

    ui.send(req, res, {
      title: `คำขอ ${c.case_no}`,
      styles: ['/static/workflow/workflow.css'],
      scripts: ['/static/workflow/workflow.js'],
      body: `<div class="wf-page"${ui.attrs({ 'data-wf-case': c.case_no, 'data-wf-enc': enc })}>
<p><a href="${user.role === 'head' ? '/head/approvals' : '/officer/queue'}">← ${user.role === 'head' ? 'กลับรายการรออนุมัติ' : 'กลับคิวงาน'}</a></p>
<h1>คำขอ <span data-testid="case-no">${esc(c.case_no)}</span></h1>
${ui.messages()}
<div class="wf-grid">
<div class="wf-col">
${summary}
${actions}
${docPanel}
</div>
<div class="wf-col">
${files}
${timeline}
</div>
</div>
</div>`,
    });
  });
}

module.exports = {
  name: 'workflow',
  order: 60,
  register,
  // export สำหรับ unit test
  MIN_REASON,
  MAX_RETURNS,
  STEP_TEXT,
  cleanText,
  reasonOk,
  stepText,
  stageIndex,
  passedDepts,
  nextStage,
  holderError,
  decideError,
  fileAccessFor,
  actionFlags,
  contentDisposition,
};

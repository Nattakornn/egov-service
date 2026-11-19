'use strict';
// P07 · คิวงาน + รับเรื่อง + PDPA (ปิดบัง/แสดงเลขเต็ม) + แจ้งเตือนกระดิ่ง
// FR-12 FR-13 FR-20 FR-21 · BR-15 BR-16 BR-17 BR-18 BR-24 · A-18 A-19 A-24 A-30 A-31 A-32 A-34
// (โมดูลนี้รวมส่วน notifications ไว้ด้วย → ไม่มีโฟลเดอร์ src/modules/notifications/)
//
// หน้า:  GET  /officer/queue                        officer (แผนกตัวเอง) · head (ทุกแผนก อ่านอย่างเดียว) · ?filter=all|unclaimed|mine
//        GET  /notifications                        officer · head (noti-item / noti-empty)
// API:   GET  /api/officer/queue?filter=…           {items:[{caseNo,serviceId,serviceName,applicantName,idMasked,status,step,dept,owner,dueAt,slaLevel,canClaim}]}
//                                                   ห้ามมี idNo / เลข 13 หลัก (BR-24) · เรียง due_at แล้ว case_no (BR-16)
//        POST /api/officer/cases/:caseNo/claim      officer แผนกที่เรื่องอยู่ → 200 {caseNo,status:'IN_REVIEW',owner}
//                                                   ลำดับตรวจ: สิทธิ์ (403) → ALREADY_CLAIMED (409) → WORKLOAD_LIMIT (409)
//                                                   UPDATE แบบมีเงื่อนไข (owner IS NULL) ใน transaction เดียวกับไทม์ไลน์ + Audit CLAIM
//        POST /api/officer/cases/:caseNo/unmask     officer (แผนกที่เรื่องอยู่/เคยผ่าน) · head → 200 {idNo,idFull} + Audit UNMASK
//                                                   เหตุผลว่าง (หลัง trim) → 400 REASON_REQUIRED (ไม่บันทึก)
//        GET  /api/notifications                    {items:[{id,caseNo,level,text,createdAt}]} ของผู้ใช้นั้นเท่านั้น
// hook:  onRequest(50) ประเมินแจ้งเตือนทุก request (A-30) · bellCount = จำนวนรายการทั้งหมดของผู้ใช้
// shared: ctx.shared.queue = { canClaim(user,row), workload(username), claim(user,caseNo), unmask(user,caseNo,reason),
//                              maskedIdOf(citizenId), canSeeCase(user,row), WORKLOAD_MAX }
//         ctx.shared.notifications = { evaluate(), countFor(username), listFor(username) }
// BUG_MODE: B08 claim ข้ามการตรวจผู้ถือ (คนที่ 2 ได้ 200 และเป็นผู้ถือแทน)
//           B09 GET /api/officer/queue ส่ง idNo เต็ม (บนจอยังปิดบัง)
//           B11 unmask สำเร็จแต่ไม่บันทึก Audit UNMASK

const WORKLOAD_MAX = 10; // BR-18
const QUEUE_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'APPROVED']; // A-34
const NOTI_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'PENDING_APPROVAL', 'APPROVED']; // NEED_FIX = หยุดนับ · ปิดแล้วไม่ประเมิน
const FILTERS = ['all', 'unclaimed', 'mine'];
const FILTER_TH = { all: 'ทั้งหมด', unclaimed: 'ยังไม่มีผู้รับ', mine: 'ของฉัน' };
const STEP_TEXT = { 1: 'ขั้นตอน 1/3 · ฝ่ายทะเบียน', 2: 'ขั้นตอน 2/3 · ฝ่ายโยธา', 3: 'ขั้นตอน 3/3 · หัวหน้าฝ่าย' };
const REASON_MAX = 500;

// สคริปต์หน้า /officer/queue (เสิร์ฟที่ /static/queue/queue.js) · กด claim-btn → เรียก API ด้วย fetch
// แล้วโหลดตารางใหม่แบบไม่เปลี่ยนหน้า (คงข้อความ action-error/action-success ไว้)
const QUEUE_JS = `(function () {
  'use strict';
  function swap(doc) {
    var cur = document.querySelector('[data-queue-area]');
    var fresh = doc.querySelector('[data-queue-area]');
    if (cur && fresh) cur.innerHTML = fresh.innerHTML;
    var a = document.querySelector('[data-testid="bell-count"]');
    var b = doc.querySelector('[data-testid="bell-count"]');
    if (a && b) a.textContent = b.textContent;
  }
  function refresh() {
    return fetch(window.location.href, { credentials: 'same-origin', headers: { Accept: 'text/html' } })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (html) { if (html) swap(new DOMParser().parseFromString(html, 'text/html')); })
      .catch(function () {});
  }
  document.addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('[data-testid="claim-btn"]') : null;
    if (!btn || btn.disabled) return;
    ev.preventDefault();
    var caseNo = btn.getAttribute('data-case');
    btn.disabled = true;
    window.EG.api('POST', '/api/officer/cases/' + encodeURIComponent(caseNo) + '/claim').then(function (r) {
      if (r.ok) window.EG.showSuccess('รับเรื่อง ' + caseNo + ' แล้ว');
      else window.EG.showError((r.data && r.data.message) || 'ทำรายการไม่สำเร็จ');
      return refresh();
    }).then(function () { btn.disabled = false; });
  });
})();
`;

module.exports = {
  name: 'queue',
  order: 50,
  register(ctx) {
    const { app, db, auth, ui, errors, fmt, clock, labels } = ctx;
    const esc = ui.esc;

    // ------------------------------------------------------------------ SQL
    const qCase = db.prepare('SELECT * FROM cases WHERE case_no = ?');
    const qCitizen = db.prepare('SELECT id, id_enc FROM users WHERE id = ?');
    const qWorkload = db.prepare("SELECT COUNT(*) AS n FROM cases WHERE status = 'IN_REVIEW' AND owner = ?");
    const qQueueBase = `
      SELECT c.case_no, c.service_id, c.status, c.step, c.dept, c.owner, c.issuer, c.due_at, c.citizen_id,
             s.name AS service_name, u.name AS applicant_name, u.id_enc AS applicant_id_enc
        FROM cases c
        JOIN services s ON s.id = c.service_id
        JOIN users u ON u.id = c.citizen_id
       WHERE c.status IN (${QUEUE_STATUSES.map((s) => `'${s}'`).join(',')})`;
    const qQueueDept = db.prepare(`${qQueueBase} AND c.dept = ? ORDER BY c.due_at ASC, c.case_no ASC`);
    const qQueueAll = db.prepare(`${qQueueBase} AND c.dept IN ('registry','works') ORDER BY c.due_at ASC, c.case_no ASC`);
    const qNotiCases = db.prepare(
      `SELECT case_no, service_id, status, dept, owner, issuer, approved_by, due_at
         FROM cases WHERE status IN (${NOTI_STATUSES.map((s) => `'${s}'`).join(',')})
        ORDER BY due_at ASC, case_no ASC`
    );
    const qHeads = db.prepare("SELECT username FROM users WHERE role = 'head' AND active = 1 ORDER BY username");
    const qDeptOfficers = db.prepare("SELECT username FROM users WHERE role = 'officer' AND dept = ? AND active = 1 ORDER BY username");
    const qStaffActive = db.prepare("SELECT 1 FROM users WHERE username = ? AND role IN ('officer','head') AND active = 1");
    const insNoti = db.prepare(
      'INSERT OR IGNORE INTO notifications(username, case_no, level, text, created_at) VALUES (?, ?, ?, ?, ?)'
    );
    const qNotiList = db.prepare(
      'SELECT id, case_no, level, text, created_at FROM notifications WHERE username = ? ORDER BY created_at DESC, id ASC'
    );
    const qNotiCount = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE username = ?');

    // ------------------------------------------------------------------ helpers
    const isStaffViewer = (u) => !!(u && (u.role === 'officer' || u.role === 'head'));

    function decId(idEnc) {
      if (!idEnc) return null;
      try {
        return ctx.crypto.dec(idEnc);
      } catch (_) {
        return null;
      }
    }

    function maskedIdOf(citizenId) {
      const r = qCitizen.get(citizenId);
      return fmt.maskId(r ? decId(r.id_enc) : '');
    }

    function workload(username) {
      return username ? qWorkload.get(username).n : 0;
    }

    /** รับเรื่องได้ไหม (ไม่รวมเพดานงานในมือ ซึ่งตรวจตอนกดเท่านั้น · BR-18) */
    function canClaim(user, row) {
      if (!user || user.role !== 'officer' || !user.dept || !row) return false;
      if (row.dept !== user.dept) return false;
      if (row.owner) return false;
      return row.status === 'SUBMITTED' || row.status === 'IN_REVIEW';
    }

    function routeOf(serviceId) {
      try {
        const s = ctx.catalog.service(serviceId);
        return (s && Array.isArray(s.route) && s.route) || [];
      } catch (_) {
        return [];
      }
    }

    /** เจ้าหน้าที่เห็นคำขอนี้ได้ไหม (แผนกที่เรื่องอยู่หรือเคยผ่าน · BR-29) · head ทุกแผนก */
    function canSeeCase(user, row) {
      if (!user || !row) return false;
      if (user.role === 'head') return true;
      if (user.role !== 'officer' || !user.dept) return false;
      if (row.dept === user.dept) return true;
      const route = routeOf(row.service_id);
      const idx = route.indexOf(user.dept);
      if (idx < 0) return false;
      if (idx === 0) return true; // ทุกบริการเริ่มที่แผนกแรกของเส้นทาง (ทะเบียน)
      return (Number(row.step) || 0) >= idx + 1; // SV-03 โยธา = ขั้น 2 ขึ้นไป
    }

    function issuerOf(row) {
      const sd = ctx.shared.documents;
      if (sd && typeof sd.issuerOf === 'function') {
        try {
          return sd.issuerOf(row);
        } catch (_) {
          /* fallback ด้านล่าง */
        }
      }
      if (row.service_id === 'SV-01') return row.approved_by || row.issuer || null;
      return row.issuer || null;
    }

    function slaLevelsFor(rows) {
      const rulesLib = ctx.rules;
      if (!rulesLib) return rows.map(() => null);
      const h = rulesLib.forContext(ctx).holidays();
      return rows.map((r) => rulesLib.slaLevel(r, { holidays: h }));
    }

    function normFilter(v) {
      const f = String(v || 'all').toLowerCase();
      return FILTERS.includes(f) ? f : 'all';
    }

    /** แถวคิวของผู้ใช้ (ข้อมูลภายใน · มีเลขบัตรเต็มเฉพาะใน memory สำหรับ mask) */
    function queueRows(user, filter) {
      let rows;
      if (user.role === 'head') rows = qQueueAll.all();
      else if (user.role === 'officer' && user.dept) rows = qQueueDept.all(user.dept);
      else rows = [];
      if (filter === 'unclaimed') rows = rows.filter((r) => (r.status === 'SUBMITTED' || r.status === 'IN_REVIEW') && !r.owner);
      else if (filter === 'mine') rows = rows.filter((r) => r.status === 'IN_REVIEW' && r.owner === user.username);
      const levels = slaLevelsFor(rows);
      return rows.map((r, i) => {
        const idNo = decId(r.applicant_id_enc);
        return {
          caseNo: r.case_no,
          serviceId: r.service_id,
          serviceName: r.service_name,
          applicantName: r.applicant_name,
          idMasked: fmt.maskId(idNo || ''),
          status: r.status,
          step: r.service_id === 'SV-03' && r.step ? Number(r.step) : null,
          dept: r.dept,
          owner: r.owner || null,
          dueAt: r.due_at,
          slaLevel: levels[i],
          canClaim: canClaim(user, r),
          _idNo: idNo, // ภายในเท่านั้น (ไม่ส่งออก ยกเว้น B09)
        };
      });
    }

    function queueJson(item) {
      const { _idNo, ...out } = item;
      if (ctx.bugs.on('B09') && _idNo) out.idNo = _idNo; // B09: API ส่งเลขบัตรเต็ม (หน้าจอยังปิดบัง)
      return out;
    }

    function cleanReason(v) {
      if (typeof v !== 'string') return '';
      let s = v.trim();
      if (s.length > REASON_MAX) s = s.slice(0, REASON_MAX);
      // PDPA: ไม่เก็บเลขบัตรเต็มใน Audit detail แม้ผู้ใช้พิมพ์มาในเหตุผล
      return s.replace(/\d-?\d{4}-?\d{5}-?\d{2}-?\d/g, '[เลขบัตร]');
    }

    // ------------------------------------------------------------------ claim (FR-13 · BR-17 · BR-18)
    function claim(user, caseNo) {
      return db.tx(() => {
        const row = qCase.get(caseNo);
        if (!row) errors.fail('NOT_FOUND');
        // 1) สิทธิ์: officer เท่านั้น (head อ่านอย่างเดียว) · ต้องเป็นแผนกที่เรื่องอยู่
        if (!user || user.role !== 'officer' || !user.dept) errors.fail('FORBIDDEN');
        if (row.dept !== user.dept) {
          if (row.dept === 'registry' || row.dept === 'works') errors.fail('FORBIDDEN'); // ข้ามแผนก
          errors.fail('INVALID_STATE'); // รออนุมัติ/ปิดแล้ว/ยกเลิก
        }
        const bug08 = ctx.bugs.on('B08');
        // 2) มีผู้ถือแล้ว (B08 ข้ามการตรวจนี้)
        if (row.owner && !bug08) errors.fail('ALREADY_CLAIMED');
        if (row.status !== 'SUBMITTED' && row.status !== 'IN_REVIEW') errors.fail('INVALID_STATE');
        // 3) เพดานงานในมือ (ตรวจเฉพาะตอนกดรับ)
        if (workload(user.username) >= WORKLOAD_MAX) errors.fail('WORKLOAD_LIMIT');
        // UPDATE แบบมีเงื่อนไข: ชนะได้คนเดียว
        const now = clock.nowIso();
        const info = db
          .prepare(
            `UPDATE cases
                SET status = 'IN_REVIEW', owner = @me,
                    issuer = CASE WHEN dept = 'registry' AND (issuer IS NULL OR issuer = '') THEN @me ELSE issuer END,
                    updated_at = @now
              WHERE case_no = @caseNo AND dept = @dept AND status IN ('SUBMITTED','IN_REVIEW')
                ${bug08 ? '' : 'AND owner IS NULL'}`
          )
          .run({ me: user.username, now, caseNo, dept: user.dept });
        if (info.changes !== 1) errors.fail('ALREADY_CLAIMED');
        ctx.caseEvents.record(caseNo, {
          event: 'CLAIM',
          from: row.status,
          to: 'IN_REVIEW',
          actor: user,
          text: `รับเรื่องโดย ${user.name || user.username}`,
          at: now,
        });
        ctx.audit.log({
          username: user.username,
          role: user.role,
          event: 'CLAIM',
          caseNo,
          fromStatus: row.status,
          toStatus: 'IN_REVIEW',
          detail: '',
          at: now,
        });
        return { caseNo, status: 'IN_REVIEW', owner: user.username };
      });
    }

    // ------------------------------------------------------------------ unmask (FR-21 · BR-24 · A-32)
    function unmask(user, caseNo, reasonRaw) {
      const row = qCase.get(caseNo);
      if (!row) errors.fail('NOT_FOUND');
      if (!isStaffViewer(user) || !canSeeCase(user, row)) errors.fail('FORBIDDEN');
      const reason = cleanReason(reasonRaw);
      if (!reason) errors.fail('REASON_REQUIRED');
      const c = qCitizen.get(row.citizen_id);
      const idNo = c ? decId(c.id_enc) : null;
      if (!idNo) errors.fail('NOT_FOUND');
      if (!ctx.bugs.on('B11')) {
        ctx.audit.log({
          username: user.username,
          role: user.role,
          event: 'UNMASK',
          caseNo,
          // ไม่เปลี่ยนสถานะ → audit-transition แสดง "–" (TEST-PLAN TC-AUDIT-01)
          fromStatus: null,
          toStatus: null,
          detail: reason,
        });
      }
      return { idNo, idFull: fmt.idFull(idNo) };
    }

    // ------------------------------------------------------------------ notifications (FR-20 · BR-15 · A-30 A-31)
    function evaluate() {
      const rulesLib = ctx.rules;
      if (!rulesLib) return 0;
      const rows = qNotiCases.all();
      if (!rows.length) return 0;
      const levels = slaLevelsFor(rows);
      const now = clock.nowIso();
      let heads = null;
      const deptCache = {};
      const headList = () => (heads = heads || qHeads.all().map((r) => r.username));
      const deptList = (d) => (deptCache[d] = deptCache[d] || qDeptOfficers.all(d).map((r) => r.username));
      let added = 0;
      db.tx(() => {
        rows.forEach((row, i) => {
          const level = levels[i];
          if (level !== 'near' && level !== 'overdue') return;
          const to = new Set();
          if (row.status === 'PENDING_APPROVAL') {
            headList().forEach((u) => to.add(u)); // ขั้นหัวหน้า
          } else if (row.status === 'APPROVED') {
            const iss = issuerOf(row); // ผู้ออกเอกสาร (A-27)
            if (iss && qStaffActive.get(iss)) to.add(iss);
          } else if (row.owner) {
            if (qStaffActive.get(row.owner)) to.add(row.owner); // ผู้ถือ
          } else if (row.dept === 'registry' || row.dept === 'works') {
            deptList(row.dept).forEach((u) => to.add(u)); // ไม่มีผู้ถือ → ทุกคนของแผนก
          }
          if (level === 'overdue') headList().forEach((u) => to.add(u)); // เกินกำหนดแจ้ง head เพิ่มเสมอ
          const text = `คำขอ ${row.case_no} ${labels.LEVEL_TH[level]}`;
          for (const u of to) added += insNoti.run(u, row.case_no, level, text, now).changes;
        });
      });
      return added;
    }

    const countFor = (username) => (username ? qNotiCount.get(username).n : 0);
    const listFor = (username) =>
      qNotiList.all(username).map((r) => ({ id: r.id, caseNo: r.case_no, level: r.level, text: r.text, createdAt: r.created_at }));

    ctx.hooks.onRequest(50, () => {
      evaluate();
    });
    ctx.hooks.bellCount((user) => (isStaffViewer(user) ? countFor(user.username) : 0));

    ctx.shared.queue = { WORKLOAD_MAX, canClaim, workload, claim, unmask, maskedIdOf, canSeeCase };
    ctx.shared.notifications = { evaluate, countFor, listFor };

    // ------------------------------------------------------------------ routes: static JS
    app.get('/static/queue/queue.js', (req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.type('application/javascript').send(QUEUE_JS);
    });

    // ------------------------------------------------------------------ routes: API
    app.get('/api/officer/queue', auth.api('officer', 'head'), (req, res) => {
      const filter = normFilter(req.query.filter);
      res.json({ items: queueRows(req.user, filter).map(queueJson) });
    });

    app.post('/api/officer/cases/:caseNo/claim', auth.api('officer', 'head'), (req, res) => {
      res.json(claim(req.user, req.params.caseNo));
    });

    app.post('/api/officer/cases/:caseNo/unmask', auth.api('officer', 'head'), (req, res) => {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const out = unmask(req.user, req.params.caseNo, body.reason);
      res.set('Cache-Control', 'no-store');
      res.json(out);
    });

    app.get('/api/notifications', auth.api('officer', 'head'), (req, res) => {
      res.json({ items: listFor(req.user.username) });
    });

    // ------------------------------------------------------------------ routes: pages
    app.get('/officer/queue', auth.page('officer', 'head'), (req, res) => {
      const user = req.user;
      const filter = normFilter(req.query.filter);
      const items = queueRows(user, filter);
      const isHead = user.role === 'head';
      const deptTh = (d) => (labels.DEPT_TH && labels.DEPT_TH[d]) || d || '';

      const rowsHtml = items
        .map((it) => {
          const stepHtml = it.step ? `<span class="muted queue-step">${esc(STEP_TEXT[it.step] || '')}</span>` : '';
          const claimHtml = it.canClaim
            ? `<button type="button" class="btn btn-primary btn-small" data-testid="claim-btn" data-case="${esc(it.caseNo)}">รับเรื่อง</button>`
            : '';
          return `<tr${ui.attrs({
            'data-testid': 'queue-row',
            'data-case-no': it.caseNo,
            'data-owner': it.owner || '',
            'data-status': it.status,
            'data-sla-level': it.slaLevel || '',
          })}>
<td><a data-testid="row-case-no" href="/officer/cases/${encodeURIComponent(it.caseNo)}">${esc(it.caseNo)}</a></td>
<td><span data-testid="row-service">${esc(`${it.serviceId} ${it.serviceName}`)}</span>${stepHtml ? `<br>${stepHtml}` : ''}</td>
${isHead ? `<td>${esc(deptTh(it.dept))}</td>` : ''}
<td data-testid="row-applicant">${esc(it.applicantName)}</td>
<td data-testid="row-id-masked">${esc(it.idMasked)}</td>
<td>${ui.statusBadge(it.status, { testid: 'row-status' })}</td>
<td>${ui.time(it.dueAt, { testid: 'row-due' })}</td>
<td>${it.slaLevel ? ui.slaBadge(it.slaLevel, { testid: 'row-sla-level' }) : ''}</td>
<td data-testid="row-owner">${esc(it.owner || '')}</td>
<td>${claimHtml}</td>
</tr>`;
        })
        .join('\n');

      const workloadHtml = isHead
        ? '<p class="msg msg-info">หัวหน้าฝ่ายดูคิวของทุกฝ่ายได้แบบอ่านอย่างเดียว (รับเรื่องไม่ได้)</p>'
        : `<p class="queue-workload">งานในมือของฉัน: <strong data-testid="workload-count">${esc(workload(user.username))}</strong> / ${WORKLOAD_MAX} เรื่อง</p>`;

      const title = isHead ? 'คิวงานทุกฝ่าย' : `คิวงาน${deptTh(user.dept)}`;
      const body = `<h1>${esc(title)}</h1>
${ui.messages()}
<form method="get" action="/officer/queue" class="row queue-filter-form">
${ui.select({
  id: 'queue-filter',
  name: 'filter',
  label: 'แสดงรายการ',
  testid: 'queue-filter',
  value: filter,
  options: FILTERS.map((f) => ({ value: f, label: FILTER_TH[f] })),
  selectAttrs: { onchange: 'this.form.submit()' },
})}
<noscript><button type="submit" class="btn btn-small">กรอง</button></noscript>
</form>
<div data-queue-area>
${workloadHtml}
<div class="table-wrap" role="region" aria-label="ตารางคิวงาน" tabindex="0" style="position:relative">
<table class="tbl" data-testid="queue-table">
<caption class="sr-only">คิวงาน เรียงตามกำหนดเสร็จเร็วสุดก่อน (เท่ากันเรียงเลขคำขอ)</caption>
<thead><tr>
<th scope="col">เลขคำขอ</th><th scope="col">บริการ</th>${isHead ? '<th scope="col">ฝ่าย</th>' : ''}<th scope="col">ผู้ยื่น</th><th scope="col">เลขบัตรประชาชน</th>
<th scope="col">สถานะ</th><th scope="col">กำหนดเสร็จ</th><th scope="col">ระดับเตือน</th><th scope="col">ผู้ถือเรื่อง</th><th scope="col">ดำเนินการ</th>
</tr></thead>
<tbody>
${rowsHtml}
</tbody>
</table>
</div>
${items.length ? '' : '<p class="muted" data-testid="queue-empty">ไม่มีงานในคิว</p>'}
</div>`;
      ui.send(req, res, { title: 'คิวงาน', body, scripts: ['/static/queue/queue.js'] });
    });

    app.get('/notifications', auth.page('officer', 'head'), (req, res) => {
      const items = listFor(req.user.username);
      const list = items.length
        ? `<ul class="stack noti-list">
${items
  .map(
    (n) => `<li${ui.attrs({ 'data-testid': 'noti-item', 'data-case-no': n.caseNo, 'data-level': n.level, class: `card noti noti-${n.level}` })}>
<a href="/officer/cases/${encodeURIComponent(n.caseNo)}">${esc(n.text)}</a>
<span class="muted"> · ${ui.time(n.createdAt)}</span>
</li>`
  )
  .join('\n')}
</ul>`
        : '<p class="muted" data-testid="noti-empty">ไม่มีแจ้งเตือน</p>';
      const body = `<h1>แจ้งเตือน</h1>
<p class="muted">แจ้งเมื่อคำขอเข้าระดับ "ใกล้ครบกำหนด" หรือ "เกินกำหนด" (ระดับละ 1 ครั้งต่อคำขอ)</p>
${list}`;
      ui.send(req, res, { title: 'แจ้งเตือน', body });
    });
  },
};

'use strict';
// P10 · Audit Trail (ส่วนอ่าน) + ผู้ดูแลระบบ
// FR-24 FR-25 FR-26 FR-27 · BR-11 BR-27 BR-28 · A-36 A-42 A-53 A-57 · CONTRACT §1 §2.10 §2.11 §5 §6.4 §6.5 §6.8 §7
//
// หมายเหตุ: โมดูลนี้ลงทะเบียนทั้ง /admin/* และ /audit (+ /api/audit*) ในไฟล์เดียว (ไม่มีโฟลเดอร์ audit แยก)
//
// ---- Audit (auditor) ----
// GET  /audit                                    หน้า Audit Trail (กรองด้วย query actor/event/from/to · server render)
// GET  /api/audit?actor=&event=&from=&to=        200 {count, items:[{id,time,username,role,event,caseNo,fromStatus,toStatus,detail}]} ใหม่ → เก่า
// GET  /api/audit/export.csv?...                 CSV UTF-8 (ตัวกรองเดียวกัน) + Audit EXPORT detail 'audit-csv' (บันทึกหลังสร้างไฟล์ · A-36)
// PUT/PATCH/DELETE /api/audit · /api/audit/:id   405 METHOD_NOT_ALLOWED ทุกบทบาท (ก่อน guard · แม้ :id ไม่มีจริง)
//   วันที่กรอง = วันที่ตามเวลาไทย (Asia/Bangkok) รวมวันเริ่มและวันจบ
//
// ---- Admin (admin) ----
// GET  /admin/services · /admin/holidays · /admin/users   หน้า
// GET  /api/admin/services                       200 {items:[{id,name,feeType,fee,feeBase,feePerSqm,sla}]}
// PUT  /api/admin/services/:id                   {fee,sla} · SV-03 {feeBase|fee, feePerSqm, sla} → 200 · 400 INVALID_FEE / INVALID_SLA
// GET  /api/admin/holidays                       200 {items:[{date,name}]}
// POST /api/admin/holidays                       {date,name} → 201 · 409 DUPLICATE_HOLIDAY · 400 BAD_REQUEST (วันที่ผิดรูปแบบ)
// DELETE /api/admin/holidays/:date               200 · 404 NOT_FOUND
// GET  /api/admin/users                          200 {items:[{username,name,role,dept}]}
// PUT  /api/admin/users/:username                {role,dept} → 200 · 409 SELF_ROLE_CHANGE · 404 NOT_FOUND · 400 BAD_REQUEST
//   ทุกการแก้ที่เปลี่ยนค่าจริงบันทึก ADMIN_CHANGE 1 แถวต่อค่าที่เปลี่ยน (CONTRACT §6.8) · คำขอที่ถูกปฏิเสธไม่บันทึก
//   ค่าธรรมเนียม/SLA อ่านจาก DB ทุกครั้งผ่าน ctx.catalog → มีผลกับร่างที่เข้า PENDING_PAYMENT หลังแก้ (ยอดเดิมถูกล็อกโดย P04/P05 · BR-11)
//   วันหยุดอ่านจาก DB ทุกครั้งผ่าน ctx.catalog → มีผลทันทีกับการคำนวณครั้งถัดไป (ไม่คำนวณกำหนดเสร็จเดิมใหม่ · A-42)

const ROLES = ['citizen', 'officer', 'head', 'executive', 'auditor', 'admin'];
const DEPTS = ['registry', 'works'];
const FEE_MIN = 0;
const FEE_MAX = 100000;
const SLA_MIN = 1;
const SLA_MAX = 60;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const EVENT_TH = {
  STAFF_LOGIN: 'เข้าสู่ระบบเจ้าหน้าที่',
  CLAIM: 'รับเรื่อง',
  RETURN: 'ตีกลับ',
  FORWARD: 'ส่งต่อ',
  APPROVE: 'อนุมัติ',
  REJECT: 'ไม่อนุมัติ',
  ISSUE: 'ออกเอกสาร',
  UNMASK: 'แสดงเลขบัตรเต็ม',
  EXPORT: 'ส่งออกไฟล์',
  ADMIN_CHANGE: 'ผู้ดูแลแก้ไขค่า',
};
const CSV_HEADER = ['time', 'username', 'role', 'event', 'caseNo', 'fromStatus', 'toStatus', 'detail'];
const ARROW = ' → ';

// ---------------------------------------------------------------------------
// helper บริสุทธิ์ (export ไว้ทดสอบ)
// ---------------------------------------------------------------------------

/** จำนวนเต็มจาก number หรือสตริงตัวเลขล้วน · อย่างอื่น → null */
function toInt(v) {
  if (typeof v === 'number') return Number.isSafeInteger(v) ? v : null;
  if (typeof v === 'string' && /^\s*-?\d{1,16}\s*$/.test(v)) {
    const n = parseInt(v, 10);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

function validFee(v) {
  const n = toInt(v);
  return n !== null && n >= FEE_MIN && n <= FEE_MAX ? n : null;
}

function validSla(v) {
  const n = toInt(v);
  return n !== null && n >= SLA_MIN && n <= SLA_MAX ? n : null;
}

/** 'YYYY-MM-DD' ที่มีอยู่จริงในปฏิทิน */
function isValidYmd(s) {
  if (typeof s !== 'string' || !YMD_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** วันที่ไทยของเวลาใน audit (เก็บเป็น ISO +07:00 → ตัด 10 ตัวแรก · รูปแบบอื่นแปลงผ่าน ctx.time) */
function thaiYmdOf(at, time) {
  const s = String(at || '');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?\+07:00$/.test(s)) return s.slice(0, 10);
  try {
    return time.ymd(s);
  } catch (_) {
    return s.slice(0, 10);
  }
}

/** ช่อง CSV: ครอบ "" เมื่อมี , " ขึ้นบรรทัด · กันสูตร spreadsheet (= + - @ tab) ด้วย ' นำหน้า */
function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(items) {
  const lines = [CSV_HEADER.join(',')];
  for (const it of items) {
    lines.push([it.time, it.username, it.role, it.event, it.caseNo, it.fromStatus, it.toStatus, it.detail].map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}

function transitionText(from, to, dash) {
  if (!from && !to) return dash;
  return `${from || dash}${ARROW}${to || dash}`;
}

// ---------------------------------------------------------------------------

module.exports = {
  name: 'admin',
  order: 90,
  _test: { toInt, validFee, validSla, isValidYmd, thaiYmdOf, csvCell, toCsv, transitionText },

  register(ctx) {
    const { app, db, auth, ui, errors, audit, clock, fmt, time, labels } = ctx;
    const esc = ui.esc;
    const DASH = fmt.DASH || '–';
    const ROLE_TH = (labels && labels.ROLE_TH) || {};
    const DEPT_TH = (labels && labels.DEPT_TH) || {};
    const EVENTS = audit.EVENTS;

    // =======================================================================
    // AUDIT
    // =======================================================================

    // 405 ก่อน guard ทุกบทบาท (รวมไม่ล็อกอิน/admin · :id ไม่มีจริง)
    const DENY = new Set(['PUT', 'PATCH', 'DELETE']);
    app.all(['/api/audit', '/api/audit/', '/api/audit/:id', '/api/audit/*'], (req, res, next) => {
      if (DENY.has(req.method)) {
        res.set('Allow', 'GET, HEAD');
        return errors.send(res, 'METHOD_NOT_ALLOWED');
      }
      return next();
    });

    /** อ่านตัวกรองจาก query · strict=true → ค่าผิดรูปแบบ throw BAD_REQUEST (API) · false → ข้าม (หน้าเว็บ) */
    function parseFilter(q, strict) {
      const one = (v) => (Array.isArray(v) ? v[0] : v);
      const str = (v) => (v === undefined || v === null ? '' : String(one(v)).trim());
      const f = { actor: str(q.actor), event: str(q.event), from: str(q.from), to: str(q.to) };
      if (f.event && !EVENTS.includes(f.event)) {
        if (strict) errors.fail('BAD_REQUEST', { field: 'event' });
        f.event = '';
      }
      for (const k of ['from', 'to']) {
        if (f[k] && !isValidYmd(f[k])) {
          if (strict) errors.fail('BAD_REQUEST', { field: k });
          f[k] = '';
        }
      }
      return f;
    }

    /** รายการ audit หลังกรอง เรียงใหม่ → เก่า (เวลาเท่ากัน id มาก → น้อย) */
    function queryAudit(f) {
      const where = [];
      const args = [];
      if (f.actor) {
        where.push('username = ?');
        args.push(f.actor);
      }
      if (f.event) {
        where.push('event = ?');
        args.push(f.event);
      }
      const sql = `SELECT * FROM audit ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY at DESC, id DESC`;
      let rows = db.prepare(sql).all(...args);
      if (f.from || f.to) {
        rows = rows.filter((r) => {
          const d = thaiYmdOf(r.at, time);
          if (f.from && d < f.from) return false;
          if (f.to && d > f.to) return false;
          return true;
        });
      }
      // เรียงซ้ำด้วยเวลาจริง (กันกรณีรูปแบบเวลาไม่สม่ำเสมอ) · tie → id มากก่อน
      rows.sort((a, b) => {
        const c = String(b.at).localeCompare(String(a.at));
        if (c !== 0 && /\+07:00$/.test(a.at) && /\+07:00$/.test(b.at)) return c;
        if (c !== 0) {
          const ta = Date.parse(a.at);
          const tb = Date.parse(b.at);
          if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return tb - ta;
        }
        return b.id - a.id;
      });
      return rows.map(audit.toJson);
    }

    function filterQs(f) {
      const p = new URLSearchParams();
      for (const k of ['actor', 'event', 'from', 'to']) if (f[k]) p.set(k, f[k]);
      const s = p.toString();
      return s ? '?' + s : '';
    }

    app.get('/api/audit', auth.api('auditor'), (req, res) => {
      const items = queryAudit(parseFilter(req.query, true));
      res.json({ count: items.length, items });
    });

    app.get('/api/audit/export.csv', auth.api('auditor'), (req, res) => {
      const items = queryAudit(parseFilter(req.query, true));
      const body = toCsv(items); // สร้างก่อนบันทึก EXPORT → จำนวนแถวเท่ากับหน้าจอ
      audit.logReq(req, { event: 'EXPORT', detail: 'audit-csv' });
      const stamp = String(clock.nowIso()).slice(0, 10);
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="audit-${stamp}.csv"`);
      res.set('Cache-Control', 'no-store');
      res.send(Buffer.from(body, 'utf8'));
    });

    app.get('/audit', auth.page('auditor'), (req, res) => {
      const f = parseFilter(req.query, false);
      const items = queryAudit(f);
      const eventOptions = [{ value: '', label: 'ทั้งหมด' }].concat(EVENTS.map((e) => ({ value: e, label: `${e} · ${EVENT_TH[e] || e}` })));
      const rowsHtml = items
        .map(
          (it) => `<tr${ui.attrs({ 'data-testid': 'audit-row', 'data-id': it.id, 'data-event': it.event, 'data-actor': it.username, 'data-case-no': it.caseNo || '' })}>
<td>${ui.time(it.time, { testid: 'audit-time' })}</td>
<td data-testid="audit-actor">${esc(it.username)}</td>
<td data-testid="audit-role">${esc(it.role)}</td>
<td data-testid="audit-event">${esc(it.event)}</td>
<td data-testid="audit-case-no">${esc(it.caseNo || DASH)}</td>
<td data-testid="audit-transition">${esc(transitionText(it.fromStatus, it.toStatus, DASH))}</td>
<td data-testid="audit-detail">${esc(it.detail || DASH)}</td>
</tr>`
        )
        .join('\n');
      const body = `<h1>Audit Trail</h1>
<p class="muted">ประวัติการทำรายการของเจ้าหน้าที่ (อ่านอย่างเดียว · แก้ไขหรือลบไม่ได้) · ช่วงวันที่นับตามเวลาไทย รวมวันเริ่มและวันจบ</p>
<form class="card" method="get" action="/audit" id="audit-filter-form" novalidate>
<div class="grid-2">
${ui.field({ id: 'audit-filter-actor', name: 'actor', label: 'ผู้ทำรายการ (username)', testid: 'audit-filter-actor', value: f.actor, inputAttrs: { autocomplete: 'off' } })}
${ui.select({ id: 'audit-filter-event', name: 'event', label: 'เหตุการณ์', testid: 'audit-filter-event', options: eventOptions, value: f.event })}
${ui.field({ id: 'audit-filter-from', name: 'from', label: 'ตั้งแต่วันที่', testid: 'audit-filter-from', type: 'date', value: f.from })}
${ui.field({ id: 'audit-filter-to', name: 'to', label: 'ถึงวันที่', testid: 'audit-filter-to', type: 'date', value: f.to })}
</div>
<div class="actions">
<button type="submit" class="btn btn-primary" data-testid="audit-apply-btn">ค้นหา</button>
<a class="btn" data-testid="audit-export-csv-btn" id="audit-export-csv-btn" href="/api/audit/export.csv${esc(filterQs(f))}" download>ส่งออก CSV</a>
</div>
</form>
${ui.messages()}
<p>จำนวนรายการ: <strong data-testid="audit-count">${items.length}</strong></p>
<div class="table-wrap">
<table class="tbl">
<caption class="sr-only">รายการ Audit เรียงจากใหม่ไปเก่า</caption>
<thead><tr><th scope="col">เวลา</th><th scope="col">ผู้ทำ</th><th scope="col">บทบาท</th><th scope="col">เหตุการณ์</th><th scope="col">เลขคำขอ</th><th scope="col">สถานะก่อน → หลัง</th><th scope="col">รายละเอียด</th></tr></thead>
<tbody>
${rowsHtml}
</tbody>
</table>
</div>
${items.length ? '' : '<p class="muted">ไม่พบรายการ</p>'}
<script>
document.addEventListener('DOMContentLoaded', function () {
  var btn = document.getElementById('audit-export-csv-btn');
  if (!btn) return;
  btn.addEventListener('click', function () {
    var p = new URLSearchParams();
    [['actor', 'audit-filter-actor'], ['event', 'audit-filter-event'], ['from', 'audit-filter-from'], ['to', 'audit-filter-to']].forEach(function (x) {
      var el = document.getElementById(x[1]);
      var v = el && el.value ? String(el.value).trim() : '';
      if (v) p.set(x[0], v);
    });
    var qs = p.toString();
    btn.setAttribute('href', '/api/audit/export.csv' + (qs ? '?' + qs : ''));
  });
});
</script>`;
      ui.send(req, res, { title: 'Audit Trail', body });
    });

    // =======================================================================
    // ADMIN · บริการ (FR-25 · BR-28)
    // =======================================================================

    function adminLog(req, detail) {
      audit.logReq(req, { event: 'ADMIN_CHANGE', detail });
    }

    function svcJson(s) {
      return {
        id: s.id,
        name: s.name,
        feeType: s.feeType,
        fee: s.fee,
        feeBase: s.feeType === 'area' ? s.fee : null,
        feePerSqm: s.feePerSqm === undefined ? null : s.feePerSqm,
        sla: s.sla,
      };
    }

    app.get('/api/admin/services', auth.api('admin'), (req, res) => {
      res.json({ items: ctx.catalog.services().map(svcJson) });
    });

    app.put('/api/admin/services/:id', auth.api('admin'), (req, res) => {
      const svc = ctx.catalog.service(req.params.id);
      if (!svc) return errors.send(res, 'NOT_FOUND');
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
      const isArea = svc.feeType === 'area';

      // ตรวจทุกค่าก่อน (ผิดค่าใดค่าหนึ่ง → ไม่เปลี่ยนอะไรเลย · ค่าธรรมเนียมก่อน SLA)
      const next = {};
      const feeKey = isArea && has('feeBase') ? 'feeBase' : has('fee') ? 'fee' : null;
      if (feeKey) {
        const v = validFee(b[feeKey]);
        if (v === null) return errors.send(res, 'INVALID_FEE');
        next.fee = v;
      }
      if (isArea && has('feePerSqm')) {
        const v = validFee(b.feePerSqm);
        if (v === null) return errors.send(res, 'INVALID_FEE');
        next.feePerSqm = v;
      }
      if (has('sla')) {
        const v = validSla(b.sla);
        if (v === null) return errors.send(res, 'INVALID_SLA');
        next.sla = v;
      }

      const changes = [];
      if (next.fee !== undefined && next.fee !== svc.fee) changes.push({ col: 'fee', key: 'fee', from: svc.fee, to: next.fee });
      if (next.feePerSqm !== undefined && next.feePerSqm !== svc.feePerSqm) {
        changes.push({ col: 'fee_per_sqm', key: 'feePerSqm', from: svc.feePerSqm, to: next.feePerSqm });
      }
      if (next.sla !== undefined && next.sla !== svc.sla) changes.push({ col: 'sla', key: 'sla', from: svc.sla, to: next.sla });

      if (changes.length) {
        const now = clock.nowIso();
        db.tx(() => {
          for (const c of changes) {
            db.prepare(`UPDATE services SET ${c.col} = ?, updated_at = ? WHERE id = ?`).run(c.to, now, svc.id);
            adminLog(req, `${svc.id} ${c.key} ${c.from === null || c.from === undefined ? DASH : c.from}${ARROW}${c.to}`);
          }
        });
      }
      const after = svcJson(ctx.catalog.service(svc.id));
      res.json({ ...after, changes: changes.map((c) => `${svc.id} ${c.key} ${c.from}${ARROW}${c.to}`) });
    });

    app.get('/admin/services', auth.page('admin'), (req, res) => {
      const services = ctx.catalog.services();
      const cards = services
        .map((s) => {
          const isArea = s.feeType === 'area';
          const feeLabel = s.feeType === 'per_copy' ? 'ค่าธรรมเนียม (บาทต่อฉบับ)' : isArea ? 'ค่าธรรมเนียมฐาน พื้นที่ 1–100 ตร.ม. (บาท)' : 'ค่าธรรมเนียม (บาท คงที่)';
          const num = { inputMode: 'numeric', step: '1', 'data-service-id': s.id };
          return `<section class="card"${ui.attrs({ 'data-testid': 'service-row', 'data-service-id': s.id })}>
<h2>${esc(s.id)} · ${esc(s.name)}</h2>
<form class="svc-form" novalidate${ui.attrs({ 'data-service-id': s.id, 'data-fee-type': s.feeType })}>
<div class="grid-2">
${ui.field({ id: `svc-fee-${s.id}`, name: 'fee', label: feeLabel, testid: `svc-fee-${s.id}`, type: 'number', value: s.fee, inputAttrs: num })}
${isArea ? ui.field({ id: `svc-fee-per-sqm-${s.id}`, name: 'feePerSqm', label: 'ค่าธรรมเนียมต่อ ตร.ม. ส่วนที่เกิน 100 ตร.ม. (บาท)', testid: `svc-fee-per-sqm-${s.id}`, type: 'number', value: s.feePerSqm, inputAttrs: num }) : ''}
${ui.field({ id: `svc-sla-${s.id}`, name: 'sla', label: 'SLA (วันทำการ)', testid: `svc-sla-${s.id}`, type: 'number', value: s.sla, inputAttrs: num })}
</div>
<div class="actions"><button type="submit" class="btn btn-primary"${ui.attrs({ 'data-testid': `svc-save-${s.id}` })}>บันทึก</button></div>
</form>
</section>`;
        })
        .join('\n');
      const body = `<h1>ตั้งค่าบริการ</h1>
<p class="muted">ค่าธรรมเนียมเป็นจำนวนเต็ม 0–100,000 บาท · SLA เป็นจำนวนเต็ม 1–60 วันทำการ · ค่าใหม่มีผลกับคำขอที่เข้าสถานะรอชำระหลังบันทึก (รายการรอชำระเดิมใช้ยอดที่ล็อกไว้)</p>
${ui.messages()}
${cards}
<script>
document.addEventListener('DOMContentLoaded', function () {
  function val(id) {
    var el = document.getElementById(id);
    if (!el) return undefined;
    var v = String(el.value).trim();
    return /^-?\\d+$/.test(v) ? Number(v) : v;
  }
  Array.prototype.forEach.call(document.querySelectorAll('form.svc-form'), function (form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var id = form.getAttribute('data-service-id');
      var area = form.getAttribute('data-fee-type') === 'area';
      var body = { sla: val('svc-sla-' + id) };
      if (area) { body.feeBase = val('svc-fee-' + id); body.feePerSqm = val('svc-fee-per-sqm-' + id); }
      else body.fee = val('svc-fee-' + id);
      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      EG.api('PUT', '/api/admin/services/' + encodeURIComponent(id), body).then(function (r) {
        btn.disabled = false;
        if (r.ok) {
          var d = r.data || {};
          var set = function (eid, v) { var el = document.getElementById(eid); if (el && v !== null && v !== undefined) el.value = v; };
          set('svc-fee-' + id, d.fee); set('svc-sla-' + id, d.sla); if (area) set('svc-fee-per-sqm-' + id, d.feePerSqm);
          EG.showSuccess('บันทึกการตั้งค่า ' + id + ' แล้ว');
        } else {
          EG.showError((r.data && r.data.message) || 'บันทึกไม่สำเร็จ');
        }
      });
    });
  });
});
</script>`;
      ui.send(req, res, { title: 'ตั้งค่าบริการ', body });
    });

    // =======================================================================
    // ADMIN · วันหยุด (FR-26)
    // =======================================================================

    function holidayList() {
      return db.prepare('SELECT date, name FROM holidays ORDER BY date').all();
    }

    app.get('/api/admin/holidays', auth.api('admin'), (req, res) => {
      res.json({ items: holidayList() });
    });

    app.post('/api/admin/holidays', auth.api('admin'), (req, res) => {
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const date = typeof b.date === 'string' ? b.date.trim() : '';
      if (!isValidYmd(date)) return errors.send(res, 'BAD_REQUEST', { field: 'date' });
      let name = typeof b.name === 'string' ? b.name.trim() : '';
      if (!name) name = 'วันหยุด';
      if (name.length > 200) name = name.slice(0, 200);
      const result = db.tx(() => {
        if (db.prepare('SELECT 1 FROM holidays WHERE date = ?').get(date)) return null;
        db.prepare('INSERT INTO holidays(date, name) VALUES (?, ?)').run(date, name);
        adminLog(req, `holiday add ${date}`);
        return { date, name };
      });
      if (!result) return errors.send(res, 'DUPLICATE_HOLIDAY');
      res.status(201).json({ ...result, items: holidayList() });
    });

    app.delete('/api/admin/holidays/:date', auth.api('admin'), (req, res) => {
      const date = String(req.params.date || '').trim();
      const ok = db.tx(() => {
        const info = db.prepare('DELETE FROM holidays WHERE date = ?').run(date);
        if (!info.changes) return false;
        adminLog(req, `holiday delete ${date}`);
        return true;
      });
      if (!ok) return errors.send(res, 'NOT_FOUND');
      res.json({ ok: true, date, items: holidayList() });
    });

    app.get('/admin/holidays', auth.page('admin'), (req, res) => {
      const rows = holidayList()
        .map(
          (h) => `<tr${ui.attrs({ 'data-testid': 'holiday-row', 'data-date': h.date })}>
<td>${ui.time(h.date, { dateOnly: true })}</td><td>${esc(h.date)}</td><td>${esc(h.name)}</td>
<td><button type="button" class="btn btn-danger btn-small"${ui.attrs({ 'data-testid': 'holiday-delete-btn', 'data-date': h.date, 'aria-label': `ลบวันหยุด ${h.date}` })}>ลบ</button></td>
</tr>`
        )
        .join('\n');
      const body = `<h1>จัดการวันหยุด</h1>
<p class="muted">วันทำการ = จันทร์–ศุกร์ที่ไม่อยู่ในตารางนี้ · เพิ่ม/ลบแล้วมีผลกับการคำนวณกำหนดเสร็จครั้งถัดไปทันที (คำขอที่ชำระแล้วไม่ถูกคำนวณใหม่)</p>
<form class="card" id="holiday-form" novalidate>
<div class="grid-2">
${ui.field({ id: 'holiday-date-input', name: 'date', label: 'วันที่ (YYYY-MM-DD)', testid: 'holiday-date-input', type: 'date' })}
${ui.field({ id: 'holiday-name-input', name: 'name', label: 'ชื่อวันหยุด', testid: 'holiday-name-input' })}
</div>
<div class="actions"><button type="submit" class="btn btn-primary" data-testid="holiday-add-btn">เพิ่มวันหยุด</button></div>
</form>
${ui.messages()}
<div class="table-wrap">
<table class="tbl">
<caption>วันหยุดราชการ</caption>
<thead><tr><th scope="col">วัน</th><th scope="col">วันที่ (ค.ศ.)</th><th scope="col">ชื่อ</th><th scope="col">จัดการ</th></tr></thead>
<tbody id="holiday-tbody">
${rows}
</tbody>
</table>
</div>
<script>
document.addEventListener('DOMContentLoaded', function () {
  var MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  function thaiDate(d) { var p = d.split('-'); return Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1] + ' ' + (Number(p[0]) + 543); }
  var tbody = document.getElementById('holiday-tbody');
  function render(items) {
    tbody.textContent = '';
    items.forEach(function (h) {
      var tr = document.createElement('tr');
      tr.setAttribute('data-testid', 'holiday-row'); tr.setAttribute('data-date', h.date);
      var t = document.createElement('time'); t.setAttribute('data-iso', h.date); t.setAttribute('datetime', h.date); t.textContent = thaiDate(h.date);
      var c1 = document.createElement('td'); c1.appendChild(t);
      var c2 = document.createElement('td'); c2.textContent = h.date;
      var c3 = document.createElement('td'); c3.textContent = h.name;
      var c4 = document.createElement('td');
      var b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-danger btn-small';
      b.setAttribute('data-testid', 'holiday-delete-btn'); b.setAttribute('data-date', h.date); b.setAttribute('aria-label', 'ลบวันหยุด ' + h.date); b.textContent = 'ลบ';
      c4.appendChild(b);
      tr.appendChild(c1); tr.appendChild(c2); tr.appendChild(c3); tr.appendChild(c4);
      tbody.appendChild(tr);
    });
  }
  document.getElementById('holiday-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var date = document.getElementById('holiday-date-input').value.trim();
    var name = document.getElementById('holiday-name-input').value.trim();
    EG.api('POST', '/api/admin/holidays', { date: date, name: name }).then(function (r) {
      if (r.ok) { render(r.data.items || []); EG.showSuccess('เพิ่มวันหยุด ' + date + ' แล้ว'); document.getElementById('holiday-name-input').value = ''; }
      else EG.showError((r.data && r.data.message) || 'เพิ่มวันหยุดไม่สำเร็จ');
    });
  });
  tbody.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-testid="holiday-delete-btn"]');
    if (!b) return;
    var date = b.getAttribute('data-date');
    b.disabled = true;
    EG.api('DELETE', '/api/admin/holidays/' + encodeURIComponent(date)).then(function (r) {
      if (r.ok) { render(r.data.items || []); EG.showSuccess('ลบวันหยุด ' + date + ' แล้ว'); }
      else { b.disabled = false; EG.showError((r.data && r.data.message) || 'ลบวันหยุดไม่สำเร็จ'); }
    });
  });
});
</script>`;
      ui.send(req, res, { title: 'จัดการวันหยุด', body });
    });

    // =======================================================================
    // ADMIN · ผู้ใช้/บทบาท (FR-27)
    // =======================================================================

    function userList() {
      return db
        .prepare(`SELECT username, name, role, dept FROM users ORDER BY CASE role WHEN 'citizen' THEN 1 ELSE 0 END, id`)
        .all()
        .map((u) => ({ username: u.username, name: u.name, role: u.role, dept: u.dept || '' }));
    }

    app.get('/api/admin/users', auth.api('admin'), (req, res) => {
      res.json({ items: userList() });
    });

    app.put('/api/admin/users/:username', auth.api('admin'), (req, res) => {
      const username = String(req.params.username || '');
      if (username === req.user.username) return errors.send(res, 'SELF_ROLE_CHANGE');
      const user = db.prepare('SELECT id, username, role, dept FROM users WHERE username = ?').get(username);
      if (!user) return errors.send(res, 'NOT_FOUND');
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
      let role = user.role;
      let dept = user.dept || null;
      if (has('role')) {
        if (!ROLES.includes(b.role)) return errors.send(res, 'BAD_REQUEST', { field: 'role' });
        role = b.role;
      }
      if (has('dept')) {
        const d = b.dept === null || b.dept === undefined ? '' : String(b.dept).trim();
        if (d && !DEPTS.includes(d)) return errors.send(res, 'BAD_REQUEST', { field: 'dept' });
        dept = d || null;
      }
      const changes = [];
      if (role !== user.role) changes.push(`${user.username} role ${user.role}${ARROW}${role}`);
      if ((dept || null) !== (user.dept || null)) changes.push(`${user.username} dept ${user.dept || DASH}${ARROW}${dept || DASH}`);
      if (changes.length) {
        db.tx(() => {
          db.prepare('UPDATE users SET role = ?, dept = ?, updated_at = ? WHERE id = ?').run(role, dept, clock.nowIso(), user.id);
          for (const d of changes) adminLog(req, d);
        });
      }
      // มีผลกับการล็อกอินครั้งถัดไป (session เดิมเก็บบทบาท ณ ตอนล็อกอิน)
      res.json({ username: user.username, role, dept: dept || '', changes });
    });

    app.get('/admin/users', auth.page('admin'), (req, res) => {
      const roleOpts = ROLES.map((r) => ({ value: r, label: `${r} · ${ROLE_TH[r] || r}` }));
      const deptOpts = [{ value: '', label: 'ไม่มี' }].concat(DEPTS.map((d) => ({ value: d, label: `${d} · ${DEPT_TH[d] || d}` })));
      const opt = (list, value) =>
        list.map((o) => `<option${ui.attrs({ value: o.value, selected: String(o.value) === String(value || '') })}>${esc(o.label)}</option>`).join('');
      const self = req.user.username;
      const rows = userList()
        .map((u, i) => {
          const rid = `u${i + 1}`;
          return `<tr${ui.attrs({ 'data-testid': 'user-row', 'data-username': u.username })}>
<th scope="row">${esc(u.username)}${u.username === self ? ' <span class="muted">(คุณ)</span>' : ''}</th>
<td>${esc(u.name)}</td>
<td><label class="sr-only" for="role-${rid}">บทบาทของ ${esc(u.username)}</label><select${ui.attrs({ id: `role-${rid}`, 'data-testid': 'user-role-select', 'data-username': u.username })}>${opt(roleOpts, u.role)}</select></td>
<td><label class="sr-only" for="dept-${rid}">แผนกของ ${esc(u.username)}</label><select${ui.attrs({ id: `dept-${rid}`, 'data-testid': 'user-dept-select', 'data-username': u.username })}>${opt(deptOpts, u.dept)}</select></td>
<td><button type="button" class="btn btn-primary btn-small"${ui.attrs({ 'data-testid': 'user-save-btn', 'data-username': u.username, 'aria-label': `บันทึก ${u.username}` })}>บันทึก</button></td>
</tr>`;
        })
        .join('\n');
      const body = `<h1>จัดการผู้ใช้และบทบาท</h1>
<p class="muted">การเปลี่ยนบทบาท/แผนกมีผลเมื่อผู้ใช้นั้นเข้าสู่ระบบครั้งถัดไป · ผู้ดูแลระบบเปลี่ยนบทบาทของตัวเองไม่ได้</p>
${ui.messages()}
<div class="table-wrap">
<table class="tbl">
<caption class="sr-only">ผู้ใช้ทั้งหมด</caption>
<thead><tr><th scope="col">username</th><th scope="col">ชื่อ</th><th scope="col">บทบาท</th><th scope="col">แผนก</th><th scope="col">จัดการ</th></tr></thead>
<tbody id="user-tbody">
${rows}
</tbody>
</table>
</div>
<script>
document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('user-tbody').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-testid="user-save-btn"]');
    if (!b) return;
    var tr = b.closest('tr');
    var username = b.getAttribute('data-username');
    var role = tr.querySelector('[data-testid="user-role-select"]').value;
    var dept = tr.querySelector('[data-testid="user-dept-select"]').value;
    b.disabled = true;
    EG.api('PUT', '/api/admin/users/' + encodeURIComponent(username), { role: role, dept: dept }).then(function (r) {
      b.disabled = false;
      if (r.ok) EG.showSuccess('บันทึกบทบาทของ ' + username + ' แล้ว');
      else EG.showError((r.data && r.data.message) || 'บันทึกไม่สำเร็จ');
    });
  });
});
</script>`;
      ui.send(req, res, { title: 'จัดการผู้ใช้', body });
    });
  },
};

'use strict';
// เปลี่ยนสถานะคำขอ + เขียนไทม์ไลน์ (+ Audit ถ้าขอ) ใน transaction เดียว
//
// ctx.caseEvents.transition(caseNo, {
//   from: 'SUBMITTED' | ['IN_REVIEW', ...],   // สถานะที่ยอมรับ (ไม่ตรง → AppError 409 INVALID_STATE) · ไม่ส่ง = ไม่ตรวจ
//   to: 'IN_REVIEW',                          // สถานะใหม่ (เท่าเดิมได้ เช่น ส่งต่อ SV-03 ทะเบียน→โยธา)
//   event: 'CLAIM',                           // รหัสเหตุการณ์ไทม์ไลน์ (labels.TIMELINE_TH)
//   actor: req.user | {username,name,role} | null (ระบบ),
//   set: { owner: 'off.reg2', issuer: 'off.reg2' },   // คอลัมน์อื่นของ cases ที่ต้องแก้พร้อมกัน
//   check: (row) => { if (row.owner) ctx.errors.fail('ALREADY_CLAIMED') },  // ตรวจเพิ่มภายใน transaction ก่อนแก้
//   text, detail,                             // ข้อความไทม์ไลน์ (ไม่ส่ง = ค่าตั้งต้น) · detail = เหตุผล/หมายเหตุ
//   audit: true | 'CLAIM' | false,            // true = เขียน Audit ด้วย event เดียวกัน (ต้องเป็น 1 ใน 10 เหตุการณ์)
//   auditDetail,                              // detail ของ Audit (ไม่ส่ง = detail)
//   at,                                       // เวลา (ไม่ส่ง = clock.now())
// })  → { caseNo, from, to, row }   (row = แถว cases หลังแก้)
//
// ctx.caseEvents.note(caseNo, { event, actor, text, detail, at })   → เพิ่มไทม์ไลน์โดยไม่เปลี่ยนสถานะ
// ctx.caseEvents.record(caseNo, { event, from, to, actor, text, detail, at })  → เขียนไทม์ไลน์ดิบ (เช่น คำขอใหม่: event 'PAID', from null, to 'SUBMITTED')
// ctx.caseEvents.timeline(caseNo)  → [{id, at, event, fromStatus, toStatus, actor, actorName, actorRole, text, detail}] เก่า → ใหม่
// ctx.caseEvents.get(caseNo)       → แถว cases หรือ undefined
const { AppError } = require('./errors');
const { TIMELINE_TH } = require('./labels');
const time = require('./time');

function createCaseEvents(db, clock, audit) {
  const caseCols = new Set(db.prepare("SELECT name FROM pragma_table_info('cases')").all().map((r) => r.name));
  const getStmt = db.prepare('SELECT * FROM cases WHERE case_no = ?');
  const insTl = db.prepare(
    `INSERT INTO case_timeline(case_no, at, event, from_status, to_status, actor, actor_name, actor_role, text, detail)
     VALUES (@caseNo, @at, @event, @from, @to, @actor, @actorName, @actorRole, @text, @detail)`
  );
  const tlStmt = db.prepare('SELECT * FROM case_timeline WHERE case_no = ? ORDER BY at ASC, id ASC');

  function actorOf(actor) {
    if (!actor) return { actor: null, actorName: 'ระบบ', actorRole: 'system' };
    return { actor: actor.username || null, actorName: actor.name || actor.username || null, actorRole: actor.role || null };
  }

  function addTimeline(caseNo, { event, from = null, to = null, actor = null, text, detail = null, at }) {
    const a = actorOf(actor);
    const row = {
      caseNo,
      at: at ? time.iso(at) : clock.nowIso(),
      event,
      from,
      to,
      ...a,
      text: text || TIMELINE_TH[event] || event,
      detail: detail === undefined ? null : detail,
    };
    insTl.run(row);
    return row;
  }

  function transition(caseNo, opts) {
    const { from, to, event, actor = null, set = {}, check, text, detail = null, audit: auditOpt = false, auditDetail, at } = opts || {};
    if (!to || !event) throw new Error('caseEvents.transition: to/event required');
    return db.tx(() => {
      const row = getStmt.get(caseNo);
      if (!row) throw new AppError('NOT_FOUND');
      const allowed = from === undefined || from === null ? null : Array.isArray(from) ? from : [from];
      if (allowed && !allowed.includes(row.status)) throw new AppError('INVALID_STATE');
      if (typeof check === 'function') check(row);
      const when = at ? time.iso(at) : clock.nowIso();
      const fields = { ...set, status: to, updated_at: when };
      const keys = Object.keys(fields);
      for (const k of keys) {
        if (!caseCols.has(k)) throw new Error('caseEvents.transition: unknown column ' + k);
      }
      const sql = `UPDATE cases SET ${keys.map((k) => `"${k}" = @${k}`).join(', ')} WHERE case_no = @__caseNo AND status = @__status`;
      const params = { __caseNo: caseNo, __status: row.status };
      for (const k of keys) params[k] = fields[k] === undefined ? null : fields[k];
      const info = db.prepare(sql).run(params);
      if (info.changes !== 1) throw new AppError('INVALID_STATE');
      addTimeline(caseNo, { event, from: row.status, to, actor, text, detail, at: when });
      if (auditOpt) {
        const ev = auditOpt === true ? event : auditOpt;
        audit.log({
          username: actor && actor.username,
          role: actor && actor.role,
          event: ev,
          caseNo,
          fromStatus: row.status,
          toStatus: to,
          detail: auditDetail !== undefined ? auditDetail : detail || '',
          at: when,
        });
      }
      return { caseNo, from: row.status, to, row: getStmt.get(caseNo) };
    });
  }

  function note(caseNo, { event = 'NOTE', actor = null, text, detail = null, at } = {}) {
    const row = getStmt.get(caseNo);
    if (!row) throw new AppError('NOT_FOUND');
    return addTimeline(caseNo, { event, from: row.status, to: row.status, actor, text, detail, at });
  }

  function timeline(caseNo) {
    return tlStmt.all(caseNo).map((r) => ({
      id: r.id,
      at: r.at,
      event: r.event,
      fromStatus: r.from_status,
      toStatus: r.to_status,
      actor: r.actor,
      actorName: r.actor_name,
      actorRole: r.actor_role,
      text: r.text,
      detail: r.detail,
    }));
  }

  return { transition, note, record: addTimeline, timeline, get: (caseNo) => getStmt.get(caseNo) };
}

module.exports = { createCaseEvents };

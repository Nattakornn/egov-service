'use strict';
// BR-27 ส่วนเขียน: Audit Trail เพิ่มได้อย่างเดียว (ตารางมี trigger กัน UPDATE/DELETE)
// ใช้: ctx.audit.log({ username, role, event, caseNo, fromStatus, toStatus, detail })
//      ctx.audit.logReq(req, { event: 'CLAIM', caseNo, fromStatus, toStatus, detail })   // ดึง username/role จาก req.user
//      ctx.audit.toJson(row)  → {id,time,username,role,event,caseNo,fromStatus,toStatus,detail} (CONTRACT §6.4)
// เวลา = ctx.clock.nowIso() เสมอ · detail ตาม CONTRACT §6.8 · ห้ามใส่เลขบัตร/เบอร์เต็มใน detail

const EVENTS = ['STAFF_LOGIN', 'CLAIM', 'RETURN', 'FORWARD', 'APPROVE', 'REJECT', 'ISSUE', 'UNMASK', 'EXPORT', 'ADMIN_CHANGE'];

function createAudit(db, clock) {
  const ins = db.prepare(
    `INSERT INTO audit(at, username, role, event, case_no, from_status, to_status, detail)
     VALUES (@at, @username, @role, @event, @caseNo, @fromStatus, @toStatus, @detail)`
  );
  function log({ username, role, event, caseNo = null, fromStatus = null, toStatus = null, detail = '', at = null }) {
    if (!EVENTS.includes(event)) throw new Error('audit.log: unknown event ' + event);
    if (!username || !role) throw new Error('audit.log: username/role required');
    const row = {
      at: at || clock.nowIso(),
      username: String(username),
      role: String(role),
      event,
      caseNo: caseNo || null,
      fromStatus: fromStatus || null,
      toStatus: toStatus || null,
      detail: detail === null || detail === undefined ? '' : String(detail),
    };
    const info = ins.run(row);
    return { id: Number(info.lastInsertRowid), ...row };
  }
  function logReq(req, entry) {
    const u = (req && req.user) || {};
    return log({ username: u.username, role: u.role, ...entry });
  }
  return { EVENTS, log, logReq, toJson: auditRowToJson };
}

/** แปลงแถวตาราง audit → JSON ตาม CONTRACT §6.4 */
function auditRowToJson(r) {
  return {
    id: r.id,
    time: r.at,
    username: r.username,
    role: r.role,
    event: r.event,
    caseNo: r.case_no,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    detail: r.detail,
  };
}

module.exports = { createAudit, auditRowToJson, EVENTS };

'use strict';
// เลขรันทุกชนิด (ตาราง counters) · ทำใน transaction เดียวกับการสร้างรายการเพื่อกันเลขซ้ำ (BR-09 · NFR-07)
// ใช้: ctx.ids.caseNo(paidAt)   → 'EG-2569-000031' (ปี พ.ศ. ของเวลาชำระ · เริ่ม 000001 ทุกปี)
//      ctx.ids.receiptNo(paidAt) → 'RC-2569-000031'
//      ctx.ids.docNo(issuedAt)   → 'DOC-2569-000002'
//      ctx.ids.draftId()         → 'DR-0003'
//      ctx.ids.paymentRef()      → 'PP-0002'
//      ctx.ids.fileId()          → 'F-000051'
//      ctx.ids.citizenUsername() → 'cit-0005'
//      ctx.ids.verifyCode(exists) → 'K7M2Q9XA' แบบสุ่ม [A-Z0-9]{8} ไม่ซ้ำ (exists(code) → true ถ้ามีแล้ว)
const nodeCrypto = require('crypto');
const time = require('./time');

function createIds(db) {
  const bump = db.prepare(
    'INSERT INTO counters(name, value) VALUES(?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value'
  );
  const peekStmt = db.prepare('SELECT value FROM counters WHERE name = ?');

  /** เพิ่มตัวนับแล้วคืนค่าใหม่ (เริ่ม 1) */
  function next(name) {
    return bump.get(name).value;
  }
  /** ค่าปัจจุบัน (ยังไม่เคยใช้ = 0) */
  function peek(name) {
    const r = peekStmt.get(name);
    return r ? r.value : 0;
  }
  const p = (n, w) => String(n).padStart(w, '0');

  return {
    next,
    peek,
    caseNo(at) {
      const be = time.beYear(at);
      return `EG-${be}-${p(next('case:' + be), 6)}`;
    },
    receiptNo(at) {
      const be = time.beYear(at);
      return `RC-${be}-${p(next('receipt:' + be), 6)}`;
    },
    docNo(at) {
      const be = time.beYear(at);
      return `DOC-${be}-${p(next('doc:' + be), 6)}`;
    },
    draftId() {
      return `DR-${p(next('draft'), 4)}`;
    },
    paymentRef() {
      return `PP-${p(next('payment'), 4)}`;
    },
    fileId() {
      return `F-${p(next('file'), 6)}`;
    },
    citizenUsername() {
      return `cit-${p(next('citizen'), 4)}`;
    },
    verifyCode(exists = () => false) {
      const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      for (let i = 0; i < 100; i++) {
        const bytes = nodeCrypto.randomBytes(8);
        let s = '';
        for (const b of bytes) s += A[b % A.length];
        if (!exists(s)) return s;
      }
      throw new Error('ids.verifyCode: cannot generate unique code');
    },
  };
}

module.exports = { createIds };

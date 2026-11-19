'use strict';
// ลายเซ็นจำลองของเอกสารดิจิทัล (CONTRACT §3 · A-22)
// HMAC-SHA256 ของ docNo|caseNo|applicant|serviceId|issuedAt|validUntil|signer (ต่อกันด้วย '|' ตามลำดับนี้) ด้วยคีย์ทดสอบ
// รูปแบบค่า: issuedAt = ISO +07:00 ('2026-11-05T10:00:00+07:00') · validUntil = 'YYYY-MM-DD' (วันสุดท้ายที่ใช้ได้)
//            applicant = ชื่อ-สกุลเต็ม · signer = ชื่อแสดงของผู้ลงนาม (เช่น 'เจ้าหน้าที่ทะเบียน 1')
// ใช้: const sig = ctx.sign.signDoc({docNo, caseNo, applicant, serviceId, issuedAt, validUntil, signer})
//      ctx.sign.verifyDoc(rowFromDocumentsTable)  → true/false (tamper = แก้ฟิลด์โดยไม่คำนวณใหม่ → false)
const nodeCrypto = require('crypto');

const FIELDS = ['docNo', 'caseNo', 'applicant', 'serviceId', 'issuedAt', 'validUntil', 'signer'];

function createSign({ signKey }) {
  const key = String(signKey || 'egov-eservice-test-sign-key-A22');

  function hmac(canonical) {
    return nodeCrypto.createHmac('sha256', key).update(String(canonical), 'utf8').digest('hex');
  }

  /** แปลง row ของตาราง documents (snake_case) หรือ object camelCase → ฟิลด์ลายเซ็น */
  function fieldsOf(x) {
    return {
      docNo: x.docNo ?? x.doc_no,
      caseNo: x.caseNo ?? x.case_no,
      applicant: x.applicant,
      serviceId: x.serviceId ?? x.service_id,
      issuedAt: x.issuedAt ?? x.issued_at,
      validUntil: x.validUntil ?? x.valid_until,
      signer: x.signer,
    };
  }

  function docCanonical(x) {
    const f = fieldsOf(x);
    for (const k of FIELDS) {
      if (f[k] === undefined || f[k] === null) throw new Error('sign.docCanonical: missing field ' + k);
    }
    return FIELDS.map((k) => String(f[k])).join('|');
  }

  function signDoc(x) {
    return hmac(docCanonical(x));
  }

  function verifyDoc(row) {
    if (!row || !row.signature) return false;
    let expected;
    try {
      expected = signDoc(row);
    } catch (_) {
      return false;
    }
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(String(row.signature), 'utf8');
    return a.length === b.length && nodeCrypto.timingSafeEqual(a, b);
  }

  return { FIELDS, hmac, docCanonical, signDoc, verifyDoc, fieldsOf };
}

module.exports = { createSign, FIELDS };

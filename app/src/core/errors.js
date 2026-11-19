'use strict';
// แคตตาล็อกข้อผิดพลาดตาม CONTRACT §5 (ข้อความตรงตัวอักษร) · รูปแบบ JSON {"code","message", ...extra}
// ใช้: ctx.errors.fail('ALREADY_CLAIMED')  → throw AppError (409, ข้อความตามสัญญา) แล้ว error handler กลางตอบ JSON ให้
//      ctx.errors.fail('OTP_INVALID', { attemptsLeft: 2 })
//      ctx.errors.fail('MISSING_DOCS', { missing: ['แบบแปลน','โฉนด'] }, 'ยังขาดเอกสาร: แบบแปลน, โฉนด')
//      ctx.errors.send(res, 'NOT_FOUND')   → ตอบทันทีไม่ throw

const CATALOG = {
  // auth
  INVALID_ID: [400, 'เลขบัตรประชาชนไม่ถูกต้อง'],
  OTP_INVALID: [401, 'รหัส OTP ไม่ถูกต้อง'],
  LOCKED: [423, 'ผิดเกินกำหนด เลขบัตรนี้ถูกล็อก 15 นาที'],
  INVALID_CREDENTIALS: [401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'],
  INVALID_MOBILE: [400, 'เบอร์มือถือต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0'],
  CONSENT_REQUIRED: [400, 'กรุณายินยอมการประมวลผลข้อมูลส่วนบุคคล (PDPA)'],
  // ค่าธรรมเนียม
  INVALID_QTY: [400, 'จำนวนฉบับต้อง 1–5 ฉบับ'],
  INVALID_AREA: [400, 'กรุณาระบุพื้นที่ 1–500 ตร.ม.'],
  AREA_TOO_LARGE: [400, 'พื้นที่เกิน 500 ตร.ม. กรุณายื่นที่สำนักงาน'],
  // ไฟล์
  FILE_TOO_LARGE: [400, 'ไฟล์ใหญ่เกิน 5 MB'],
  FILE_TYPE: [400, 'รองรับเฉพาะไฟล์ PDF, JPG, PNG'],
  FILE_COUNT: [400, 'แนบได้สูงสุด 5 ไฟล์ต่อคำขอ'],
  PLAN_NOT_PDF: [400, 'แบบแปลนต้องเป็นไฟล์ PDF เท่านั้น'],
  MISSING_DOCS: [409, 'ยังขาดเอกสาร'],
  // ชำระเงิน
  QR_EXPIRED: [410, 'QR หมดอายุ กรุณาสร้าง QR ใหม่'],
  AMOUNT_MISMATCH: [422, 'ยอดเงินไม่ตรงกับค่าธรรมเนียม'],
  // คำขอ / งาน
  NOT_FOUND: [404, 'ไม่พบคำขอ'],
  CANNOT_CANCEL: [409, 'ยกเลิกไม่ได้ คำขอมีเจ้าหน้าที่รับเรื่องแล้ว'],
  FIX_WINDOW_EXPIRED: [409, 'หมดเวลาแก้ไขแล้ว คำขอถูกยกเลิก'],
  ALREADY_CLAIMED: [409, 'มีเจ้าหน้าที่รับเรื่องนี้แล้ว'],
  WORKLOAD_LIMIT: [409, 'รับงานได้สูงสุด 10 เรื่อง'],
  RETURN_LIMIT: [409, 'ตีกลับได้สูงสุด 2 ครั้ง'],
  REASON_TOO_SHORT: [400, 'กรุณากรอกเหตุผลอย่างน้อย 10 ตัวอักษร'],
  REASON_REQUIRED: [400, 'กรุณากรอกเหตุผล'],
  INVALID_STATE: [409, 'สถานะคำขอไม่ถูกต้องสำหรับรายการนี้'],
  // สิทธิ์
  FORBIDDEN: [403, 'ไม่มีสิทธิ์ทำรายการนี้'],
  UNAUTHENTICATED: [401, 'กรุณาเข้าสู่ระบบ'],
  // ผู้ดูแล
  INVALID_FEE: [400, 'ค่าธรรมเนียมต้องเป็นจำนวนเต็ม 0–100,000 บาท'],
  INVALID_SLA: [400, 'SLA ต้องเป็นจำนวนเต็ม 1–60 วันทำการ'],
  DUPLICATE_HOLIDAY: [409, 'มีวันหยุดนี้อยู่แล้ว'],
  SELF_ROLE_CHANGE: [409, 'ไม่สามารถเปลี่ยนบทบาทของตัวเองได้'],
  METHOD_NOT_ALLOWED: [405, 'Method Not Allowed'],
  // test hook / ทั่วไป
  INVALID_TIME: [400, 'รูปแบบเวลาไม่ถูกต้อง ต้องเป็น ISO 8601 พร้อม offset เช่น 2026-12-01T09:00:00+07:00'],
  BAD_REQUEST: [400, 'ข้อมูลที่ส่งมาไม่ถูกต้อง'],
  PAYLOAD_TOO_LARGE: [413, 'ข้อมูลที่ส่งมามีขนาดใหญ่เกินไป'],
  ROUTE_NOT_FOUND: [404, 'Not Found'],
  INTERNAL: [500, 'เกิดข้อผิดพลาดภายในระบบ'],
};

// ข้อความหน้าเว็บ (ไม่ใช่ API)
const PAGE_TEXT = {
  FORBIDDEN_PAGE: 'ไม่มีสิทธิ์เข้าถึงหน้านี้',
  NOT_FOUND_CASE: 'ไม่พบคำขอ',
  NOT_FOUND_PAGE: 'ไม่พบหน้าที่ต้องการ',
};

class AppError extends Error {
  /**
   * @param {string} code รหัสใน CATALOG (หรือรหัสใหม่ + status)
   * @param {object} [extra] ฟิลด์เพิ่มใน JSON เช่น {attemptsLeft:2}
   * @param {string} [message] ทับข้อความมาตรฐาน (เช่น MISSING_DOCS)
   * @param {number} [status] ทับ HTTP status
   */
  constructor(code, extra, message, status) {
    const def = CATALOG[code] || [status || 400, message || code];
    super(message || def[1]);
    this.name = 'AppError';
    this.code = code;
    this.status = status || def[0];
    this.extra = extra || undefined;
  }

  toJSON() {
    return { code: this.code, message: this.message, ...(this.extra || {}) };
  }
}

function fail(code, extra, message, status) {
  throw new AppError(code, extra, message, status);
}

function send(res, code, extra, message, status) {
  const e = new AppError(code, extra, message, status);
  return res.status(e.status).json(e.toJSON());
}

function message(code) {
  return (CATALOG[code] || [])[1];
}

function status(code) {
  return (CATALOG[code] || [])[0];
}

module.exports = { CATALOG, PAGE_TEXT, AppError, fail, send, message, status };

'use strict';
// NFR-10 รูปแบบแสดงผล: วันที่ '4 ธ.ค. 2569 16:30' (พ.ศ. ย่อ) · เงิน '฿1,010' · เลขบัตร · ปิดบังชื่อ
// ทุกฟังก์ชันรับ Date | ISO string | 'YYYY-MM-DD' และคิดเป็นเวลาไทย (+07:00)
const time = require('./time');

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const DASH = '–'; // en dash U+2013 (CONTRACT: ค่าว่างของทันกำหนด % / fee-total ที่ไม่ถูกต้อง)

/** '฿1,010' (จำนวนเต็มบาท) · null/undefined/NaN → '–' */
function money(n) {
  if (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))) return DASH;
  const v = Math.round(Number(n));
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (v < 0 ? '-฿' : '฿') + s;
}

/** '4 ธ.ค. 2569 16:30' */
function dateTime(x) {
  if (x === null || x === undefined || x === '') return DASH;
  const p = time.parts(x);
  return `${p.d} ${TH_MONTHS[p.m - 1]} ${p.y + 543} ${time.pad(p.hh)}:${time.pad(p.mi)}`;
}

/** '2 ก.พ. 2570' (รับ 'YYYY-MM-DD' ได้) */
function date(x) {
  if (x === null || x === undefined || x === '') return DASH;
  const p = time.parts(x);
  return `${p.d} ${TH_MONTHS[p.m - 1]} ${p.y + 543}`;
}

/** '16:30' */
function hhmm(x) {
  return time.hhmm(x);
}

/** ISO +07:00 สำหรับ data-iso และ API */
function iso(x) {
  if (x === null || x === undefined || x === '') return null;
  return time.iso(x);
}

/** '85.7%' · null → '–' (ห้ามแสดง NaN/0% เมื่อปิดงาน 0) */
function pct(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return DASH;
  return Number(v).toFixed(1) + '%';
}

/** เลขบัตรเต็มแบบมีขีด '1-1017-00123-45-6' (ประชาชนเห็นของตัวเอง) */
function idFull(id) {
  const s = String(id || '').replace(/\D/g, '');
  if (s.length !== 13) return String(id || '');
  return `${s[0]}-${s.slice(1, 5)}-${s.slice(5, 10)}-${s.slice(10, 12)}-${s[12]}`;
}

/** เลขบัตรปิดบัง 'X-XXXX-XXXXX-45-6' (BR-24: เห็น 3 หลักท้าย) */
function maskId(id) {
  const s = String(id || '').replace(/\D/g, '');
  if (s.length !== 13) return 'X-XXXX-XXXXX-XX-X';
  return `X-XXXX-XXXXX-${s.slice(10, 12)}-${s[12]}`;
}

/** ชื่อปิดบัง (BR-23 · A-54): 'สมชาย ใจดี' → 'สมชาย ใ***' · ไม่มีนามสกุล → 'สมชาย ***' */
function maskName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '***';
  if (parts.length === 1) return `${parts[0]} ***`;
  const first = parts[0];
  const surname = parts.slice(1).join(' ');
  return `${first} ${Array.from(surname)[0]}***`;
}

/** escape HTML (ใช้กับทุกค่าที่มาจากผู้ใช้/DB ก่อนใส่ใน HTML) */
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { TH_MONTHS, DASH, money, dateTime, date, hhmm, iso, pct, idFull, maskId, maskName, esc };

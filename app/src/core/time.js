'use strict';
// เวลา Asia/Bangkok (+07:00 ตายตัว ไม่มี DST) · ไม่อ่านเวลาเครื่อง (ใช้ clock.now() เป็นอินพุตเสมอ)
// รูปแบบเวลาที่เก็บใน DB และส่งใน API: 'YYYY-MM-DDTHH:MM:SS+07:00' (iso()) → เทียบแบบ string ได้ถูกต้อง

const OFFSET_MS = 7 * 3600 * 1000;
const ISO_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/;
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** แปลง Date | ISO string | epoch ms | 'YYYY-MM-DD' (= 00:00 เวลาไทย) → Date */
function toDate(x) {
  if (x instanceof Date) return new Date(x.getTime());
  if (typeof x === 'number') return new Date(x);
  if (typeof x === 'string') {
    const s = x.trim();
    if (ISO_WITH_OFFSET.test(s)) return new Date(s);
    const m = LOCAL_RE.exec(s);
    if (m) return fromParts(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d;
  }
  throw new TypeError('time.toDate: ค่าเวลาไม่ถูกต้อง: ' + String(x));
}

/** ส่วนประกอบเวลาไทย: {y,m,d,hh,mi,ss,ms,dow} (m = 1–12, dow 0=อาทิตย์) */
function parts(x) {
  const t = new Date(toDate(x).getTime() + OFFSET_MS);
  return {
    y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(),
    hh: t.getUTCHours(), mi: t.getUTCMinutes(), ss: t.getUTCSeconds(), ms: t.getUTCMilliseconds(),
    dow: t.getUTCDay(),
  };
}

/** เวลาไทย (ปี ค.ศ.) → Date */
function fromParts(y, m, d, hh = 0, mi = 0, ss = 0, ms = 0) {
  return new Date(Date.UTC(y, m - 1, d, hh, mi, ss, ms) - OFFSET_MS);
}

/** Date → '2026-12-04T16:30:00+07:00' (ตัดมิลลิวินาที) */
function iso(x) {
  const p = parts(x);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mi)}:${pad(p.ss)}+07:00`;
}

/** วันที่ไทย 'YYYY-MM-DD' */
function ymd(x) {
  const p = parts(x);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** 'HH:MM' เวลาไทย */
function hhmm(x) {
  const p = parts(x);
  return `${pad(p.hh)}:${pad(p.mi)}`;
}

/** 'YYYY-MM' เวลาไทย */
function ym(x) {
  const p = parts(x);
  return `${p.y}-${pad(p.m)}`;
}

/** parse ISO ที่ "ต้องมี offset" (Z หรือ ±HH:MM) → Date | null (ใช้กับ PUT /api/test/clock) */
function parseIsoStrict(s) {
  if (typeof s !== 'string') return null;
  const m = ISO_WITH_OFFSET.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, sec] = m;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +h > 23 || +mi > 59 || (sec !== undefined && +sec > 59)) return null;
  const date = new Date(s.trim());
  if (Number.isNaN(date.getTime())) return null;
  // ตรวจว่าวันที่มีจริง (เช่น 2026-02-30 ไม่มี)
  const off = m[8] === 'Z' ? 0 : (m[8][0] === '-' ? -1 : 1) * ((+m[8].slice(1, 3)) * 60 + (+m[8].slice(4, 6)));
  const local = new Date(date.getTime() + off * 60000);
  if (local.getUTCFullYear() !== +y || local.getUTCMonth() + 1 !== +mo || local.getUTCDate() !== +d) return null;
  return date;
}

/** วันที่ 'YYYY-MM-DD' (ปฏิทิน) ± n วัน */
function addDaysYmd(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** วันในสัปดาห์ของ 'YYYY-MM-DD' (0=อาทิตย์ … 6=เสาร์) */
function dowYmd(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** เวลา + ms */
function addMs(x, ms) {
  return new Date(toDate(x).getTime() + ms);
}
const addMinutes = (x, n) => addMs(x, n * 60000);
const addHours = (x, n) => addMs(x, n * 3600000);

/** ปี พ.ศ. ของเวลาไทย */
function beYear(x) {
  return parts(x).y + 543;
}

/** เปรียบเทียบเวลา (Date|ISO) → -1/0/1 */
function cmp(a, b) {
  const x = toDate(a).getTime();
  const y = toDate(b).getTime();
  return x < y ? -1 : x > y ? 1 : 0;
}

module.exports = {
  OFFSET_MS, toDate, parts, fromParts, iso, ymd, ym, hhmm, parseIsoStrict, addDaysYmd, dowYmd,
  addMs, addMinutes, addHours, beYear, cmp, pad,
};

'use strict';
// กฎ SLA วันทำการ + ระดับเตือน (P03) · BR-12 BR-13 BR-14 BR-20 FR-19 · DECISIONS §0 §8 §18 · CONTRACT §4.2
// เวลาทั้งหมดเป็น Asia/Bangkok (+07:00 ตายตัว) · รับ Date / ISO มี offset / 'YYYY-MM-DD' / 'YYYY-MM-DD HH:MM' (เวลาไทย)
// คืนเวลาเป็นสตริงรูปแบบ DB: 'YYYY-MM-DDTHH:MM:SS+07:00' · วันที่เป็น 'YYYY-MM-DD'
// วันหยุด: ส่ง Set/Array ของ 'YYYY-MM-DD' หรือ ctx / ctx.catalog / db (อ่านตาราง holidays ใหม่ทุกครั้ง)
// BUG_MODE ในไฟล์นี้: B03 (วันทำการไม่ข้ามวันหยุดในตาราง · ฟังก์ชันเดียวใช้ทั้ง D0 กำหนดเสร็จ หยุดนับ และวันคงเหลือ)
//                    B04 (extendDueForFix คืนกำหนดเดิม ไม่เลื่อน)

const time = require('../core/time');
const { clock } = require('../core/clock');
const { bugs } = require('../core/bugs');
const { LEVEL_TH } = require('../core/labels');
const { resolveService } = require('./fee');

const CUTOFF_SECONDS = 16 * 3600 + 30 * 60; // 16:30:00 (ยื่นตั้งแต่ 16:30:00 = วันทำการถัดไป · A-03)
const DUE_TIME = '16:30:00';
const FIX_WINDOW_HOURS = 168; // BR-20 · A-21
const NEAR_MAX_DAYS = 1; // ใกล้ครบกำหนด: วันคงเหลือ ≤ 1 (ปกติ ≥ 2)
const CLOSED = new Set(['COMPLETED', 'REJECTED', 'CANCELLED']);
const PAUSED = 'NEED_FIX';
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_SCAN_DAYS = 5000; // กันวนไม่รู้จบ (ไม่ควรถึง)

// ---------- แหล่งข้อมูล ----------

/**
 * วันหยุดเป็น Set ของ 'YYYY-MM-DD'
 * src: Set · Array<string|{date}> · catalog (holidaySet()) · ctx (catalog/db) · db (prepare()) · {holidays: …}
 */
function resolveHolidays(src) {
  if (src instanceof Set) return src;
  if (Array.isArray(src)) return new Set(src.map((h) => (typeof h === 'string' ? h : h && h.date)).filter(Boolean));
  if (src && typeof src === 'object') {
    if (typeof src.holidaySet === 'function') return src.holidaySet(); // ctx.catalog
    if (src.catalog && typeof src.catalog.holidaySet === 'function') return src.catalog.holidaySet(); // ctx
    const db = typeof src.prepare === 'function' ? src : src.db && typeof src.db.prepare === 'function' ? src.db : null;
    if (db) return new Set(db.prepare('SELECT date FROM holidays').all().map((r) => r.date));
    if (src.holidays !== undefined && typeof src.holidays !== 'function') return resolveHolidays(src.holidays);
  }
  throw new TypeError('rules: ต้องส่งวันหยุด (Set/Array ของ YYYY-MM-DD หรือ ctx/catalog/db)');
}

/** เวลาปัจจุบัน: opts.now (ถ้าส่ง) ไม่เช่นนั้นนาฬิกากลาง (ตัดมิลลิวินาทีให้ตรงกับ nowIso()) */
function resolveNow(now) {
  const d = now === undefined || now === null ? clock.now() : time.toDate(now);
  return new Date(Math.floor(d.getTime() / 1000) * 1000);
}

// ---------- วันที่ ----------

/** 'YYYY-MM-DD' (เวลาไทย) ของ Date/ISO/วันที่ */
function ymdOf(x) {
  if (typeof x === 'string') {
    const m = YMD_RE.exec(x.trim());
    if (m) return x.trim();
  }
  return time.ymd(x);
}

/** วันทำการ = จันทร์–ศุกร์ ที่ไม่อยู่ในตารางวันหยุด (A-02) · B03: ไม่ดูตารางวันหยุด */
function isBusinessDay(date, holidaysSrc) {
  const ymd = ymdOf(date);
  const dow = time.dowYmd(ymd);
  if (dow === 0 || dow === 6) return false;
  if (bugs.on('B03')) return true;
  return !resolveHolidays(holidaysSrc).has(ymd);
}

/** วันทำการแรก "หลัง" วันที่ (ไม่รวมวันนั้น) → 'YYYY-MM-DD' */
function nextBusinessDay(date, holidaysSrc) {
  const hs = resolveHolidays(holidaysSrc);
  let d = ymdOf(date);
  for (let i = 0; i < MAX_SCAN_DAYS; i++) {
    d = time.addDaysYmd(d, 1);
    if (isBusinessDay(d, hs)) return d;
  }
  throw new Error('rules: หาวันทำการไม่พบ');
}

/** เวลาไทยของ Date/ISO เป็น 'HH:MM:SS' */
function timeOfDay(x) {
  const p = time.parts(x);
  return `${time.pad(p.hh)}:${time.pad(p.mi)}:${time.pad(p.ss)}`;
}

/**
 * วันทำการที่ n หลังวันที่ที่ให้ (n = 0 → วันเดิม)
 * รับ 'YYYY-MM-DD' → คืน 'YYYY-MM-DD' · รับเวลา (Date/ISO) → คืน ISO วันใหม่ เวลาเดิม (+07:00)
 */
function addBusinessDays(date, n, holidaysSrc) {
  if (!Number.isInteger(n) || n < 0) throw new TypeError('rules.addBusinessDays: n ต้องเป็นจำนวนเต็ม ≥ 0');
  const hs = resolveHolidays(holidaysSrc);
  let d = ymdOf(date);
  for (let i = 0; i < n; i++) d = nextBusinessDay(d, hs);
  const dateOnly = typeof date === 'string' && YMD_RE.test(date.trim());
  return dateOnly ? d : `${d}T${timeOfDay(date)}+07:00`;
}

/** จำนวนวันทำการในช่วง (from, to] ตามวันที่ (ไม่ขึ้นกับเวลา) · to ≤ from → 0 */
function countBusinessDays(fromExclusive, toInclusive, holidaysSrc) {
  const hs = resolveHolidays(holidaysSrc);
  const to = ymdOf(toInclusive);
  let d = ymdOf(fromExclusive);
  let n = 0;
  for (let i = 0; i < MAX_SCAN_DAYS * 10; i++) {
    d = time.addDaysYmd(d, 1);
    if (d > to) return n;
    if (isBusinessDay(d, hs)) n++;
  }
  throw new Error('rules: ช่วงวันที่ยาวเกินไป');
}

// ---------- BR-12 · กำหนดเสร็จ ----------

/** D0 = วันที่ชำระ ถ้าเป็นวันทำการและก่อน 16:30:00 ไม่เช่นนั้นวันทำการถัดไป → 'YYYY-MM-DD' */
function computeD0(paidAt, holidaysSrc) {
  const hs = resolveHolidays(holidaysSrc);
  const p = time.parts(paidAt);
  const ymd = ymdOf(paidAt);
  const secs = p.hh * 3600 + p.mi * 60 + p.ss;
  if (isBusinessDay(ymd, hs) && secs < CUTOFF_SECONDS) return ymd;
  return nextBusinessDay(ymd, hs);
}

/** แปลง SLA จาก number / แถวบริการ / รหัสบริการ (+ แหล่งข้อมูล) → จำนวนวันทำการ */
function resolveSla(sla, src) {
  let n = sla;
  if (typeof sla === 'string' && !/^\s*\d+\s*$/.test(sla)) {
    const svc = resolveService(sla, src);
    if (!svc) throw new TypeError(`rules: ไม่พบบริการ ${sla}`);
    n = svc.sla;
  } else if (sla && typeof sla === 'object') {
    n = resolveService(sla).sla;
  }
  n = typeof n === 'string' ? parseInt(n, 10) : n;
  if (!Number.isInteger(n) || n < 0) throw new TypeError('rules: SLA ต้องเป็นจำนวนเต็ม ≥ 0');
  return n;
}

/**
 * กำหนดเสร็จ = วันทำการที่ N หลัง D0 เวลา 16:30:00 (+07:00) · คำนวณครั้งเดียวตอนชำระ (A-42)
 * @param paidAt เวลาชำระ
 * @param sla จำนวนวันทำการ | แถวบริการ | รหัส 'SV-01' (อ่าน SLA ปัจจุบันจาก src)
 * @param src วันหยุด (Set/Array) หรือ ctx/catalog/db (ใช้ทั้งวันหยุดและบริการ)
 * @returns '2026-12-04T16:30:00+07:00'
 */
function computeDueAt(paidAt, sla, src) {
  const hs = resolveHolidays(src);
  const n = resolveSla(sla, src);
  const d0 = computeD0(paidAt, hs);
  return `${addBusinessDays(d0, n, hs)}T${DUE_TIME}+07:00`;
}

// ---------- BR-13 · หยุดนับระหว่าง NEED_FIX ----------

/** จำนวนวันทำการใน (วันที่ตีกลับ, วันที่ส่งแก้] ตามวันที่ ไม่ขึ้นกับเวลา (ใช้ตารางวันหยุด ณ เวลาที่ส่งแก้) */
function pausedBusinessDays(returnedAt, resubmittedAt, holidaysSrc) {
  return countBusinessDays(returnedAt, resubmittedAt, holidaysSrc);
}

/**
 * กำหนดเสร็จใหม่เมื่อส่งแก้ = กำหนดเดิม + pausedBusinessDays (เวลาเดิม 16:30) → ISO
 * B04: คืนกำหนดเดิม (ไม่หยุดนับ)
 */
function extendDueForFix(dueAt, returnedAt, resubmittedAt, holidaysSrc) {
  const original = time.iso(dueAt);
  if (bugs.on('B04')) return original;
  const hs = resolveHolidays(holidaysSrc);
  const n = pausedBusinessDays(returnedAt, resubmittedAt, hs);
  return n === 0 ? original : addBusinessDays(original, n, hs);
}

/** แบบละเอียด: {dueAt, pausedDays} (pausedDays = จำนวนจริงสำหรับ returns.paused_days แม้เปิด B04) */
function fixExtension(dueAt, returnedAt, resubmittedAt, holidaysSrc) {
  const hs = resolveHolidays(holidaysSrc);
  return {
    dueAt: extendDueForFix(dueAt, returnedAt, resubmittedAt, hs),
    pausedDays: pausedBusinessDays(returnedAt, resubmittedAt, hs),
  };
}

// ---------- BR-14 · ระดับเตือน ----------

/** วันคงเหลือ = จำนวนวันทำการหลังวันนี้ถึงวันกำหนดเสร็จ (รวมวันกำหนด) · วันกำหนด ≤ วันนี้ → 0 */
function remainingBusinessDays(dueAt, now, holidaysSrc) {
  return countBusinessDays(resolveNow(now), dueAt, holidaysSrc);
}

/** อ่าน status / dueAt จากแถว cases หรือ JSON API */
function caseFields(c) {
  return {
    status: c.status,
    dueAt: c.dueAt !== undefined ? c.dueAt : c.due_at,
  };
}

/**
 * ระดับเตือน (CONTRACT §4.2): 'closed' | 'paused' | 'overdue' | 'near' | 'normal' | null (ไม่มีกำหนดเสร็จ)
 * เรียกได้ 2 แบบ:
 *   slaLevel(caseRow, src)                     src = ctx/catalog/db/Set/Array หรือ {holidays, now}
 *   slaLevel(status, dueAt, now, holidaysSrc)
 */
function slaLevel(a, b, c, d) {
  let status;
  let dueAt;
  let now;
  let hsrc;
  if (typeof a === 'string') {
    status = a;
    dueAt = b;
    now = c;
    hsrc = d;
  } else {
    ({ status, dueAt } = caseFields(a || {}));
    hsrc = b;
    now = b && typeof b === 'object' && !(b instanceof Set) && !Array.isArray(b) && b.now !== undefined && typeof b.now !== 'function' ? b.now : c;
  }
  if (CLOSED.has(status)) return 'closed';
  if (status === PAUSED) return 'paused';
  if (!dueAt) return null;
  const n = resolveNow(now);
  if (n.getTime() > time.toDate(dueAt).getTime()) return 'overdue';
  return remainingBusinessDays(dueAt, n, hsrc) <= NEAR_MAX_DAYS ? 'near' : 'normal';
}

/**
 * FR-19 ส่วนคำนวณ: {level, levelText, dueAt, remainingDays}
 * remainingDays = null เมื่อปิดแล้ว/หยุดนับ/เกินกำหนด/ไม่มีกำหนด
 * การแสดงบนจอใช้ ctx.ui.slaBadge(level) + ctx.ui.time(dueAt)
 */
function slaInfo(caseRow, src, nowArg) {
  const { dueAt } = caseFields(caseRow || {});
  const now = src && typeof src === 'object' && !(src instanceof Set) && !Array.isArray(src) && src.now !== undefined && typeof src.now !== 'function' ? src.now : nowArg;
  const level = slaLevel(caseRow, src, now);
  const remainingDays = level === 'near' || level === 'normal' ? remainingBusinessDays(dueAt, now, src) : null;
  return {
    level,
    levelText: level ? LEVEL_TH[level] : null,
    dueAt: dueAt ? time.iso(dueAt) : null,
    remainingDays,
  };
}

function levelText(level) {
  return LEVEL_TH[level] || null;
}

// ---------- BR-20 · เวลาแก้ไข 168 ชม. ----------

/** เส้นตายแก้ไข = เวลาตีกลับ + 168 ชม. → ISO */
function fixDeadline(returnedAt) {
  return time.iso(time.addHours(returnedAt, FIX_WINDOW_HOURS));
}

/** ยังส่งแก้ได้ ⇔ ตอนนี้ < เส้นตาย (167:59 ได้ · 168:00 ไม่ได้) */
function isFixWindowOpen(deadline, now) {
  return resolveNow(now).getTime() < time.toDate(deadline).getTime();
}

/** เลยเส้นตายแล้ว (ใช้ยกเลิกอัตโนมัติ A-46) ⇔ ตอนนี้ ≥ เส้นตาย */
function isFixWindowExpired(deadline, now) {
  return !isFixWindowOpen(deadline, now);
}

// ---------- DECISIONS §18 · ทันกำหนด ----------

/** ทันกำหนด ⇔ closed_at ≤ กำหนดเสร็จ (16:30:00 ทัน · 16:30:01 ไม่ทัน) */
function isOnTime(closedAt, dueAt) {
  if (!closedAt || !dueAt) return false;
  return Math.floor(time.toDate(closedAt).getTime() / 1000) <= Math.floor(time.toDate(dueAt).getTime() / 1000);
}

module.exports = {
  CUTOFF_SECONDS, DUE_TIME, FIX_WINDOW_HOURS, NEAR_MAX_DAYS,
  resolveHolidays, resolveNow, ymdOf,
  isBusinessDay, nextBusinessDay, addBusinessDays, countBusinessDays,
  computeD0, resolveSla, computeDueAt,
  pausedBusinessDays, extendDueForFix, fixExtension,
  remainingBusinessDays, slaLevel, slaInfo, levelText,
  fixDeadline, isFixWindowOpen, isFixWindowExpired,
  isOnTime,
};

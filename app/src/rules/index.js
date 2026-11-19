'use strict';
// ไลบรารีกฎตัวเลข (P03) · ไม่ใช่โมดูลเว็บ (ไม่ถูกโหลดอัตโนมัติ) · ใช้ผ่าน ctx.rules หรือ require('../../rules')
// ฟังก์ชันบริสุทธิ์: ไม่มี I/O นอกจากอ่านตาราง services / holidays ผ่านพารามิเตอร์ (ctx / ctx.catalog / db) ทุกครั้ง (ไม่ cache)
// ทุกเวลาเป็น Asia/Bangkok (+07:00) · คืนเวลาเป็น 'YYYY-MM-DDTHH:MM:SS+07:00' (รูปแบบ DB) · วันที่ 'YYYY-MM-DD'
// BUG_MODE: B01 (fee.js) · B03 B04 (sla.js) — อ่าน bugs singleton ของ core ตอนเรียก จึงกระทบเฉพาะการคำนวณใหม่ (seed เก็บค่าตายตัว)
//
// ─── ค่าธรรมเนียม (BR-04 BR-05) ─────────────────────────────────────────────
//   computeFee(service, {qty, areaSqm}, src?)
//     service = ctx.catalog.service('SV-03') | แถว services | 'SV-03' (+ src = ctx/catalog/db)
//     → {ok:true, fee:1010, serviceId, feeType, qty, areaSqm}
//     → {ok:false, fee:null, code:'INVALID_QTY'|'INVALID_AREA'|'AREA_TOO_LARGE', message:<CONTRACT §5>, status:400}
//     SV-01 qty ไม่ส่ง (undefined/null) = 1 (A-56) · '' / 0 / 6 / 2.5 → INVALID_QTY · รับสตริงตัวเลขได้ ('3')
//     SV-03 areaSqm (หรือ area / area_sqm) ≤0 / ว่าง / ไม่ใช่จำนวนเต็ม → INVALID_AREA · >500 → AREA_TOO_LARGE
//   requireFee(service, input, src?)      เหมือน computeFee แต่ throw AppError (ctx.errors) → error handler กลางตอบ 400 JSON
//   validateFeeInput(service, input, src?) → null | {code, message, status}
//
// ─── SLA (BR-12 BR-13 BR-20) ───────────────────────────────────────────────
//   holidaysSrc = ctx | ctx.catalog | db | Set/Array ของ 'YYYY-MM-DD' | {holidays}
//   isBusinessDay(date, holidaysSrc) · nextBusinessDay(date, h) · addBusinessDays(date, n, h) · countBusinessDays(fromExcl, toIncl, h)
//   computeD0(paidAt, h)                         → '2026-12-02'
//   computeDueAt(paidAt, sla|service|'SV-01', src) → '2026-12-08T16:30:00+07:00'   (P05 ตอนชำระสำเร็จ)
//   extendDueForFix(dueAt, returnedAt, resubmittedAt, h) → ISO ใหม่ (P06 ตอนส่งแก้ · B04 คืนค่าเดิม)
//   pausedBusinessDays(returnedAt, resubmittedAt, h) → จำนวนวันทำการใน (ตีกลับ, ส่งแก้] (returns.paused_days)
//   fixExtension(...)                            → {dueAt, pausedDays}
//   fixDeadline(returnedAt)                      → returnedAt + 168 ชม. (cases.fix_deadline)
//   isFixWindowOpen(deadline, now?) / isFixWindowExpired(deadline, now?)   (now ไม่ส่ง = นาฬิกากลาง)
//
// ─── ระดับเตือน (BR-14 · FR-19 ส่วนคำนวณ) ──────────────────────────────────
//   slaLevel(caseRow, src)  หรือ slaLevel(status, dueAt, now, h)
//     caseRow = แถว cases ({status, due_at}) หรือ JSON ({status, dueAt}) · src = ctx/catalog/db/Set หรือ {holidays, now}
//     → 'closed' (COMPLETED/REJECTED/CANCELLED) | 'paused' (NEED_FIX) | 'overdue' | 'near' | 'normal' | null (ไม่มี dueAt)
//   remainingBusinessDays(dueAt, now?, h)        → วันทำการหลังวันนี้ถึงวันกำหนด (รวมวันกำหนด)
//   slaInfo(caseRow, src)                        → {level, levelText, dueAt, remainingDays}
//   isOnTime(closedAt, dueAt)                    → closed_at ≤ dueAt (DECISIONS §18 · Dashboard)
//   แสดงผลบนจอ: ctx.ui.slaBadge(level, {testid:'sla-level'}) + ctx.ui.time(dueAt, {testid:'sla-due'})
//
// ─── แบบผูกกับ ctx (อ่าน DB ใหม่ทุกครั้งที่เรียก) ───────────────────────────
//   const r = ctx.rules.forContext(ctx);
//   r.computeFee('SV-03', {areaSqm: 101}).fee      // 1010
//   r.computeDueAt(paidAt, 'SV-01')                // ใช้ SLA และวันหยุดปัจจุบันจาก DB
//   r.extendDueForFix(row.due_at, row.returned_at, ctx.clock.nowIso())
//   r.slaLevel(row) · r.slaInfo(row) · r.remainingBusinessDays(row.due_at)   // now = ctx.clock
//   หลายแถวในหน้าเดียว: const h = r.holidays(); rows.map((x) => rules.slaLevel(x, { holidays: h }))

const fee = require('./fee');
const sla = require('./sla');

/**
 * ผูกฟังก์ชันกับแหล่งข้อมูล (ctx / ctx.catalog / db) · วันหยุด/บริการอ่านใหม่ทุกครั้ง → ผู้ดูแลแก้แล้วมีผลทันที
 * @param {object} src ctx (แนะนำ) | ctx.catalog | better-sqlite3 db
 */
function forContext(src) {
  if (!src || typeof src !== 'object') throw new TypeError('rules.forContext: ต้องส่ง ctx / catalog / db');
  const nowOf = (now) => (now === undefined || now === null ? undefined : now);
  return {
    holidays: () => sla.resolveHolidays(src),
    service: (id) => fee.resolveService(id, src),
    computeFee: (service, input) => fee.computeFee(service, input, src),
    requireFee: (service, input) => fee.requireFee(service, input, src),
    validateFeeInput: (service, input) => fee.validateFeeInput(service, input, src),
    isBusinessDay: (date) => sla.isBusinessDay(date, src),
    nextBusinessDay: (date) => sla.nextBusinessDay(date, src),
    addBusinessDays: (date, n) => sla.addBusinessDays(date, n, src),
    countBusinessDays: (from, to) => sla.countBusinessDays(from, to, src),
    computeD0: (paidAt) => sla.computeD0(paidAt, src),
    computeDueAt: (paidAt, slaOrService) => sla.computeDueAt(paidAt, slaOrService, src),
    pausedBusinessDays: (returnedAt, resubmittedAt) => sla.pausedBusinessDays(returnedAt, resubmittedAt, src),
    extendDueForFix: (dueAt, returnedAt, resubmittedAt) => sla.extendDueForFix(dueAt, returnedAt, resubmittedAt, src),
    fixExtension: (dueAt, returnedAt, resubmittedAt) => sla.fixExtension(dueAt, returnedAt, resubmittedAt, src),
    remainingBusinessDays: (dueAt, now) => sla.remainingBusinessDays(dueAt, nowOf(now), src),
    slaLevel: (caseRow, now) => sla.slaLevel(caseRow, { holidays: sla.resolveHolidays(src), now: nowOf(now) }),
    slaInfo: (caseRow, now) => sla.slaInfo(caseRow, { holidays: sla.resolveHolidays(src), now: nowOf(now) }),
    fixDeadline: sla.fixDeadline,
    isFixWindowOpen: sla.isFixWindowOpen,
    isFixWindowExpired: sla.isFixWindowExpired,
    isOnTime: sla.isOnTime,
    levelText: sla.levelText,
  };
}

module.exports = {
  ...fee,
  ...sla,
  forContext,
};

// `node --test src/rules`: Node 20 สแกนโฟลเดอร์หา *.test.js เอง · Node 22 รันไฟล์นี้เป็น entry → โหลด test ทุกไฟล์ในโฟลเดอร์
if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith('.test.js')).sort()) require(path.join(__dirname, f));
}

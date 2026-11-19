'use strict';
// นาฬิกากลาง · กฎธุรกิจทุกข้อต้องอ่านเวลาจาก clock.now() เท่านั้น (ห้าม Date.now()/new Date() ตรง ๆ)
// TEST_MODE=1 → แช่แข็งที่ 2026-12-01T09:00:00+07:00 ตั้งแต่เริ่ม และตั้งใหม่ได้ด้วย PUT /api/test/clock (A-37)
// ไม่ตั้ง TEST_MODE → เวลาจริงของเครื่อง
const time = require('./time');

const DEFAULT_NOW_ISO = '2026-12-01T09:00:00+07:00';

function createClock({ frozen = false } = {}) {
  let frozenAt = frozen ? time.toDate(DEFAULT_NOW_ISO).getTime() : null;
  return {
    DEFAULT_NOW_ISO,
    /** Date ปัจจุบันตามนาฬิการะบบ (สร้างใหม่ทุกครั้ง แก้ไขได้ไม่กระทบนาฬิกา) */
    now() {
      return new Date(frozenAt === null ? Date.now() : frozenAt);
    },
    /** '2026-12-01T09:00:00+07:00' */
    nowIso() {
      return time.iso(this.now());
    },
    /** ตั้งเวลาแช่แข็ง (Date | ISO มี offset) */
    set(value) {
      const d = value instanceof Date ? value : time.parseIsoStrict(value);
      if (!d) throw new TypeError('INVALID_TIME');
      frozenAt = d.getTime();
      return this.nowIso();
    },
    /** กลับค่าเริ่มต้นของ reset (แช่แข็งที่ 2026-12-01 09:00) */
    reset() {
      frozenAt = time.toDate(DEFAULT_NOW_ISO).getTime();
      return this.nowIso();
    },
    isFrozen() {
      return frozenAt !== null;
    },
    /** ใช้ตอนสร้าง server: frozen=true (TEST_MODE) → แช่แข็งที่ค่าเริ่มต้น · false → เวลาจริง */
    configure({ frozen: f = false } = {}) {
      frozenAt = f ? time.toDate(DEFAULT_NOW_ISO).getTime() : null;
    },
  };
}

// singleton ของทั้ง process (ctx.clock คือตัวนี้) · โค้ดที่ไม่มี ctx (เช่น src/rules) ใช้ require('../core/clock').clock ได้
const clock = createClock({ frozen: false });

module.exports = { createClock, clock, DEFAULT_NOW_ISO };

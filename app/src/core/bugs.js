'use strict';
// ตัวอ่าน BUG_MODE (BUGS.md §1) · 'B03,B07' → เปิด B03 และ B07 · ไม่ตั้ง/ว่าง = เว็บถูกต้อง 100%
// ใช้: if (ctx.bugs.on('B03')) { ...พฤติกรรมผิดเฉพาะจุด... }
// บั๊กต้องอยู่ฝั่งเซิร์ฟเวอร์ กระทบเฉพาะการคำนวณ/ตรวจสิทธิ์ใหม่ ไม่เปลี่ยน seed และไม่เปลี่ยนข้อความ

const VALID = new Set(['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10', 'B11', 'B12']);

function parseBugMode(raw) {
  const out = [];
  const unknown = [];
  for (const part of String(raw || '').split(/[,\s;]+/)) {
    const t = part.trim().toUpperCase();
    if (!t) continue;
    const norm = /^B\d$/.test(t) ? 'B0' + t.slice(1) : t; // 'B3' → 'B03'
    if (VALID.has(norm)) {
      if (!out.includes(norm)) out.push(norm);
    } else {
      unknown.push(t);
    }
  }
  out.sort();
  return { active: out, unknown };
}

function createBugs(raw) {
  let active = new Set(parseBugMode(raw).active);
  let unknown = parseBugMode(raw).unknown;
  return {
    /** true ถ้าเปิดบั๊กรหัสนี้ (รับ 'B03' หรือ 'b3') */
    on(code) {
      const t = String(code || '').trim().toUpperCase();
      return active.has(/^B\d$/.test(t) ? 'B0' + t.slice(1) : t);
    },
    list() {
      return [...active].sort();
    },
    /** รหัสที่อ่านไม่ออกใน BUG_MODE (server log เตือน) */
    unknown() {
      return unknown.slice();
    },
    /** ตั้งชุดบั๊กใหม่ (server ใช้ตอนเริ่ม · unit test ใช้สลับ) เช่น bugs.set(['B01']) หรือ bugs.set('B03,B04') · ว่าง = ปิดหมด */
    set(list) {
      const parsed = parseBugMode(Array.isArray(list) ? list.join(',') : list);
      active = new Set(parsed.active);
      unknown = parsed.unknown;
      return this.list();
    },
  };
}

// singleton ของทั้ง process (ctx.bugs คือตัวนี้) · โค้ดที่ไม่มี ctx (เช่น src/rules) ใช้ require('../core/bugs').bugs ได้
// เริ่มจาก process.env.BUG_MODE และ server ตั้งซ้ำจาก config ตอนสร้าง
const bugs = createBugs(process.env.BUG_MODE);

module.exports = { createBugs, bugs, parseBugMode, VALID_BUGS: [...VALID] };

'use strict';
// กฎค่าธรรมเนียม (P03) · BR-04 BR-05 · DECISIONS §3 · CONTRACT §5 (ข้อความ error ตรงตัว)
// ฟังก์ชันบริสุทธิ์: ค่าธรรมเนียม/SLA อ่านจากแถว services ปัจจุบัน (ผู้ดูแลแก้ได้) ที่ผู้เรียกส่งมา
// หรือส่งรหัสบริการ + แหล่งข้อมูล (ctx / ctx.catalog / db) ให้ไลบรารีอ่านเองทุกครั้ง (ไม่ cache)
// BUG_MODE ในไฟล์นี้: B01 (SV-03 ใช้ > 101 แทน ≥ 101 → พื้นที่ 101 คิดแค่ฐาน ฿1,000)

const errors = require('../core/errors');
const { bugs } = require('../core/bugs');

// ช่วงที่ "ไม่ใช่ค่าที่ผู้ดูแลแก้ได้" (A-42 แก้ได้เฉพาะค่าธรรมเนียมและ SLA) → ค่าคงที่
const QTY_MIN = 1;
const QTY_MAX = 5;
const QTY_DEFAULT = 1; // A-56 ค่าตั้งต้นจำนวนฉบับ SV-01
const AREA_MIN = 1;
const AREA_MAX = 500;
const AREA_BASE_MAX = 100; // 1–100 ตร.ม. = ค่าฐาน

const FEE_TYPE_BY_ID = { 'SV-01': 'per_copy', 'SV-02': 'fixed', 'SV-03': 'area' };

/** แปลงแถว services (snake_case) หรือผลของ ctx.catalog.service() ให้เป็นรูปเดียวกัน */
function normalizeService(s) {
  if (!s || typeof s !== 'object') return null;
  const id = s.id || s.serviceId || s.service_id || null;
  const feeType = s.feeType || s.fee_type || FEE_TYPE_BY_ID[id] || null;
  const feePerSqm = s.feePerSqm !== undefined ? s.feePerSqm : s.fee_per_sqm;
  return {
    id,
    name: s.name,
    feeType,
    fee: s.fee === undefined || s.fee === null ? null : Number(s.fee),
    feePerSqm: feePerSqm === undefined || feePerSqm === null ? null : Number(feePerSqm),
    sla: s.sla === undefined || s.sla === null ? null : Number(s.sla),
  };
}

/**
 * หาแถวบริการ: รับ object (แถว/ผล catalog) หรือรหัส 'SV-03' + แหล่งข้อมูล
 * แหล่งข้อมูล: ctx (มี catalog/db) · catalog (มี service()) · better-sqlite3 db (มี prepare()) · {services:{'SV-01':{...}}} · {db}|{catalog}
 * @returns {object|null} บริการรูปมาตรฐาน หรือ null ถ้าไม่พบ
 */
function resolveService(svc, src) {
  if (svc && typeof svc === 'object') return normalizeService(svc);
  if (typeof svc !== 'string' || !svc) return null;
  const id = svc.trim().toUpperCase();
  if (!src) throw new TypeError(`rules: ต้องส่งแหล่งข้อมูลบริการ (ctx/catalog/db) เมื่อระบุบริการเป็นรหัส '${id}'`);
  if (src.services && typeof src.services === 'object' && !Array.isArray(src.services) && typeof src.services !== 'function') {
    return normalizeService(src.services[id]);
  }
  if (typeof src.service === 'function') return normalizeService(src.service(id)); // ctx.catalog
  if (src.catalog && typeof src.catalog.service === 'function') return normalizeService(src.catalog.service(id)); // ctx
  const db = typeof src.prepare === 'function' ? src : src.db && typeof src.db.prepare === 'function' ? src.db : null;
  if (db) return normalizeService(db.prepare('SELECT * FROM services WHERE id = ?').get(id));
  throw new TypeError('rules: แหล่งข้อมูลบริการไม่รู้จัก (ต้องเป็น ctx / catalog / db)');
}

/** จำนวนเต็มจากตัวเลขหรือสตริงตัวเลขล้วน (' 101 ' ได้ · '1.5' '1e2' 'abc' '' ไม่ได้) → number | null */
function toInt(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v === 'string' && /^\s*[-+]?\d+\s*$/.test(v)) return parseInt(v, 10);
  return null;
}

function failure(code) {
  return { ok: false, fee: null, code, message: errors.message(code), status: errors.status(code) };
}

/**
 * คำนวณค่าธรรมเนียม + ตรวจค่าที่กรอก (BR-04 BR-05)
 * @param {object|string} service แถว services / ผล ctx.catalog.service() / รหัส 'SV-01' (ต้องส่ง src)
 * @param {{qty?, areaSqm?, area?, area_sqm?}} input SV-01 ใช้ qty (ไม่ส่ง = 1 ตาม A-56) · SV-03 ใช้ areaSqm
 * @param {object} [src] ctx / catalog / db เมื่อ service เป็นรหัส
 * @returns {{ok:true, fee:number, serviceId, feeType, qty:number|null, areaSqm:number|null}
 *          |{ok:false, fee:null, code:'INVALID_QTY'|'INVALID_AREA'|'AREA_TOO_LARGE'|'BAD_REQUEST', message, status:400}}
 */
function computeFee(service, input = {}, src) {
  const svc = resolveService(service, src);
  if (!svc || !svc.feeType || svc.fee === null || Number.isNaN(svc.fee)) return failure('BAD_REQUEST');
  const inp = input || {};
  const base = { ok: true, serviceId: svc.id, feeType: svc.feeType, qty: null, areaSqm: null };

  if (svc.feeType === 'per_copy') {
    // SV-01: ฿fee × จำนวนฉบับ 1–5
    const raw = inp.qty;
    const qty = raw === undefined || raw === null ? QTY_DEFAULT : toInt(raw);
    if (qty === null || qty < QTY_MIN || qty > QTY_MAX) return failure('INVALID_QTY');
    return { ...base, fee: svc.fee * qty, qty };
  }

  if (svc.feeType === 'fixed') {
    // SV-02: คงที่
    return { ...base, fee: svc.fee };
  }

  if (svc.feeType === 'area') {
    // SV-03: 1–100 → ฐาน · 101–500 → ฐาน + ต่อ ตร.ม. × (พื้นที่ − 100) · ≤0/ไม่ใช่จำนวนเต็ม → INVALID_AREA · >500 → AREA_TOO_LARGE
    const raw = inp.areaSqm !== undefined ? inp.areaSqm : inp.area !== undefined ? inp.area : inp.area_sqm;
    const area = toInt(raw);
    if (area === null || area < AREA_MIN) return failure('INVALID_AREA');
    if (area > AREA_MAX) return failure('AREA_TOO_LARGE');
    const perSqm = svc.feePerSqm === null || Number.isNaN(svc.feePerSqm) ? 0 : svc.feePerSqm;
    // B01: ใช้ "> 101" แทน "≥ 101" (= "> 100") → 101 ตร.ม. ได้แค่ฐาน (102 ขึ้นไปยังถูก)
    const over = bugs.on('B01') ? area > AREA_BASE_MAX + 1 : area > AREA_BASE_MAX;
    const fee = over ? svc.fee + perSqm * (area - AREA_BASE_MAX) : svc.fee;
    return { ...base, fee, areaSqm: area };
  }

  return failure('BAD_REQUEST');
}

/** ตรวจอย่างเดียว → null ถ้าถูก หรือ {code, message, status} */
function validateFeeInput(service, input, src) {
  const r = computeFee(service, input, src);
  return r.ok ? null : { code: r.code, message: r.message, status: r.status };
}

/** คำนวณแล้ว throw AppError (400 + ข้อความตาม CONTRACT §5) ถ้าไม่ผ่าน → คืนผลเต็มของ computeFee */
function requireFee(service, input, src) {
  const r = computeFee(service, input, src);
  if (!r.ok) errors.fail(r.code);
  return r;
}

module.exports = {
  QTY_MIN, QTY_MAX, QTY_DEFAULT, AREA_MIN, AREA_MAX, AREA_BASE_MAX,
  normalizeService, resolveService, toInt,
  computeFee, validateFeeInput, requireFee,
};

'use strict';
// P11 · ตัวคำนวณตัวชี้วัด Dashboard (ฟังก์ชันบริสุทธิ์ ไม่แตะ DB/นาฬิกาเอง → ทดสอบตรงได้)
// นิยาม: REQUIREMENTS BR-25 BR-26 · DECISIONS ข้อ 12 + ข้อ 18 · TEST-DATA §7 · CONTRACT §2.9 §6.4 §7
//
//   รับเรื่อง        = คำขอที่ชำระสำเร็จ (มีเลขคำขอ = ทุกแถวใน cases) ที่ paid_at อยู่ในช่วง · รวม CANCELLED ที่เคยชำระ
//   ปิดงาน          = COMPLETED + REJECTED ที่ closed_at อยู่ในช่วง (CANCELLED ไม่ใช่ปิดงาน)
//   ทัน             = ปิดงานที่ closed_at ≤ due_at (รวมวินาทีที่ 16:30:00 พอดี) · นับทั้ง COMPLETED และ REJECTED
//   ทันกำหนด %      = ทัน ÷ ปิดงาน × 100 ทศนิยม 1 ตำแหน่ง ปัดครึ่งขึ้น · ปิดงาน 0 → null (จอแสดง '–')
//   งานคงค้าง       = SUBMITTED + IN_REVIEW + NEED_FIX + PENDING_APPROVAL + APPROVED "ณ ตอนนี้" (ไม่ขึ้นกับช่วง แต่กรองบริการ · A-41)
//   เกินกำหนดคงค้าง = งานคงค้างที่ไม่ใช่ NEED_FIX และ ตอนนี้ > due_at (ที่ 16:30:00 พอดียังไม่เกิน)
//   งานในมือ        = IN_REVIEW ที่ owner = เจ้าหน้าที่คนนั้น (ณ ตอนนี้ · ไม่ขึ้นกับตัวกรอง A-41)
//   รายปี (BR-26)   = นับทุกเดือนรวมกันแล้วคิด % จากยอดรวม (ไม่ใช่เฉลี่ย % รายเดือน)
//   ช่วง/เดือน คิดตามเวลาไทย (+07:00)
const time = require('../../core/time');

const OPEN_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'NEED_FIX', 'PENDING_APPROVAL', 'APPROVED'];
const CLOSED_STATUSES = ['COMPLETED', 'REJECTED'];
const DASH = '–'; // en dash U+2013 (CONTRACT §2.9 · ปิดงาน 0)

/** ป้ายตามลำดับแถว 2–6 ของ xlsx (CONTRACT §7) และลำดับ kpi บนจอ */
const KPI_ROWS = [
  { key: 'received', label: 'รับเรื่อง', testid: 'kpi-received' },
  { key: 'closed', label: 'ปิดงาน', testid: 'kpi-closed' },
  { key: 'ontimePct', label: 'ทันกำหนด %', testid: 'kpi-ontime-pct' },
  { key: 'backlog', label: 'งานคงค้าง', testid: 'kpi-backlog' },
  { key: 'overdue', label: 'เกินกำหนดคงค้าง', testid: 'kpi-overdue' },
];

const PERIOD_MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const PERIOD_YEAR_RE = /^(\d{4})$/;

/** '2026-11' → {kind:'month', year:2026, month:11} · '2026' → {kind:'year', year:2026} · อื่น → null */
function parsePeriod(p) {
  if (typeof p !== 'string') return null;
  const s = p.trim();
  let m = PERIOD_MONTH_RE.exec(s);
  if (m) return { kind: 'month', value: s, year: +m[1], month: +m[2] };
  m = PERIOD_YEAR_RE.exec(s);
  if (m) return { kind: 'year', value: s, year: +m[1] };
  return null;
}

/** เวลา (ISO +07:00 / Date) อยู่ในช่วงหรือไม่ · เทียบเดือน/ปีตามเวลาไทย */
function inPeriod(value, period) {
  if (value === null || value === undefined || value === '') return false;
  const per = typeof period === 'string' ? parsePeriod(period) : period;
  if (!per) return false;
  const p = time.parts(value);
  if (p.y !== per.year) return false;
  return per.kind === 'year' || p.m === per.month;
}

const ms = (x) => time.toDate(x).getTime();

const sec = (x) => Math.floor(ms(x) / 1000);

/** ทันกำหนด ⇔ closed_at ≤ due_at เทียบระดับวินาที (16:29:59 / 16:30:00 พอดี = ทัน · 16:30:01 = ไม่ทัน) · เหมือน rules.isOnTime */
function isOnTime(closedAt, dueAt) {
  if (!closedAt || !dueAt) return false;
  return sec(closedAt) <= sec(dueAt);
}

/** เกินกำหนด ⇔ ตอนนี้ > due_at (เท่ากันพอดียังไม่เกิน) */
function isPastDue(now, dueAt) {
  if (!dueAt) return false;
  return sec(now) > sec(dueAt);
}

/**
 * num ÷ den × 100 ทศนิยม 1 ตำแหน่ง ปัดครึ่งขึ้น (คิดด้วยจำนวนเต็ม ไม่มีปัญหา floating point)
 * den = 0 → null · 6/7 → 85.7 · 2/3 → 66.7 · 7/8 → 87.5 · 1/16 → 6.3
 */
function pctHalfUp(num, den) {
  const n = Number(num);
  const d = Number(den);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return null;
  // round(n*1000/d) แบบครึ่งขึ้น = floor((2*n*1000 + d) / (2*d))
  return Math.floor((2 * n * 1000 + d) / (2 * d)) / 10;
}

/** ค่าที่แสดงบนจอ/ไฟล์: 85.7 → '85.7%' · 100 → '100.0%' · null → '–' */
function fmtPct(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return DASH;
  return Number(v).toFixed(1) + '%';
}

function matchService(row, service) {
  return !service || service === 'ALL' || row.service_id === service;
}

/**
 * คำนวณตัวชี้วัด
 * @param rows   แถว cases: {case_no, service_id, status, paid_at, due_at, closed_at, owner}
 * @param opts   {period: '2026-11'|'2026', service: 'ALL'|'SV-01'…, now: Date|ISO, divideByReceived: bool (BUG B10),
 *                onTime: (closedAt, dueAt) => bool (ค่าเริ่มต้น isOnTime ของไฟล์นี้ · index.js ส่ง ctx.rules.isOnTime)}
 * @returns {received, closed, onTime, ontimePct, backlog, overdue}
 */
function computeKpis(rows, { period, service = 'ALL', now, divideByReceived = false, onTime: onTimeFn = isOnTime } = {}) {
  const per = typeof period === 'string' ? parsePeriod(period) : period;
  if (!per) throw new TypeError('computeKpis: period ไม่ถูกต้อง: ' + String(period));
  if (now === undefined || now === null) throw new TypeError('computeKpis: ต้องส่ง now (นาฬิการะบบ)');
  let received = 0;
  let closed = 0;
  let onTime = 0;
  let backlog = 0;
  let overdue = 0;
  for (const r of rows) {
    if (!matchService(r, service)) continue;
    // รับเรื่อง: ชำระสำเร็จในช่วง (ทุกสถานะ รวม CANCELLED)
    if (inPeriod(r.paid_at, per)) received++;
    // ปิดงาน + ทัน
    if (CLOSED_STATUSES.includes(r.status) && inPeriod(r.closed_at, per)) {
      closed++;
      if (onTimeFn(r.closed_at, r.due_at)) onTime++;
    }
    // ณ ตอนนี้ (ไม่ขึ้นกับช่วง · ขึ้นกับบริการ)
    if (OPEN_STATUSES.includes(r.status)) {
      backlog++;
      if (r.status !== 'NEED_FIX' && isPastDue(now, r.due_at)) overdue++;
    }
  }
  // BUG_MODE B10: หารด้วย "รับเรื่อง" แทน "ปิดงาน" (พ.ย. 23.1% · ปี 23.3% · ธ.ค. 0.0%)
  const ontimePct = pctHalfUp(onTime, divideByReceived ? received : closed);
  return { received, closed, onTime, ontimePct, backlog, overdue };
}

/**
 * งานในมือรายเจ้าหน้าที่ (IN_REVIEW ที่ owner = คนนั้น ณ ตอนนี้) · แสดงเจ้าหน้าที่ทุกคนแม้ 0
 * ไม่ขึ้นกับตัวกรองเดือน/บริการ (A-41)
 * @param rows      แถว cases
 * @param officers  [{username, name}] เจ้าหน้าที่ที่ต้องแสดงเสมอ (เรียงตามที่ส่งมา)
 * @param names     Map/obj username → ชื่อแสดง ของผู้ถือเรื่องที่ไม่อยู่ใน officers (เช่นถูกเปลี่ยนบทบาทภายหลัง)
 * @returns [{username, name, count}] · ผู้ถือเรื่องที่ไม่อยู่ใน officers แต่มีงาน > 0 ต่อท้าย (เรียง username)
 */
function computeWorkload(rows, officers = [], names = {}) {
  const counts = new Map();
  for (const r of rows) {
    if (r.status === 'IN_REVIEW' && r.owner) counts.set(r.owner, (counts.get(r.owner) || 0) + 1);
  }
  const out = officers.map((o) => ({ username: o.username, name: o.name || o.username, count: counts.get(o.username) || 0 }));
  const known = new Set(officers.map((o) => o.username));
  const nameOf = (u) => (names instanceof Map ? names.get(u) : names[u]) || u;
  const extra = [...counts.keys()].filter((u) => !known.has(u)).sort();
  for (const u of extra) out.push({ username: u, name: nameOf(u), count: counts.get(u) });
  return out;
}

/** ข้อความที่แสดงบนจอ (= ค่าคอลัมน์ B ของ xlsx) */
function displayValues(k) {
  return {
    received: String(k.received),
    closed: String(k.closed),
    ontimePct: fmtPct(k.ontimePct),
    backlog: String(k.backlog),
    overdue: String(k.overdue),
  };
}

/** บรรทัด ASCII ใน PDF (CONTRACT §7): 'kpi received=26 closed=7 ontime=85.7% backlog=21 overdue=1' · ปิดงาน 0 → 'ontime=-' */
function kpiLine(k) {
  const pct = k.ontimePct === null || k.ontimePct === undefined ? '-' : fmtPct(k.ontimePct);
  return `kpi received=${k.received} closed=${k.closed} ontime=${pct} backlog=${k.backlog} overdue=${k.overdue}`;
}

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** '2026-11' → 'พ.ย. 2569' · '2026' → 'ทั้งปี 2569' */
function periodLabel(period) {
  const per = typeof period === 'string' ? parsePeriod(period) : period;
  if (!per) return String(period || '');
  if (per.kind === 'year') return `ทั้งปี ${per.year + 543}`;
  return `${TH_MONTHS[per.month - 1]} ${per.year + 543}`;
}

/**
 * ตัวเลือกของ period-select: 24 เดือนย้อนหลังนับจากเดือนของนาฬิกา (ใหม่ → เก่า) + ทั้งปีของปีปัจจุบันและปีก่อน
 * ค่าที่ขอมา (extra) ที่ไม่อยู่ในรายการถูกเพิ่มให้ด้วย
 */
function periodOptions(now, extra) {
  const p = time.parts(now);
  const out = [];
  let y = p.y;
  let m = p.m;
  for (let i = 0; i < 24; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  out.push(String(p.y), String(p.y - 1));
  if (extra && parsePeriod(extra) && !out.includes(extra)) out.push(extra);
  return out.map((v) => ({ value: v, label: periodLabel(v) }));
}

module.exports = {
  OPEN_STATUSES,
  CLOSED_STATUSES,
  DASH,
  KPI_ROWS,
  parsePeriod,
  inPeriod,
  isOnTime,
  isPastDue,
  pctHalfUp,
  fmtPct,
  computeKpis,
  computeWorkload,
  displayValues,
  kpiLine,
  periodLabel,
  periodOptions,
};

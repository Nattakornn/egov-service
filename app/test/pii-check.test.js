'use strict';
// ตัวควบคุมบวกของการตรวจ PII ใน PDF (REVIEW-P14 M2) และการค้นค่าตรงตัวใน DB/log (REVIEW-P14 ข้อสังเกต 8)
// พิสูจน์ว่าตัวตรวจใน e2e/specs/part2/pii.js (ตัวเดียวกับที่ TC-DASH-03 / TC-NFR-04 ใช้) "จับได้จริง":
//   1) สตริงที่สระ/วรรณยุกต์ถูกแยกขึ้นบรรทัดใหม่แบบที่ pdf-parse ทำ
//   2) PDF ที่สร้างด้วยโค้ดส่งออกของเว็บจริง (buildPdf) โดยแทรกชื่อ/เลขบัตร/เบอร์ลงไป แล้วดึงข้อความด้วย pdf-parse ตัวเดียวกับ e2e
//   3) ข้อความว่าง/อ่านไม่ได้ → throw (ไม่ผ่านแบบไม่ได้ตรวจ)
//   4) PDF ปกติ (ไม่มี PII) → ไม่พบอะไร (ไม่มี false positive) และบรรทัด KPI อยู่ในข้อความที่ดึงได้
// ต้องมี e2e/node_modules (pdf-parse) → cd e2e && npm install
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const pii = require(path.join(ROOT, 'e2e', 'specs', 'part2', 'pii.js'));
const { buildPdf } = require(path.join(ROOT, 'src', 'modules', 'dashboard'))._internal;
const M = require(path.join(ROOT, 'src', 'modules', 'dashboard', 'metrics'));

const FONTS = {
  regular: path.join(ROOT, 'assets', 'fonts', 'NotoSansThai-Regular.ttf'),
  bold: path.join(ROOT, 'assets', 'fonts', 'NotoSansThai-Bold.ttf'),
};
const NOW = new Date('2026-12-01T02:00:00Z');
const KPI_LINE = 'kpi received=26 closed=7 ontime=85.7% backlog=21 overdue=1';

/** รายงาน พ.ย. ALL รูปเดียวกับ dash.report() (ค่าตาม seed / TEST-PLAN TC-DASH-03) */
function novReport(workload) {
  const k = { received: 26, closed: 7, onTime: 6, ontimePct: 85.7, backlog: 21, overdue: 1 };
  return {
    period: '2026-11',
    service: 'ALL',
    periodLabel: M.periodLabel('2026-11'),
    serviceLabel: 'ทุกบริการ',
    asOf: '2026-12-01T09:00:00+07:00',
    asOfText: '1 ธ.ค. 2569 09:00',
    ...k,
    workload,
    display: M.displayValues(k),
  };
}
const STAFF = [
  { username: 'off.reg1', name: 'เจ้าหน้าที่ทะเบียน 1', count: 3 },
  { username: 'off.reg2', name: 'เจ้าหน้าที่ทะเบียน 2', count: 9 },
  { username: 'off.works1', name: 'เจ้าหน้าที่โยธา 1', count: 0 },
];

/**
 * PDF ถูกรูปแบบที่ไม่มีข้อความเลย (มีแต่รูปสี่เหลี่ยม) · ต้องใหญ่กว่า ~1.1 KB เพราะ pdf.js ใน pdf-parse 1.1.1
 * อ่านไฟล์เล็กมากไม่ได้ ("bad XRef entry") ซึ่งก็ throw เหมือนกัน แต่ที่นี่ต้องการกรณี "อ่านได้แต่ข้อความว่าง"
 */
function blankPdf() {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', compress: false, info: { CreationDate: NOW, ModDate: NOW } });
  const chunks = [];
  return new Promise((resolve, reject) => {
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    for (let i = 0; i < 50; i++) doc.rect(10 + i * 8, 10 + i * 8, 4, 4).fill('#000000');
    doc.end();
  });
}

/** แบบเดิม (ก่อนแก้): เทียบชื่อทีละบรรทัด */
const perLineNames = (text) => pii.textLines(text).flatMap((l) => pii.SEED_NAMES.filter((n) => l.includes(n)));
const names = (findings) => pii.SEED_NAMES.filter((n) => findings.some((f) => f.startsWith(`name ${n} `)));

test('สตริงที่ถูกแยกสระ/วรรณยุกต์ขึ้นบรรทัดใหม่ "ส\\nม\\nห\\nญ\\nิ\\nง" → จับชื่อ สมหญิง ได้ (แบบทีละบรรทัดพลาด)', () => {
  const text = 'รายงาน\nส\nม\nห\nญ\nิ\nง\nป\nิ\nต\nิ\nkpi received=1';
  assert.deepEqual(perLineNames(text), [], 'แบบเดิมทีละบรรทัดหาไม่เจอ (นี่คือช่องโหว่ที่รีวิวชี้)');
  const f = pii.pdfPiiFindings(text);
  assert.deepEqual(names(f), ['สมหญิง', 'ปิติ'], JSON.stringify(f));
  // xlsx/innerText: ชื่อที่มีช่องว่าง/ขึ้นบรรทัดแทรกในเซลล์เดียวก็จับได้
  assert.deepEqual(names(pii.piiFindings(['ม า น ะ'])), ['มานะ']);
});

test('เลข 13 หลัก และ 0\\d{9} ตรวจทีละบรรทัด', () => {
  const f = pii.pdfPiiFindings('a\nid 1101700123456\ntel 0845678901\nperiod=2026-11 service=ALL asof=2026-12-01T09:00:00+07:00');
  assert.ok(f.includes('\\d{13} in line "id 1101700123456"'), JSON.stringify(f));
  assert.ok(f.includes('0\\d{9} in line "tel 0845678901"'), JSON.stringify(f));
  assert.ok(!f.some((x) => x.includes('period=')), `บรรทัด period/asof ต้องไม่ถูกนับ: ${JSON.stringify(f)}`);
  // คนละบรรทัดไม่ต่อกัน: เลข 7 + 6 หลักแยกบรรทัด ไม่ใช่ \d{13}
  assert.deepEqual(pii.pdfPiiFindings('1101700\n123456'), []);
});

test('ข้อความว่าง/อ่านไม่ได้ → throw (ห้ามผ่านแบบไม่ได้ตรวจ)', async () => {
  assert.throws(() => pii.pdfPiiFindings(''), /ข้อความว่าง/);
  assert.throws(() => pii.pdfPiiFindings(' \n\t \n'), /ข้อความว่าง/);
  assert.throws(() => pii.assertPdfText('', 'x'), /ข้อความว่าง/);
  await assert.rejects(pii.pdfText(Buffer.from('hello')), /pdf-parse อ่านไฟล์ไม่ได้/);
  // PDF ถูกรูปแบบแต่ไม่มีข้อความ (หน้าเปล่าจาก pdfkit) → ดึงได้ '' → ด่านข้อความว่างต้องล้ม
  const empty = await blankPdf();
  const t = await pii.pdfText(empty);
  assert.equal(t.trim(), '', `PDF เปล่าควรได้ข้อความว่าง (ได้ ${JSON.stringify(t)})`);
  assert.throws(() => pii.assertPdfText(t, 'pdf เปล่า'), /ข้อความว่าง/);
});

test('ตัวควบคุมบวก: PDF จาก buildPdf ของเว็บที่แทรกชื่อ/เลขบัตร/เบอร์ → pdf-parse + pdfPiiFindings จับได้ครบ', async (t) => {
  const leak = [
    ...STAFF,
    { username: 'x1', name: 'สมหญิง ใจดี', count: 1 },
    { username: 'x2', name: 'ปิติ', count: 1 },
    { username: 'x3', name: 'สมชาย', count: 1 },
    { username: 'x4', name: 'มานะ', count: 1 },
    { username: '1101700123456', name: 'id', count: 1 },
    { username: '0845678901', name: 'tel', count: 1 },
  ];
  const buf = await buildPdf(novReport(leak), { fonts: FONTS, now: NOW });
  assert.equal(buf.subarray(0, 4).toString('latin1'), '%PDF');
  const text = await pii.pdfText(buf);
  assert.ok(text.trim().length > 0, 'ดึงข้อความได้');
  assert.ok(pii.textLines(text).some((l) => l.includes(KPI_LINE)), 'บรรทัด KPI อยู่ในข้อความที่ดึงได้');
  const f = pii.pdfPiiFindings(text, 'pdf แทรก PII');
  assert.deepEqual(names(f), ['สมชาย', 'สมหญิง', 'ปิติ', 'มานะ'], JSON.stringify(f));
  assert.ok(f.some((x) => x.startsWith('\\d{13}')), `ต้องจับ \\d{13}: ${JSON.stringify(f)}`);
  assert.ok(f.some((x) => x.startsWith('0\\d{9}')), `ต้องจับ 0\\d{9}: ${JSON.stringify(f)}`);
  const i = text.indexOf('สมห');
  t.diagnostic(`pdf-parse "สมหญิง ใจดี" → ${JSON.stringify(text.slice(i, i + 16))}`);
  t.diagnostic(`แบบเดิมทีละบรรทัดเจอ: ${JSON.stringify([...new Set(perLineNames(text))])} · แบบใหม่เจอ: ${JSON.stringify(names(f))}`);
});

test('ตัวควบคุมบวก: ข้อความที่ pdf-parse แยกวรรณยุกต์ขึ้นบรรทัดใหม่ใน PDF จริงของเว็บ → แบบทีละบรรทัดพลาด แบบตัด whitespace จับได้', async (t) => {
  // "ช่วง" ในแถวงานในมือ (ฟอนต์/ขนาดเดียวกับชื่อ) ถูก pdf-parse แยกเป็น "ช\n่\nวง" (วัดจริงกับ pdfkit 0.17.2 + NotoSansThai + pdf-parse 1.1.1)
  const WORD = 'ช่วงสมหญิง';
  const buf = await buildPdf(novReport([...STAFF, { username: 'x1', name: `ผู้ยื่น ${WORD}`, count: 1 }]), { fonts: FONTS, now: NOW });
  const text = await pii.pdfText(buf);
  const i = text.indexOf('ผู้ยื่น');
  t.diagnostic(`pdf-parse "ผู้ยื่น ${WORD}" → ${JSON.stringify(text.slice(i, i + 24))}`);
  assert.ok(!pii.textLines(text).some((l) => l.includes(WORD)), `ต้องถูกแยกบรรทัดจริง (ถ้าไม่แยก ตัวอย่างนี้ใช้พิสูจน์ไม่ได้): ${JSON.stringify(text.slice(i, i + 24))}`);
  assert.ok(text.replace(/\s+/g, '').includes(WORD), 'ตัด whitespace แล้วต้องต่อกลับเป็นคำเดิม');
  // ตัวตรวจจริงจับชื่อที่อยู่ในคำที่ถูกแยกได้
  assert.deepEqual(names(pii.pdfPiiFindings(text)), ['สมหญิง']);
});

test('PDF ปกติ (seed พ.ย. ไม่มี PII) → ไม่พบอะไร · บรรทัด KPI อยู่ในข้อความที่ดึงได้', async () => {
  const buf = await buildPdf(novReport(STAFF), { fonts: FONTS, now: NOW });
  const text = await pii.pdfText(buf);
  assert.ok(pii.textLines(text).some((l) => l.includes(KPI_LINE)), 'บรรทัด KPI');
  assert.deepEqual(pii.pdfPiiFindings(text), []);
});

test('needleFindings (TC-NFR-04 DB + log ของเว็บ): จับค่าตรงตัวทั้ง utf8 และ utf16le · log สะอาด → ไม่พบ', () => {
  const clean = Buffer.from('[egov] listening on :3000 · TEST_MODE=1\n[egov] POST /api/auth/register 201 4ms\n', 'utf8');
  assert.deepEqual(pii.needleFindings(clean, pii.NFR04_NEEDLES, 'web.log'), []);
  const leaked = Buffer.concat([clean, Buffer.from('[egov] register mobile=0845678901 id=3-1006-00987-65-9\n', 'utf8')]);
  assert.deepEqual(pii.needleFindings(leaked, pii.NFR04_NEEDLES, 'web.log'), [
    'web.log: "0845678901" (utf8) × 1',
    'web.log: "3-1006-00987-65-9" (utf8) × 1',
  ]);
  const wide = Buffer.from('x 1101700123456 x', 'utf16le');
  assert.deepEqual(pii.needleFindings(wide, pii.NFR04_NEEDLES, 'db'), ['db: "1101700123456" (utf16le) × 1']);
});

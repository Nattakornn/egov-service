// global-setup: สร้างไฟล์ทดสอบอัปโหลดตาม TEST-DATA §11 ลง e2e/testfiles/
// (พอร์ตจาก make_testfiles.py ทีละบรรทัด — ชื่อไฟล์และขนาดไบต์ตรงตาราง §11 · ชุด 1 และชุด 2 ใช้ชื่อเดียวกัน)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TESTFILES_DIR = path.join(__dirname, 'testfiles');

// ---- CRC32 (ไม่พึ่ง zlib.crc32 ที่มีเฉพาะ Node รุ่นใหม่) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const u16be = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };

/** PDF จริงขนาด n ไบต์ (หัว %PDF + เติมช่องว่างแล้วปิดด้วย %%EOF) */
function pdf(n) {
  const head = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n', 'latin1');
  const tail = Buffer.from('\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');
  const pad = n - head.length - tail.length;
  if (pad < 0) throw new Error(`pdf(${n}) too small`);
  return Buffer.concat([head, Buffer.alloc(pad, 0x20), tail]);
}

/** PNG จริง 1x1 + เติม chunk tEXt ให้ครบขนาด */
function png(n) {
  const chunk = (type, data) => {
    const t = Buffer.from(type, 'latin1');
    return Buffer.concat([u32be(data.length), t, data, u32be(crc32(Buffer.concat([t, data])))]);
  };
  const ihdr = Buffer.concat([u32be(1), u32be(1), Buffer.from([8, 2, 0, 0, 0])]);
  const base = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0x00, 0xff, 0x00, 0x00]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const pad = n - base.length - 12; // tEXt overhead 12 ไบต์
  const text = Buffer.concat([Buffer.from([0x6b, 0x00]), Buffer.alloc(pad - 2, 0x78)]);
  return Buffer.concat([base.subarray(0, base.length - 12), chunk('tEXt', text), base.subarray(base.length - 12)]);
}

/** JPEG จริงแบบย่อ: SOI + APP0 + COM เติมขนาด + EOI */
function jpg(n) {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const pad = n - soi.length - app0.length - 2 - 4;
  return Buffer.concat([soi, app0, Buffer.from([0xff, 0xfe]), u16be(pad + 2), Buffer.alloc(pad, 0x78), Buffer.from([0xff, 0xd9])]);
}

/** รายการไฟล์ตาม TEST-DATA §11 → Buffer */
function buildAll() {
  const files = {};
  for (const name of ['ok-id.pdf', 'id-card.pdf', 'map.pdf', 'plan.pdf', 'deed.pdf', ...[1, 2, 3, 4, 5, 6].map((i) => `multi-${i}.pdf`)]) {
    files[name] = () => pdf(1024);
  }
  files['real.jpg'] = () => jpg(1024);
  files['real.png'] = () => png(1024);
  files['plan-as-jpg.jpg'] = () => jpg(1024);
  for (const n of [5242879, 5242880, 5242881]) files[`size-${n}.pdf`] = () => pdf(n);
  files['fake-text.pdf'] = () => Buffer.from('hello');
  files['fake-text.jpg'] = () => Buffer.from('hello');
  files['notes.txt'] = () => Buffer.from('hello');
  files['exe-as.png'] = () => Buffer.concat([Buffer.from('MZ', 'latin1'), Buffer.alloc(1022, 0)]);
  return files;
}

/** ขนาดที่คาดหวังตาม §11 (ใช้ตรวจหลังสร้าง) */
const EXPECTED_SIZES = {
  'size-5242879.pdf': 5242879,
  'size-5242880.pdf': 5242880,
  'size-5242881.pdf': 5242881,
  'fake-text.pdf': 5,
  'fake-text.jpg': 5,
  'notes.txt': 5,
};

function ensureTestFiles(verbose = false) {
  fs.mkdirSync(TESTFILES_DIR, { recursive: true });
  const all = buildAll();
  for (const [name, make] of Object.entries(all)) {
    const p = path.join(TESTFILES_DIR, name);
    const want = EXPECTED_SIZES[name] ?? 1024;
    if (fs.existsSync(p) && fs.statSync(p).size === want) continue;
    fs.writeFileSync(p, make());
  }
  for (const name of Object.keys(all)) {
    const size = fs.statSync(path.join(TESTFILES_DIR, name)).size;
    const want = EXPECTED_SIZES[name] ?? 1024;
    if (size !== want) throw new Error(`testfile ${name}: size ${size} ≠ ${want}`);
    if (verbose) console.log(name, size);
  }
  return TESTFILES_DIR;
}

module.exports = async function globalSetup() {
  ensureTestFiles(false);
};
module.exports.ensureTestFiles = ensureTestFiles;
module.exports.TESTFILES_DIR = TESTFILES_DIR;

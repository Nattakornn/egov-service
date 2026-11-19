// @ts-check
// part2/pii.js · ตรวจข้อมูลส่วนบุคคล (BR-24) และดึงข้อความจาก PDF · ไม่พึ่ง @playwright/test
// ใช้ทั้งใน spec (ผ่าน _lib.js) และใน unit test ตัวควบคุมบวก (app/test/pii-check.test.js)
'use strict';

/** ชื่อใน seed ที่ห้ามโผล่ในรายงาน (TEST-PLAN TC-DASH-03 แถว "ทุกไฟล์") */
const SEED_NAMES = ['สมชาย', 'สมหญิง', 'ปิติ', 'มานะ'];

/** ค่าที่ห้ามพบแบบตรงตัวในฐานข้อมูล/log (TEST-PLAN TC-NFR-04) */
const NFR04_NEEDLES = [
  '1101700123456', '3100600987659', '1909900555015', '5500400111221',
  '0812345678', '0823456789', '0834567890', '0845678901',
  '1-1017-00123-45-6', '3-1006-00987-65-9', '1-9099-00555-01-5', '5-5004-00111-22-1',
];

const squash = (s) => String(s).replace(/\s+/g, '');

/**
 * ดึงข้อความจาก PDF ด้วย pdf-parse (TEST-PLAN TC-DASH-03 "อ่านข้อความด้วย pdf-parse")
 * ไม่เงียบ: โหลดไลบรารีไม่ได้หรือ parse ไม่ได้ → throw (เดิมคืน '' แล้วการตรวจ PII ผ่านแบบไม่ได้ตรวจอะไร)
 */
async function pdfText(buf) {
  let parse;
  try {
    parse = require('pdf-parse/lib/pdf-parse.js'); // ไม่ require 'pdf-parse' ตรง ๆ เพราะ index.js ของ 1.1.1 รันโค้ด debug
  } catch (e) {
    throw new Error(`pdfText: โหลด pdf-parse ไม่ได้ (cd e2e && npm install) · ${e && e.message}`);
  }
  let r;
  try {
    r = await parse(buf);
  } catch (e) {
    throw new Error(`pdfText: pdf-parse อ่านไฟล์ไม่ได้ (${buf ? buf.length : 0} ไบต์) · ${e && e.message}`);
  }
  return String((r && r.text) || '');
}

/** ข้อความที่ดึงได้ต้องไม่ว่าง ไม่งั้นการตรวจบรรทัด/PII ไม่มีความหมาย */
function assertPdfText(text, label) {
  if (!String(text || '').trim()) {
    throw new Error(`${label}: ดึงข้อความจาก PDF ได้ข้อความว่าง (pdf-parse) จึงตรวจบรรทัด/ข้อมูลส่วนบุคคลไม่ได้`);
  }
  return text;
}

/** แยกบรรทัดของข้อความที่ดึงได้ (ยุบช่องว่างในบรรทัด · ตัดบรรทัดว่าง) */
function textLines(text) {
  return String(text).split(/\r?\n/).map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
}

/**
 * PII ในรายการข้อความ (เซลล์ xlsx / บรรทัด innerText) · regex `\d{13}` `0\d{9}` ทีละรายการ
 * ชื่อเทียบบนรายการที่ตัดช่องว่างออกแล้ว (กันกรณีมีช่องว่าง/ขึ้นบรรทัดแทรกในชื่อ)
 */
function piiFindings(texts) {
  const found = [];
  for (const t of texts) {
    const s = String(t);
    if (/\d{13}/.test(s)) found.push(`\\d{13} in "${s.slice(0, 80)}"`);
    if (/0\d{9}/.test(s)) found.push(`0\\d{9} in "${s.slice(0, 80)}"`);
    const flat = squash(s);
    for (const n of SEED_NAMES) if (flat.includes(n)) found.push(`name ${n} in "${s.slice(0, 80)}"`);
  }
  return found;
}

/**
 * PII ในข้อความที่ดึงจาก PDF ทั้งไฟล์
 * - `\d{13}` และ `0\d{9}` ตรวจทีละบรรทัด (ตามการ์ด "บรรทัดใน PDF")
 * - ชื่อไทยตรวจบนข้อความทั้งไฟล์ที่ตัด whitespace ทุกตัวออก เพราะ pdf-parse แยกสระบน/ล่างและวรรณยุกต์ไปขึ้นบรรทัดใหม่
 *   (เช่น "สมหญิง" ออกมาเป็น "สมหญ\nิ\nง") การเทียบทีละบรรทัดจึงหลุด
 * ข้อความว่าง → throw (ห้ามผ่านแบบไม่ได้ตรวจ)
 */
function pdfPiiFindings(text, label = 'PDF') {
  assertPdfText(text, label);
  const found = [];
  for (const l of textLines(text)) {
    if (/\d{13}/.test(l)) found.push(`\\d{13} in line "${l.slice(0, 80)}"`);
    if (/0\d{9}/.test(l)) found.push(`0\\d{9} in line "${l.slice(0, 80)}"`);
  }
  const flat = squash(text);
  for (const n of SEED_NAMES) {
    const at = flat.indexOf(n);
    if (at !== -1) found.push(`name ${n} in text (whitespace removed) "…${flat.slice(Math.max(0, at - 20), at + n.length + 20)}…"`);
  }
  return found;
}

/** นับจำนวนครั้งที่พบแต่ละค่าในไฟล์/บัฟเฟอร์ (utf8 + utf16le) · คืน ["<label>: "<ค่า>" (<enc>) × n"] */
function needleFindings(buf, needles, label) {
  const found = [];
  for (const n of needles) {
    for (const enc of ['utf8', 'utf16le']) {
      const needle = Buffer.from(n, /** @type {BufferEncoding} */ (enc));
      let count = 0;
      let at = buf.indexOf(needle);
      while (at !== -1) {
        count++;
        at = buf.indexOf(needle, at + 1);
      }
      if (count) found.push(`${label}: "${n}" (${enc}) × ${count}`);
    }
  }
  return found;
}

module.exports = {
  SEED_NAMES, NFR04_NEEDLES, pdfText, assertPdfText, textLines, piiFindings, pdfPiiFindings, needleFindings,
};

#!/usr/bin/env node
'use strict';
// สร้างตาราง markdown (FINAL-REPORT §3 §4.1 §4.3 §4.4) จาก <dir>/<label>.summary.json + <label>.json ที่ run-bugs.sh เขียนไว้
// ใช้: node scripts/report-tables.js reports/runs-docker
const fs = require('fs');
const path = require('path');
const dir = process.argv[2] || 'reports/runs-docker';
const load = (l) => { const f = path.join(dir, `${l}.summary.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
const mtime = (l) => { const f = path.join(dir, `${l}.json`); return fs.existsSync(f) ? fs.statSync(f).mtime : null; };
const list = (a) => (a && a.length ? a.join(' · ') : '–');
const ts = (d) => d ? new Date(d.getTime() + 7 * 3600e3).toISOString().replace('T', ' ').slice(0, 19) : '?';

const rows = [
  ['normal-1', '(ปกติ) รอบ 1'], ['normal-2', '(ปกติ) รอบ 2 ทันที'],
  ...['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10', 'B11', 'B12'].map((b) => [`bug-${b}`, b]),
  ['bug-B03_B07', 'B03,B07'], ['bug-B01_B05_B09', 'B01,B05,B09'], ['normal-final', '(ปิดบั๊ก) final'],
];
console.log('| บั๊ก | TC ที่คาดว่าล้ม (BUGS §2) | TC ที่ล้มจริง | TC ล้มเกินที่คาด | TC ที่ควรล้มแต่ผ่าน | ผล | เวลาเสร็จ |');
console.log('|---|---|---|---|---|---|---|');
for (const [l, name] of rows) {
  const s = load(l);
  if (!s) { console.log(`| ${name} | ? | (ยังไม่มีผล) | | | ❌ | |`); continue; }
  const exp = list(s.expectFail) + (s.allowFail.length ? ` (อาจล้ม: ${s.allowFail.join(' · ')})` : '');
  const res = `${s.passed.length} passed · ${s.failed.length} failed · ${s.skipped.length} skipped ${s.match ? '✅ MATCH' : '❌ MISMATCH'}`;
  console.log(`| ${name} | ${s.expectFail.length || s.allowFail.length ? exp : '–'} | ${list(s.failed)} | ${list(s.extra)} | ${list(s.missedExpected)} | ${res} | ${ts(mtime(l)).slice(11)} |`);
}
console.log('\n#### ข้อความ assert แรกของ TC ที่ล้ม\n');
console.log('| รอบ | TC | ข้อความแรก |');
console.log('|---|---|---|');
for (const [l, name] of rows) {
  const s = load(l);
  if (!s) continue;
  for (const t of s.tests.filter((x) => !x.ok && !x.skipped)) console.log(`| ${name} | ${t.id} | ${t.msg.replace(/\|/g, '\\|')} |`);
}

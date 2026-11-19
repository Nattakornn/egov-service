#!/usr/bin/env node
'use strict';
// สรุปผล Playwright จาก e2e/results/results.json → รายการ TC ที่ผ่าน/ล้ม + ข้อความ assert แรก
// ใช้: node scripts/pw-summary.js <results.json> [--expect TC-A,TC-B] [--allow TC-C] [--json out.json]
//   --expect  TC ที่ต้องล้ม (BUGS.md §2 คอลัมน์ "TC ที่ต้องล้ม")
//   --allow   TC ที่อาจล้มด้วย (ผลข้างเคียงที่ยอมรับ)
// exit 0 = ตรงตามคาด (ครบ 51 TC ไม่ซ้ำ · skipped = 0 · ทุก expect ล้ม · ที่ล้มอยู่ใน expect ∪ allow) · exit 1 = ไม่ตรง
// TC ที่ skipped ไม่นับเป็นผ่าน และไม่นับเป็นล้ม → รอบไหนมี skip = MISMATCH เสมอ (BUGS §3 ต้อง "ผ่านครบ 51/51")
const fs = require('fs');

const args = process.argv.slice(2);
const file = args[0];
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1].split(',').map((s) => s.trim()).filter(Boolean) : [];
};
const expectFail = opt('--expect');
const allowFail = opt('--allow');
const jsonOutIdx = args.indexOf('--json');
const jsonOut = jsonOutIdx >= 0 ? args[jsonOutIdx + 1] : null;

const report = JSON.parse(fs.readFileSync(file, 'utf8'));
const strip = (s) => String(s || '').replace(/\u001b\[[0-9;]*m/g, '');

const tests = [];
function walk(suite) {
  for (const spec of suite.specs || []) {
    const m = spec.title.match(/^(TC-[A-Z]+-\d{2})/);
    const id = m ? m[1] : spec.title;
    for (const t of spec.tests || []) {
      const last = (t.results || [])[t.results.length - 1] || {};
      const status = last.status || t.status || 'unknown';
      const err = (last.errors && last.errors[0]) || last.error || null;
      let msg = err ? strip(err.message).split('\n').filter((l) => l.trim())[0] || '' : '';
      if (msg.length > 220) msg = msg.slice(0, 220) + '…';
      tests.push({ id, title: spec.title, status, ok: status === 'passed', skipped: status === 'skipped', msg, ms: last.duration || 0 });
    }
  }
  for (const s of suite.suites || []) walk(s);
}
for (const s of report.suites || []) walk(s);
tests.sort((a, b) => a.id.localeCompare(b.id));

const passed = tests.filter((t) => t.ok).map((t) => t.id);
const skipped = tests.filter((t) => t.skipped).map((t) => t.id);
const failed = tests.filter((t) => !t.ok && !t.skipped).map((t) => t.id); // failed / timedOut / interrupted / unknown
const missedExpected = expectFail.filter((id) => !failed.includes(id)); // ควรล้มแต่ไม่ล้ม (ผ่านหลอก หรือถูก skip)
const extra = failed.filter((id) => !expectFail.includes(id) && !allowFail.includes(id)); // ล้มเกินที่คาด
const sideEffects = failed.filter((id) => allowFail.includes(id));
const uniqueIds = new Set(tests.map((t) => t.id)).size;
const okMatch = tests.length === 51 && uniqueIds === 51 && skipped.length === 0 && missedExpected.length === 0 && extra.length === 0;

console.log(`total=${tests.length} unique=${uniqueIds} passed=${passed.length} failed=${failed.length} skipped=${skipped.length}`);
for (const t of tests.filter((x) => !x.ok && !x.skipped)) console.log(`  FAIL ${t.id}: ${t.msg}`);
if (skipped.length) console.log(`  SKIP ${skipped.join(' ')} (skipped ไม่นับว่าผ่าน → MISMATCH)`);
console.log(`expected-fail=[${expectFail.join(' ')}] allowed=[${allowFail.join(' ')}]`);
console.log(`failed=[${failed.join(' ')}] extra=[${extra.join(' ')}] should-fail-but-passed=[${missedExpected.join(' ')}] side-effects=[${sideEffects.join(' ')}]`);
console.log(okMatch ? 'RESULT: MATCH' : 'RESULT: MISMATCH');

if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify({ total: tests.length, passed, failed, skipped, extra, missedExpected, sideEffects, expectFail, allowFail, match: okMatch, tests }, null, 2));
}
process.exit(okMatch ? 0 : 1);

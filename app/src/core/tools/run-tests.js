#!/usr/bin/env node
'use strict';
// `npm test` → รัน unit test ทุกไฟล์ *.test.js ใต้ src/ และ test/ ด้วย node:test (ใช้ได้ทั้ง Node 20 และ 22)
// test/ = ตัวควบคุมบวกของเครื่องมือทดสอบ (ตัวตรวจ PII ของ e2e · pw-summary) ต้องมี e2e/node_modules · ใน image ไม่มีโฟลเดอร์นี้
// ส่งชื่อไฟล์/โฟลเดอร์ต่อท้ายได้: npm test -- src/rules
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function collect(target, out) {
  const st = fs.statSync(target);
  if (st.isFile()) {
    if (target.endsWith('.test.js')) out.push(target);
    return;
  }
  for (const name of fs.readdirSync(target)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    collect(path.join(target, name), out);
  }
}

const args = process.argv.slice(2);
const targets = args.length ? args.map((a) => path.resolve(process.cwd(), a)) : [path.join(ROOT, 'src'), path.join(ROOT, 'test')];
const files = [];
for (const t of targets) {
  if (fs.existsSync(t)) collect(t, files);
}
files.sort();
if (!files.length) {
  console.log('ไม่พบไฟล์ *.test.js');
  process.exit(0);
}
console.log(`unit test ${files.length} ไฟล์:\n` + files.map((f) => '  ' + path.relative(ROOT, f)).join('\n'));
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: ROOT, env: { ...process.env, BUG_MODE: '' } });
process.exit(r.status === null ? 1 : r.status);

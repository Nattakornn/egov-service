#!/usr/bin/env node
'use strict';
// สร้างไฟล์ migration ว่างเลขถัดไป · ห้ามแก้ไฟล์ migration ที่ apply แล้ว ให้เพิ่มไฟล์ใหม่เท่านั้น
//   npm run migrate:new -- <desc>                     → src/core/migrations/NNNN_<desc>.sql
//   npm run migrate:new -- <desc> --module <โฟลเดอร์>  → src/modules/<โฟลเดอร์>/migrations/NNNN_<desc>.sql
// desc แปลงเป็น a-z 0-9 _ (เช่น "add user nickname" → add_user_nickname) · ไฟล์ว่างทำให้เริ่มระบบไม่ได้จนกว่าจะใส่ SQL
const fs = require('fs');
const path = require('path');
const { readScope, CORE_SCOPE, CORE_MIGRATIONS_DIR } = require('../migrate');

const APP_ROOT = path.resolve(__dirname, '..', '..', '..');
const MODULES_DIR = path.join(APP_ROOT, 'src', 'modules');

function slug(desc) {
  return String(desc || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** @returns {string} path ของไฟล์ที่สร้าง */
function createMigration({ desc, module: mod = null, modulesDir = MODULES_DIR, coreDir = CORE_MIGRATIONS_DIR }) {
  const name = slug(desc);
  if (!name) throw new Error('ต้องระบุคำอธิบายภาษาอังกฤษ (a-z 0-9) เช่น: npm run migrate:new -- add_user_nickname');
  let scope = CORE_SCOPE;
  let dir = coreDir;
  if (mod) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(mod) || !fs.existsSync(path.join(modulesDir, mod, 'index.js'))) {
      throw new Error(`ไม่พบโมดูล ${mod} (ต้องมี ${path.join(modulesDir, mod, 'index.js')})`);
    }
    scope = mod;
    dir = path.join(modulesDir, mod, 'migrations');
  }
  const existing = readScope(scope, dir); // ชื่อผิด/เลขซ้ำ → throw ก่อนสร้างไฟล์
  const next = existing.reduce((mx, m) => Math.max(mx, m.num), 0) + 1;
  if (next > 9999) throw new Error(`${scope}: เลข migration เกิน 9999`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(next).padStart(4, '0')}_${name}.sql`);
  fs.writeFileSync(file, '', { flag: 'wx' });
  return file;
}

function parseArgs(argv) {
  const words = [];
  let mod = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--module' || a === '-m') mod = argv[++i];
    else if (a.startsWith('--module=')) mod = a.slice('--module='.length);
    else words.push(a);
  }
  return { desc: words.join('_'), module: mod };
}

if (require.main === module) {
  try {
    const file = createMigration(parseArgs(process.argv.slice(2)));
    console.log(`สร้าง ${path.relative(APP_ROOT, file)} (ไฟล์ว่าง)`);
    console.log('- ใส่ SQL แบบเพิ่ม เช่น ALTER TABLE … ADD COLUMN · CREATE TABLE · CREATE INDEX · UPDATE ข้อมูลที่จำเป็น (ไม่ต้องมี BEGIN/COMMIT: core ห่อ transaction ให้)');
    console.log('- ห้ามแก้ไฟล์ migration ที่ apply แล้ว ให้เพิ่มไฟล์ใหม่เท่านั้น');
    console.log('- ห้ามมีเลขบัตร/เบอร์โทรในคอมเมนต์หรือ SQL (NFR-04: SQLite เก็บข้อความ CREATE ไว้ในไฟล์ DB)');
    console.log('- ไฟล์ว่างทำให้เริ่มระบบไม่ได้จนกว่าจะใส่ SQL');
  } catch (e) {
    console.error('[migrate:new] ' + e.message);
    process.exit(1);
  }
}

module.exports = { createMigration, slug, parseArgs };

'use strict';
// Migration แบบเพิ่มไฟล์ (additive) · ห้ามแก้ไฟล์ migration ที่ apply แล้ว ให้เพิ่มไฟล์ใหม่เท่านั้น (npm run migrate:new -- <desc>)
//
// ไฟล์:  src/core/migrations/NNNN_<desc>.sql                 → id "core/NNNN_<desc>.sql"
//        src/modules/<โฟลเดอร์>/migrations/NNNN_<desc>.sql   → id "<โฟลเดอร์>/NNNN_<desc>.sql"
// ลำดับ: core ก่อน แล้วโมดูลตามลำดับโหลด · ในแต่ละ scope เรียงตามเลขนำหน้า (4 หลัก ห้ามซ้ำ เริ่ม 0001)
// แต่ละไฟล์รันใน transaction ของตัวเองพร้อมแถว schema_migrations(id, checksum sha256, applied_at)
// เริ่มเครื่องทุกครั้ง: ตรวจ checksum ของไฟล์ที่ apply แล้ว · ถูกแก้/ลบ/เปลี่ยนชื่อ → throw (ไม่เริ่มระบบ) · ไม่มีการลบตารางในไฟล์นี้
// DB รุ่นก่อน migration (มีตาราง + meta.schema_hash แต่ไม่มี schema_migrations) ที่ตารางตรงกับ core/0001 → baseline (บันทึกว่า apply แล้วโดยไม่รัน)
const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');
const Database = require('better-sqlite3');

const CORE_SCOPE = 'core';
const CORE_MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const FILE_RE = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
const SCOPE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const NEW_HINT = 'npm run migrate:new -- <desc>';
const DDL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  id         TEXT PRIMARY KEY,
  checksum   TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`;

class MigrationError extends Error {
  constructor(message, { code, ids = [] } = {}) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
    this.ids = ids;
  }
}

/** sha256 ของเนื้อไฟล์ (ตัด BOM · CRLF → LF เพื่อไม่ให้ git บน Windows ทำให้ checksum เปลี่ยน) */
function checksum(sql) {
  return nodeCrypto.createHash('sha256').update(sql, 'utf8').digest('hex');
}

function readSql(file) {
  return fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
}

/**
 * SQL ที่ตัดคอมเมนต์ · ยุบช่องว่าง · ตัวพิมพ์เล็ก (นอก string/quoted identifier)
 * ใช้ (1) ตรวจไฟล์ว่าง (2) เทียบโครงสร้าง DB รุ่นเดิมกับ 0001 โดยไม่สนคอมเมนต์/ช่องว่าง
 */
function normalizeSql(sql) {
  const parts = [];
  let plain = '';
  const flush = () => {
    if (plain) parts.push(plain.replace(/\s+/g, ' ').replace(/ ?([(),;=]) ?/g, '$1').toLowerCase());
    plain = '';
  };
  const s = String(sql || '');
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '-' && s[i + 1] === '-') {
      const j = s.indexOf('\n', i);
      i = j < 0 ? s.length : j;
      plain += ' ';
    } else if (c === '/' && s[i + 1] === '*') {
      const j = s.indexOf('*/', i + 2);
      i = j < 0 ? s.length : j + 2;
      plain += ' ';
    } else if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === close) {
          if (close !== ']' && s[j + 1] === close) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      flush();
      parts.push(s.slice(i, j + 1));
      i = j + 1;
    } else {
      plain += c;
      i++;
    }
  }
  flush();
  return parts.join('').trim();
}

function isEmptySql(sql) {
  return normalizeSql(sql).replace(/[;\s]/g, '') === '';
}

/** อ่านไฟล์ migration ของ scope เดียว (ตรวจชื่อ/เลข) → เรียงตามเลข */
function readScope(scope, dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const problems = [];
  const byNum = new Map();
  const list = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || /\.md$/i.test(ent.name)) continue;
    const m = FILE_RE.exec(ent.name);
    if (!ent.isFile() || !m) {
      problems.push(`${scope}/${ent.name}: ชื่อไม่ตรงรูปแบบ NNNN_<desc>.sql (เลข 4 หลัก · desc ใช้ a-z 0-9 _)`);
      continue;
    }
    const num = Number(m[1]);
    if (num === 0) {
      problems.push(`${scope}/${ent.name}: เลขต้องเริ่มที่ 0001`);
      continue;
    }
    if (byNum.has(num)) {
      problems.push(`${scope}: เลข ${m[1]} ซ้ำกัน (${byNum.get(num)} · ${ent.name})`);
      continue;
    }
    byNum.set(num, ent.name);
    const file = path.join(dir, ent.name);
    const sql = readSql(file);
    list.push({ id: `${scope}/${ent.name}`, scope, file: ent.name, path: file, num, sql, checksum: checksum(sql), empty: isEmptySql(sql) });
  }
  if (problems.length) {
    throw new MigrationError(`[migrate] ไฟล์ migration ไม่ถูกต้อง → ไม่เริ่มระบบ\n- ${problems.sort().join('\n- ')}`, { code: 'MIGRATION_INVALID' });
  }
  return list.sort((a, b) => a.num - b.num);
}

/**
 * รวมไฟล์ migration ทุก scope ตามลำดับที่ส่งมา (core ต้องมาก่อน)
 * @param {{name: string, dir: string}[]} scopes
 */
function loadMigrations(scopes) {
  const seen = new Set();
  const out = [];
  for (const { name, dir } of scopes) {
    if (!SCOPE_RE.test(String(name))) throw new MigrationError(`[migrate] ชื่อ scope ไม่ถูกต้อง: ${name}`, { code: 'MIGRATION_INVALID' });
    if (seen.has(name)) throw new MigrationError(`[migrate] scope "${name}" ซ้ำ (โมดูลห้ามตั้งชื่อโฟลเดอร์ว่า core)`, { code: 'MIGRATION_INVALID' });
    seen.add(name);
    const legacy = path.join(path.dirname(dir), 'schema.sql');
    if (fs.existsSync(legacy)) {
      throw new MigrationError(
        `[migrate] พบ ${legacy} ซึ่งไม่รองรับแล้ว → ย้ายเนื้อหาไปเป็น ${path.join(dir, '0001_init.sql')} (ถ้า scope นี้ยังไม่มี migration) หรือสร้างไฟล์ใหม่ด้วย ${NEW_HINT} แล้วลบ schema.sql`,
        { code: 'MIGRATION_INVALID' }
      );
    }
    out.push(...readScope(name, dir));
  }
  return out;
}

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function userObjects(db) {
  return db
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND type IN ('table','index','view','trigger') ORDER BY type, name")
    .all();
}

/** ความต่างระหว่างโครงสร้างใน DB กับวัตถุที่ sql สร้าง (รันใน :memory:) · [] = ตรงกัน (DB มีตารางอื่นเพิ่มได้) */
function diffSchema(db, sql) {
  const mem = new Database(':memory:');
  let want;
  try {
    mem.exec(sql);
    want = userObjects(mem);
  } finally {
    mem.close();
  }
  const have = new Map(userObjects(db).map((o) => [`${o.type}:${o.name}`, o]));
  const out = [];
  for (const w of want) {
    const h = have.get(`${w.type}:${w.name}`);
    if (!h) out.push(`ไม่มี ${w.type} ${w.name}`);
    else if (h.tbl_name !== w.tbl_name || normalizeSql(h.sql) !== normalizeSql(w.sql)) out.push(`${w.type} ${w.name} โครงสร้างไม่ตรง`);
  }
  return out;
}

/** DB ที่มีตารางแต่ไม่มี schema_migrations → baseline core/0001 ถ้าเป็น DB รุ่นเดิมที่ตารางตรง · ไม่งั้น throw (ไม่ลบอะไร) */
function baselineLegacy(db, migrations, { log, now, result }) {
  let legacyHash = null;
  if (tableExists(db, 'meta')) {
    const r = db.prepare("SELECT value FROM meta WHERE key = 'schema_hash'").get();
    legacyHash = r ? r.value : null;
  }
  const init = migrations.find((m) => m.scope === CORE_SCOPE && m.num === 1);
  if (!legacyHash || !init) {
    throw new MigrationError(
      `[migrate] DB มีตารางอยู่แล้วแต่ไม่มี schema_migrations และไม่ใช่ DB รุ่นก่อน migration ของระบบนี้ → ไม่เริ่มระบบ (ไม่ได้แตะข้อมูล) · ตรวจ DB_PATH`,
      { code: 'MIGRATION_UNKNOWN_DB' }
    );
  }
  const diff = diffSchema(db, init.sql);
  if (diff.length) {
    throw new MigrationError(
      `[migrate] DB รุ่นก่อน migration แต่ตารางไม่ตรงกับ ${init.id} → ไม่ baseline ไม่เริ่มระบบ (ไม่ได้แตะข้อมูล)\n- ${diff.join('\n- ')}`,
      { code: 'MIGRATION_LEGACY_MISMATCH', ids: [init.id] }
    );
  }
  db.tx(() => {
    db.exec(DDL);
    db.prepare('INSERT INTO schema_migrations(id, checksum, applied_at) VALUES (?, ?, ?)').run(init.id, init.checksum, now());
    db.prepare("DELETE FROM meta WHERE key = 'schema_hash'").run();
  });
  result.baselined.push(init.id);
  log(`[migrate] baseline ${init.id} (DB รุ่นก่อน migration · ตารางตรงกัน → บันทึกว่า apply แล้วโดยไม่รัน · ข้อมูลเดิมอยู่ครบ)`);
}

const numOf = (file) => Number(String(file).slice(0, 4));

/** ไฟล์ที่ apply แล้วต้องอยู่ครบและ checksum ตรง · ไฟล์ใหม่ต้องมีเลขมากกว่าตัวล่าสุดที่ apply แล้วของ scope เดียวกัน */
function verify(applied, migrations) {
  const byId = new Map(migrations.map((m) => [m.id, m]));
  const appliedIds = new Set(applied.map((r) => r.id));
  const changed = [];
  for (const r of applied) {
    const m = byId.get(r.id);
    if (!m) {
      const slash = r.id.indexOf('/');
      const scope = r.id.slice(0, slash);
      const file = r.id.slice(slash + 1);
      const renamed = migrations.find((x) => !appliedIds.has(x.id) && (x.checksum === r.checksum || (x.scope === scope && x.num === numOf(file))));
      changed.push({
        id: r.id,
        text: `${r.id}: apply แล้ว (${r.applied_at}) แต่ไม่พบไฟล์ → ถูกลบหรือเปลี่ยนชื่อ${renamed ? ` (ไฟล์ใหม่ที่น่าจะเป็นตัวเดิม: ${renamed.id})` : ''}`,
      });
    } else if (m.checksum !== r.checksum) {
      changed.push({ id: r.id, text: `${r.id}: ไฟล์ถูกแก้หลัง apply แล้ว (checksum ที่บันทึก ${r.checksum.slice(0, 12)}… ≠ ไฟล์ตอนนี้ ${m.checksum.slice(0, 12)}…)` });
    }
  }
  if (changed.length) {
    throw new MigrationError(
      `[migrate] ไม่เริ่มระบบ: migration ที่ apply แล้วถูกแก้ไข/ลบ/เปลี่ยนชื่อ\n- ${changed.map((c) => c.text).join('\n- ')}\n` +
        `ห้ามแก้ไฟล์ migration ที่ apply แล้ว ให้เพิ่มไฟล์ใหม่เท่านั้น → คืนไฟล์เดิม (ชื่อและเนื้อหาเดิม) แล้วเพิ่ม migration ใหม่: ${NEW_HINT}\n` +
        `Applied migrations must never be edited, deleted or renamed; restore the original file and add a new migration instead. ข้อมูลใน DB ไม่ถูกแตะ`,
      { code: 'MIGRATION_CHANGED', ids: changed.map((c) => c.id) }
    );
  }
  const problems = [];
  const lastApplied = new Map();
  for (const r of applied) {
    const m = byId.get(r.id);
    if (m && (!lastApplied.has(m.scope) || lastApplied.get(m.scope).num < m.num)) lastApplied.set(m.scope, m);
  }
  for (const m of migrations) {
    if (appliedIds.has(m.id)) continue;
    const last = lastApplied.get(m.scope);
    if (last && m.num < last.num) problems.push(`${m.id}: ยังไม่ได้ apply แต่เลขน้อยกว่า ${last.id} ที่ apply แล้ว → เปลี่ยนเป็นเลขถัดไป (${NEW_HINT})`);
    if (m.empty) problems.push(`${m.id}: ไฟล์ว่าง (ไม่มีคำสั่ง SQL) → ใส่ SQL ก่อนเริ่มระบบ หรือลบไฟล์ถ้าไม่ใช้`);
  }
  if (problems.length) {
    throw new MigrationError(`[migrate] ไม่เริ่มระบบ: migration ที่รอ apply ไม่ถูกต้อง (ไม่ได้แตะข้อมูล)\n- ${problems.join('\n- ')}`, {
      code: 'MIGRATION_INVALID',
    });
  }
}

/**
 * apply migration ที่ค้าง · ไม่ลบอะไรเด็ดขาด
 * @param {import('better-sqlite3').Database & {tx: Function}} db
 * @param {ReturnType<typeof loadMigrations>} migrations
 * @param {{log?: Function, now?: () => string}} opts now = ค่า applied_at
 * @returns {{applied: string[], baselined: string[]}}
 */
function migrate(db, migrations, { log = () => {}, now = () => new Date().toISOString() } = {}) {
  const result = { applied: [], baselined: [] };
  if (!tableExists(db, 'schema_migrations')) {
    if (userObjects(db).some((o) => o.type === 'table')) baselineLegacy(db, migrations, { log, now, result });
    else db.exec(DDL);
  }
  const applied = db.prepare('SELECT id, checksum, applied_at FROM schema_migrations ORDER BY rowid').all();
  verify(applied, migrations);
  const done = new Set(applied.map((r) => r.id));
  const ins = db.prepare('INSERT INTO schema_migrations(id, checksum, applied_at) VALUES (?, ?, ?)');
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    db.tx(() => {
      try {
        db.exec(m.sql);
      } catch (e) {
        throw new MigrationError(`[migrate] ${m.id} รันไม่สำเร็จ (rollback ไฟล์นี้แล้ว · ไฟล์ก่อนหน้าที่สำเร็จยังอยู่): ${e.message}`, {
          code: 'MIGRATION_FAILED',
          ids: [m.id],
        });
      }
      ins.run(m.id, m.checksum, now());
    });
    result.applied.push(m.id);
    log(`[migrate] applied ${m.id}`);
  }
  return result;
}

module.exports = { migrate, loadMigrations, readScope, normalizeSql, checksum, diffSchema, MigrationError, CORE_SCOPE, CORE_MIGRATIONS_DIR, FILE_RE };

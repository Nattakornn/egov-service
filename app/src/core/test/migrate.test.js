'use strict';
// migration แบบเพิ่มไฟล์: (a) DB ใหม่ apply ทั้งหมด + seed · (b) restart โหมดปกติข้อมูลอยู่ครบ · (c) เพิ่ม 0002 → apply เฉพาะ 0002
// (d) แก้/ลบ/เปลี่ยนชื่อไฟล์ที่ apply แล้ว → ไม่เริ่มระบบ ข้อมูลไม่หาย · (e) baseline DB รุ่นก่อน migration · (f) TEST_MODE/RESET_ON_START/reset ยังล้าง
// + เลขไฟล์ซ้ำ/ผิดรูปแบบ/ข้ามลำดับ/ไฟล์ว่าง · migrate:new · NFR-04 ในไฟล์ migration
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const nodeCrypto = require('crypto');
const Database = require('better-sqlite3');
const { createServer } = require('../../server');
const { loadConfig } = require('../config');
const { openDb } = require('../db');
const { createCrypto } = require('../crypto');
const { createSign } = require('../sign');
const { createStorage } = require('../storage');
const { seedAll } = require('../seed');
const { migrate, loadMigrations, readScope, normalizeSql, CORE_MIGRATIONS_DIR } = require('../migrate');
const { createMigration, parseArgs } = require('../tools/migrate-new');

const RULE = 'ห้ามแก้ไฟล์ migration ที่ apply แล้ว ให้เพิ่มไฟล์ใหม่เท่านั้น';
const ISO_TH = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'egov-mig-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const sha256 = (s) => nodeCrypto.createHash('sha256').update(s, 'utf8').digest('hex');
const INIT_SQL = fs.readFileSync(path.join(CORE_MIGRATIONS_DIR, '0001_init.sql'), 'utf8');

/** พื้นที่ทดสอบแยก: สำเนา core migrations + โมดูล demo ที่มี migrations ของตัวเอง */
function workspace(name) {
  const root = path.join(tmp, name);
  const coreDir = path.join(root, 'core-migrations');
  fs.mkdirSync(coreDir, { recursive: true });
  for (const f of fs.readdirSync(CORE_MIGRATIONS_DIR)) fs.copyFileSync(path.join(CORE_MIGRATIONS_DIR, f), path.join(coreDir, f));
  const modulesDir = path.join(root, 'modules');
  const demoMig = path.join(modulesDir, 'demo', 'migrations');
  fs.mkdirSync(demoMig, { recursive: true });
  fs.writeFileSync(path.join(modulesDir, 'demo', 'index.js'), "module.exports = { name: 'demo', order: 5, register() {} };");
  // ไม่มี IF NOT EXISTS → ถ้าถูกรันซ้ำจะ error "already exists" (พิสูจน์ว่าไม่รันซ้ำ)
  fs.writeFileSync(path.join(demoMig, '0001_demo_items.sql'), 'CREATE TABLE demo_items (id INTEGER PRIMARY KEY, v TEXT NOT NULL);\n');
  return { root, coreDir, modulesDir, demoMig, dbPath: path.join(root, 'data', 'app.db') };
}

async function boot(ws, env = {}, { modules = true } = {}) {
  const logs = [];
  const r = await createServer({
    env: { DB_PATH: ws.dbPath, TEST_MODE: '', ...env },
    modulesDir: modules ? ws.modulesDir : null,
    coreMigrationsDir: ws.coreDir,
    log: (...a) => logs.push(a.join(' ')),
  });
  return { ctx: r.ctx, db: r.ctx.db, result: r.ctx._internal.migrationResult, logs, close: () => r.ctx.db.close() };
}

/** เปิดไฟล์ DB ตรง ๆ (หลังเริ่มระบบไม่สำเร็จ) เพื่อดูว่าข้อมูลยังอยู่ */
function peek(dbPath, fn) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const count = (db, t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
const migRows = (db) => db.prepare('SELECT id, checksum, applied_at FROM schema_migrations ORDER BY rowid').all();
const MARK = { username: 'mig.keep', name: 'ผู้ใช้ทดสอบ migration' };
function insertMarker(db) {
  db.prepare("INSERT INTO users(username, name, role, dept, created_at) VALUES (?, ?, 'officer', 'registry', '2026-11-19T10:00:00+07:00')").run(MARK.username, MARK.name);
  db.prepare("UPDATE services SET fee = 777 WHERE id = 'SV-02'").run();
  db.prepare("INSERT INTO demo_items(v) VALUES ('ข้อมูลจริง')").run();
}
const marker = (db) => db.prepare('SELECT name FROM users WHERE username = ?').get(MARK.username);

async function rejects(promise, code, includes) {
  let err;
  try {
    const r = await promise;
    r.ctx.db.close();
  } catch (e) {
    err = e;
  }
  assert.ok(err, `ต้องไม่เริ่มระบบ (${code})`);
  assert.equal(err.name, 'MigrationError', String(err && err.stack));
  assert.equal(err.code, code, err.message);
  for (const s of includes) assert.ok(err.message.includes(s), `ข้อความต้องมี "${s}"\n${err.message}`);
  return err;
}

// ---------------------------------------------------------------- (a)–(d) เส้นทางเดียวกันบน DB เดียว
test('(a)–(d) DB ใหม่ → restart → เพิ่ม 0002 → แก้ไฟล์ที่ apply แล้ว (โหมดปกติ ไม่มี TEST_MODE)', async (t) => {
  const ws = workspace('flow');

  await t.test('(a) DB ใหม่: apply ทุกไฟล์ (core ก่อน แล้วโมดูล) + seed', async () => {
    const s = await boot(ws);
    try {
      assert.deepEqual(s.result, { applied: ['core/0001_init.sql', 'demo/0001_demo_items.sql'], baselined: [] });
      assert.equal(s.ctx._internal.seededAtStart, true);
      assert.equal(count(s.db, 'users'), 11);
      assert.equal(count(s.db, 'cases'), 30);
      const rows = migRows(s.db);
      assert.deepEqual(rows.map((r) => r.id), ['core/0001_init.sql', 'demo/0001_demo_items.sql']);
      assert.equal(rows[0].checksum, sha256(INIT_SQL), 'checksum = sha256 ของไฟล์');
      for (const r of rows) assert.match(r.applied_at, ISO_TH);
      assert.equal(count(s.db, 'meta'), 0, 'ไม่มี hash แบบเก่าใน meta');
      assert.ok(s.logs.some((l) => l.includes('[migrate] applied core/0001_init.sql')));
      insertMarker(s.db);
    } finally {
      s.close();
    }
  });

  let firstRows;
  await t.test('(b) restart โหมดปกติ: ไม่ apply ซ้ำ ไม่ seed ซ้ำ ข้อมูลที่เพิ่มยังอยู่', async () => {
    const s = await boot(ws);
    try {
      assert.deepEqual(s.result, { applied: [], baselined: [] });
      assert.equal(s.ctx._internal.seededAtStart, false);
      assert.equal(marker(s.db).name, MARK.name);
      assert.equal(count(s.db, 'users'), 12);
      assert.equal(s.db.prepare("SELECT fee FROM services WHERE id = 'SV-02'").get().fee, 777);
      assert.deepEqual(s.db.prepare('SELECT v FROM demo_items').all(), [{ v: 'ข้อมูลจริง' }]);
      firstRows = migRows(s.db);
      assert.equal(firstRows.length, 2);
    } finally {
      s.close();
    }
  });

  await t.test('(c) เพิ่ม core/0002 + demo/0002 → apply เฉพาะ 0002 (core ก่อน) ข้อมูลเดิมอยู่ครบ', async () => {
    fs.writeFileSync(path.join(ws.coreDir, '0002_users_nickname.sql'), '-- ชื่อเล่นผู้ใช้ (ไม่บังคับ)\nALTER TABLE users ADD COLUMN nickname TEXT;\n');
    fs.writeFileSync(path.join(ws.demoMig, '0002_demo_note.sql'), "ALTER TABLE demo_items ADD COLUMN note TEXT NOT NULL DEFAULT '-';\n");
    const s = await boot(ws);
    try {
      assert.deepEqual(s.result, { applied: ['core/0002_users_nickname.sql', 'demo/0002_demo_note.sql'], baselined: [] });
      assert.equal(s.ctx._internal.seededAtStart, false);
      assert.equal(marker(s.db).name, MARK.name);
      assert.equal(count(s.db, 'users'), 12);
      assert.equal(count(s.db, 'cases'), 30);
      assert.deepEqual(s.db.prepare('SELECT v, note FROM demo_items').all(), [{ v: 'ข้อมูลจริง', note: '-' }]);
      assert.ok(s.db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'nickname'));
      const rows = migRows(s.db);
      assert.deepEqual(rows.slice(0, 2), firstRows, 'แถวของ 0001 ไม่ถูกแตะ (applied_at เดิม)');
      assert.deepEqual(rows.map((r) => r.id), ['core/0001_init.sql', 'demo/0001_demo_items.sql', 'core/0002_users_nickname.sql', 'demo/0002_demo_note.sql']);
    } finally {
      s.close();
    }
  });

  await t.test('(d) แก้ไฟล์ที่ apply แล้ว → ไม่เริ่มระบบ บอกชื่อไฟล์ + ให้เพิ่มไฟล์ใหม่ · ข้อมูลไม่หาย', async () => {
    const f = path.join(ws.coreDir, '0002_users_nickname.sql');
    const original = fs.readFileSync(f, 'utf8');
    const before = peek(ws.dbPath, (db) => ({ users: count(db, 'users'), cases: count(db, 'cases'), mig: migRows(db) }));
    fs.writeFileSync(f, original.replace('nickname TEXT', 'nickname TEXT NOT NULL DEFAULT ""'));
    const err = await rejects(boot(ws), 'MIGRATION_CHANGED', ['core/0002_users_nickname.sql', 'ถูกแก้หลัง apply', RULE, 'add a new migration', 'npm run migrate:new']);
    assert.deepEqual(err.ids, ['core/0002_users_nickname.sql']);
    const after = peek(ws.dbPath, (db) => ({ users: count(db, 'users'), cases: count(db, 'cases'), mig: migRows(db), mark: marker(db) }));
    assert.deepEqual({ users: after.users, cases: after.cases, mig: after.mig }, before, 'ไม่มีอะไรถูกลบ/เพิ่ม');
    assert.equal(after.mark.name, MARK.name);

    // แก้ 0001 ของ core (จำลองด้วย checksum ที่บันทึกไว้ต่างจากไฟล์) → เหมือนกัน
    fs.writeFileSync(f, original);
    fs.appendFileSync(path.join(ws.coreDir, '0001_init.sql'), '\n-- แก้ทีหลัง\n');
    await rejects(boot(ws), 'MIGRATION_CHANGED', ['core/0001_init.sql', RULE]);
    fs.writeFileSync(path.join(ws.coreDir, '0001_init.sql'), INIT_SQL);

    // ลบไฟล์ที่ apply แล้ว
    const demo2 = path.join(ws.demoMig, '0002_demo_note.sql');
    const demo2Sql = fs.readFileSync(demo2, 'utf8');
    fs.rmSync(demo2);
    await rejects(boot(ws), 'MIGRATION_CHANGED', ['demo/0002_demo_note.sql', 'ไม่พบไฟล์', 'ถูกลบหรือเปลี่ยนชื่อ', RULE]);

    // เปลี่ยนชื่อ → บอกทั้งชื่อเดิมและไฟล์ที่น่าจะเป็นตัวเดิม
    fs.writeFileSync(path.join(ws.demoMig, '0002_demo_note_v2.sql'), demo2Sql);
    await rejects(boot(ws), 'MIGRATION_CHANGED', ['demo/0002_demo_note.sql', 'demo/0002_demo_note_v2.sql', RULE]);
    fs.rmSync(path.join(ws.demoMig, '0002_demo_note_v2.sql'));
    fs.writeFileSync(demo2, demo2Sql);

    // CRLF (git บน Windows) ไม่นับว่าแก้ไฟล์
    fs.writeFileSync(f, original.replace(/\n/g, '\r\n'));
    const s = await boot(ws);
    try {
      assert.deepEqual(s.result, { applied: [], baselined: [] });
      assert.equal(marker(s.db).name, MARK.name, 'คืนไฟล์เดิมแล้วเริ่มได้ ข้อมูลอยู่ครบ');
      assert.deepEqual(migRows(s.db), after.mig);
    } finally {
      s.close();
    }
  });

  await t.test('(f) TEST_MODE=1 บน DB เดิม → ล้างทุกตาราง + migration ทั้งหมดใหม่ + seed', async () => {
    const s = await boot(ws, { TEST_MODE: '1' });
    try {
      assert.deepEqual(s.result.applied, ['core/0001_init.sql', 'core/0002_users_nickname.sql', 'demo/0001_demo_items.sql', 'demo/0002_demo_note.sql']);
      assert.equal(s.ctx._internal.seededAtStart, true);
      assert.equal(marker(s.db), undefined, 'ข้อมูลที่เพิ่มหายตาม reset');
      assert.equal(count(s.db, 'users'), 11);
      assert.equal(count(s.db, 'demo_items'), 0);
      assert.equal(s.db.prepare("SELECT fee FROM services WHERE id = 'SV-02'").get().fee, 500);
      for (const r of migRows(s.db)) assert.equal(r.applied_at, '2026-12-01T09:00:00+07:00', 'นาฬิกาทดสอบ');

      // POST /api/test/reset (ctx.reset) ทำแบบเดียวกัน
      insertMarker(s.db);
      s.ctx.clock.set('2026-12-10T12:00:00+07:00');
      assert.equal(await s.ctx.reset(), '2026-12-01T09:00:00+07:00');
      assert.equal(marker(s.db), undefined);
      assert.equal(count(s.db, 'users'), 11);
      assert.equal(count(s.db, 'demo_items'), 0);
      assert.equal(migRows(s.db).length, 4);
      for (const r of migRows(s.db)) assert.equal(r.applied_at, '2026-12-01T09:00:00+07:00', 'reset ซ้ำได้ค่าเดิม (NFR-09)');
      insertMarker(s.db);
    } finally {
      s.close();
    }
    const r = await boot(ws, { RESET_ON_START: '1' });
    try {
      assert.equal(r.ctx.clock.isFrozen(), false, 'RESET_ON_START ไม่ได้เปิด TEST_MODE');
      assert.equal(r.ctx._internal.seededAtStart, true);
      assert.equal(marker(r.db), undefined, 'RESET_ON_START ล้างเหมือน TEST_MODE');
      assert.equal(migRows(r.db).length, 4);
    } finally {
      r.close();
    }
  });
});

// ---------------------------------------------------------------- (e) DB รุ่นก่อน migration
/** สร้าง DB แบบที่โค้ดรุ่นก่อนสร้าง: exec ไฟล์ schema ทั้งไฟล์ + seed + meta.schema_hash (sha1) */
function makeLegacyDb(dbPath, sql = INIT_SQL, { hash = true } = {}) {
  const cfg = loadConfig({ DB_PATH: dbPath });
  const db = openDb(dbPath);
  db.exec(sql);
  seedAll({ db, crypto: createCrypto({ piiKey: cfg.piiKey }), sign: createSign({ signKey: cfg.signKey }), storage: createStorage(cfg.uploadDir) });
  if (hash) db.prepare("INSERT INTO meta(key, value) VALUES ('schema_hash', ?)").run(nodeCrypto.createHash('sha1').update(sql).digest('hex'));
  db.prepare("INSERT INTO users(username, name, role, created_at) VALUES (?, ?, 'officer', '2026-11-01T09:00:00+07:00')").run(MARK.username, MARK.name);
  db.prepare("INSERT INTO notifications(username, case_no, level, text, created_at) VALUES ('off.reg1', 'EG-2569-000020', 'overdue', 'x', '2026-11-01T09:00:00+07:00')").run();
  db.close();
}
const snapshot = (db) => ({ users: count(db, 'users'), cases: count(db, 'cases'), notifications: count(db, 'notifications'), audit: count(db, 'audit'), mark: marker(db) });

test('(e) DB รุ่นก่อน migration (มีตาราง + meta.schema_hash ไม่มี schema_migrations) ตารางตรง 0001 → baseline ไม่รัน ไม่ลบ ไม่ seed ซ้ำ', async () => {
  const ws = workspace('legacy');
  makeLegacyDb(ws.dbPath);
  const before = peek(ws.dbPath, snapshot);
  const s = await boot(ws);
  try {
    assert.deepEqual(s.result, { baselined: ['core/0001_init.sql'], applied: ['demo/0001_demo_items.sql'] }, 'core/0001 baseline · โมดูลที่เพิ่งมี migration ถูก apply ปกติ');
    assert.equal(s.ctx._internal.seededAtStart, false);
    assert.deepEqual(snapshot(s.db), before, 'ข้อมูลเดิมอยู่ครบ (รวมแถวที่ไม่ใช่ seed)');
    const rows = migRows(s.db);
    assert.equal(rows[0].id, 'core/0001_init.sql');
    assert.equal(rows[0].checksum, sha256(INIT_SQL));
    assert.equal(count(s.db, 'meta'), 0, 'ลบ schema_hash แบบเก่าออกแล้ว');
    assert.ok(s.logs.some((l) => l.includes('[migrate] baseline core/0001_init.sql')));
  } finally {
    s.close();
  }
  const again = await boot(ws);
  try {
    assert.deepEqual(again.result, { applied: [], baselined: [] }, 'เริ่มครั้งต่อไปเป็น DB ปกติแล้ว');
    assert.deepEqual(snapshot(again.db), before);
  } finally {
    again.close();
  }
});

test('(e) DB รุ่นก่อนที่ตารางไม่ตรง 0001 หรือ DB ที่ไม่รู้จัก → ไม่เริ่มระบบ ไม่ baseline ไม่ลบข้อมูล', async () => {
  const ws = workspace('legacy-bad');
  // จำลอง DB จาก schema รุ่นเก่ากว่า: ไม่มีดัชนี cases_due และ notifications ยังไม่มี UNIQUE
  const olderSql = INIT_SQL.replace('CREATE INDEX IF NOT EXISTS cases_due ON cases(due_at, case_no);\n', '').replace(',\n  UNIQUE (username, case_no, level)\n', '\n');
  assert.equal(olderSql.length < INIT_SQL.length - 60, true);
  makeLegacyDb(ws.dbPath, olderSql);
  const before = peek(ws.dbPath, snapshot);
  await rejects(boot(ws, {}, { modules: false }), 'MIGRATION_LEGACY_MISMATCH', ['core/0001_init.sql', 'ไม่มี index cases_due', 'table notifications โครงสร้างไม่ตรง', 'ไม่ได้แตะข้อมูล']);
  peek(ws.dbPath, (db) => {
    assert.deepEqual(snapshot(db), before);
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'schema_migrations'").get(), undefined);
    assert.ok(db.prepare("SELECT value FROM meta WHERE key = 'schema_hash'").get());
  });

  const ws2 = workspace('unknown-db');
  makeLegacyDb(ws2.dbPath, INIT_SQL, { hash: false });
  await rejects(boot(ws2, {}, { modules: false }), 'MIGRATION_UNKNOWN_DB', ['ไม่มี schema_migrations', 'DB_PATH']);
  peek(ws2.dbPath, (db) => assert.equal(marker(db).name, MARK.name));

  // ต่างแค่คอมเมนต์/ช่องว่างยังนับว่าตรง
  assert.equal(normalizeSql('CREATE TABLE a (\n  x TEXT, -- c\n  y INTEGER /* z */\n)'), normalizeSql('create table a(x text,y integer)'));
  assert.notEqual(normalizeSql("CREATE TABLE a (x TEXT DEFAULT 'A -- b')"), normalizeSql("CREATE TABLE a (x TEXT DEFAULT 'A')"));
});

// ---------------------------------------------------------------- เลขไฟล์ · ไฟล์ว่าง · ข้ามลำดับ
test('เลขซ้ำ/ชื่อผิดรูปแบบ/0000/schema.sql แบบเก่า → error ก่อนแตะ DB', () => {
  const dir = path.join(tmp, 'naming', 'migrations');
  const reset = (files) => {
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), c);
  };
  const expectInvalid = (fn, ...includes) => {
    assert.throws(fn, (e) => {
      assert.equal(e.name, 'MigrationError');
      assert.equal(e.code, 'MIGRATION_INVALID');
      for (const s of includes) assert.ok(e.message.includes(s), `"${s}" ใน\n${e.message}`);
      return true;
    });
  };
  reset({ '0001_a.sql': 'SELECT 1;', '0002_b.sql': 'SELECT 1;', '0010_c.sql': 'SELECT 1;', '.gitkeep': '', 'README.md': '#' });
  assert.deepEqual(readScope('x', dir).map((m) => m.id), ['x/0001_a.sql', 'x/0002_b.sql', 'x/0010_c.sql'], 'เรียงตามเลข · ข้าม dotfile/.md');
  reset({ '0001_a.sql': 'SELECT 1;', '0001_b.sql': 'SELECT 1;' });
  expectInvalid(() => readScope('x', dir), 'เลข 0001 ซ้ำกัน', '0001_a.sql', '0001_b.sql');
  for (const bad of ['1_a.sql', '00002_a.sql', '0002-a.sql', '0002_A.sql', '0002_a.SQL', '0002_a.txt', '0002.sql', 'init.sql']) {
    reset({ '0001_a.sql': 'SELECT 1;', [bad]: 'SELECT 1;' });
    expectInvalid(() => readScope('x', dir), `x/${bad}`, 'NNNN_<desc>.sql');
  }
  reset({ '0000_a.sql': 'SELECT 1;' });
  expectInvalid(() => readScope('x', dir), 'เริ่มที่ 0001');
  reset({ '0001_a.sql': 'SELECT 1;' });
  fs.writeFileSync(path.join(path.dirname(dir), 'schema.sql'), 'CREATE TABLE t(x);');
  expectInvalid(() => loadMigrations([{ name: 'x', dir }]), 'schema.sql', 'ไม่รองรับแล้ว');
  expectInvalid(() => loadMigrations([{ name: 'core', dir: path.join(tmp, 'none') }, { name: 'core', dir: path.join(tmp, 'none2') }]), 'ซ้ำ');
});

test('ไฟล์ใหม่เลขน้อยกว่าที่ apply แล้ว · ไฟล์ว่าง · SQL ผิด → ไม่เริ่ม (ไฟล์ก่อนหน้าคงอยู่ ไฟล์ที่ผิด rollback)', () => {
  const dir = path.join(tmp, 'order', 'migrations');
  fs.mkdirSync(dir, { recursive: true });
  const db = openDb(path.join(tmp, 'order', 'app.db'));
  try {
    fs.writeFileSync(path.join(dir, '0001_t.sql'), 'CREATE TABLE t (x TEXT);');
    fs.writeFileSync(path.join(dir, '0003_t_y.sql'), 'ALTER TABLE t ADD COLUMN y TEXT;');
    assert.deepEqual(migrate(db, loadMigrations([{ name: 'core', dir }])).applied, ['core/0001_t.sql', 'core/0003_t_y.sql']);
    db.prepare("INSERT INTO t(x) VALUES ('keep')").run();

    fs.writeFileSync(path.join(dir, '0002_late.sql'), 'ALTER TABLE t ADD COLUMN z TEXT;');
    assert.throws(() => migrate(db, loadMigrations([{ name: 'core', dir }])), /core\/0002_late\.sql: ยังไม่ได้ apply แต่เลขน้อยกว่า core\/0003_t_y\.sql/);
    fs.rmSync(path.join(dir, '0002_late.sql'));

    fs.writeFileSync(path.join(dir, '0004_empty.sql'), '-- ยังไม่ได้เขียน\n\n');
    assert.throws(() => migrate(db, loadMigrations([{ name: 'core', dir }])), /core\/0004_empty\.sql: ไฟล์ว่าง/);
    fs.writeFileSync(path.join(dir, '0004_empty.sql'), 'ALTER TABLE t ADD COLUMN w TEXT;');
    fs.writeFileSync(path.join(dir, '0005_broken.sql'), "INSERT INTO t(x) VALUES ('half');\nALTER TABLE nope ADD COLUMN q TEXT;");
    assert.throws(() => migrate(db, loadMigrations([{ name: 'core', dir }])), (e) => e.code === 'MIGRATION_FAILED' && e.message.includes('core/0005_broken.sql'));
    assert.deepEqual(db.prepare('SELECT id FROM schema_migrations ORDER BY rowid').all().map((r) => r.id), ['core/0001_t.sql', 'core/0003_t_y.sql', 'core/0004_empty.sql']);
    assert.deepEqual(db.prepare('SELECT x FROM t').all(), [{ x: 'keep' }], '0005 rollback ทั้งไฟล์ (ไม่มีแถว half)');
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------- migrate:new
test('npm run migrate:new -- <desc> สร้างไฟล์ว่างเลขถัดไป (core และ --module)', () => {
  const root = path.join(tmp, 'new');
  const coreDir = path.join(root, 'core', 'migrations');
  const modulesDir = path.join(root, 'modules');
  fs.mkdirSync(coreDir, { recursive: true });
  fs.mkdirSync(path.join(modulesDir, 'queue'), { recursive: true });
  fs.writeFileSync(path.join(modulesDir, 'queue', 'index.js'), '');
  fs.copyFileSync(path.join(CORE_MIGRATIONS_DIR, '0001_init.sql'), path.join(coreDir, '0001_init.sql'));

  assert.deepEqual(parseArgs(['Add', 'user', 'nickname']), { desc: 'Add_user_nickname', module: null });
  assert.deepEqual(parseArgs(['x', '--module', 'queue']), { desc: 'x', module: 'queue' });
  let f = createMigration({ desc: 'Add user-nickname!', coreDir, modulesDir });
  assert.equal(path.basename(f), '0002_add_user_nickname.sql');
  assert.equal(fs.readFileSync(f, 'utf8'), '');
  f = createMigration({ desc: 'more', coreDir, modulesDir });
  assert.equal(path.basename(f), '0003_more.sql');
  f = createMigration({ desc: 'queue_flags', module: 'queue', coreDir, modulesDir });
  assert.equal(f, path.join(modulesDir, 'queue', 'migrations', '0001_queue_flags.sql'));
  assert.throws(() => createMigration({ desc: 'ภาษาไทย', coreDir, modulesDir }), /คำอธิบายภาษาอังกฤษ/);
  assert.throws(() => createMigration({ desc: 'x', module: 'nope', coreDir, modulesDir }), /ไม่พบโมดูล/);
  fs.writeFileSync(path.join(coreDir, '0003_dup.sql'), 'SELECT 1;');
  assert.throws(() => createMigration({ desc: 'x', coreDir, modulesDir }), /เลข 0003 ซ้ำกัน/);
});

// ---------------------------------------------------------------- NFR-04
test('NFR-04: ไฟล์ migration จริงทุกไฟล์ไม่มีเลขบัตร 13 หลัก/เบอร์มือถือ (SQLite เก็บข้อความ CREATE ไว้ในไฟล์ DB)', () => {
  const appSrc = path.resolve(__dirname, '..', '..');
  const dirs = [CORE_MIGRATIONS_DIR];
  for (const m of fs.readdirSync(path.join(appSrc, 'modules'))) dirs.push(path.join(appSrc, 'modules', m, 'migrations'));
  const files = dirs.filter((d) => fs.existsSync(d)).flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.sql')).map((f) => path.join(d, f)));
  assert.ok(files.length >= 1);
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(text, /(?<!\d)\d{13}(?!\d)/, f);
    assert.doesNotMatch(text, /(?<!\d)\d-\d{4}-\d{5}-\d{2}-\d(?!\d)/, f);
    assert.doesNotMatch(text, /(?<!\d)0[689]\d{8}(?!\d)/, f);
    assert.doesNotMatch(text, /(?<!\d)0[689]\d-\d{3}-\d{4}(?!\d)/, f);
  }
});

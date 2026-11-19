'use strict';
// เปิดฐานข้อมูล SQLite ที่ DB_PATH (CONTRACT §0 ข้อ 11) · better-sqlite3 เป็นแบบ synchronous
// ใช้: ctx.db.prepare(sql).get/all/run(...) · ctx.db.tx(() => {...})  (transaction; throw = rollback)
// โครงสร้างตาราง: migration แบบเพิ่มไฟล์ (src/core/migrate.js · src/core/migrations/NNNN_<desc>.sql)
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  // rollback journal (ไม่ใช้ WAL) → ข้อมูลทั้งหมดอยู่ในไฟล์เดียว ตรวจ inspection ง่าย และปลอดภัยบน bind mount ของ Docker Desktop
  db.pragma('journal_mode = DELETE');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = OFF');
  /** รัน fn ใน transaction (ซ้อนได้: ชั้นในเป็น savepoint) · คืนค่าที่ fn คืน */
  db.tx = (fn) => db.transaction(fn)();
  return db;
}

/**
 * ลบทุกตาราง/view (ดัชนี/trigger หายตาม) รวม schema_migrations
 * ใช้เฉพาะ TEST_MODE / RESET_ON_START / POST /api/test/reset · โหมดปกติห้ามเรียก (schema เปลี่ยน = เพิ่ม migration ไม่ใช่ลบข้อมูล)
 */
function dropAll(db) {
  const objs = db.prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND type IN ('table','view')").all();
  db.exec('PRAGMA foreign_keys = OFF');
  for (const o of objs) {
    db.exec(`DROP ${o.type === 'view' ? 'VIEW' : 'TABLE'} IF EXISTS "${o.name.replace(/"/g, '""')}"`);
  }
  // sqlite_sequence (AUTOINCREMENT) ล้างให้เลข id เริ่มใหม่ทุก reset (NFR-09)
  const hasSeq = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'sqlite_sequence'").get();
  if (hasSeq) db.exec('DELETE FROM sqlite_sequence');
}

module.exports = { openDb, dropAll };

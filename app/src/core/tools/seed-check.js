#!/usr/bin/env node
'use strict';
// สรุปข้อมูลใน DB ปัจจุบัน (อ่านอย่างเดียว) เพื่อเทียบกับ TEST-DATA: npm run seed:check  (DB_PATH=... ถ้าไม่ใช่ค่าเริ่มต้น)
const Database = require('better-sqlite3');
const { loadConfig } = require('../config');

const cfg = loadConfig();
const db = new Database(cfg.dbPath, { readonly: true, fileMustExist: true });
const q = (sql, ...a) => db.prepare(sql).all(...a);
console.log('DB_PATH', cfg.dbPath);
console.log('cases by status', Object.fromEntries(q('SELECT status, COUNT(*) n FROM cases GROUP BY status').map((r) => [r.status, r.n])));
console.log('in-review by owner', Object.fromEntries(q("SELECT IFNULL(owner,'-') o, COUNT(*) n FROM cases WHERE status='IN_REVIEW' GROUP BY o").map((r) => [r.o, r.n])));
console.log('drafts', q('SELECT id, service_id, status, fee FROM drafts'));
console.log('payments', q('SELECT ref, draft_id, amount, status, qr_expires_at FROM payments'));
console.log('documents', q('SELECT doc_no, case_no, verify_code, valid_until FROM documents'));
console.log('counters', Object.fromEntries(q('SELECT name, value FROM counters').map((r) => [r.name, r.value])));
console.log('audit rows', q('SELECT COUNT(*) n FROM audit')[0].n, '· notifications', q('SELECT COUNT(*) n FROM notifications')[0].n, '· sessions', q('SELECT COUNT(*) n FROM sessions')[0].n);

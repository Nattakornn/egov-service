'use strict';
// จุดเริ่มของเว็บ · โหลดทุกโฟลเดอร์ใน src/modules อัตโนมัติ (เรียงตาม order) → ไม่มีใครต้องแก้ไฟล์นี้
// รัน: node src/server.js  (env: PORT TEST_MODE BUG_MODE DB_PATH · ดู ARCHITECTURE.md)
const fs = require('fs');
const path = require('path');
const express = require('express');
const { loadConfig } = require('./core/config');
const { createContext, mountBase, mountFinal } = require('./core');

const MODULES_DIR = path.join(__dirname, 'modules');

/** หาโมดูล: src/modules/<ชื่อ>/index.js (ข้ามโฟลเดอร์ที่ขึ้นต้นด้วย _ หรือ .) */
function discoverModules(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
    .map((d) => {
      const base = path.join(dir, d.name);
      return {
        folder: d.name,
        dir: base,
        index: path.join(base, 'index.js'),
        migrations: path.join(base, 'migrations'),
        public: path.join(base, 'public'),
      };
    })
    .filter((m) => fs.existsSync(m.index));
}

/**
 * สร้างเว็บ (ไม่ listen) · ใช้ใน test: const { app, ctx } = await createServer({ env: {...}, modulesDir: null })
 * @param {{env?: object, modulesDir?: string|null, coreMigrationsDir?: string, log?: Function}} opts
 *   modulesDir=null → ไม่โหลดโมดูล · coreMigrationsDir ใช้ใน test เท่านั้น (ค่าเริ่มต้น src/core/migrations)
 */
async function createServer({ env = process.env, modulesDir = MODULES_DIR, coreMigrationsDir, log } = {}) {
  const config = loadConfig(env);
  const found = discoverModules(modulesDir);

  // require ทุกโมดูลก่อนสร้าง ctx เพื่อรู้ลำดับโหลด (order น้อย → มาก ตามด้วยชื่อ) → migration ของโมดูลรันตามลำดับเดียวกัน
  const loaded = [];
  const loadErrors = [];
  for (const m of found) {
    try {
      const mod = require(m.index);
      if (!mod || typeof mod.register !== 'function') throw new Error('index.js ต้อง export { name, order, register(ctx) }');
      loaded.push({ ...m, name: mod.name || m.folder, order: Number.isFinite(mod.order) ? mod.order : 100, mod });
    } catch (e) {
      if (config.strictModules) throw e;
      loadErrors.push({ folder: m.folder, migrations: m.migrations, error: e });
    }
  }
  loaded.sort((a, b) => a.order - b.order || a.folder.localeCompare(b.folder));
  // migration: core ก่อน แล้วโมดูลตามลำดับโหลด · โมดูลที่ require ไม่ผ่านยังนับ (ต่อท้าย) เพื่อไม่ให้ไฟล์ที่ apply แล้วกลายเป็น "หาย"
  const failed = [...loadErrors].sort((a, b) => a.folder.localeCompare(b.folder));
  const migrationScopes = [...loaded, ...failed].map((m) => ({ name: m.folder, dir: m.migrations }));
  const ctx = createContext(config, { migrationScopes, ...(coreMigrationsDir ? { coreMigrationsDir } : {}), ...(log ? { log } : {}) });
  for (const f of loadErrors) ctx.log(`[module ${f.folder}] โหลดไม่สำเร็จ: ${f.error && f.error.stack ? f.error.stack : f.error}`);
  mountBase(ctx);

  for (const m of loaded) {
    try {
      if (fs.existsSync(m.public)) ctx.app.use(`/static/${m.folder}`, express.static(m.public, { maxAge: 0 }));
      await m.mod.register(ctx);
      ctx.modules.push({ name: m.name, folder: m.folder, order: m.order });
    } catch (e) {
      ctx.log(`[module ${m.folder}] register ล้มเหลว: ${e && e.stack ? e.stack : e}`);
      if (config.strictModules) throw e;
    }
  }
  mountFinal(ctx);

  // seed ตอนเริ่มเครื่อง → ให้โมดูลที่ใช้ onReset ได้เตรียมข้อมูลของตัวเองด้วย
  if (ctx._internal.seededAtStart) await ctx.hooks._runReset(ctx);
  return { app: ctx.app, ctx, config };
}

async function main() {
  const { app, ctx, config } = await createServer();
  const server = app.listen(config.port, () => {
    ctx.log(
      `listening on :${config.port} · TEST_MODE=${config.testMode ? '1' : 'off'} · BUG_MODE=${ctx.bugs.list().join(',') || '-'}` +
        ` · DB_PATH=${config.dbPath} · modules=[${ctx.modules.map((m) => m.folder).join(', ')}] · clock=${ctx.clock.nowIso()}`
    );
    if (ctx.bugs.unknown().length) ctx.log(`BUG_MODE มีรหัสที่ไม่รู้จัก: ${ctx.bugs.unknown().join(',')}`);
  });
  // ไฟล์ 5–6 MB ผ่านเครือข่ายช้าไม่ถูกตัด
  server.requestTimeout = 120000;
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (require.main === module) {
  main().catch((e) => {
    // MigrationError มีข้อความครบแล้ว (ไฟล์ไหน · ต้องทำอะไร) ไม่ต้องพิมพ์ stack
    // eslint-disable-next-line no-console
    console.error('[egov] start failed:', e && e.name === 'MigrationError' ? e.message : e);
    process.exit(1);
  });
}

module.exports = { createServer, discoverModules };

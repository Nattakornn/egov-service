'use strict';
// ประกอบ core: สร้าง ctx ที่ส่งให้ทุกโมดูล + middleware/route กลาง + reset
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');

const time = require('./time');
const fmt = require('./fmt');
const labels = require('./labels');
const errors = require('./errors');
const { clock } = require('./clock');
const { bugs } = require('./bugs');
const { openDb, dropAll } = require('./db');
const { migrate, loadMigrations, CORE_SCOPE, CORE_MIGRATIONS_DIR } = require('./migrate');
const { createCrypto } = require('./crypto');
const { createSign } = require('./sign');
const { createIds } = require('./ids');
const { createAudit } = require('./audit');
const { createCaseEvents } = require('./caseEvents');
const { createStorage } = require('./storage');
const { createAuth } = require('./auth');
const { createHooks } = require('./hooks');
const { createUi } = require('./ui');
const { createCatalog } = require('./catalog');
const { seedAll } = require('./seed');
const { mountCoreRoutes } = require('./routes');

/**
 * สร้าง ctx (ยังไม่โหลดโมดูล)
 * @param {object} config จาก loadConfig()
 * @param {{migrationScopes?: {name: string, dir: string}[], coreMigrationsDir?: string, log?: Function}} opts
 *   migrationScopes = โฟลเดอร์ migrations ของโมดูลตามลำดับโหลด · coreMigrationsDir ใช้ใน test เท่านั้น
 */
function createContext(config, { migrationScopes = [], coreMigrationsDir = CORE_MIGRATIONS_DIR, log = defaultLog } = {}) {
  clock.configure({ frozen: config.testMode });
  bugs.set(config.bugMode);

  const app = express();
  const db = openDb(config.dbPath);
  const crypto = createCrypto({ piiKey: config.piiKey });
  const sign = createSign({ signKey: config.signKey });
  const storage = createStorage(config.uploadDir);
  const now = () => clock.nowIso();
  // TEST_MODE / RESET_ON_START → ล้างทุกตาราง + รัน migration ทั้งหมดใหม่ + seed (atomic)
  // โหมดปกติ → apply เฉพาะ migration ที่ค้าง (ตรวจ checksum ของที่ apply แล้ว) · ไม่ลบอะไรเด็ดขาด · seed เฉพาะ DB ใหม่ที่ยังไม่มีผู้ใช้
  const fresh = config.testMode || config.resetOnStart;
  let migrations;
  let migrationResult;
  try {
    // อ่าน + ตรวจชื่อ/เลขไฟล์ก่อนแตะ DB (ผิด → throw ไม่เริ่มระบบ)
    migrations = loadMigrations([{ name: CORE_SCOPE, dir: coreMigrationsDir }, ...migrationScopes]);
    migrationResult = fresh
      ? db.tx(() => {
          dropAll(db);
          return migrate(db, migrations, { log, now });
        })
      : migrate(db, migrations, { log, now });
  } catch (e) {
    db.close();
    throw e;
  }
  const needSeed = fresh || !db.prepare('SELECT 1 FROM users LIMIT 1').get();

  const testRouter = express.Router();
  const ctx = {
    config,
    app,
    db,
    clock,
    bugs,
    time,
    fmt,
    labels,
    errors,
    crypto,
    sign,
    storage,
    log,
    shared: {},
    modules: [],
    paths: {
      appRoot: config.appRoot,
      dataDir: config.dataDir,
      uploadDir: storage.dir,
      dbPath: config.dbPath,
      assets: path.join(config.appRoot, 'assets'),
      fonts: config.fonts,
    },
    /** multer (memory) สำหรับ multipart · limit 7 MB/ไฟล์ เพื่อให้โมดูลตรวจ 5 MB เองแล้วตอบ 400 FILE_TOO_LARGE (CONTRACT §0 ข้อ 10) */
    upload: multer({ storage: multer.memoryStorage(), limits: { fileSize: 7 * 1024 * 1024, files: 10, fields: 50, fieldSize: 1024 * 1024 } }),
    /** ห่อ handler แบบ async ให้ error ไปถึง error handler กลาง */
    wrap(fn) {
      return (req, res, next) => {
        try {
          Promise.resolve(fn(req, res, next)).catch(next);
        } catch (e) {
          next(e);
        }
      };
    },
    /** ไลบรารีกฎตัวเลขของ P03 (src/rules) ถ้ามี */
    get rules() {
      try {
        return require(path.join(config.appRoot, 'src', 'rules'));
      } catch (e) {
        if (e && e.code === 'MODULE_NOT_FOUND' && String(e.message).includes(path.join('src', 'rules'))) return null;
        throw e;
      }
    },
  };
  ctx.hooks = createHooks({ testRouter, testMode: config.testMode, log });
  ctx.ids = createIds(db);
  ctx.catalog = createCatalog(db);
  ctx.audit = createAudit(db, clock);
  ctx.caseEvents = createCaseEvents(db, clock, ctx.audit);
  ctx.auth = createAuth({ db, clock, crypto, getCtx: () => ctx });
  ctx.ui = createUi({ config, hooks: ctx.hooks, getCtx: () => ctx });
  ctx.reset = () => resetAll(ctx);
  ctx._internal = { testRouter, migrations, migrationResult, seededAtStart: false };

  if (needSeed) {
    storage.wipe();
    seedAll({ db, crypto, sign, storage });
    ctx._internal.seededAtStart = true;
  }
  return ctx;
}

/** ล้างทุกอย่างแล้ว migrate + seed ใหม่ (POST /api/test/reset · NFR-09 · เรียกได้เฉพาะ TEST_MODE) */
async function resetAll(ctx) {
  const { db, storage, crypto, sign } = ctx;
  // นาฬิกากลับค่าเริ่มก่อน → applied_at ของ schema_migrations เท่ากันทุก reset (seed ไม่ใช้นาฬิกา)
  ctx.clock.reset();
  // ลบทุกตาราง (รวม schema_migrations) แล้วรัน migration ชุดที่อ่านไว้ตอนเริ่มเครื่องใหม่ทั้งหมด ใน transaction เดียว
  db.tx(() => {
    dropAll(db);
    migrate(db, ctx._internal.migrations, { now: () => ctx.clock.nowIso() });
  });
  storage.wipe();
  seedAll({ db, crypto, sign, storage });
  await ctx.hooks._runReset(ctx);
  return ctx.clock.nowIso();
}

/** middleware + route กลาง (เรียกก่อนโหลดโมดูล) */
function mountBase(ctx) {
  const { app, config } = ctx;
  app.disable('x-powered-by');
  app.set('etag', false);
  if (config.logRequests) {
    app.use((req, res, next) => {
      const t0 = Date.now();
      res.on('finish', () => ctx.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - t0}ms`));
      next();
    });
  }
  app.use('/static/core', express.static(path.join(__dirname, 'public'), { maxAge: 0 }));
  app.get('/favicon.ico', (req, res) => res.status(204).end());
  // body ≥ 6 MB (CONTRACT §0 ข้อ 10) · multipart ใช้ ctx.upload ต่อ route
  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: false, limit: '8mb' }));
  app.use(cookieParser());
  app.use(ctx.auth.loadUser);
  // CONTRACT §0 ข้อ 7: ทุก request ยกเว้น /api/test/* เรียก onRequest hooks
  app.use(async (req, res, next) => {
    if (req.path.startsWith('/api/test/') || req.path === '/api/test' || req.path.startsWith('/static/')) return next();
    try {
      await ctx.hooks._runRequest(req, ctx);
    } catch (e) {
      ctx.log('[onRequest] ' + (e && e.stack ? e.stack : e));
    }
    next();
  });
  if (config.testMode) {
    app.use(ctx._internal.testRouter);
  } else {
    app.all(['/api/test', '/api/test/*'], (req, res) => errors.send(res, 'ROUTE_NOT_FOUND'));
  }
  mountCoreRoutes(ctx);
}

/** 404 + error handler (เรียกหลังโหลดโมดูล) */
function mountFinal(ctx) {
  const { app } = ctx;
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return errors.send(res, 'ROUTE_NOT_FOUND');
    return ctx.ui.pageNotFound(req, res);
  });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let e = err;
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') e = new errors.AppError('FILE_TOO_LARGE');
      else if (err.code === 'LIMIT_FILE_COUNT') e = new errors.AppError('FILE_COUNT');
      else e = new errors.AppError('BAD_REQUEST', { detail: err.code });
    } else if (err && err.type === 'entity.too.large') {
      e = new errors.AppError('PAYLOAD_TOO_LARGE');
    } else if (err && (err.type === 'entity.parse.failed' || err.type === 'encoding.unsupported')) {
      e = new errors.AppError('BAD_REQUEST');
    } else if (!(err instanceof errors.AppError)) {
      ctx.log('[error] ' + req.method + ' ' + req.path + ' ' + (err && err.stack ? err.stack : err));
      e = new errors.AppError('INTERNAL');
    }
    if (res.headersSent) return;
    if (req.path.startsWith('/api/')) return res.status(e.status).json(e.toJSON());
    if (e.status === 401) return res.redirect(302, '/login');
    if (e.status === 403) return ctx.ui.forbidden(req, res);
    if (e.status === 404) return ctx.ui.notFound(req, res);
    return ctx.ui.errorPage(req, res, e.status, e.message);
  });
}

function defaultLog(...args) {
  // eslint-disable-next-line no-console
  console.log('[egov]', ...args);
}

module.exports = { createContext, mountBase, mountFinal, resetAll };

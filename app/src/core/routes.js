'use strict';
// route กลางของ core: /api/health · /api/test/reset · /api/test/clock · / · POST /logout
const errors = require('./errors');

function mountCoreRoutes(ctx) {
  const { app, hooks, clock, auth } = ctx;

  // NFR-06 · CONTRACT §6.6: 200 {"status":"ok"} ตรงตัว ไม่ต้องล็อกอิน ไม่ขึ้นกับ TEST_MODE
  app.get('/api/health', (req, res) => {
    try {
      ctx.db.prepare('SELECT 1').get();
    } catch (e) {
      return res.status(503).json({ status: 'error' });
    }
    res.status(200).json({ status: 'ok' });
  });

  // CONTRACT §8 (ลงทะเบียนผ่าน hooks.testRoute → ใช้ได้เฉพาะ TEST_MODE=1)
  hooks.testRoute(
    'post',
    '/api/test/reset',
    ctx.wrap(async (req, res) => {
      const now = await ctx.reset();
      res.clearCookie(auth.COOKIE, { path: '/' });
      res.status(200).json({ ok: true, now });
    })
  );
  hooks.testRoute('get', '/api/test/clock', (req, res) => {
    res.status(200).json({ now: clock.nowIso() });
  });
  hooks.testRoute('put', '/api/test/clock', (req, res) => {
    const value = req.body && req.body.now;
    try {
      const now = clock.set(value);
      return res.status(200).json({ now });
    } catch (_) {
      return errors.send(res, 'INVALID_TIME');
    }
  });

  // CONTRACT §1: '/' → /login หรือหน้าตั้งต้นตามบทบาท
  app.get('/', (req, res) => {
    res.redirect(302, auth.landingFor(req.user));
  });

  // ปุ่ม logout-btn ในหัวหน้าเว็บ (form POST) → /login
  app.post('/logout', (req, res) => {
    auth.destroySession(req, res);
    res.redirect(303, '/login');
  });
}

module.exports = { mountCoreRoutes };

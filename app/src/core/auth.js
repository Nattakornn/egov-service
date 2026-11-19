'use strict';
// session + RBAC กลาง (FR-03 ส่วนตัวกลาง · CONTRACT §0 ข้อ 6 §1)
//
// req.user (ตั้งโดย middleware ของ core ทุก request) = null | {
//   id, username, name, role, dept, scope: 'full'|'register', registered: bool, sid
// }   · role/dept มาจาก session (ค่า ณ ตอนล็อกอิน → admin เปลี่ยนบทบาทมีผลครั้งถัดไป)
//
// Guard หน้า:  app.get('/dashboard', ctx.auth.page('executive'), handler)
//   ไม่ล็อกอิน → 302 /login · ประชาชนที่ยังไม่ลงทะเบียน (scope register) → 302 /register · บทบาทไม่ตรง → 403 หน้า forbidden-msg
// Guard API:   app.get('/api/dashboard', ctx.auth.api('executive'), handler)
//   ไม่ล็อกอิน/ยังไม่ลงทะเบียน → 401 {"code":"UNAUTHENTICATED"} · บทบาทไม่ตรง → 403 {"code":"FORBIDDEN"}
//   ไม่ระบุบทบาท = ล็อกอินแล้วบทบาทใดก็ได้ (ctx.auth.api())
// หน้า/API ลงทะเบียน: ctx.auth.pendingCitizen()  (อนุญาตเฉพาะ session scope 'register')
//
// สร้าง session (โมดูล auth ของ P02 เรียก): ctx.auth.createSession(res, userRow, { scope: 'full' | 'register' })
// ออกจากระบบ: ctx.auth.destroySession(req, res) · core มี POST /logout (ปุ่ม logout-btn) ให้แล้ว
const { LANDING } = require('./labels');
const { AppError } = require('./errors');

const COOKIE = 'eg_sid';

function createAuth({ db, clock, crypto, getCtx }) {
  const qSession = db.prepare(
    `SELECT s.sid, s.role AS s_role, s.dept AS s_dept, s.scope, u.id, u.username, u.name, u.registered, u.active
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.sid = ?`
  );
  const insSession = db.prepare(
    'INSERT INTO sessions(sid, user_id, role, dept, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const delSession = db.prepare('DELETE FROM sessions WHERE sid = ?');

  function cookieOpts(req) {
    return { httpOnly: true, sameSite: 'lax', path: '/', secure: !!(req && req.secure) };
  }

  /** middleware: ตั้ง req.user จาก cookie */
  function loadUser(req, res, next) {
    req.user = null;
    const sid = req.cookies && req.cookies[COOKIE];
    if (sid && typeof sid === 'string' && sid.length <= 128) {
      const r = qSession.get(sid);
      if (r && r.active) {
        req.user = {
          id: r.id,
          username: r.username,
          name: r.name,
          role: r.s_role,
          dept: r.s_dept || null,
          scope: r.scope,
          registered: !!r.registered && r.scope === 'full',
          sid: r.sid,
        };
      }
    }
    next();
  }

  function createSession(res, user, { scope = 'full' } = {}) {
    const sid = crypto.randomHex(32);
    insSession.run(sid, user.id, user.role, user.dept || null, scope, clock.nowIso());
    res.cookie(COOKIE, sid, cookieOpts(res.req));
    return sid;
  }

  function destroySession(req, res) {
    const sid = req.cookies && req.cookies[COOKIE];
    if (sid) delSession.run(sid);
    res.clearCookie(COOKIE, cookieOpts(req));
    req.user = null;
  }

  /** หน้าตั้งต้นของผู้ใช้ (CONTRACT §1) */
  function landingFor(user) {
    if (!user) return '/login';
    if (user.role === 'citizen' && user.scope === 'register') return '/register';
    return LANDING[user.role] || '/login';
  }

  function isLoggedIn(req) {
    return !!(req.user && req.user.scope === 'full');
  }

  function page(...roles) {
    const allow = roles.flat();
    return function pageGuard(req, res, next) {
      if (!req.user) return res.redirect(302, '/login');
      if (req.user.scope === 'register') return res.redirect(302, '/register');
      if (allow.length && !allow.includes(req.user.role)) return getCtx().ui.forbidden(req, res);
      next();
    };
  }

  function api(...roles) {
    const allow = roles.flat();
    return function apiGuard(req, res, next) {
      if (!isLoggedIn(req)) return next(new AppError('UNAUTHENTICATED'));
      if (allow.length && !allow.includes(req.user.role)) return next(new AppError('FORBIDDEN'));
      next();
    };
  }

  /** เฉพาะประชาชนที่ยืนยัน ThaiD แล้วแต่ยังไม่ลงทะเบียน (cookie scope 'register') */
  function pendingCitizen({ api: isApi = false } = {}) {
    return function pendingGuard(req, res, next) {
      if (req.user && req.user.role === 'citizen' && req.user.scope === 'register') return next();
      if (isApi) return next(new AppError(req.user ? 'FORBIDDEN' : 'UNAUTHENTICATED'));
      if (req.user) return res.redirect(302, landingFor(req.user));
      return res.redirect(302, '/login');
    };
  }

  /** หา user ประชาชนจากเลขบัตร (ผ่าน id_hash) */
  function findCitizenByIdNo(idNo) {
    const h = crypto.hash(String(idNo || ''));
    if (!h) return undefined;
    return db.prepare("SELECT * FROM users WHERE id_hash = ? AND role = 'citizen'").get(h);
  }

  /** ถอดเลขบัตรของ user (ใช้เฉพาะฝั่งเซิร์ฟเวอร์ · ห้ามส่งให้เจ้าหน้าที่ ยกเว้น unmask) */
  function citizenIdNo(userRowOrId) {
    const row = typeof userRowOrId === 'object' ? userRowOrId : db.prepare('SELECT id_enc FROM users WHERE id = ?').get(userRowOrId);
    return row && row.id_enc ? crypto.dec(row.id_enc) : null;
  }

  return {
    COOKIE,
    loadUser,
    createSession,
    destroySession,
    landingFor,
    isLoggedIn,
    page,
    api,
    pendingCitizen,
    findCitizenByIdNo,
    citizenIdNo,
    hashPassword: crypto.hashPassword,
    verifyPassword: crypto.verifyPassword,
  };
}

module.exports = { createAuth, COOKIE };

'use strict';
// P02 · ยืนยันตัวตน: ThaiD จำลอง + ลงทะเบียน + SSO เจ้าหน้าที่จำลอง
// FR-01 FR-02 FR-03 (ส่วนล็อกอิน) · BR-01 BR-02 BR-03 · CONTRACT §1 §2.2 §2.3 §5 §6.1 §6.8
//
// หน้า:  GET /login (แท็บประชาชน/เจ้าหน้าที่) · GET /register (เฉพาะ session scope 'register')
// API:   POST /api/auth/thaid/start · POST /api/auth/thaid/verify · POST /api/auth/register
//        POST /api/auth/staff/login · POST /api/auth/logout · GET /api/me
//
// ข้อตกลง
// - ตัวนับ OTP ผิด/การล็อกอยู่ในตาราง core `otp_attempts` (คีย์ = crypto.hash(เลขบัตร) · ไม่เก็บเลขตรง)
//   core ล้างตารางนี้ให้ทุก reset → ไม่มีสถานะในหน่วยความจำ ไม่ต้องใช้ onReset
// - ล็อก 15 นาทีนับจากเวลาที่ผิดครั้งที่ 3 ตาม ctx.clock.now() · now ≥ locked_until = ปลดล็อก + ตัวนับเริ่มที่ 0
// - เลขบัตรที่ checksum ถูกแต่ไม่มีใน DB = ประชาชนใหม่: สร้าง user (registered=0) เมื่อ OTP ถูก แล้วไป /register
// - ข้อความ error ทั้งหมดมาจาก ctx.errors (CONTRACT §5) · JS ฝั่ง browser แสดง message ที่เซิร์ฟเวอร์ส่งมา
// - ไม่มีบั๊ก BUG_MODE ในโมดูลนี้

const OTP_CODE = '123456'; // A-05: ThaiD จำลอง OTP คงที่
const MAX_OTP_FAILS = 3; // BR-02
const LOCK_MINUTES = 15; // BR-02

/** BR-01: ตัวเลข 13 หลักพอดี และหลักที่ 13 = (11 − (Σ dᵢ×(13−i), i=1..12) mod 11) mod 10 */
function isValidThaiId(value) {
  if (typeof value !== 'string' || !/^[0-9]{13}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(value[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(value[12]);
}

/** รับค่าจาก body (JSON หรือ form) → สตริงที่ตัดช่องว่างหัวท้าย · ชนิดอื่น → '' */
function str(v) {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

/** BR-03: เบอร์มือถือ 10 หลักขึ้นต้น 0 */
function isValidMobile(v) {
  return typeof v === 'string' && /^0[0-9]{9}$/.test(v);
}

/** อีเมลไม่บังคับ · ถ้ากรอกต้องมีรูปแบบพื้นฐาน */
function isValidEmail(v) {
  return v === '' || (v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
}

function isConsent(v) {
  return v === true || v === 1 || v === 'true' || v === 'on' || v === '1' || v === 'yes';
}

// ชื่อ-สกุลจำลองที่ "ThaiD" ส่งกลับสำหรับเลขบัตรที่ไม่มีใน seed (บุคคลสมมติ)
const MOCK_FIRST = ['สมศักดิ์', 'วันดี', 'ประเสริฐ', 'กมลา', 'ธนากร', 'นภาพร', 'วีระ', 'สุดารัตน์'];
const MOCK_LAST = ['ใจงาม', 'สุขสันต์', 'มั่นคง', 'ศรีสุข', 'บุญมา', 'แสงทอง', 'ทองดี', 'รุ่งเรือง'];
function mockThaidName(idNo) {
  let a = 0;
  let b = 0;
  for (let i = 0; i < idNo.length; i++) {
    a = (a * 31 + idNo.charCodeAt(i)) % 9973;
    b = (b * 17 + idNo.charCodeAt(i)) % 9967;
  }
  return `${MOCK_FIRST[a % MOCK_FIRST.length]} ${MOCK_LAST[b % MOCK_LAST.length]}`;
}

module.exports = {
  name: 'auth',
  order: 10,
  isValidThaiId,
  isValidMobile,
  register(ctx) {
    const { app, db, clock, time, crypto, errors, auth, ui, audit, ids } = ctx;
    const esc = ui.esc;

    // ---------- OTP / ล็อก (BR-02) ----------
    const qAttempt = db.prepare('SELECT * FROM otp_attempts WHERE id_hash = ?');
    const upAttempt = db.prepare(
      `INSERT INTO otp_attempts(id_hash, fail_count, locked_until, last_fail_at, otp_sent_at)
       VALUES (@idHash, @failCount, @lockedUntil, @lastFailAt, @otpSentAt)
       ON CONFLICT(id_hash) DO UPDATE SET fail_count = excluded.fail_count, locked_until = excluded.locked_until,
         last_fail_at = excluded.last_fail_at, otp_sent_at = excluded.otp_sent_at`
    );

    /** สถานะปัจจุบันของเลขบัตร · ล็อกหมดอายุแล้ว → ปลดล็อกและตัวนับเริ่มที่ 0 */
    function attemptState(idHash, nowMs) {
      const row = qAttempt.get(idHash);
      const st = {
        idHash,
        failCount: row ? row.fail_count : 0,
        lockedUntil: row ? row.locked_until : null,
        lastFailAt: row ? row.last_fail_at : null,
        otpSentAt: row ? row.otp_sent_at : null,
      };
      if (st.lockedUntil) {
        if (nowMs < time.toDate(st.lockedUntil).getTime()) return { ...st, locked: true };
        st.failCount = 0;
        st.lockedUntil = null;
        upAttempt.run(st);
      }
      return { ...st, locked: false };
    }

    function lockedError(st) {
      return new errors.AppError('LOCKED', { lockedUntil: st.lockedUntil });
    }

    function readIdNo(body) {
      const idNo = str(body && body.idNo);
      if (!isValidThaiId(idNo)) errors.fail('INVALID_ID');
      return idNo;
    }

    /** ลบ session เดิมของ cookie นี้ (ถ้ามี) ก่อนออก session ใหม่ (กัน session fixation) */
    const delSession = db.prepare('DELETE FROM sessions WHERE sid = ?');
    function dropCurrentSession(req) {
      const sid = req.cookies && req.cookies[auth.COOKIE];
      if (sid && typeof sid === 'string') delSession.run(sid);
      req.user = null;
    }

    // ---------- API · CONTRACT §6.1 ----------
    app.post('/api/auth/thaid/start', (req, res) => {
      const idNo = readIdNo(req.body);
      const now = clock.now();
      db.tx(() => {
        const st = attemptState(crypto.hash(idNo), now.getTime());
        if (st.locked) throw lockedError(st);
        upAttempt.run({ ...st, otpSentAt: time.iso(now) });
      });
      res.json({ status: 'OTP_SENT' });
    });

    const insCitizen = db.prepare(
      `INSERT INTO users(username, password_hash, name, role, dept, id_enc, id_hash, email, registered, active, created_at)
       VALUES (?, NULL, ?, 'citizen', NULL, ?, ?, '', 0, 1, ?)`
    );

    app.post('/api/auth/thaid/verify', (req, res) => {
      const idNo = readIdNo(req.body);
      const otp = str(req.body && req.body.otp);
      const now = clock.now();
      const nowIso = time.iso(now);
      const idHash = crypto.hash(idNo);

      // ห้าม throw ภายใน tx (throw = rollback → ตัวนับผิดจะไม่ถูกบันทึก) → คืนผลแล้วค่อย throw นอก tx
      const result = db.tx(() => {
        const st = attemptState(idHash, now.getTime());
        if (st.locked) return { error: lockedError(st) };
        if (otp !== OTP_CODE) {
          const failCount = st.failCount + 1;
          if (failCount >= MAX_OTP_FAILS) {
            const lockedUntil = time.iso(time.addMinutes(now, LOCK_MINUTES));
            upAttempt.run({ ...st, failCount, lockedUntil, lastFailAt: nowIso });
            return { error: new errors.AppError('LOCKED', { lockedUntil }) };
          }
          upAttempt.run({ ...st, failCount, lastFailAt: nowIso });
          return { error: new errors.AppError('OTP_INVALID', { attemptsLeft: MAX_OTP_FAILS - failCount }) };
        }
        // OTP ถูก → ตัวนับกลับเป็น 0
        upAttempt.run({ ...st, failCount: 0, lockedUntil: null, otpSentAt: null });
        let u = auth.findCitizenByIdNo(idNo);
        if (!u) {
          // ประชาชนใหม่ที่ยืนยันกับ ThaiD จำลองแล้ว → สร้างบัญชีรอลงทะเบียน
          const info = insCitizen.run(ids.citizenUsername(), mockThaidName(idNo), crypto.enc(idNo), idHash, nowIso);
          u = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
        }
        return { user: u };
      });
      if (result.error) throw result.error;
      const user = result.user;

      if (!user.active) errors.fail('FORBIDDEN');
      const registered = !!user.registered;
      dropCurrentSession(req);
      auth.createSession(res, user, { scope: registered ? 'full' : 'register' });
      res.json({ registered });
    });

    const updRegister = db.prepare(
      `UPDATE users SET mobile_enc = ?, mobile_hash = ?, email = ?, consent_at = ?, registered = 1, updated_at = ?
       WHERE id = ? AND role = 'citizen'`
    );

    app.post('/api/auth/register', auth.pendingCitizen({ api: true }), (req, res) => {
      const body = req.body || {};
      const mobile = str(body.mobile);
      const email = str(body.email);
      if (!isValidMobile(mobile)) errors.fail('INVALID_MOBILE');
      if (!isConsent(body.consent)) errors.fail('CONSENT_REQUIRED');
      if (!isValidEmail(email)) errors.fail('BAD_REQUEST', { field: 'email' }, 'รูปแบบอีเมลไม่ถูกต้อง');
      const nowIso = clock.nowIso();
      const userId = req.user.id;
      updRegister.run(crypto.enc(mobile), crypto.hash(mobile), email, nowIso, nowIso, userId);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      dropCurrentSession(req);
      auth.createSession(res, user, { scope: 'full' });
      res.status(201).json({ registered: true, landing: auth.landingFor({ role: 'citizen', scope: 'full' }) });
    });

    const qStaff = db.prepare("SELECT * FROM users WHERE username = ? AND role <> 'citizen'");

    app.post('/api/auth/staff/login', (req, res) => {
      const body = req.body || {};
      const username = str(body.username);
      const password = typeof body.password === 'string' ? body.password : '';
      const user = username && password ? qStaff.get(username) : null;
      let ok = false;
      if (user && user.active && user.password_hash) {
        try {
          ok = !!auth.verifyPassword(password, user.password_hash);
        } catch (_) {
          ok = false;
        }
      }
      if (!ok) errors.fail('INVALID_CREDENTIALS');
      dropCurrentSession(req);
      auth.createSession(res, user, { scope: 'full' });
      audit.log({ username: user.username, role: user.role, event: 'STAFF_LOGIN', detail: '' });
      res.json({ role: user.role, dept: user.dept || null, landing: auth.landingFor({ role: user.role, scope: 'full' }) });
    });

    app.post('/api/auth/logout', (req, res) => {
      auth.destroySession(req, res);
      res.status(204).end();
    });

    app.get('/api/me', auth.api(), (req, res) => {
      const u = req.user;
      res.json({ username: u.username, name: u.name, role: u.role, dept: u.dept || null });
    });

    // ---------- หน้า /login · CONTRACT §2.2 ----------
    const M = (code) => errors.message(code);

    app.get('/login', (req, res) => {
      const body = `<h1>เข้าสู่ระบบ</h1>
<div class="card auth-card">
  <div class="auth-tabs" role="tablist" aria-label="เลือกประเภทผู้ใช้">
    <button type="button" class="auth-tab" role="tab" id="tab-citizen" data-testid="login-tab-citizen" aria-selected="true" aria-controls="panel-citizen">ประชาชน (ThaiD)</button>
    <button type="button" class="auth-tab" role="tab" id="tab-staff" data-testid="login-tab-staff" aria-selected="false" aria-controls="panel-staff">เจ้าหน้าที่</button>
  </div>

  <section class="auth-panel stack" role="tabpanel" id="panel-citizen" aria-labelledby="tab-citizen">
    <form id="thaid-form" class="stack" method="post" action="/api/auth/thaid/start" novalidate>
      <div class="field">
        <label for="thaid-id">เลขบัตรประจำตัวประชาชน 13 หลัก</label>
        <p class="hint" id="thaid-id-hint">กรอกตัวเลข 13 หลัก ไม่ต้องมีขีด</p>
        <input id="thaid-id" name="idNo" type="text" inputmode="numeric" autocomplete="off" data-testid="thaid-id-input" aria-describedby="thaid-id-hint thaid-error">
        <p class="field-error" id="thaid-error" data-testid="thaid-error" role="alert" hidden></p>
      </div>
      <div class="actions"><button type="submit" class="btn btn-primary" data-testid="thaid-submit">เข้าสู่ระบบด้วย ThaiD (จำลอง)</button></div>
    </form>

    <div class="otp-step stack" data-testid="otp-step" id="otp-step" hidden>
      <form id="otp-form" class="stack" method="post" action="/api/auth/thaid/verify" novalidate>
        <div class="field">
          <label for="otp">รหัส OTP 6 หลัก</label>
          <p class="hint" id="otp-hint">ระบบจำลอง: ส่ง OTP ไปที่แอป ThaiD แล้ว (รหัสทดสอบ ${esc(OTP_CODE)})</p>
          <input id="otp" name="otp" type="text" inputmode="numeric" autocomplete="one-time-code" data-testid="otp-input" aria-describedby="otp-hint otp-error otp-attempts-left">
          <p class="field-error" id="otp-error" data-testid="otp-error" role="alert" hidden></p>
          <p class="hint" id="otp-attempts-left" data-testid="otp-attempts-left" hidden></p>
        </div>
        <div class="actions"><button type="submit" class="btn btn-primary" data-testid="otp-submit">ยืนยัน OTP</button></div>
      </form>
    </div>

    <div class="msg msg-error lock-box" id="lock-box" role="alert" hidden>
      <p data-testid="lock-message" id="lock-message">${esc(M('LOCKED'))}</p>
      <p>ลองใหม่ได้เมื่อ <time data-testid="lock-until" id="lock-until"></time></p>
    </div>
  </section>

  <section class="auth-panel stack" role="tabpanel" id="panel-staff" aria-labelledby="tab-staff" hidden>
    <form id="staff-form" class="stack" method="post" action="/api/auth/staff/login" novalidate>
      <div class="field">
        <label for="staff-username">ชื่อผู้ใช้</label>
        <input id="staff-username" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" data-testid="staff-username" aria-describedby="staff-error">
      </div>
      <div class="field">
        <label for="staff-password">รหัสผ่าน</label>
        <input id="staff-password" name="password" type="password" autocomplete="current-password" data-testid="staff-password" aria-describedby="staff-error">
      </div>
      <p class="field-error" id="staff-error" data-testid="staff-error" role="alert" hidden></p>
      <div class="actions"><button type="submit" class="btn btn-primary" data-testid="staff-submit">เข้าสู่ระบบเจ้าหน้าที่ (SSO ภาครัฐ จำลอง)</button></div>
    </form>
  </section>
</div>
<p class="muted">ThaiD และ SSO ภาครัฐในระบบนี้เป็นตัวจำลองเพื่อการทดสอบ</p>`;
      ui.send(req, res, { title: 'เข้าสู่ระบบ', body, scripts: ['/static/auth/login.js'], styles: ['/static/auth/auth.css'] });
    });

    // ---------- หน้า /register · CONTRACT §2.3 ----------
    app.get('/register', auth.pendingCitizen(), (req, res) => {
      const body = `<h1>ลงทะเบียนใช้งานครั้งแรก</h1>
<form id="reg-form" class="card stack auth-card" method="post" action="/api/auth/register" novalidate>
  <div class="field">
    <label for="reg-name">ชื่อ-สกุล (ข้อมูลจาก ThaiD แก้ไขไม่ได้)</label>
    <input id="reg-name" name="name" type="text" readonly aria-readonly="true" value="${esc(req.user.name)}" data-testid="reg-name">
  </div>
  <div class="field">
    <label for="reg-mobile">เบอร์มือถือ <span class="req" aria-hidden="true">*</span><span class="sr-only">(จำเป็น)</span></label>
    <p class="hint" id="reg-mobile-hint">ตัวเลข 10 หลัก ขึ้นต้นด้วย 0</p>
    <input id="reg-mobile" name="mobile" type="tel" inputmode="numeric" autocomplete="tel-national" aria-required="true" data-testid="reg-mobile" aria-describedby="reg-mobile-hint reg-mobile-error">
    <p class="field-error" id="reg-mobile-error" data-testid="reg-error-mobile" role="alert" hidden></p>
  </div>
  <div class="field">
    <label for="reg-email">อีเมล (ไม่บังคับ)</label>
    <input id="reg-email" name="email" type="email" autocomplete="email" data-testid="reg-email" aria-describedby="reg-email-error">
    <p class="field-error" id="reg-email-error" role="alert" hidden></p>
  </div>
  <div class="field">
    <div class="check">
      <input id="reg-consent" name="consent" type="checkbox" value="true" aria-required="true" data-testid="reg-consent" aria-describedby="reg-consent-error">
      <label for="reg-consent">ข้าพเจ้ายินยอมให้เทศบาลเก็บรวบรวม ใช้ และประมวลผลข้อมูลส่วนบุคคลของข้าพเจ้า เพื่อการให้บริการ e-Service ตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล (PDPA)</label>
    </div>
    <p class="field-error" id="reg-consent-error" data-testid="reg-error-consent" role="alert" hidden></p>
  </div>
  <p class="field-error" id="reg-error" role="alert" hidden></p>
  <div class="actions"><button type="submit" class="btn btn-primary" data-testid="reg-submit">ลงทะเบียน</button></div>
</form>`;
      ui.send(req, res, { title: 'ลงทะเบียน', body, scripts: ['/static/auth/register.js'], styles: ['/static/auth/auth.css'] });
    });
  },
};

// TEST-PLAN §2 หมวด AUTH (TC-AUTH-01..04)
const {
  test, expect, T0, ID, MSG, STAFF_NAME, PASSWORD, OTP_OK,
  start, reset, clock, expectStatus, readBody, loginC, tid, expectPath, clickAndCapture, uiLoginCitizen, uiLoginStaff,
} = require('./_lib');

test('TC-AUTH-01 · เลขบัตร 13 หลัก + checksum', async ({ tc }) => {
  await start(T0);
  const { page, api } = await tc.anon();

  const invalid = [
    ['110170012345', '12 หลัก ต่ำกว่าขอบ'],
    ['11017001234567', '14 หลัก เกินขอบ'],
    ['1101700123457', 'checksum ผิด (ที่ถูกคือ 6)'],
    ['11017001234ab', 'ไม่ใช่ตัวเลขล้วน'],
  ];
  for (const [value, why] of invalid) {
    await test.step(`ปฏิเสธ ${value} (${why})`, async () => {
      await page.goto('/login');
      await tid(page, 'login-tab-citizen').click();
      await tid(page, 'thaid-id-input').fill(value);
      // A-45: ช่องไม่จำกัด maxlength → ต้องพิมพ์ได้ครบทุกตัว
      await expect(tid(page, 'thaid-id-input'), `${value}: ช่องต้องรับครบ ${value.length} ตัว`).toHaveValue(value);
      await tid(page, 'thaid-submit').click();
      await expect(tid(page, 'thaid-error'), `${value}: thaid-error`).toHaveText(MSG.INVALID_ID);
      await expect(tid(page, 'otp-step'), `${value}: otp-step ต้องไม่แสดง`).toBeHidden();
      await expectStatus(await api.post('/api/auth/thaid/start', { data: { idNo: value } }), 400, 'INVALID_ID', `API start ${value}`);
    });
  }

  const valid = ['1101700123456', '3100600987659', '1909900555015', '5500400111221'];
  for (const value of valid) {
    await test.step(`รับ ${value} (checksum ถูก)`, async () => {
      await page.goto('/login');
      await tid(page, 'login-tab-citizen').click();
      await tid(page, 'thaid-id-input').fill(value);
      await tid(page, 'thaid-submit').click();
      await expect(tid(page, 'otp-step'), `${value}: otp-step ต้องแสดง`).toBeVisible();
      await expect(tid(page, 'thaid-error'), `${value}: ต้องไม่มี thaid-error`).toBeHidden();
      const body = await expectStatus(await api.post('/api/auth/thaid/start', { data: { idNo: value } }), 200, null, `API start ${value}`);
      expect(body, `API start ${value}: body`).toEqual({ status: 'OTP_SENT' });
    });
  }
});

test('TC-AUTH-02 · OTP ผิด 3 ครั้งล็อก 15 นาที', async ({ tc }) => {
  await start(T0);
  const verifyPath = '/api/auth/thaid/verify';

  await test.step('ขั้น 1–3: ปิติ OTP 000000 สามครั้งผ่านหน้าจอ → ล็อก 15 นาที', async () => {
    const { page } = await tc.anon();
    await page.goto('/login');
    await tid(page, 'login-tab-citizen').click();
    await tid(page, 'thaid-id-input').fill(ID.PITI);
    await tid(page, 'thaid-submit').click();
    await expect(tid(page, 'otp-step')).toBeVisible();

    // ครั้งที่ 1
    await tid(page, 'otp-input').fill('000000');
    let r = await clickAndCapture(page, tid(page, 'otp-submit'), verifyPath);
    expect(r.status, `ครั้งที่ 1: HTTP (body=${JSON.stringify(r.body)})`).toBe(401);
    expect(r.body.code, 'ครั้งที่ 1: code').toBe('OTP_INVALID');
    expect(r.body.attemptsLeft, 'ครั้งที่ 1: attemptsLeft').toBe(2);
    await expect(tid(page, 'otp-error'), 'ครั้งที่ 1: otp-error').toHaveText(MSG.OTP_INVALID);
    await expect(tid(page, 'otp-attempts-left'), 'ครั้งที่ 1: otp-attempts-left').toHaveText('เหลือ 2 ครั้ง');

    // ครั้งที่ 2
    await tid(page, 'otp-input').fill('000000');
    r = await clickAndCapture(page, tid(page, 'otp-submit'), verifyPath);
    expect(r.status, `ครั้งที่ 2: HTTP (body=${JSON.stringify(r.body)})`).toBe(401);
    expect(r.body.attemptsLeft, 'ครั้งที่ 2: attemptsLeft').toBe(1);
    await expect(tid(page, 'otp-attempts-left'), 'ครั้งที่ 2: otp-attempts-left').toHaveText('เหลือ 1 ครั้ง');

    // ครั้งที่ 3 → ล็อก
    await tid(page, 'otp-input').fill('000000');
    r = await clickAndCapture(page, tid(page, 'otp-submit'), verifyPath);
    expect(r.status, `ครั้งที่ 3: HTTP (body=${JSON.stringify(r.body)})`).toBe(423);
    expect(r.body.code, 'ครั้งที่ 3: code').toBe('LOCKED');
    expect(new Date(r.body.lockedUntil).getTime(), `ครั้งที่ 3: lockedUntil (received ${r.body.lockedUntil})`)
      .toBe(new Date('2026-12-01T09:15:00+07:00').getTime());
    await expect(tid(page, 'lock-message'), 'ครั้งที่ 3: lock-message').toHaveText(MSG.LOCKED);
    await expect(tid(page, 'lock-until'), 'ครั้งที่ 3: lock-until data-iso').toHaveAttribute('data-iso', '2026-12-01T09:15:00+07:00');
  });

  await test.step('ขั้น 4: OTP ถูกทันที → ยัง 423', async () => {
    const { api } = await tc.anon();
    const s = await api.post('/api/auth/thaid/start', { data: { idNo: ID.PITI } });
    expect([200, 423], `start ระหว่างล็อก ควร 200 หรือ 423 (received ${s.status()})`).toContain(s.status());
    await expectStatus(await api.post('/api/auth/thaid/verify', { data: { idNo: ID.PITI, otp: OTP_OK } }), 423, 'LOCKED', 'ขั้น 4 verify 123456');
  });

  await test.step('ขั้น 5: สมชายล็อกอินปกติระหว่างที่ปิติถูกล็อก', async () => {
    const { api } = await tc.anon();
    const b = await loginC(api, ID.SOMCHAI);
    expect(b.registered, 'สมชาย registered').toBe(true);
  });

  await test.step('ขั้น 6: 09:14:59 ปิติ OTP 123456 → ยัง 423', async () => {
    await clock('2026-12-01T09:14:59+07:00');
    const { api } = await tc.anon();
    await api.post('/api/auth/thaid/start', { data: { idNo: ID.PITI } });
    await expectStatus(await api.post('/api/auth/thaid/verify', { data: { idNo: ID.PITI, otp: OTP_OK } }), 423, 'LOCKED', 'ขั้น 6 verify ที่ 09:14:59');
  });

  await test.step('ขั้น 7–8: 09:15:00 ปลดล็อก ตัวนับเริ่มใหม่ แล้ว OTP ถูก → 200', async () => {
    await clock('2026-12-01T09:15:00+07:00');
    const { page } = await tc.anon();
    await page.goto('/login');
    await tid(page, 'login-tab-citizen').click();
    await tid(page, 'thaid-id-input').fill(ID.PITI);
    await tid(page, 'thaid-submit').click();
    await expect(tid(page, 'otp-step'), 'ขั้น 7: otp-step แสดง (ไม่ถูกล็อกแล้ว)').toBeVisible();
    await tid(page, 'otp-input').fill('000000');
    let r = await clickAndCapture(page, tid(page, 'otp-submit'), verifyPath);
    expect(r.status, `ขั้น 7: HTTP (body=${JSON.stringify(r.body)})`).toBe(401);
    expect(r.body.code, 'ขั้น 7: code').toBe('OTP_INVALID');
    await expect(tid(page, 'otp-attempts-left'), 'ขั้น 7: ตัวนับเริ่มใหม่').toHaveText('เหลือ 2 ครั้ง');

    await tid(page, 'otp-input').fill(OTP_OK);
    r = await clickAndCapture(page, tid(page, 'otp-submit'), verifyPath);
    expect(r.status, `ขั้น 8: HTTP (body=${JSON.stringify(r.body)})`).toBe(200);
    await expectPath(page, '/citizen', 'ขั้น 8: ล็อกอินสำเร็จไป /citizen');
  });

  await test.step('ขั้น 9: RESET · ผิด 2 → ถูก → ออก → ผิด 2 → ไม่ล็อก', async () => {
    await reset();
    const { api } = await tc.anon();
    await expectStatus(await api.post('/api/auth/thaid/start', { data: { idNo: ID.PITI } }), 200, null, 'ขั้น 9 start');
    let b = await expectStatus(await api.post('/api/auth/thaid/verify', { data: { idNo: ID.PITI, otp: '000000' } }), 401, 'OTP_INVALID', 'ขั้น 9 ผิดครั้ง 1');
    expect(b.attemptsLeft, 'ขั้น 9 ผิดครั้ง 1 attemptsLeft').toBe(2);
    b = await expectStatus(await api.post('/api/auth/thaid/verify', { data: { idNo: ID.PITI, otp: '000000' } }), 401, 'OTP_INVALID', 'ขั้น 9 ผิดครั้ง 2');
    expect(b.attemptsLeft, 'ขั้น 9 ผิดครั้ง 2 attemptsLeft').toBe(1);
    await expectStatus(await api.post('/api/auth/thaid/verify', { data: { idNo: ID.PITI, otp: OTP_OK } }), 200, null, 'ขั้น 9 OTP ถูก');
    await expectStatus(await api.post('/api/auth/logout'), 204, null, 'ขั้น 9 logout');

    await expectStatus(await api.post('/api/auth/thaid/start', { data: { idNo: ID.PITI } }), 200, null, 'ขั้น 9 start รอบใหม่');
    b = await expectStatus(await api.post('/api/auth/thaid/verify', { data: { idNo: ID.PITI, otp: '000000' } }), 401, 'OTP_INVALID', 'ขั้น 9 รอบใหม่ ผิดครั้ง 1');
    expect(b.attemptsLeft, 'ขั้น 9 รอบใหม่ ผิดครั้ง 1 attemptsLeft (ตัวนับถูกรีเซ็ตเป็น 0)').toBe(2);
    b = await expectStatus(await api.post('/api/auth/thaid/verify', { data: { idNo: ID.PITI, otp: '000000' } }), 401, 'OTP_INVALID', 'ขั้น 9 รอบใหม่ ผิดครั้ง 2 (ต้องไม่ล็อก)');
    expect(b.attemptsLeft, 'ขั้น 9 รอบใหม่ ผิดครั้ง 2 attemptsLeft').toBe(1);
  });
});

test('TC-AUTH-03 · ลงทะเบียนครั้งแรก', async ({ tc }) => {
  await start(T0);
  const { page } = await tc.anon();

  await uiLoginCitizen(page, ID.MANA);
  await expectPath(page, '/register', 'มานะยังไม่ลงทะเบียน → /register');

  await test.step('1: reg-name = มานะ ตั้งใจ และ readOnly', async () => {
    const name = tid(page, 'reg-name');
    await expect(name, 'reg-name ค่า').toHaveValue('มานะ ตั้งใจ');
    expect(await name.evaluate((e) => e.readOnly), 'reg-name readOnly').toBe(true);
    await name.focus();
    await page.keyboard.type('ทดสอบ');
    await expect(name, 'reg-name พิมพ์แล้วค่าไม่เปลี่ยน').toHaveValue('มานะ ตั้งใจ');
  });

  for (const mobile of ['081234567', '08123456789', '1812345678', '08123abcde']) {
    await test.step(`2–4: เบอร์ ${mobile} → reg-error-mobile`, async () => {
      await tid(page, 'reg-mobile').fill(mobile);
      await tid(page, 'reg-consent').setChecked(true);
      await tid(page, 'reg-submit').click();
      await expect(tid(page, 'reg-error-mobile'), `เบอร์ ${mobile}`).toHaveText(MSG.INVALID_MOBILE);
      await expectPath(page, '/register', `เบอร์ ${mobile}: ยังอยู่ /register`);
    });
  }

  await test.step('5: เบอร์ถูก ไม่ติ๊กยินยอม → reg-error-consent', async () => {
    await tid(page, 'reg-mobile').fill('0845678901');
    await tid(page, 'reg-consent').setChecked(false);
    await tid(page, 'reg-submit').click();
    await expect(tid(page, 'reg-error-consent')).toHaveText(MSG.CONSENT_REQUIRED);
    await expectPath(page, '/register', 'ไม่ยินยอม: ยังอยู่ /register');
  });

  await test.step('6: เบอร์ถูก + ติ๊ก + อีเมลว่าง → /citizen', async () => {
    await tid(page, 'reg-mobile').fill('0845678901');
    await tid(page, 'reg-email').fill('');
    await tid(page, 'reg-consent').setChecked(true);
    await tid(page, 'reg-submit').click();
    await expectPath(page, '/citizen', 'ลงทะเบียนสำเร็จ → /citizen');
    await expect(tid(page, 'citizen-welcome')).toHaveText('สวัสดี มานะ ตั้งใจ');
  });

  await test.step('7: ออกจากระบบ → ล็อกอินมานะอีกครั้ง เข้า /citizen ตรง ๆ', async () => {
    await tid(page, 'logout-btn').click();
    await expectPath(page, '/login', 'logout → /login');
    const visited = [];
    const onNav = (f) => { if (f === page.mainFrame()) visited.push(f.url()); };
    page.on('framenavigated', onNav);
    await uiLoginCitizen(page, ID.MANA);
    await expectPath(page, '/citizen', 'ล็อกอินครั้งที่ 2 → /citizen');
    page.off('framenavigated', onNav);
    expect(visited.filter((u) => new URL(u).pathname === '/register'), 'ต้องไม่ผ่าน /register').toEqual([]);
  });

  await test.step('8: RESET · API register ตรวจฝั่งเซิร์ฟเวอร์', async () => {
    await reset();
    const { api } = await tc.anon();
    await expectStatus(await api.post('/api/auth/thaid/start', { data: { idNo: ID.MANA } }), 200, null, 'start มานะ');
    const v = await expectStatus(await api.post('/api/auth/thaid/verify', { data: { idNo: ID.MANA, otp: OTP_OK } }), 200, null, 'verify มานะ');
    expect(v.registered, 'มานะหลัง RESET registered').toBe(false);
    await expectStatus(
      await api.post('/api/auth/register', { data: { mobile: '081234567', email: '', consent: true } }),
      400, 'INVALID_MOBILE', 'register เบอร์ 9 หลัก', MSG.INVALID_MOBILE,
    );
    await expectStatus(
      await api.post('/api/auth/register', { data: { mobile: '0845678901', email: '', consent: false } }),
      400, 'CONSENT_REQUIRED', 'register consent:false', MSG.CONSENT_REQUIRED,
    );
  });
});

test('TC-AUTH-04 · เจ้าหน้าที่ SSO จำลองและหน้าตั้งต้น', async ({ tc }) => {
  await start(T0);
  const { page, api } = await tc.anon();

  await page.goto('/login');
  await tid(page, 'login-tab-staff').click();
  await expect(tid(page, 'staff-submit'), 'ข้อความปุ่ม staff-submit').toHaveText('เข้าสู่ระบบเจ้าหน้าที่ (SSO ภาครัฐ จำลอง)');

  const rows = [
    ['off.reg1', '/officer/queue', 'เจ้าหน้าที่', 'officer', 'registry'],
    ['off.reg2', '/officer/queue', 'เจ้าหน้าที่', 'officer', 'registry'],
    ['off.works1', '/officer/queue', 'เจ้าหน้าที่', 'officer', 'works'],
    ['head1', '/head/approvals', 'หัวหน้าฝ่าย', 'head', null],
    ['exec1', '/dashboard', 'ผู้บริหาร', 'executive', null],
    ['audit1', '/audit', 'ผู้ตรวจสอบภายใน', 'auditor', null],
    ['admin1', '/admin/services', 'ผู้ดูแลระบบ', 'admin', null],
  ];
  for (const [username, landing, roleText, role, dept] of rows) {
    await test.step(`${username} → ${landing}`, async () => {
      await uiLoginStaff(page, username);
      await expectPath(page, landing, `${username}: หน้าตั้งต้น`);
      await expect(tid(page, 'user-name'), `${username}: user-name`).toHaveText(STAFF_NAME[username]);
      await expect(tid(page, 'user-role'), `${username}: user-role`).toHaveText(roleText);
      await expect(tid(page, 'user-role'), `${username}: data-role`).toHaveAttribute('data-role', role);
      if (dept) await expect(tid(page, 'user-role'), `${username}: data-dept`).toHaveAttribute('data-dept', dept);
      await tid(page, 'logout-btn').click();
      await expectPath(page, '/login', `${username}: logout → /login`);
    });
  }

  await test.step('API staff/login คืน role/dept/landing', async () => {
    const { api: a2 } = await tc.anon();
    const b = await expectStatus(await a2.post('/api/auth/staff/login', { data: { username: 'off.reg1', password: PASSWORD } }), 200, null, 'staff login off.reg1');
    expect(b, 'body staff/login off.reg1').toMatchObject({ role: 'officer', dept: 'registry', landing: '/officer/queue' });
  });

  const bad = [
    ['off.reg1', 'wrong', 'รหัสผ่านผิด'],
    ['nobody', PASSWORD, 'username ไม่มี'],
    [ID.SOMCHAI, PASSWORD, 'เลขบัตรประชาชนในช่อง username'],
  ];
  for (const [username, password, why] of bad) {
    await test.step(`ปฏิเสธ: ${why}`, async () => {
      await uiLoginStaff(page, username, password);
      await expect(tid(page, 'staff-error'), `${why}: staff-error`).toHaveText(MSG.INVALID_CREDENTIALS);
      await expectPath(page, '/login', `${why}: ยังอยู่ /login`);
      await expectStatus(
        await api.post('/api/auth/staff/login', { data: { username, password } }),
        401, 'INVALID_CREDENTIALS', `API ${why}`, MSG.INVALID_CREDENTIALS,
      );
    });
  }

  await test.step('หลังออกจากระบบ เปิด /officer/queue → /login', async () => {
    await uiLoginStaff(page, 'off.reg1');
    await expectPath(page, '/officer/queue');
    await tid(page, 'logout-btn').click();
    await expectPath(page, '/login');
    await page.goto('/officer/queue');
    await expectPath(page, '/login', 'เปิด /officer/queue หลัง logout ต้อง redirect /login');
    const res = await page.request.get('/api/me');
    expect(res.status(), `GET /api/me หลัง logout (body=${JSON.stringify(await readBody(res))})`).toBe(401);
  });
});

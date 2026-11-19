// @ts-check
// TC-RBAC-01..06 (TEST-PLAN §15)
'use strict';

const {
  test, expect, ID, C, REASON10,
  tid, gotoStatus, expectHttp, expectApiError, okJson, newPaid, expectCaseStatus, expectCount, expectText,
  auditFilter, auditRows, grabDownload,
} = require('./_lib');

const NAVS = ['nav-my-cases', 'nav-queue', 'nav-approvals', 'nav-bell', 'nav-dashboard', 'nav-audit', 'nav-admin-services', 'nav-admin-holidays', 'nav-admin-users'];

test.describe('RBAC', () => {
  test('TC-RBAC-01 · ประชาชนเปิดคำขอคนอื่นไม่ได้ (IDOR)', async ({ kit }) => {
    const somying = await kit.loginC(ID.somying);
    const page = await kit.pageFor(somying);

    await gotoStatus(page, `/citizen/cases/${C(5)}`, 404, 'UI …000005 (ของสมชาย)');
    await expectText(tid(page, 'not-found-msg'), 'ไม่พบคำขอ', 'not-found-msg');
    await expectCount(tid(page, 'case-no'), 0, 'case-no');
    await expectCount(tid(page, 'case-status'), 0, 'case-status');
    const html = await page.content();
    expect(html.includes('สมชาย'), 'HTML: expected no "สมชาย", received it').toBe(false);

    const r1 = await somying.get(`/api/cases/${C(5)}`);
    const j1 = await expectApiError(r1, 404, 'NOT_FOUND', 'GET …000005', 'ไม่พบคำขอ');
    const t1 = JSON.stringify(j1);
    const r2 = await somying.get('/api/cases/EG-2569-999999');
    const j2 = await expectApiError(r2, 404, 'NOT_FOUND', 'GET …999999', 'ไม่พบคำขอ');
    const t2 = JSON.stringify(j2);
    expect(t2, `เนื้อหา 404 เลขไม่มีจริง: expected identical to ${t1}, received ${t2}`).toBe(t1);

    await expectHttp(await somying.get('/api/documents/DOC-2569-000001/pdf'), 404, 'GET pdf ของสมชาย');
    await expectHttp(await somying.get('/api/drafts/DR-0001'), 404, 'GET DR-0001 ของสมชาย');
    await expectHttp(await somying.post(`/api/cases/${C(30)}/cancel`), 404, 'cancel …000030 ของสมชาย');

    await gotoStatus(page, `/citizen/cases/${C(7)}`, 200, 'UI …000007 ของตัวเอง');
    await expectText(tid(page, 'case-no'), C(7), 'case-no ของตัวเอง');

    const somchai = await kit.loginC(ID.somchai);
    await expectHttp(await somchai.get(`/api/cases/${C(5)}`), 200, 'สมชาย GET …000005 ของตัวเอง');
  });

  test('TC-RBAC-02 · เจ้าหน้าที่อนุมัติ SV-02 ไม่ได้ (ตรวจที่ API)', async ({ kit }) => {
    const reg2 = await kit.loginS('off.reg2');
    const status = async (api, caseNo) => (await okJson(await api.get(`/api/cases/${caseNo}`), `GET ${caseNo}`)).status;

    // 1-3 ยิง API ตรง (ไม่เชื่อว่าปุ่มซ่อน = ปลอดภัย · BUGS B07)
    await expectApiError(await reg2.post(`/api/cases/${C(14)}/approve`), 403, 'FORBIDDEN', '#1 off.reg2 approve …000014');
    expect(await status(reg2, C(14)), '#1 สถานะ …000014: expected PENDING_APPROVAL').toBe('PENDING_APPROVAL');
    await expectApiError(await reg2.post(`/api/cases/${C(13)}/approve`), 403, 'FORBIDDEN', '#2 off.reg2 approve …000013');
    expect(await status(reg2, C(13)), '#2 สถานะ …000013: expected IN_REVIEW').toBe('IN_REVIEW');
    await expectHttp(await reg2.post(`/api/cases/${C(14)}/reject`, { data: { reason: REASON10 } }), 403, '#3 off.reg2 reject …000014');
    expect(await status(reg2, C(14)), '#3 สถานะ …000014: expected PENDING_APPROVAL').toBe('PENDING_APPROVAL');

    // 4 UI
    const page = await kit.pageFor(reg2);
    for (const n of [13, 14]) {
      await page.goto(`/officer/cases/${C(n)}`);
      await expectCount(tid(page, 'approve-btn'), 0, `#4 approve-btn …0000${n}`);
    }

    // 5-6 head1
    const head = await kit.loginS('head1');
    await expectHttp(await head.post(`/api/cases/${C(25)}/approve`), 403, '#5 head1 approve SV-01 …000025');
    expect(await status(head, C(25)), '#5 สถานะ …000025: expected IN_REVIEW').toBe('IN_REVIEW');
    const ok = await okJson(await head.post(`/api/cases/${C(14)}/approve`), '#6 head1 approve …000014');
    expect(ok.status, `#6 status: expected APPROVED, received ${ok.status}`).toBe('APPROVED');

    // 7 Audit
    const aud = await kit.loginS('audit1');
    const ap = await kit.pageFor(aud);
    await gotoStatus(ap, '/audit', 200, '#7 /audit');
    await auditFilter(ap, { event: 'APPROVE' }, 1, '#7 APPROVE');
    const rows = await auditRows(ap);
    expect(rows.map((r) => `${r.actor}/${r.caseNo}`), '#7 APPROVE rows: expected only head1/…000014')
      .toEqual([`head1/${C(14)}`]);
  });

  test('TC-RBAC-03 · ตารางสิทธิ์หน้า/API ตามบทบาท', async ({ kit }) => {
    const ROLES = ['anon', 'citizen', 'officer', 'head', 'executive', 'auditor', 'admin'];
    const OK = 'ok';
    const F = 403;
    const R = 'login';
    const PAGES = [
      ['/citizen', [R, OK, F, F, F, F, F]],
      ['/officer/queue', [R, F, OK, OK, F, F, F]],
      ['/head/approvals', [R, F, F, OK, F, F, F]],
      ['/dashboard', [R, F, F, F, OK, F, F]],
      ['/audit', [R, F, F, F, F, OK, F]],
      ['/admin/services', [R, F, F, F, F, F, OK]],
      ['/admin/holidays', [R, F, F, F, F, F, OK]],
      ['/admin/users', [R, F, F, F, F, F, OK]],
      ['/notifications', [R, F, OK, OK, F, F, F]],
      ['/verify/K7M2Q9XA', [OK, OK, OK, OK, OK, OK, OK]],
    ];
    const APIS = [
      ['GET', '/api/officer/queue', null, [401, 403, 200, 200, 403, 403, 403]],
      ['GET', '/api/notifications', null, [401, 403, 200, 200, 403, 403, 403]],
      ['GET', '/api/dashboard?period=2026-12&service=ALL', null, [401, 403, 403, 403, 200, 403, 403]],
      ['GET', '/api/audit', null, [401, 403, 403, 403, 403, 200, 403]],
      ['GET', '/api/admin/services', null, [401, 403, 403, 403, 403, 403, 200]],
      ['POST', '/api/drafts', { serviceId: 'SV-01', qty: 1 }, [401, 201, 403, 403, 403, 403, 403]],
      ['GET', `/api/cases/${C(25)}`, null, [401, 200, 200, 200, 403, 403, 403], 'somying'],
      ['POST', `/api/officer/cases/${C(28)}/claim`, null, [401, 403, 200, 403, 403, 403, 403]], // ลำดับสุดท้าย
    ];
    const NAV_OF = {
      citizen: ['nav-my-cases'],
      officer: ['nav-queue', 'nav-bell'],
      head: ['nav-queue', 'nav-approvals', 'nav-bell'],
      executive: ['nav-dashboard'],
      auditor: ['nav-audit'],
      admin: ['nav-admin-services', 'nav-admin-holidays', 'nav-admin-users'],
    };
    const USER = { officer: 'off.reg1', head: 'head1', executive: 'exec1', auditor: 'audit1', admin: 'admin1' };
    const LANDING = { citizen: '/citizen', officer: '/officer/queue', head: '/head/approvals', executive: '/dashboard', auditor: '/audit', admin: '/admin/services' };

    const problems = [];
    for (let i = 0; i < ROLES.length; i++) {
      const role = ROLES[i];
      if (i > 0) await kit.fresh(); // RESET ก่อนแต่ละบทบาท
      let api = null;
      let somying = null;
      if (role === 'citizen') {
        api = await kit.loginC(ID.somchai);
        somying = await kit.loginC(ID.somying);
      } else if (role !== 'anon') {
        api = await kit.loginS(USER[role]);
      } else {
        api = await kit.newApi();
      }
      const page = role === 'anon' ? await kit.anonPage() : await kit.pageFor(api);

      // ส่วน A หน้า
      for (const [url, row] of PAGES) {
        const want = row[i];
        const res = await page.goto(url);
        const st = res ? res.status() : -1;
        const pathNow = new URL(page.url()).pathname;
        if (want === R) {
          if (pathNow !== '/login') problems.push(`A ${role} ${url}: expected redirect /login, received ${pathNow} (HTTP ${st})`);
        } else if (want === OK) {
          if (st !== 200) problems.push(`A ${role} ${url}: expected HTTP 200, received ${st}`);
          if (pathNow !== url.split('?')[0]) problems.push(`A ${role} ${url}: expected stay on ${url}, received ${pathNow}`);
          if ((await tid(page, 'forbidden-msg').count()) !== 0) problems.push(`A ${role} ${url}: expected no forbidden-msg, received one`);
        } else {
          if (st !== 403) problems.push(`A ${role} ${url}: expected HTTP 403, received ${st}`);
          const msg = (await tid(page, 'forbidden-msg').count()) ? (await tid(page, 'forbidden-msg').first().innerText()).trim() : '<none>';
          if (msg !== 'ไม่มีสิทธิ์เข้าถึงหน้านี้') problems.push(`A ${role} ${url}: expected forbidden-msg "ไม่มีสิทธิ์เข้าถึงหน้านี้", received "${msg}"`);
        }
      }

      // ส่วน D เมนู
      if (role !== 'anon') {
        await page.goto(LANDING[role]);
        for (const nav of NAVS) {
          const want = NAV_OF[role].includes(nav) ? 1 : 0;
          const got = await tid(page, nav).count();
          if ((want === 1 && got < 1) || (want === 0 && got !== 0)) problems.push(`D ${role} ${nav}: expected ${want ? '≥1' : 0}, received ${got}`);
        }
      }

      // ส่วน B API (claim ลำดับสุดท้าย)
      for (const [method, url, data, row, as] of APIS) {
        const who = as === 'somying' && somying ? somying : api;
        const res = await who.fetch(url, { method, ...(data ? { data } : {}) });
        if (res.status() !== row[i]) problems.push(`B ${role}${as && role === 'citizen' ? '(สมหญิง)' : ''} ${method} ${url}: expected ${row[i]}, received ${res.status()}`);
      }
    }

    // ส่วน C ขอบเขตแผนก
    await kit.fresh();
    const works = await kit.loginS('off.works1');
    const reg1 = await kit.loginS('off.reg1');
    const c1 = await works.post(`/api/officer/cases/${C(28)}/claim`);
    if (c1.status() !== 403) problems.push(`C off.works1 claim …000028: expected 403, received ${c1.status()}`);
    const c2 = await reg1.post(`/api/officer/cases/${C(10)}/claim`);
    if (c2.status() !== 403) problems.push(`C off.reg1 claim …000010: expected 403, received ${c2.status()}`);
    const q = await okJson(await works.get('/api/officer/queue?filter=all'), 'C off.works1 queue');
    const qs = (q.items || []).map((x) => x.caseNo);
    if (JSON.stringify(qs) !== JSON.stringify([C(10)])) problems.push(`C off.works1 queue: expected [${C(10)}], received ${JSON.stringify(qs)}`);

    expect(problems, `RBAC matrix: expected 0 mismatches, received ${problems.length}`).toEqual([]);
  });

  test('TC-RBAC-04 · ผู้ดูแลระบบ: บริการ วันหยุด ผู้ใช้ และยอดที่ล็อก', async ({ kit }) => {
    const admin = await kit.loginS('admin1');
    const ap = await kit.pageFor(admin);

    // 1
    await gotoStatus(ap, '/admin/holidays', 200, '#1 /admin/holidays');
    await expectCount(tid(ap, 'holiday-row'), 4, '#1 holiday-row');
    const dates = await tid(ap, 'holiday-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-date')).sort());
    expect(dates, '#1 data-date').toEqual(['2026-12-07', '2026-12-10', '2026-12-31', '2027-01-01']);

    // 2 NEW_PAID ก่อนแก้
    const p1 = await newPaid(kit, { serviceId: 'SV-01', qty: 1, at: '2026-12-01T09:00:00+07:00', expectFee: 20 });
    expect(p1.caseNo, `#2 caseNo: expected ${C(31)}, received ${p1.caseNo}`).toBe(C(31));
    const due31 = (await okJson(await p1.api.get(`/api/cases/${C(31)}`), '#2 GET …000031')).dueAt;
    expect(due31, `#2 dueAt: expected 2026-12-04T16:30:00+07:00, received ${due31}`).toBe('2026-12-04T16:30:00+07:00');

    // 3 แก้ค่าธรรมเนียม
    const feeOf = async (id) => {
      const j = await okJson(await admin.get('/api/admin/services'), 'GET /api/admin/services');
      const s = (j.items || []).find((x) => x.id === id);
      return s && s.fee;
    };
    await gotoStatus(ap, '/admin/services', 200, '#3 /admin/services');
    await tid(ap, 'svc-fee-SV-01').fill('25');
    await tid(ap, 'svc-save-SV-01').click();
    await expect(tid(ap, 'action-success'), '#3 SV-01 action-success: expected visible').toBeVisible();
    await expect.poll(() => feeOf('SV-01'), { message: '#3 SV-01 fee: expected 25' }).toBe(25);
    await gotoStatus(ap, '/admin/services', 200, '#3 /admin/services (SV-02)');
    await tid(ap, 'svc-fee-SV-02').fill('600');
    await tid(ap, 'svc-save-SV-02').click();
    await expect(tid(ap, 'action-success'), '#3 SV-02 action-success: expected visible').toBeVisible();
    await expect.poll(() => feeOf('SV-02'), { message: '#3 SV-02 fee: expected 600' }).toBe(600);

    // 4 สมชายร่างใหม่
    const somchai = await kit.loginC(ID.somchai);
    const cp = await kit.pageFor(somchai);
    await gotoStatus(cp, '/citizen/new/SV-01', 200, '#4 /citizen/new/SV-01');
    await tid(cp, 'qty-input').fill('5');
    await expectText(tid(cp, 'fee-total'), '฿125', '#4 qty 5 fee-total');
    await tid(cp, 'qty-input').fill('1');
    await expectText(tid(cp, 'fee-total'), '฿25', '#4 qty 1 fee-total');
    await gotoStatus(cp, '/citizen/new/SV-02', 200, '#4 /citizen/new/SV-02');
    await expectText(tid(cp, 'fee-total'), '฿600', '#4 SV-02 fee-total');
    await gotoStatus(cp, `/citizen/cases/${C(30)}`, 200, '#4 …000030');
    await expectText(tid(cp, 'case-fee'), '฿20', '#4 …000030 case-fee เดิม');

    // 5 ยอดที่ล็อกของ PP-0001
    await gotoStatus(cp, '/citizen/new/SV-02?draft=DR-0002', 200, '#5 เปิด DR-0002');
    await expectText(tid(cp, 'payment-amount'), '฿500', '#5 payment-amount');
    const h = await kit.anon();
    await expectApiError(await h.post('/api/test/payments/PP-0001/pay', { data: { amount: 600 } }), 422, 'AMOUNT_MISMATCH', '#5 pay 600');
    const paid = await okJson(await h.post('/api/test/payments/PP-0001/pay', { data: { amount: 500 } }), '#5 pay 500');
    expect(paid.status, `#5 status: expected PAID, received ${paid.status}`).toBe('PAID');
    expect(paid.caseNo, `#5 caseNo: expected ${C(32)}, received ${paid.caseNo}`).toBe(C(32));

    // 6 เพิ่มวันหยุด
    await gotoStatus(ap, '/admin/holidays', 200, '#6 /admin/holidays');
    await tid(ap, 'holiday-date-input').fill('2026-12-02');
    await tid(ap, 'holiday-name-input').fill('วันหยุดทดสอบ');
    await tid(ap, 'holiday-add-btn').click();
    await expectCount(tid(ap, 'holiday-row'), 5, '#6 holiday-row');
    const due31b = (await okJson(await p1.api.get(`/api/cases/${C(31)}`), '#6 GET …000031')).dueAt;
    expect(due31b, `#6 dueAt …000031 ไม่คำนวณใหม่: expected 2026-12-04T16:30:00+07:00, received ${due31b}`).toBe('2026-12-04T16:30:00+07:00');

    // 7 NEW_PAID หลังเพิ่มวันหยุด
    const p2 = await newPaid(kit, { serviceId: 'SV-01', qty: 1, at: '2026-12-01T09:00:00+07:00', expectFee: 25 });
    expect(p2.caseNo, `#7 caseNo: expected ${C(33)}, received ${p2.caseNo}`).toBe(C(33));
    const due33 = (await okJson(await p2.api.get(`/api/cases/${C(33)}`), '#7 GET …000033')).dueAt;
    expect(due33, `#7 dueAt: expected 2026-12-08T16:30:00+07:00, received ${due33}`).toBe('2026-12-08T16:30:00+07:00');

    // 8 เปลี่ยนบทบาท exec1 → auditor
    await okJson(await admin.put('/api/admin/users/exec1', { data: { role: 'auditor', dept: '' } }), '#8 PUT users/exec1');
    const exec = await kit.newApi();
    const lr = await okJson(await exec.post('/api/auth/staff/login', { data: { username: 'exec1', password: 'Test@1234' } }), '#8 exec1 login ใหม่');
    expect(lr.landing, `#8 landing: expected /audit, received ${lr.landing}`).toBe('/audit');
    const ep = await kit.pageFor(exec);
    await ep.goto('/');
    expect(new URL(ep.url()).pathname, `#8 หน้าตั้งต้น: expected /audit, received ${ep.url()}`).toBe('/audit');
    await gotoStatus(ep, '/dashboard', 403, '#8 exec1 /dashboard');

    // 9 Audit ADMIN_CHANGE = 4
    await gotoStatus(ep, '/audit', 200, '#9 /audit');
    await auditFilter(ep, { event: 'ADMIN_CHANGE' }, 4, '#9 ADMIN_CHANGE');
    let rows = await auditRows(ep);
    for (const r of rows) {
      expect(r.actor, `#9 data-actor: expected admin1, received ${r.actor}`).toBe('admin1');
      expect(r.role, `#9 audit-role: expected admin, received ${r.role}`).toBe('admin');
    }
    const details = rows.map((r) => r.detail || '');
    for (const d of ['SV-01 fee 20 → 25', 'SV-02 fee 500 → 600', 'holiday add 2026-12-02', 'exec1 role executive → auditor']) {
      expect(details.some((x) => x.includes(d)), `#9 detail: expected a row containing "${d}", received ${JSON.stringify(details)}`).toBe(true);
    }

    // 10 admin ทำรายการคำขอไม่ได้
    await expectHttp(await admin.post('/api/drafts', { data: { serviceId: 'SV-01', qty: 1 } }), 403, '#10 admin POST /api/drafts');

    // 11 ลบวันหยุด
    await gotoStatus(ap, '/admin/holidays', 200, '#11 /admin/holidays');
    await ap.locator('[data-testid="holiday-row"][data-date="2026-12-02"]').getByTestId('holiday-delete-btn').click();
    await expectCount(tid(ap, 'holiday-row'), 4, '#11 holiday-row');
    await gotoStatus(ep, '/audit', 200, '#11 /audit');
    await auditFilter(ep, { event: 'ADMIN_CHANGE' }, 5, '#11 ADMIN_CHANGE');
    rows = await auditRows(ep);
    expect(rows.some((r) => (r.detail || '').includes('holiday delete 2026-12-02')),
      `#11 detail: expected "holiday delete 2026-12-02", received ${JSON.stringify(rows.map((r) => r.detail))}`).toBe(true);
  });

  test('TC-RBAC-05 · สิทธิ์เปิด/ดาวน์โหลดไฟล์แนบ', async ({ kit }) => {
    const users = {};
    for (const u of ['off.reg1', 'off.reg2', 'off.works1', 'head1', 'exec1', 'audit1', 'admin1']) users[u] = await kit.loginS(u);
    users['สมหญิง'] = await kit.loginC(ID.somying);
    users['สมชาย'] = await kit.loginC(ID.somchai);
    users['ไม่ล็อกอิน'] = await kit.newApi();

    // fileId จากผู้มีสิทธิ์ (head1 ทุกแผนก · สมหญิงสำหรับ …000025)
    const files = {};
    for (const n of [25, 10, 12, 11]) {
      const j = await okJson(await users.head1.get(`/api/cases/${C(n)}/files`), `head1 files …0000${n}`);
      files[n] = j.items || [];
    }
    const own25 = await okJson(await users['สมหญิง'].get(`/api/cases/${C(25)}/files`), 'สมหญิง files …000025');
    const fid = (n) => (n === 25 && own25.items && own25.items[0] ? own25.items[0].fileId : files[n][0] && files[n][0].fileId);

    const SV03 = ['deed.pdf', 'id-card.pdf', 'plan.pdf'];
    const table = [
      ['off.reg1', 25, 200, ['id-card.pdf']],
      ['off.works1', 25, 403],
      ['off.reg2', 12, 200, SV03],
      ['off.works1', 12, 403],
      ['off.works1', 10, 200, SV03],
      ['off.reg1', 10, 200, SV03],
      ['off.works1', 11, 200, SV03],
      ['head1', 25, 200, ['id-card.pdf']],
      ['head1', 10, 200, SV03],
      ['head1', 12, 200, SV03],
      ['สมหญิง', 25, 200, ['id-card.pdf']],
      ['สมชาย', 25, 404],
      ['exec1', 25, 403],
      ['audit1', 25, 403],
      ['admin1', 25, 403],
      ['ไม่ล็อกอิน', 25, 401],
    ];
    const problems = [];
    for (const [who, n, st, names] of table) {
      const api = users[who];
      const r = await api.get(`/api/cases/${C(n)}/files`);
      if (r.status() !== st) problems.push(`${who} GET /api/cases/…0000${n}/files: expected ${st}, received ${r.status()}`);
      else if (names) {
        const got = ((await r.json()).items || []).map((x) => x.name).sort();
        if (JSON.stringify(got) !== JSON.stringify(names)) problems.push(`${who} …0000${n} files: expected ${JSON.stringify(names)}, received ${JSON.stringify(got)}`);
      }
      const id = fid(n);
      if (!id) { problems.push(`no fileId for …0000${n}`); continue; }
      const f = await api.get(`/api/files/${encodeURIComponent(id)}`);
      if (f.status() !== st) problems.push(`${who} GET /api/files/${id} (…0000${n}): expected ${st}, received ${f.status()}`);
      else if (st === 200) {
        const ct = f.headers()['content-type'] || '';
        const head = (await f.body()).subarray(0, 4).toString('latin1');
        if (!ct.includes('application/pdf')) problems.push(`${who} /api/files/${id}: expected Content-Type application/pdf, received ${ct}`);
        if (head !== '%PDF') problems.push(`${who} /api/files/${id}: expected body starts %PDF, received ${JSON.stringify(head)}`);
      }
    }
    const nf = await users['off.reg1'].get('/api/files/no-such-file-000000');
    if (nf.status() !== 404) problems.push(`off.reg1 GET /api/files/<ไม่มี>: expected 404, received ${nf.status()}`);
    expect(problems, `สิทธิ์ไฟล์แนบ: expected 0 mismatches, received ${problems.length}`).toEqual([]);

    // UI
    const p1 = await kit.pageFor(users['off.reg1']);
    await gotoStatus(p1, `/officer/cases/${C(25)}`, 200, 'off.reg1 เปิด …000025');
    await expectCount(tid(p1, 'doc-item'), 1, 'off.reg1 …000025 doc-item');
    await expect(tid(p1, 'doc-item'), 'doc-item data-name: expected id-card.pdf').toHaveAttribute('data-name', 'id-card.pdf');
    const dl = await grabDownload(p1, tid(p1, 'doc-item').getByTestId('doc-download-link'), 'doc-download-link');
    expect(dl.buf.length, `ไฟล์ที่ดาวน์โหลด: expected > 0 bytes, received ${dl.buf.length}`).toBeGreaterThan(0);

    const p2 = await kit.pageFor(users['off.reg2']);
    await gotoStatus(p2, `/officer/cases/${C(12)}`, 200, 'off.reg2 เปิด …000012');
    await expectCount(tid(p2, 'doc-item'), 3, 'off.reg2 …000012 doc-item');

    const p3 = await kit.pageFor(users['สมหญิง']);
    await gotoStatus(p3, `/citizen/cases/${C(25)}`, 200, 'สมหญิง เปิด …000025');
    await expectCount(tid(p3, 'doc-item'), 1, 'สมหญิง …000025 doc-item');
  });

  test('TC-RBAC-06 · ผู้ดูแลระบบ: ช่วงค่าที่ยอมรับ', async ({ kit }) => {
    const admin = await kit.loginS('admin1');
    const page = await kit.pageFor(admin);
    const FEE_MSG = 'ค่าธรรมเนียมต้องเป็นจำนวนเต็ม 0–100,000 บาท';
    const SLA_MSG = 'SLA ต้องเป็นจำนวนเต็ม 1–60 วันทำการ';
    const sv01 = async () => {
      const j = await okJson(await admin.get('/api/admin/services'), 'GET /api/admin/services');
      const s = (j.items || []).find((x) => x.id === 'SV-01');
      return { fee: s && s.fee, sla: s && s.sla };
    };
    const put = (body) => admin.put('/api/admin/services/SV-01', { data: body });

    async function ui(field, value) {
      await gotoStatus(page, '/admin/services', 200, '/admin/services');
      await tid(page, field).fill(String(value));
      await tid(page, 'svc-save-SV-01').click();
    }

    // fee −1
    await ui('svc-fee-SV-01', -1);
    await expectText(tid(page, 'action-error'), FEE_MSG, 'fee −1 action-error');
    await expectApiError(await put({ fee: -1, sla: 3 }), 400, 'INVALID_FEE', 'fee −1 API');
    expect(await sv01(), 'fee −1 ค่าไม่เปลี่ยน').toEqual({ fee: 20, sla: 3 });

    // fee 0 (UI) · fee 100000 (API)
    await ui('svc-fee-SV-01', 0);
    await expect(tid(page, 'action-success'), 'fee 0 action-success').toBeVisible();
    await expect.poll(async () => (await sv01()).fee, { message: 'fee 0: expected 0' }).toBe(0);
    await okJson(await put({ fee: 100000, sla: 3 }), 'fee 100000 API');

    // fee 100001
    await expectApiError(await put({ fee: 100001, sla: 3 }), 400, 'INVALID_FEE', 'fee 100001 API');
    await ui('svc-fee-SV-01', 100001);
    await expectText(tid(page, 'action-error'), FEE_MSG, 'fee 100001 action-error');
    expect(await sv01(), 'fee 100001 ค่าไม่เปลี่ยน').toEqual({ fee: 100000, sla: 3 });

    // sla 0
    await ui('svc-sla-SV-01', 0);
    await expectText(tid(page, 'action-error'), SLA_MSG, 'sla 0 action-error');
    await expectApiError(await put({ fee: 100000, sla: 0 }), 400, 'INVALID_SLA', 'sla 0 API');

    // sla 1 (UI) · sla 60 (API) · sla 61
    await ui('svc-sla-SV-01', 1);
    await expect(tid(page, 'action-success'), 'sla 1 action-success').toBeVisible();
    await expect.poll(async () => (await sv01()).sla, { message: 'sla 1: expected 1' }).toBe(1);
    await okJson(await put({ fee: 100000, sla: 60 }), 'sla 60 API');
    await expectApiError(await put({ fee: 100000, sla: 61 }), 400, 'INVALID_SLA', 'sla 61 API');
    expect(await sv01(), 'หลัง sla 61 ค่าไม่เปลี่ยน').toEqual({ fee: 100000, sla: 60 });

    // วันหยุด
    await expectApiError(await admin.post('/api/admin/holidays', { data: { date: '2026-12-07', name: 'ซ้ำ' } }), 409, 'DUPLICATE_HOLIDAY', 'holiday ซ้ำ', 'มีวันหยุดนี้อยู่แล้ว');
    await gotoStatus(page, '/admin/holidays', 200, '/admin/holidays');
    await expectCount(tid(page, 'holiday-row'), 4, 'holiday-row หลังซ้ำ');
    await expectHttp(await admin.post('/api/admin/holidays', { data: { date: '2026-12-05', name: 'วันเสาร์' } }), 201, 'holiday วันเสาร์');

    // เปลี่ยนบทบาทตัวเอง
    await expectApiError(await admin.put('/api/admin/users/admin1', { data: { role: 'executive', dept: '' } }), 409, 'SELF_ROLE_CHANGE', 'admin1 เปลี่ยนตัวเอง');
    const me = await okJson(await admin.get('/api/me'), 'GET /api/me');
    expect(me.role, `GET /api/me role: expected admin, received ${me.role}`).toBe('admin');

    // Audit = 5
    const aud = await kit.loginS('audit1');
    const apg = await kit.pageFor(aud);
    await gotoStatus(apg, '/audit', 200, '/audit');
    await auditFilter(apg, { event: 'ADMIN_CHANGE' }, 5, 'ADMIN_CHANGE');
  });
});

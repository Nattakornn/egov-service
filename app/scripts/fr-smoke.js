#!/usr/bin/env node
'use strict';
// ตรวจเร็ว FR-01..FR-29 ส่วนที่ 51 TC ไม่ได้แตะตรง ๆ (route/API ตาม CONTRACT §1 §6) กับเว็บ TEST_MODE=1
// ใช้: BASE_URL=http://localhost:3150 node scripts/fr-smoke.js   → พิมพ์ PASS/FAIL ต่อข้อ · exit 1 ถ้ามี FAIL
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const results = [];

function jar() {
  let cookie = '';
  return async function req(method, path, body, opts = {}) {
    const headers = { Accept: opts.accept || 'application/json' };
    if (cookie) headers.Cookie = cookie;
    let payload;
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(BASE + path, { method, headers, body: payload, redirect: 'manual' });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* html */ }
    return { status: r.status, location: r.headers.get('location'), text, json, type: r.headers.get('content-type') || '' };
  };
}
function check(fr, what, ok, detail) {
  results.push({ fr, what, ok: !!ok, detail: ok ? '' : detail });
}
const T = (s) => s.includes('data-testid');

(async () => {
  const hook = jar();
  await hook('POST', '/api/test/reset');

  // FR-28 health + hooks
  let r = await hook('GET', '/api/health');
  check('FR-28', 'GET /api/health = {"status":"ok"}', r.status === 200 && r.text === '{"status":"ok"}', r.text);
  r = await hook('GET', '/api/test/clock');
  check('FR-28', 'GET /api/test/clock', r.status === 200 && r.json && r.json.now === '2026-12-01T09:00:00+07:00', r.text);

  // FR-01 ล็อกอิน/ออก · หน้า /
  const anon = jar();
  r = await anon('GET', '/', undefined, { accept: 'text/html' });
  check('FR-01', '/ ยังไม่ล็อกอิน → redirect /login', r.status >= 300 && r.status < 400 && /\/login/.test(r.location || ''), `${r.status} ${r.location}`);
  r = await anon('GET', '/citizen', undefined, { accept: 'text/html' });
  check('FR-01', '/citizen ยังไม่ล็อกอิน → redirect /login', r.status >= 300 && r.status < 400 && /\/login/.test(r.location || ''), `${r.status} ${r.location}`);
  const c = jar();
  await c('POST', '/api/auth/thaid/start', { idNo: '1101700123456' });
  r = await c('POST', '/api/auth/thaid/verify', { idNo: '1101700123456', otp: '123456' });
  check('FR-01', 'ThaiD verify → registered:true', r.status === 200 && r.json && r.json.registered === true, r.text);
  r = await c('GET', '/api/me');
  check('FR-01', 'GET /api/me', r.status === 200 && r.json && r.json.role === 'citizen' && 'name' in r.json, r.text);
  r = await c('GET', '/', undefined, { accept: 'text/html' });
  check('FR-01', '/ ล็อกอินแล้ว → /citizen', r.status >= 300 && r.status < 400 && /\/citizen$/.test(r.location || ''), `${r.status} ${r.location}`);

  // FR-04 แคตตาล็อก + ฟอร์มทุกบริการ
  r = await c('GET', '/citizen', undefined, { accept: 'text/html' });
  check('FR-04', '/citizen มี start-service-SV-01..03', ['SV-01', 'SV-02', 'SV-03'].every((s) => r.text.includes(`start-service-${s}`)), 'missing start-service');
  check('FR-09', '/citizen มี my-case-row', r.text.includes('my-case-row'), 'no my-case-row');
  for (const s of ['SV-01', 'SV-02', 'SV-03']) {
    r = await c('GET', `/citizen/new/${s}`, undefined, { accept: 'text/html' });
    check('FR-04', `/citizen/new/${s} 200 + fee-total`, r.status === 200 && r.text.includes('fee-total'), String(r.status));
  }
  r = await c('POST', '/api/drafts', { serviceId: 'SV-02' });
  check('FR-07', 'POST /api/drafts SV-02 → 201 fee 500', r.status === 201 && r.json && r.json.fee === 500 && /^DR-/.test(r.json.draftId), r.text);
  r = await c('GET', '/api/drafts');
  check('FR-07', 'GET /api/drafts items', r.status === 200 && Array.isArray(r.json && r.json.items), r.text);

  // FR-09 รายการ/รายละเอียด/ไทม์ไลน์
  r = await c('GET', '/api/cases');
  check('FR-09', 'GET /api/cases เฉพาะของฉัน', r.status === 200 && r.json.items.length > 0 && r.json.items.every((i) => i.caseNo && i.dueAt !== undefined && i.slaLevel !== undefined), r.text.slice(0, 200));
  r = await c('GET', '/citizen/cases/EG-2569-000005', undefined, { accept: 'text/html' });
  check('FR-09', 'หน้า case มี case-status/case-timeline/sla-due/sla-level', r.status === 200 && ['case-status', 'case-timeline', 'timeline-item', 'sla-due', 'sla-level'].every((t) => r.text.includes(`data-testid="${t}`)), String(r.status));

  // FR-01 logout
  r = await c('POST', '/api/auth/logout');
  check('FR-01', 'POST /api/auth/logout → 204', r.status === 204, String(r.status));
  r = await c('GET', '/api/me');
  check('FR-01', 'หลัง logout /api/me → 401', r.status === 401, String(r.status));

  // FR-03 landing ทุกบทบาท + RBAC หน้า
  const landing = { 'off.reg1': '/officer/queue', head1: '/head/approvals', exec1: '/dashboard', audit1: '/audit', admin1: '/admin/services' };
  const staff = {};
  for (const [u, l] of Object.entries(landing)) {
    const s = jar();
    r = await s('POST', '/api/auth/staff/login', { username: u, password: 'Test@1234' });
    check('FR-03', `${u} landing ${l}`, r.status === 200 && r.json && r.json.landing === l, r.text);
    r = await s('GET', l, undefined, { accept: 'text/html' });
    check('FR-03', `${u} เปิด ${l} → 200`, r.status === 200, String(r.status));
    staff[u] = s;
  }
  r = await staff['off.reg1']('GET', '/dashboard', undefined, { accept: 'text/html' });
  check('FR-03', 'officer เปิด /dashboard → 403 forbidden-msg', r.status === 403 && r.text.includes('forbidden-msg'), String(r.status));

  // FR-12 คิว + filter
  r = await staff['off.reg1']('GET', '/api/officer/queue?filter=unclaimed');
  check('FR-12', 'queue filter=unclaimed', r.status === 200 && r.json.items.length === 4, r.text.slice(0, 200));

  // FR-20 แจ้งเตือน
  r = await staff['off.reg1']('GET', '/notifications', undefined, { accept: 'text/html' });
  check('FR-20', '/notifications officer 200', r.status === 200, String(r.status));
  r = await staff['off.reg1']('GET', '/api/notifications');
  check('FR-20', 'GET /api/notifications', r.status === 200 && Array.isArray(r.json.items), r.text.slice(0, 200));
  r = await staff.exec1('GET', '/api/notifications');
  check('FR-20', 'executive /api/notifications → 403', r.status === 403, String(r.status));

  // FR-16 หน้าอนุมัติของหัวหน้า
  r = await staff.head1('GET', '/head/approvals', undefined, { accept: 'text/html' });
  check('FR-16', '/head/approvals มี EG-2569-000014', r.status === 200 && r.text.includes('EG-2569-000014'), String(r.status));

  // FR-18 verify
  r = await anon('GET', '/api/verify/K7M2Q9XA');
  check('FR-18', 'GET /api/verify/K7M2Q9XA → VALID ไม่ต้องล็อกอิน', r.status === 200 && r.json && r.json.result === 'VALID', r.text);
  r = await anon('GET', '/verify/NOPE0000', undefined, { accept: 'text/html' });
  check('FR-18', '/verify/<ไม่มี> → 404 ไม่พบเอกสาร', r.status === 404 && r.text.includes('ไม่พบเอกสาร'), String(r.status));

  // FR-22/23 dashboard + export
  r = await staff.exec1('GET', '/api/dashboard?period=2026-11&service=ALL');
  check('FR-22', 'dashboard พ.ย. received 26 closed 7 ontimePct 85.7', r.json && r.json.received === 26 && r.json.closed === 7 && r.json.ontimePct === 85.7, r.text.slice(0, 200));
  for (const f of ['xlsx', 'pdf']) {
    const rr = await fetch(`${BASE}/api/dashboard/export?format=${f}&period=2569&service=ALL`, { headers: { Cookie: '' } });
    check('FR-23', `export ${f} ต้องล็อกอิน (ไม่ล็อกอิน → 401/302)`, rr.status !== 200, String(rr.status));
  }

  // FR-24 audit
  r = await staff.audit1('GET', '/api/audit');
  check('FR-24', 'GET /api/audit count', r.status === 200 && typeof r.json.count === 'number', r.text.slice(0, 200));
  r = await staff.admin1('DELETE', '/api/audit/1');
  check('FR-24', 'admin DELETE /api/audit/1 → 405', r.status === 405, String(r.status));

  // FR-25..27 admin
  for (const p of ['/admin/services', '/admin/holidays', '/admin/users']) {
    r = await staff.admin1('GET', p, undefined, { accept: 'text/html' });
    check(p === '/admin/services' ? 'FR-25' : p === '/admin/holidays' ? 'FR-26' : 'FR-27', `admin เปิด ${p} → 200`, r.status === 200 && T(r.text), String(r.status));
    r = await staff.exec1('GET', p, undefined, { accept: 'text/html' });
    check('FR-03', `executive เปิด ${p} → 403`, r.status === 403, String(r.status));
  }
  r = await staff.admin1('GET', '/api/admin/holidays');
  check('FR-26', 'GET /api/admin/holidays มี 4 วัน', r.status === 200 && (r.json.items || []).length === 4, r.text.slice(0, 200));
  r = await staff.admin1('GET', '/api/admin/users');
  check('FR-27', 'GET /api/admin/users', r.status === 200 && (r.json.items || []).length >= 7, r.text.slice(0, 120));
  r = await staff.admin1('POST', '/api/drafts', { serviceId: 'SV-01', qty: 1 });
  check('FR-03', 'admin POST /api/drafts → 403', r.status === 403, String(r.status));

  // FR-29 ไฟล์แนบ (บทบาทที่ไม่มีสิทธิ์)
  r = await staff.exec1('GET', '/api/cases/EG-2569-000025/files');
  check('FR-29', 'executive /api/cases/:no/files → 403', r.status === 403, String(r.status));
  r = await staff.head1('GET', '/api/cases/EG-2569-000025/files');
  check('FR-29', 'head /api/cases/:no/files → 200', r.status === 200, String(r.status));

  // ไม่ใช้ชื่อหน่วยงานจริง (หน้า login)
  r = await anon('GET', '/login', undefined, { accept: 'text/html' });
  check('BRIEF', 'หน้า /login มีชื่อหน่วยงานสมมติ "เทศบาลนครตัวอย่าง"', r.text.includes('เทศบาลนครตัวอย่าง'), 'missing org name');

  await hook('POST', '/api/test/reset');
  const fails = results.filter((x) => !x.ok);
  for (const x of results) console.log(`${x.ok ? 'PASS' : 'FAIL'} ${x.fr} · ${x.what}${x.ok ? '' : ' → ' + x.detail}`);
  console.log(`\n${results.length - fails.length}/${results.length} PASS`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

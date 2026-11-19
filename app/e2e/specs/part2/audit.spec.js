// @ts-check
// TC-AUDIT-01..03 (TEST-PLAN §14)
'use strict';

const {
  test, expect, T0, ID, C, REASON10,
  tid, gotoStatus, expectHttp, expectApiError, okJson, expectCount, expectText, auditFilter, auditRows, grabDownload,
} = require('./_lib');

function countBy(rows, key) {
  const m = {};
  for (const r of rows) m[r[key]] = (m[r[key]] || 0) + 1;
  return m;
}

test.describe('AUDIT', () => {
  test('TC-AUDIT-01 · เหตุการณ์และฟิลด์ใน Audit', async ({ kit }) => {
    // ล็อกอินครั้งเดียวต่อบัญชี (STAFF_LOGIN = 6)
    const reg2 = await kit.loginS('off.reg2');
    await okJson(await reg2.post(`/api/officer/cases/${C(28)}/claim`), '1 off.reg2 claim …000028');
    const reg1 = await kit.loginS('off.reg1');
    await okJson(await reg1.post(`/api/officer/cases/${C(20)}/return`, { data: { reason: REASON10 } }), '2 off.reg1 return …000020');
    await okJson(await reg2.post(`/api/officer/cases/${C(13)}/forward`, { data: {} }), '3 off.reg2 forward …000013');
    const head = await kit.loginS('head1');
    await okJson(await head.post(`/api/cases/${C(13)}/approve`), '4 head1 approve …000013');
    await okJson(await reg2.post(`/api/cases/${C(25)}/approve`), '5 off.reg2 approve …000025');
    await okJson(await reg2.post(`/api/officer/cases/${C(25)}/issue`), '5 off.reg2 issue …000025');
    await okJson(await reg2.post(`/api/cases/${C(26)}/reject`, { data: { reason: REASON10 } }), '5 off.reg2 reject …000026');
    await okJson(await reg2.post(`/api/officer/cases/${C(25)}/unmask`, { data: { reason: 'ตรวจสอบตัวตนซ้ำ' } }), '5 off.reg2 unmask …000025');
    const exec = await kit.loginS('exec1');
    await expectHttp(await exec.get('/api/dashboard/export?format=xlsx&period=2026-12&service=ALL'), 200, '6 exec1 export xlsx');
    const admin = await kit.loginS('admin1');
    await okJson(await admin.put('/api/admin/services/SV-01', { data: { fee: 25, sla: 3 } }), '7 admin1 PUT SV-01');
    const aud = await kit.loginS('audit1');
    const page = await kit.pageFor(aud);
    await gotoStatus(page, '/audit', 200, '8 /audit');

    // ไม่กรอง
    await expectText(tid(page, 'audit-count'), '16', 'audit-count');
    await expectCount(tid(page, 'audit-row'), 16, 'audit-row');
    const rows = await auditRows(page);

    const byEvent = countBy(rows, 'event');
    const wantEvents = { STAFF_LOGIN: 6, CLAIM: 1, RETURN: 1, FORWARD: 1, APPROVE: 2, ISSUE: 1, REJECT: 1, UNMASK: 1, EXPORT: 1, ADMIN_CHANGE: 1 };
    expect(byEvent, `จำนวนต่อเหตุการณ์: expected ${JSON.stringify(wantEvents)}, received ${JSON.stringify(byEvent)}`).toEqual(wantEvents);

    const badTime = rows.filter((r) => r.iso !== T0).map((r) => `${r.event}:${r.iso}`);
    expect(badTime, `audit-time data-iso: expected all ${T0}, received ${JSON.stringify(badTime)}`).toEqual([]);

    // เรียงใหม่ → เก่า (เวลาเท่ากัน data-id มาก → น้อย)
    const ids = rows.map((r) => r.id);
    const sorted = [...ids].sort((a, b) => {
      const na = Number(a);
      const nb = Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb)) return nb - na;
      return String(b).localeCompare(String(a), undefined, { numeric: true });
    });
    expect(ids, `ลำดับ data-id: expected descending ${JSON.stringify(sorted)}, received ${JSON.stringify(ids)}`).toEqual(sorted);

    const logins = rows.filter((r) => r.event === 'STAFF_LOGIN').map((r) => r.actor).sort();
    expect(logins, `STAFF_LOGIN actors: expected 6 accounts, received ${JSON.stringify(logins)}`)
      .toEqual(['admin1', 'audit1', 'exec1', 'head1', 'off.reg1', 'off.reg2']);
    for (const r of rows.filter((x) => x.event === 'STAFF_LOGIN')) {
      expect(r.transition, `STAFF_LOGIN ${r.actor} audit-transition: expected "–", received "${r.transition}"`).toBe('–');
    }

    const DASH = '–';
    const spec = [
      { event: 'CLAIM', actor: 'off.reg2', role: 'officer', caseNo: C(28), transition: 'SUBMITTED → IN_REVIEW' },
      { event: 'RETURN', actor: 'off.reg1', role: 'officer', caseNo: C(20), transition: 'IN_REVIEW → NEED_FIX', detail: REASON10 },
      { event: 'FORWARD', actor: 'off.reg2', role: 'officer', caseNo: C(13), transition: 'IN_REVIEW → PENDING_APPROVAL' },
      { event: 'APPROVE', actor: 'head1', role: 'head', caseNo: C(13), transition: 'PENDING_APPROVAL → APPROVED' },
      { event: 'APPROVE', actor: 'off.reg2', role: 'officer', caseNo: C(25), transition: 'IN_REVIEW → APPROVED' },
      { event: 'ISSUE', actor: 'off.reg2', role: 'officer', caseNo: C(25), transition: 'APPROVED → COMPLETED', detail: 'DOC-2569-000002' },
      { event: 'REJECT', actor: 'off.reg2', role: 'officer', caseNo: C(26), transition: 'IN_REVIEW → REJECTED', detail: REASON10 },
      { event: 'UNMASK', actor: 'off.reg2', role: 'officer', caseNo: C(25), transition: DASH, detail: 'ตรวจสอบตัวตนซ้ำ' },
      { event: 'EXPORT', actor: 'exec1', role: 'executive', transition: DASH, details: ['xlsx', '2026-12'] },
      { event: 'ADMIN_CHANGE', actor: 'admin1', role: 'admin', transition: DASH, detail: 'SV-01 fee 20 → 25' },
    ];
    for (const s of spec) {
      const r = rows.find((x) => x.event === s.event && x.actor === s.actor && (!s.caseNo || x.caseNo === s.caseNo));
      expect(r, `${s.event} ${s.actor} ${s.caseNo || ''}: expected a row, received none in ${JSON.stringify(rows.map((x) => `${x.event}/${x.actor}/${x.caseNo}`))}`).toBeTruthy();
      if (!r) continue;
      const label = `${s.event} ${s.actor}`;
      expect(r.actorText, `${label} audit-actor: expected ${s.actor}, received ${r.actorText}`).toBe(s.actor);
      expect(r.role, `${label} audit-role: expected ${s.role}, received ${r.role}`).toBe(s.role);
      expect(r.eventText, `${label} audit-event: expected ${s.event}, received ${r.eventText}`).toBe(s.event);
      if (s.caseNo) expect(r.caseText, `${label} audit-case-no: expected ${s.caseNo}, received ${r.caseText}`).toBe(s.caseNo);
      expect(r.transition, `${label} audit-transition: expected "${s.transition}", received "${r.transition}"`).toBe(s.transition);
      for (const d of s.details || (s.detail ? [s.detail] : [])) {
        expect(r.detail || '', `${label} audit-detail: expected to contain "${d}", received "${r.detail}"`).toContain(d);
      }
    }

    // กรอง
    await auditFilter(page, { actor: 'off.reg2' }, 7, 'actor off.reg2');
    const ev = (await auditRows(page)).map((r) => r.event).sort();
    expect(ev, `actor off.reg2 events: expected 7 events, received ${JSON.stringify(ev)}`)
      .toEqual(['APPROVE', 'CLAIM', 'FORWARD', 'ISSUE', 'REJECT', 'STAFF_LOGIN', 'UNMASK']);
    await auditFilter(page, { event: 'APPROVE' }, 2, 'event APPROVE');
    const ap = (await auditRows(page)).map((r) => r.actor).sort();
    expect(ap, `APPROVE actors: expected [head1, off.reg2], received ${JSON.stringify(ap)}`).toEqual(['head1', 'off.reg2']);
    await auditFilter(page, { actor: 'off.reg2', event: 'APPROVE' }, 1, 'actor off.reg2 + APPROVE');

    // CSV (ไม่กรอง)
    await auditFilter(page, {}, 16, 'ล้างตัวกรองก่อนส่งออก');
    const f = await grabDownload(page, tid(page, 'audit-export-csv-btn'), 'audit-export-csv-btn');
    const lines = f.buf.toString('utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
    expect(lines[0], `CSV header: expected time,username,role,event,caseNo,fromStatus,toStatus,detail, received ${lines[0]}`)
      .toBe('time,username,role,event,caseNo,fromStatus,toStatus,detail');
    expect(lines.length - 1, `CSV data rows: expected 16, received ${lines.length - 1}`).toBe(16);

    await gotoStatus(page, '/audit', 200, 'เปิด /audit ใหม่หลังส่งออก');
    await expectText(tid(page, 'audit-count'), '17', 'audit-count หลังส่งออก CSV');
    const exp = (await auditRows(page)).filter((r) => r.event === 'EXPORT' && r.actor === 'audit1');
    expect(exp.length, `EXPORT ของ audit1: expected 1, received ${exp.length}`).toBe(1);
    expect(exp[0] && exp[0].detail, `EXPORT audit1 detail: expected to contain audit-csv, received ${exp[0] && exp[0].detail}`).toContain('audit-csv');
  });

  test('TC-AUDIT-02 · Audit แก้/ลบไม่ได้ (405)', async ({ kit }) => {
    const aud = await kit.loginS('audit1');
    const b = await okJson(await aud.get('/api/audit'), 'GET /api/audit (before)');
    const before = b.items || [];
    expect(before.length, `before: expected 1 row (STAFF_LOGIN audit1), received ${before.length}`).toBe(1);
    const id = before[0].id;

    async function hammer(api, who) {
      const reqs = [
        ['PUT', `/api/audit/${id}`, { detail: 'x' }],
        ['PATCH', `/api/audit/${id}`, { detail: 'x' }],
        ['DELETE', `/api/audit/${id}`],
        ['PUT', '/api/audit', { detail: 'x' }],
        ['PATCH', '/api/audit', { detail: 'x' }],
        ['DELETE', '/api/audit'],
        ['DELETE', '/api/audit/999999'],
        ['PUT', '/api/audit/999999', { detail: 'x' }],
        ['PATCH', '/api/audit/999999', { detail: 'x' }],
      ];
      for (const [method, url, data] of reqs) {
        const res = await api.fetch(url, { method, ...(data ? { data } : {}) });
        await expectApiError(res, 405, 'METHOD_NOT_ALLOWED', `${who} ${method} ${url}`);
      }
    }

    // ตามการ์ด: admin1 และ audit1
    const admin = await kit.loginS('admin1');
    await hammer(admin, 'admin1');
    await hammer(aud, 'audit1');
    const a1 = await okJson(await aud.get('/api/audit'), 'GET /api/audit (after admin1/audit1)');
    const after1 = a1.items || [];
    for (const row of before) {
      const same = after1.find((x) => x.id === row.id);
      expect(same, `แถวเดิม id=${row.id}: expected unchanged ${JSON.stringify(row)}, received ${JSON.stringify(same)}`).toEqual(row);
    }
    const added1 = after1.filter((x) => !before.some((y) => y.id === x.id)).map((x) => `${x.event}/${x.username}`);
    expect(added1, `แถวที่เพิ่ม: expected only ["STAFF_LOGIN/admin1"], received ${JSON.stringify(added1)}`).toEqual(['STAFF_LOGIN/admin1']);

    // ทุกบทบาทที่เหลือ
    const others = [
      ['สมชาย (citizen)', await kit.loginC(ID.somchai)],
      ['off.reg1', await kit.loginS('off.reg1')],
      ['head1', await kit.loginS('head1')],
      ['exec1', await kit.loginS('exec1')],
    ];
    for (const [who, api] of others) await hammer(api, who);
    const a2 = await okJson(await aud.get('/api/audit'), 'GET /api/audit (after all roles)');
    const after2 = a2.items || [];
    for (const row of after1) {
      const same = after2.find((x) => x.id === row.id);
      expect(same, `แถวเดิม id=${row.id}: expected unchanged, received ${JSON.stringify(same)}`).toEqual(row);
    }
    const added2 = after2.filter((x) => !after1.some((y) => y.id === x.id)).map((x) => `${x.event}/${x.username}`).sort();
    expect(added2, `แถวที่เพิ่มรอบ 2: expected only STAFF_LOGIN of off.reg1/head1/exec1, received ${JSON.stringify(added2)}`)
      .toEqual(['STAFF_LOGIN/exec1', 'STAFF_LOGIN/head1', 'STAFF_LOGIN/off.reg1']);

    // UI ไม่มีปุ่มแก้/ลบ · admin อ่านไม่ได้
    const page = await kit.pageFor(aud);
    await gotoStatus(page, '/audit', 200, '/audit');
    await expect(tid(page, 'audit-row'), 'audit-row: expected ≥ 1').not.toHaveCount(0);
    await expectCount(tid(page, 'audit-edit-btn'), 0, 'audit-edit-btn');
    await expectCount(tid(page, 'audit-delete-btn'), 0, 'audit-delete-btn');
    await expectHttp(await admin.get('/api/audit'), 403, 'admin1 GET /api/audit');
  });

  test('TC-AUDIT-03 · กรองช่วงวันที่ตามเวลาไทย', async ({ kit }) => {
    const L = {
      L1: ['2026-11-30T23:59:59+07:00', 'off.reg1'],
      L2: ['2026-12-01T00:00:00+07:00', 'off.reg2'],
      L3: ['2026-12-01T23:59:59+07:00', 'off.works1'],
      L4: ['2026-12-02T00:00:00+07:00', 'off.reg1'],
      L5: ['2026-12-02T09:00:00+07:00', 'audit1'],
    };
    let aud = null;
    for (const [, [iso, user]] of Object.entries(L)) {
      await kit.clock(iso);
      const api = await kit.loginS(user);
      if (user === 'audit1') aud = api;
    }
    if (!aud) throw new Error('audit1 not logged in');
    const page = await kit.pageFor(aud);
    await gotoStatus(page, '/audit', 200, '/audit');

    const cases = [
      [{ from: '2026-12-01', to: '2026-12-01' }, ['L2', 'L3']],
      [{ from: '2026-11-30', to: '2026-11-30' }, ['L1']],
      [{ from: '2026-11-30', to: '2026-12-01' }, ['L1', 'L2', 'L3']],
      [{ from: '2026-12-02', to: '' }, ['L4', 'L5']],
      [{ from: '', to: '2026-11-30' }, ['L1']],
      [{ from: '2026-12-01', to: '2026-12-02' }, ['L2', 'L3', 'L4', 'L5']],
      [{ from: '2026-12-01', to: '2026-12-01', actor: 'off.reg2' }, ['L2']],
    ];
    for (const [f, want] of cases) {
      const label = `from=${f.from || '(ว่าง)'} to=${f.to || '(ว่าง)'}${f.actor ? ` actor=${f.actor}` : ''}`;
      const wantSet = want.map((k) => `${L[k][1]}@${L[k][0]}`).sort();
      // UI
      await auditFilter(page, f, want.length, label);
      const got = (await auditRows(page)).map((r) => `${r.actor}@${r.iso}`).sort();
      expect(got, `${label} UI rows: expected ${JSON.stringify(wantSet)}, received ${JSON.stringify(got)}`).toEqual(wantSet);
      // API
      const q = new URLSearchParams({ actor: f.actor || '', event: '', from: f.from || '', to: f.to || '' });
      const j = await okJson(await aud.get(`/api/audit?${q}`), `${label} GET /api/audit`);
      expect(j.count, `${label} API count: expected ${want.length}, received ${j.count}`).toBe(want.length);
      const apiGot = (j.items || []).map((r) => `${r.username}@${r.time}`).sort();
      expect(apiGot, `${label} API rows: expected ${JSON.stringify(wantSet)}, received ${JSON.stringify(apiGot)}`).toEqual(wantSet);
    }
  });
});

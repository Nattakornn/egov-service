// @ts-check
// TC-PDPA-01..03 (TEST-PLAN §12)
'use strict';

const {
  test, expect, T0, ID, C,
  tid, gotoStatus, expectHttp, expectApiError, expectCount, expectText, auditFilter, auditRows, deepKeyPaths,
} = require('./_lib');

const MASK_RE = /^X-XXXX-XXXXX-\d{2}-\d$/;

test.describe('PDPA', () => {
  test('TC-PDPA-01 · ปิดบังเลขบัตรบนจอ', async ({ kit }) => {
    const reg2 = await kit.loginS('off.reg2');
    const op = await kit.pageFor(reg2);
    await gotoStatus(op, '/officer/queue', 200, 'off.reg2 /officer/queue');
    await expect(tid(op, 'queue-row'), 'queue-row: expected ≥ 1').not.toHaveCount(0);
    const masked = await tid(op, 'row-id-masked').allInnerTexts();
    const bad = masked.map((s) => s.trim()).filter((s) => !MASK_RE.test(s));
    expect(bad, `row-id-masked: expected all match ${MASK_RE}, received non-matching ${JSON.stringify(bad)}`).toEqual([]);
    await expectText(op.locator(`[data-testid="queue-row"][data-case-no="${C(25)}"]`).getByTestId('row-id-masked'), 'X-XXXX-XXXXX-65-9', 'แถว …000025');
    await expectText(op.locator(`[data-testid="queue-row"][data-case-no="${C(26)}"]`).getByTestId('row-id-masked'), 'X-XXXX-XXXXX-45-6', 'แถว …000026');

    await gotoStatus(op, `/officer/cases/${C(25)}`, 200, 'off.reg2 เปิด …000025');
    await expectText(tid(op, 'applicant-id'), 'X-XXXX-XXXXX-65-9', 'off.reg2 applicant-id');
    const html = await op.content();
    for (const s of [ID.somying, '3-1006-00987-65-9']) {
      expect(html.includes(s), `HTML …000025 (off.reg2): expected no "${s}", received it in page`).toBe(false);
    }

    const head = await kit.loginS('head1');
    const hp = await kit.pageFor(head);
    await gotoStatus(hp, `/officer/cases/${C(25)}`, 200, 'head1 เปิด …000025');
    await expectText(tid(hp, 'applicant-id'), 'X-XXXX-XXXXX-65-9', 'head1 applicant-id');

    const somying = await kit.loginC(ID.somying);
    const sp = await kit.pageFor(somying);
    await gotoStatus(sp, `/citizen/cases/${C(25)}`, 200, 'สมหญิง เปิด …000025');
    await expectText(tid(sp, 'case-id-full'), '3-1006-00987-65-9', 'สมหญิง case-id-full');

    const somchai = await kit.loginC(ID.somchai);
    const cp = await kit.pageFor(somchai);
    await gotoStatus(cp, `/citizen/cases/${C(20)}`, 200, 'สมชาย เปิด …000020');
    await expectText(tid(cp, 'case-id-full'), '1-1017-00123-45-6', 'สมชาย case-id-full');
  });

  test('TC-PDPA-02 · API (JSON) ไม่ส่งเลขบัตรเต็ม', async ({ kit }) => {
    const paths = [
      '/api/officer/queue?filter=all',
      `/api/cases/${C(25)}`,
      `/api/cases/${C(26)}`,
      `/api/cases/${C(20)}`,
      '/api/notifications',
      `/api/cases/${C(25)}/files`,
    ];
    const problems = [];
    for (const user of ['off.reg1', 'head1']) {
      const api = await kit.loginS(user);
      for (const p of paths) {
        const res = await api.get(p);
        await expectHttp(res, 200, `${user} GET ${p}`);
        const ct = res.headers()['content-type'] || '';
        expect(ct, `${user} GET ${p} Content-Type: expected application/json, received ${ct}`).toContain('application/json');
        const json = await res.json();
        const s = JSON.stringify(json);
        const m13 = s.match(/\d{13}/);
        if (m13) problems.push(`${user} ${p}: found \\d{13} "${m13[0]}"`);
        const mDash = s.match(/\d-\d{4}-\d{5}-\d{2}-\d/);
        if (mDash) problems.push(`${user} ${p}: found full dashed id "${mDash[0]}"`);
        for (const id of [ID.somying, ID.somchai, ID.piti]) if (s.includes(id)) problems.push(`${user} ${p}: found ${id}`);
        const keys = deepKeyPaths(json, 'idNo');
        if (keys.length) problems.push(`${user} ${p}: has key idNo at ${keys.join(', ')}`);
        const items = Array.isArray(json.items) ? json.items : null;
        if (p.startsWith('/api/officer/queue')) {
          expect(items && items.length > 0, `${user} queue items: expected non-empty array, received ${s.slice(0, 200)}`).toBe(true);
          for (const it of items) {
            if (!MASK_RE.test(String(it.idMasked))) problems.push(`${user} queue ${it.caseNo}: idMasked "${it.idMasked}" not ${MASK_RE}`);
          }
        } else if (items) {
          for (const it of items) {
            if ('idMasked' in it && !MASK_RE.test(String(it.idMasked))) problems.push(`${user} ${p}: idMasked "${it.idMasked}"`);
          }
        }
        if (/^\/api\/cases\/EG-\d{4}-\d{6}$/.test(p)) {
          if (!MASK_RE.test(String(json.idMasked))) problems.push(`${user} ${p}: idMasked "${json.idMasked}" not ${MASK_RE}`);
        }
      }
    }
    expect(problems, `PDPA JSON: expected no full id, received ${problems.length} problem(s)`).toEqual([]);
  });

  test('TC-PDPA-03 · แสดงเลขเต็มต้องมีเหตุผลและบันทึก Audit', async ({ kit }) => {
    const reg2 = await kit.loginS('off.reg2');
    const op = await kit.pageFor(reg2);
    const url = `/officer/cases/${C(25)}`;
    await gotoStatus(op, url, 200, 'off.reg2 เปิด …000025');

    async function tryUnmask(reason) {
      if (!(await tid(op, 'unmask-reason').isVisible().catch(() => false))) await tid(op, 'show-full-id-btn').click();
      await tid(op, 'unmask-reason').fill(reason);
      await tid(op, 'unmask-submit').click();
    }

    // 1 ว่าง · 2 เว้นวรรคล้วน
    for (const [label, reason] of [['#1 ว่าง', ''], ['#2 เว้นวรรค', '     ']]) {
      await tryUnmask(reason);
      await expectText(tid(op, 'unmask-error'), 'กรุณากรอกเหตุผล', `${label} unmask-error`);
      await expectCount(tid(op, 'full-id'), 0, `${label} full-id`);
      await expectApiError(await reg2.post(`/api/officer/cases/${C(25)}/unmask`, { data: { reason } }), 400, 'REASON_REQUIRED', `${label} API`);
    }

    // 3 เหตุผลถูกต้อง
    await tryUnmask('ตรวจสอบตัวตนซ้ำ');
    await expectText(tid(op, 'full-id'), '3-1006-00987-65-9', '#3 full-id');

    // 4 โหลดซ้ำ
    await op.reload();
    await expectText(tid(op, 'applicant-id'), 'X-XXXX-XXXXX-65-9', '#4 applicant-id');
    await expectCount(tid(op, 'full-id'), 0, '#4 full-id');

    // 5 Audit
    const aud = await kit.loginS('audit1');
    const ap = await kit.pageFor(aud);
    await gotoStatus(ap, '/audit', 200, '#5 /audit');
    await auditFilter(ap, { event: 'UNMASK' }, 1, '#5 UNMASK');
    const [row] = await auditRows(ap);
    expect(row.actor, `#5 data-actor: expected off.reg2, received ${row.actor}`).toBe('off.reg2');
    expect(row.role, `#5 audit-role: expected officer, received ${row.role}`).toBe('officer');
    expect(row.caseText, `#5 audit-case-no: expected ${C(25)}, received ${row.caseText}`).toBe(C(25));
    expect(row.eventText, `#5 audit-event: expected UNMASK, received ${row.eventText}`).toBe('UNMASK');
    expect(row.detail || '', `#5 audit-detail: expected to contain ตรวจสอบตัวตนซ้ำ, received ${row.detail}`).toContain('ตรวจสอบตัวตนซ้ำ');
    expect(row.iso, `#5 audit-time data-iso: expected ${T0}, received ${row.iso}`).toBe(T0);

    // 6 บทบาทอื่น → 403
    const exec = await kit.loginS('exec1');
    const somying = await kit.loginC(ID.somying);
    for (const [who, api] of [['exec1', exec], ['audit1', aud], ['สมหญิง', somying]]) {
      await expectHttp(await api.post(`/api/officer/cases/${C(25)}/unmask`, { data: { reason: 'x' } }), 403, `#6 ${who} unmask`);
    }
  });
});

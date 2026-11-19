// TEST-PLAN §7 หมวด QUEUE (TC-QUEUE-01..03) · คิวเริ่มต้นตาม TEST-DATA §9
const {
  test, expect, T0, ID, MSG, STAFF_NAME, LEVEL_TH, cn, start, reset, expectStatus, getCase, claimApi, queueApi, auditApi,
  tid, byAttr, queueRow, attrList, expectAttrList, expectPath, clickAndCapture, expectWorkload, expectCaseStatus,
} = require('./_lib');

const n6 = (list) => list.map((n) => cn(n));
// TEST-DATA §9.1 (17 แถว เรียงตาม BR-16)
const REGISTRY_ORDER = n6([20, 22, 24, 23, 25, 26, 13, 15, 27, 28, 29, 30, 16, 18, 19, 12, 21]);

/** คลิก claim-btn ของแถวผ่านหน้าจอ แล้วคืน HTTP status/body ของ API claim */
async function uiClaim(page, caseNo) {
  await page.goto('/officer/queue');
  const btn = queueRow(page, caseNo).getByTestId('claim-btn');
  await expect(btn, `claim-btn ของ ${caseNo}`).toHaveCount(1);
  return clickAndCapture(page, btn, `/api/officer/cases/${caseNo}/claim`);
}
async function claimAuditCount(caseNo, tc) {
  const au = await tc.staff('audit1');
  const items = await auditApi(au.api, { event: 'CLAIM' });
  return items.filter((i) => i.caseNo === caseNo).length;
}

test('TC-QUEUE-01 · ลำดับคิวและขอบเขตแผนก', async ({ tc }) => {
  await start(T0);

  await test.step('off.reg1 filter all: 17 แถวตามลำดับ', async () => {
    const { page, api } = await tc.staff('off.reg1');
    await page.goto('/officer/queue');
    await expect(tid(page, 'queue-filter'), 'ค่าเริ่มต้น queue-filter').toHaveValue('all');
    await expect(tid(page, 'queue-row'), 'queue-row 17 แถว').toHaveCount(17);
    await expectAttrList(tid(page, 'queue-row'), 'data-case-no', REGISTRY_ORDER, 'ลำดับคิวทะเบียน (BR-16)');

    const levels = await tid(page, 'queue-row').getByTestId('row-sla-level').allInnerTexts();
    expect(levels.slice(0, 3).map((s) => s.trim()), 'row-sla-level 3 แถวแรก').toEqual([LEVEL_TH.overdue, LEVEL_TH.near, LEVEL_TH.near]);
    const masked = (await tid(page, 'queue-row').getByTestId('row-id-masked').allInnerTexts()).map((s) => s.trim());
    expect(masked.length, 'row-id-masked ทุกแถว').toBe(17);
    for (const m of masked) expect(m, 'row-id-masked รูปแบบ').toMatch(/^X-XXXX-XXXXX-\d{2}-\d$/);

    // claim-btn เฉพาะแถวที่รับได้
    await expect(tid(page, 'claim-btn'), 'claim-btn 4 ปุ่ม').toHaveCount(4);
    const claimable = await page.locator('[data-testid="queue-row"]:has([data-testid="claim-btn"])').evaluateAll((els) => els.map((e) => e.getAttribute('data-case-no')));
    expect(claimable, 'แถวที่มี claim-btn').toEqual(n6([24, 28, 29, 30]));
    await expect(queueRow(page, cn(19)).getByTestId('claim-btn'), 'แถว APPROVED 019 ไม่มี claim-btn').toHaveCount(0);

    // ไม่อยู่ในคิว
    const all = await attrList(tid(page, 'queue-row'), 'data-case-no');
    for (const n of [17, 11, 14, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) expect(all, `${cn(n)} ต้องไม่อยู่ในคิวทะเบียน`).not.toContain(cn(n));

    await tid(page, 'queue-filter').selectOption('unclaimed');
    await expectAttrList(tid(page, 'queue-row'), 'data-case-no', n6([24, 28, 29, 30]), 'filter unclaimed');
    await tid(page, 'queue-filter').selectOption('mine');
    await expectAttrList(tid(page, 'queue-row'), 'data-case-no', n6([20, 22, 23]), 'filter mine (off.reg1)');
    await expect(tid(page, 'workload-count'), 'workload-count off.reg1').toHaveText('3');

    // API ฝั่งเซิร์ฟเวอร์
    expect((await queueApi(api, 'all')).map((i) => i.caseNo), 'API queue all (off.reg1)').toEqual(REGISTRY_ORDER);
    expect((await queueApi(api, 'unclaimed')).map((i) => i.caseNo), 'API queue unclaimed').toEqual(n6([24, 28, 29, 30]));
    expect((await queueApi(api, 'mine')).map((i) => i.caseNo), 'API queue mine (off.reg1)').toEqual(n6([20, 22, 23]));
  });

  await test.step('off.reg2 filter mine: 9 แถว', async () => {
    const { page, api } = await tc.staff('off.reg2');
    await page.goto('/officer/queue');
    await expect(tid(page, 'queue-row')).toHaveCount(17);
    await tid(page, 'queue-filter').selectOption('mine');
    const expected = n6([25, 26, 13, 15, 27, 16, 18, 12, 21]);
    await expectAttrList(tid(page, 'queue-row'), 'data-case-no', expected, 'filter mine (off.reg2)');
    await expect(tid(page, 'workload-count'), 'workload-count off.reg2').toHaveText('9');
    expect((await queueApi(api, 'mine')).map((i) => i.caseNo), 'API queue mine (off.reg2)').toEqual(expected);
  });

  await test.step('off.works1 เห็นเฉพาะคิวโยธา', async () => {
    const { page, api } = await tc.staff('off.works1');
    await page.goto('/officer/queue');
    await expectAttrList(tid(page, 'queue-row'), 'data-case-no', [cn(10)], 'คิวโยธา');
    expect((await queueApi(api, 'all')).map((i) => i.caseNo), 'API queue (off.works1)').toEqual([cn(10)]);
    // ข้ามแผนก: ฝั่งเซิร์ฟเวอร์ต้องปฏิเสธ
    const r = await claimApi(api, cn(28));
    expect(r.status, `off.works1 claim ${cn(28)} ข้ามแผนก (body=${JSON.stringify(r.body)})`).toBe(403);
    expect(r.body.code, 'code').toBe('FORBIDDEN');
  });

  await test.step('head1 เห็น 18 แถว (ทะเบียน + โยธา) ไม่มี claim-btn', async () => {
    const { page, api } = await tc.staff('head1');
    await page.goto('/officer/queue');
    const expected = [...REGISTRY_ORDER];
    expected.splice(expected.indexOf(cn(23)), 0, cn(10)); // กลุ่ม 3 ธ.ค.: 010 → 023 → 025 → 026
    await expect(tid(page, 'queue-row'), 'head1 18 แถว').toHaveCount(18);
    await expectAttrList(tid(page, 'queue-row'), 'data-case-no', expected, 'คิวของ head1');
    await expect(tid(page, 'claim-btn'), 'head1 ไม่มี claim-btn').toHaveCount(0);
    expect((await queueApi(api, 'all')).map((i) => i.caseNo), 'API queue (head1)').toEqual(expected);
    const r = await claimApi(api, cn(28));
    expect(r.status, `head1 claim ผ่าน API ต้องถูกปฏิเสธ (body=${JSON.stringify(r.body)})`).toBe(403);
    expect(r.body.code, 'code').toBe('FORBIDDEN');
  });
});

test('TC-QUEUE-02 · รับเรื่องซ้อน (พร้อมกันและต่อกัน)', async ({ tc }) => {
  await start(T0);
  const C28 = cn(28);
  const C29 = cn(29);

  // ทุกส่วนรันเสมอแม้ส่วนก่อนล้ม (ส่วน 2 และ 3 เริ่มด้วย RESET เอง) → ผลรอบ B08 แสดงครบทั้ง 3 ส่วน
  // แต่ละส่วนยัง assert แบบปกติข้างใน · ผลรายส่วนบันทึกด้วย expect.soft แล้วปิดท้ายด้วย assert แบบ hard ว่าผ่านครบ
  const verdicts = [];
  const clean = (e) => String((e && e.message) || e).replace(/\u001b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 6).join(' | ');
  async function part(title, fn) {
    let err = null;
    try { await test.step(title, fn); } catch (e) { err = e; }
    verdicts.push({ part: title, result: err ? `ล้ม: ${clean(err)}` : 'ผ่าน' });
    expect.soft(err ? `ล้ม: ${clean(err)}` : 'ผ่าน', `TC-QUEUE-02 ${title}`).toBe('ผ่าน');
  }

  await part('ส่วน 1: กด claim-btn พร้อมกัน 2 browser context', async () => {
    const A = await tc.staff('off.reg1');
    const B = await tc.staff('off.reg2');
    await Promise.all([A.page.goto('/officer/queue'), B.page.goto('/officer/queue')]);
    const btnA = queueRow(A.page, C28).getByTestId('claim-btn');
    const btnB = queueRow(B.page, C28).getByTestId('claim-btn');
    await expect(btnA, 'A เห็น claim-btn 028').toHaveCount(1);
    await expect(btnB, 'B เห็น claim-btn 028').toHaveCount(1);

    const [ra, rb] = await Promise.all([
      clickAndCapture(A.page, btnA, `/api/officer/cases/${C28}/claim`),
      clickAndCapture(B.page, btnB, `/api/officer/cases/${C28}/claim`),
    ]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses, `สำเร็จ 1 คน อีกคน 409 (A=${ra.status} ${JSON.stringify(ra.body)} · B=${rb.status} ${JSON.stringify(rb.body)})`).toEqual([200, 409]);
    const [win, lose, loseRes] = ra.status === 200 ? [A, B, rb] : [B, A, ra];
    expect(loseRes.body.code, 'ผู้แพ้ code').toBe('ALREADY_CLAIMED');
    await expect(tid(lose.page, 'action-error'), 'ผู้แพ้ action-error').toHaveText(MSG.ALREADY_CLAIMED);

    const c = await getCase(win.api, C28);
    expect(c.owner, 'owner = ผู้ชนะ').toBe(win.username);
    expect(c.status, 'status').toBe('IN_REVIEW');
    await win.page.goto('/officer/queue');
    await expect(queueRow(win.page, C28), 'data-owner = ผู้ชนะ').toHaveAttribute('data-owner', win.username);
    await expect(queueRow(win.page, C28).getByTestId('row-owner'), 'row-owner = ผู้ชนะ')
      .toHaveText(new RegExp(`^(${win.username.replace('.', '\\.')}|${STAFF_NAME[win.username]})$`));
    expect(await claimAuditCount(C28, tc), `Audit CLAIM ของ ${C28}`).toBe(1);
  });

  await part('ส่วน 2: API 10 ครั้งพร้อมกัน (RESET)', async () => {
    await reset();
    const A = await tc.staff('off.reg1');
    const B = await tc.staff('off.reg2');
    const calls = [];
    for (let i = 0; i < 5; i++) { calls.push(['off.reg1', A.api]); calls.push(['off.reg2', B.api]); }
    const res = await Promise.all(calls.map(([, api]) => api.post(`/api/officer/cases/${C29}/claim`)));
    const out = [];
    for (let i = 0; i < res.length; i++) out.push({ user: calls[i][0], status: res[i].status(), body: await res[i].json().catch(() => ({})) });
    const ok = out.filter((o) => o.status === 200);
    const desc = out.map((o) => `${o.user}:${o.status}:${o.body.code || ''}`).join(' ');
    expect(ok.length, `ต้องได้ 200 ครั้งเดียว (${desc})`).toBe(1);
    const fail = out.filter((o) => o.status !== 200);
    expect(fail.map((o) => `${o.status}:${o.body.code}`), `อีก 9 ครั้ง (${desc})`).toEqual(Array(9).fill('409:ALREADY_CLAIMED'));
    const c = await getCase(A.api, C29);
    expect(c.owner, 'owner = ผู้ชนะคนเดียว').toBe(ok[0].user);
    expect(await claimAuditCount(C29, tc), `Audit CLAIM ของ ${C29}`).toBe(1);
  });

  await part('ส่วน 3: ต่อกัน (RESET · จับ B08)', async () => {
    await reset();
    const A = await tc.staff('off.reg1');
    const B = await tc.staff('off.reg2');
    const r1 = await claimApi(A.api, C29);
    expect(r1.status, `off.reg1 claim (body=${JSON.stringify(r1.body)})`).toBe(200);
    expect(r1.body.owner, 'owner').toBe('off.reg1');
    const r2 = await B.api.post(`/api/officer/cases/${C29}/claim`);
    await expectStatus(r2, 409, 'ALREADY_CLAIMED', 'off.reg2 claim ต่อจาก off.reg1', MSG.ALREADY_CLAIMED);
    const c = await getCase(B.api, C29);
    expect(c.owner, 'owner ยัง off.reg1').toBe('off.reg1');
    await expectWorkload(B.page, 9, 'workload-count off.reg2 ยัง 9');
    const r3 = await A.api.post(`/api/officer/cases/${C29}/claim`);
    await expectStatus(r3, 409, null, 'off.reg1 claim ซ้ำเอง');
    expect(await claimAuditCount(C29, tc), `Audit CLAIM ของ ${C29}`).toBe(1);
  });

  const failedParts = verdicts.filter((v) => v.result !== 'ผ่าน');
  expect(failedParts, `TC-QUEUE-02 ทุกส่วนต้องผ่าน · ผลรายส่วน ${JSON.stringify(verdicts)}`).toEqual([]);
});

test('TC-QUEUE-03 · งานในมือสูงสุด 10', async ({ tc }) => {
  await start(T0);
  let reg2 = await tc.staff('off.reg2');

  await test.step('1: workload 9', async () => {
    await expectWorkload(reg2.page, 9);
  });

  await test.step('2: claim 028 (ครั้งที่ 10) → สำเร็จ', async () => {
    const r = await uiClaim(reg2.page, cn(28));
    expect(r.status, `claim 028 (body=${JSON.stringify(r.body)})`).toBe(200);
    await expectWorkload(reg2.page, 10);
  });

  await test.step('3: claim 029 (ครั้งที่ 11) → WORKLOAD_LIMIT', async () => {
    const r = await uiClaim(reg2.page, cn(29));
    expect(r.status, `claim 029 (body=${JSON.stringify(r.body)})`).toBe(409);
    expect(r.body.code, 'code').toBe('WORKLOAD_LIMIT');
    await expect(tid(reg2.page, 'action-error')).toHaveText(MSG.WORKLOAD_LIMIT);
    await expectStatus(await reg2.api.post(`/api/officer/cases/${cn(29)}/claim`), 409, 'WORKLOAD_LIMIT', 'API claim 029 ครั้งที่ 11', MSG.WORKLOAD_LIMIT);
    const c = await getCase(reg2.api, cn(29));
    expect(c.status, '029 ยัง SUBMITTED').toBe('SUBMITTED');
    expect(c.owner || null, '029 ไม่มีผู้รับ').toBeNull();
    await expectWorkload(reg2.page, 10, 'workload ยัง 10');
  });

  await test.step('4: อนุมัติ 025 (SV-01) → workload 9', async () => {
    await reg2.page.goto(`/officer/cases/${cn(25)}`);
    await tid(reg2.page, 'approve-btn').click();
    await expectCaseStatus(reg2.page, 'APPROVED');
    await expectWorkload(reg2.page, 9);
  });

  await test.step('5: claim 029 อีกครั้ง → สำเร็จ', async () => {
    const r = await uiClaim(reg2.page, cn(29));
    expect(r.status, `claim 029 (body=${JSON.stringify(r.body)})`).toBe(200);
    await expectWorkload(reg2.page, 10);
  });

  await test.step('6: off.reg1 (3) claim 030 → สำเร็จ', async () => {
    const reg1 = await tc.staff('off.reg1');
    const r = await claimApi(reg1.api, cn(30));
    expect(r.status, `off.reg1 claim 030 (body=${JSON.stringify(r.body)})`).toBe(200);
  });

  await test.step('7: RESET · return 025 → NEED_FIX ไม่นับ → workload 8', async () => {
    await reset();
    reg2 = await tc.staff('off.reg2');
    await reg2.page.goto(`/officer/cases/${cn(25)}`);
    await tid(reg2.page, 'return-btn').click();
    await tid(reg2.page, 'return-reason').fill('xxxxxxxxxx');
    await tid(reg2.page, 'return-submit').click();
    await expectCaseStatus(reg2.page, 'NEED_FIX');
    await expectWorkload(reg2.page, 8);
  });

  await test.step('8: claim 028 และ 029 → workload 10', async () => {
    for (const n of [28, 29]) {
      const r = await uiClaim(reg2.page, cn(n));
      expect(r.status, `claim ${cn(n)} (body=${JSON.stringify(r.body)})`).toBe(200);
    }
    await expectWorkload(reg2.page, 10);
  });

  await test.step('9: สมหญิงส่งแก้ 025 → คืนผู้ถือเดิมแม้เกิน 10 → workload 11', async () => {
    const sy = await tc.citizen(ID.SOMYING);
    await sy.page.goto(`/citizen/cases/${cn(25)}`);
    await tid(sy.page, 'submit-fix-btn').click();
    await expectCaseStatus(sy.page, 'IN_REVIEW');
    await expect(tid(sy.page, 'action-error'), 'ส่งแก้ไม่ error').toBeHidden();
    const c = await getCase(reg2.api, cn(25));
    expect(c.owner, 'ผู้ถือยัง off.reg2').toBe('off.reg2');
    await expectWorkload(reg2.page, 11);
  });

  await test.step('10: off.reg2 claim 030 → WORKLOAD_LIMIT · workload ยัง 11', async () => {
    await expectStatus(await reg2.api.post(`/api/officer/cases/${cn(30)}/claim`), 409, 'WORKLOAD_LIMIT', 'claim 030 ที่ 11', MSG.WORKLOAD_LIMIT);
    await expectWorkload(reg2.page, 11);
  });
});

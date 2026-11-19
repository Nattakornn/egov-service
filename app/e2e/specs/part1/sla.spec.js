// TEST-PLAN §8 หมวด SLA (TC-SLA-01..03) · วันทำการ จ.–ศ. ยกเว้น 7 ธ.ค. · 10 ธ.ค. · 31 ธ.ค. 2569 · 1 ม.ค. 2570 · ตัดรอบ 16:30:00
const {
  test, expect, T0, ID, cn, start, reset, clock, expectStatus, newPaid, getCase, claimApi, returnApi,
  tid, queueRow, expectSlaLevel, expectCaseStatus,
} = require('./_lib');

const C31 = cn(31);

async function expectDue(page, iso, text, label) {
  await expect(tid(page, 'sla-due'), `${label}: sla-due data-iso`).toHaveAttribute('data-iso', iso);
  if (text) await expect(tid(page, 'sla-due'), `${label}: sla-due ข้อความ`).toHaveText(text);
}
async function claimAndReturn(tc, caseNo) {
  const off = await tc.staff('off.reg1');
  const r = await claimApi(off.api, caseNo);
  expect(r.status, `off.reg1 claim ${caseNo} (body=${JSON.stringify(r.body)})`).toBe(200);
  const b = await returnApi(off.api, caseNo, 'xxxxxxxxxx');
  expect(b.status, 'return → NEED_FIX').toBe('NEED_FIX');
  return off;
}

test('TC-SLA-01 · กำหนดเสร็จตามตารางวันที่', async ({ tc }) => {
  await start(T0);
  // [แถว, บริการ, ตัวเลือก, ชำระเมื่อ, dueAt, ข้อความบนจอ]
  const rows = [
    ['a', 'SV-01', { qty: 1 }, '2026-12-01T09:00:00+07:00', '2026-12-04T16:30:00+07:00', '4 ธ.ค. 2569 16:30'],
    ['b', 'SV-01', { qty: 1 }, '2026-12-01T16:29:00+07:00', '2026-12-04T16:30:00+07:00', '4 ธ.ค. 2569 16:30'],
    ['c', 'SV-01', { qty: 1 }, '2026-12-01T16:30:00+07:00', '2026-12-08T16:30:00+07:00', '8 ธ.ค. 2569 16:30'],
    ['d', 'SV-01', { qty: 1 }, '2026-12-04T10:00:00+07:00', '2026-12-11T16:30:00+07:00', '11 ธ.ค. 2569 16:30'],
    ['e', 'SV-01', { qty: 1 }, '2026-12-05T10:00:00+07:00', '2026-12-14T16:30:00+07:00', '14 ธ.ค. 2569 16:30'],
    ['f', 'SV-02', {}, '2026-12-01T09:00:00+07:00', '2026-12-17T16:30:00+07:00', '17 ธ.ค. 2569 16:30'],
    ['g', 'SV-03', { areaSqm: 100 }, '2026-12-01T09:00:00+07:00', '2026-12-24T16:30:00+07:00', '24 ธ.ค. 2569 16:30'],
    ['h', 'SV-01', { qty: 1 }, '2026-12-29T10:00:00+07:00', '2027-01-05T16:30:00+07:00', '5 ม.ค. 2570 16:30'],
    ['i', 'SV-01', { qty: 1 }, '2026-12-31T23:59:00+07:00', '2027-01-07T16:30:00+07:00', '7 ม.ค. 2570 16:30'],
  ];
  for (const [row, svc, opts, paidAt, dueAt, text] of rows) {
    await test.step(`แถว ${row}: ${svc} ชำระ ${paidAt} → ${dueAt}`, async () => {
      await start(paidAt); // RESET ทุกแถว แล้ว CLOCK(เวลาชำระ)
      const { page, api } = await tc.citizen(ID.SOMCHAI);
      const p = await newPaid(api, svc, opts);
      expect(p.caseNo, `แถว ${row}: caseNo`).toBe(C31);
      const c = await getCase(api, C31, `แถว ${row}`);
      expect(c.dueAt, `แถว ${row}: dueAt`).toBe(dueAt);
      await page.goto(`/citizen/cases/${C31}`);
      await expectDue(page, dueAt, text, `แถว ${row}`);
    });
  }
});

test('TC-SLA-02 · หยุดนับ SLA ระหว่างรอแก้ไข', async ({ tc }) => {
  await start(T0);

  await test.step('ส่วน 1: ตีกลับ 2 ธ.ค. 11:00 ส่งแก้ 3 ธ.ค. 10:00 → 8 ธ.ค.', async () => {
    const cit = await tc.citizen(ID.SOMCHAI);
    const p = await newPaid(cit.api, 'SV-01', { qty: 1 });
    expect(p.caseNo).toBe(C31);
    expect((await getCase(cit.api, C31)).dueAt, 'dueAt ตั้งต้น').toBe('2026-12-04T16:30:00+07:00');

    await clock('2026-12-02T11:00:00+07:00');
    const off = await claimAndReturn(tc, C31);
    await off.page.goto(`/officer/cases/${C31}`);
    await expectCaseStatus(off.page, 'NEED_FIX', 'officer');
    await cit.page.goto(`/citizen/cases/${C31}`);
    await expectSlaLevel(tid(cit.page, 'sla-level'), 'paused', 'ระหว่าง NEED_FIX');
    await expect(tid(cit.page, 'fix-deadline'), 'fix-deadline = ตีกลับ + 168 ชม.').toHaveAttribute('data-iso', '2026-12-09T11:00:00+07:00');

    await clock('2026-12-03T10:00:00+07:00');
    await cit.page.goto(`/citizen/cases/${C31}`);
    await tid(cit.page, 'submit-fix-btn').click();
    await expectCaseStatus(cit.page, 'IN_REVIEW', 'หลังส่งแก้');
    await expectDue(cit.page, '2026-12-08T16:30:00+07:00', '8 ธ.ค. 2569 16:30', 'หลังส่งแก้');
    await expectSlaLevel(tid(cit.page, 'sla-level'), 'normal', 'หลังส่งแก้');
    const c = await getCase(cit.api, C31);
    expect(c.dueAt, 'API dueAt (หยุดนับ 1 วัน: พฤ.3)').toBe('2026-12-08T16:30:00+07:00');
    expect(c.slaLevel, 'API slaLevel').toBe('normal');
    expect(c.owner, 'API owner เดิม').toBe('off.reg1');
    await off.page.goto(`/officer/cases/${C31}`);
    await expect(tid(off.page, 'case-owner'), 'case-owner เดิม').toHaveText('off.reg1');
  });

  await test.step('ส่วน 2: seed 017 ส่งแก้ 1 ธ.ค. 09:00 → 1 ธ.ค. 16:30', async () => {
    await reset();
    const cit = await tc.citizen(ID.SOMCHAI);
    await cit.page.goto(`/citizen/cases/${cn(17)}`);
    await expectSlaLevel(tid(cit.page, 'sla-level'), 'paused', '017 ก่อนส่ง');
    await expect(tid(cit.page, 'sla-due'), '017 ก่อนส่ง sla-due').toHaveAttribute('data-iso', '2026-11-27T16:30:00+07:00');
    await tid(cit.page, 'submit-fix-btn').click();
    await expectCaseStatus(cit.page, 'IN_REVIEW', '017 หลังส่ง');
    await expectSlaLevel(tid(cit.page, 'sla-level'), 'near', '017 หลังส่ง');
    const c = await getCase(cit.api, cn(17));
    expect(c.dueAt, '017 dueAt (หยุดนับ 2 วัน: 30 พ.ย., 1 ธ.ค.)').toBe('2026-12-01T16:30:00+07:00');
    expect(c.slaLevel, '017 slaLevel').toBe('near');
    expect(c.owner, '017 ผู้ถือ').toBe('off.reg1');
  });

  await test.step('ส่วน 3: 017 ส่งแก้ 4 ธ.ค. 10:00 → 4 ธ.ค. 16:30', async () => {
    await start('2026-12-04T10:00:00+07:00');
    const cit = await tc.citizen(ID.SOMCHAI);
    const b = await expectStatus(await cit.api.post(`/api/cases/${cn(17)}/resubmit`), 200, null, 'resubmit 017');
    expect(b.status, 'resubmit status').toBe('IN_REVIEW');
    expect(b.dueAt, 'resubmit dueAt (หยุดนับ 5 วัน)').toBe('2026-12-04T16:30:00+07:00');
    const c = await getCase(cit.api, cn(17));
    expect(c.dueAt, '017 dueAt').toBe('2026-12-04T16:30:00+07:00');
    expect(c.slaLevel, '017 slaLevel').toBe('near');
    await cit.page.goto(`/citizen/cases/${cn(17)}`);
    await expectSlaLevel(tid(cit.page, 'sla-level'), 'near', '017 ส่วน 3');
  });

  await test.step('ส่วน 4: ตีกลับและส่งแก้วันเดียวกัน → หยุด 0 วัน', async () => {
    await start(T0);
    const cit = await tc.citizen(ID.SOMCHAI);
    expect((await newPaid(cit.api, 'SV-01', { qty: 1 })).caseNo).toBe(C31);
    await clock('2026-12-02T09:00:00+07:00');
    await claimAndReturn(tc, C31);
    await clock('2026-12-02T15:00:00+07:00');
    const b = await expectStatus(await cit.api.post(`/api/cases/${C31}/resubmit`), 200, null, 'resubmit 031');
    expect(b.dueAt, 'resubmit dueAt').toBe('2026-12-04T16:30:00+07:00');
    expect((await getCase(cit.api, C31)).dueAt, 'dueAt ยัง 4 ธ.ค.').toBe('2026-12-04T16:30:00+07:00');
  });

  await test.step('ส่วน 5: คร่อมสุดสัปดาห์/วันหยุด ส่งแก้หลัง 16:30 → 8 ธ.ค. เกินกำหนด', async () => {
    await start(T0);
    const cit = await tc.citizen(ID.SOMCHAI);
    expect((await newPaid(cit.api, 'SV-01', { qty: 1 })).caseNo).toBe(C31);
    await clock('2026-12-04T10:00:00+07:00');
    await claimAndReturn(tc, C31);
    await clock('2026-12-08T17:00:00+07:00');
    await cit.page.goto(`/citizen/cases/${C31}`);
    await tid(cit.page, 'submit-fix-btn').click();
    await expectCaseStatus(cit.page, 'IN_REVIEW', 'ส่วน 5');
    const c = await getCase(cit.api, C31);
    expect(c.dueAt, 'dueAt (หยุดนับ 1 วัน: อ.8)').toBe('2026-12-08T16:30:00+07:00');
    expect(c.slaLevel, 'slaLevel').toBe('overdue');
    await cit.page.goto(`/citizen/cases/${C31}`);
    await expectDue(cit.page, '2026-12-08T16:30:00+07:00', '8 ธ.ค. 2569 16:30', 'ส่วน 5');
    await expectSlaLevel(tid(cit.page, 'sla-level'), 'overdue', 'ส่วน 5');
  });
});

test('TC-SLA-03 · ระดับเตือน ปกติ / ใกล้ครบกำหนด / เกินกำหนด', async ({ tc }) => {
  await start(T0);

  await test.step('ส่วน A: คำขอใหม่ กำหนด ศ. 4 ธ.ค. 16:30', async () => {
    const cit = await tc.citizen(ID.SOMCHAI);
    expect((await newPaid(cit.api, 'SV-01', { qty: 1 })).caseNo).toBe(C31);
    const table = [
      ['2026-12-01T09:00:00+07:00', 'normal'],
      ['2026-12-02T09:00:00+07:00', 'normal'],
      ['2026-12-03T09:00:00+07:00', 'near'],
      ['2026-12-04T16:30:00+07:00', 'near'],
      ['2026-12-04T16:30:01+07:00', 'overdue'],
      ['2026-12-04T16:31:00+07:00', 'overdue'],
      ['2026-12-05T10:00:00+07:00', 'overdue'],
    ];
    for (const [t, level] of table) {
      await clock(t);
      await cit.page.goto(`/citizen/cases/${C31}`);
      await expectSlaLevel(tid(cit.page, 'sla-level'), level, `ส่วน A ${t}`);
      expect((await getCase(cit.api, C31)).slaLevel, `ส่วน A ${t}: API slaLevel`).toBe(level);
    }
  });

  await test.step('ส่วน B: seed 016 กำหนด อ. 8 ธ.ค. (คั่น ส-อา และ จ.7)', async () => {
    await reset();
    const piti = await tc.citizen(ID.PITI); // ผู้ยื่น 016
    const table = [
      ['2026-12-03T09:00:00+07:00', 'normal'],
      ['2026-12-04T09:00:00+07:00', 'near'],
      ['2026-12-08T16:30:00+07:00', 'near'],
      ['2026-12-08T16:31:00+07:00', 'overdue'],
    ];
    for (const [t, level] of table) {
      await clock(t);
      await piti.page.goto(`/citizen/cases/${cn(16)}`);
      await expectSlaLevel(tid(piti.page, 'sla-level'), level, `ส่วน B ${t}`);
      expect((await getCase(piti.api, cn(16))).slaLevel, `ส่วน B ${t}: API slaLevel`).toBe(level);
    }
  });

  await test.step('ส่วน C: seed ที่ 09:00 ผ่านคิวและหน้าเคส', async () => {
    await reset();
    const off = await tc.staff('off.reg1');
    await off.page.goto('/officer/queue');
    const expected = [[20, 'overdue'], [22, 'near'], [24, 'near'], [25, 'normal']];
    for (const [n, level] of expected) {
      const row = queueRow(off.page, cn(n));
      await expect(row.getByTestId('row-sla-level'), `คิว ${cn(n)} row-sla-level`).toHaveText(
        { normal: 'ปกติ', near: 'ใกล้ครบกำหนด', overdue: 'เกินกำหนด' }[level],
      );
      await expect(row, `คิว ${cn(n)} data-sla-level`).toHaveAttribute('data-sla-level', level);
    }
    for (const [n, level] of [...expected, [17, 'paused']]) {
      await off.page.goto(`/officer/cases/${cn(n)}`);
      await expectSlaLevel(tid(off.page, 'sla-level'), level, `หน้าเคส ${cn(n)}`);
      expect((await getCase(off.api, cn(n))).slaLevel, `API ${cn(n)} slaLevel`).toBe(level);
    }
    const sy = await tc.citizen(ID.SOMYING);
    await sy.page.goto(`/citizen/cases/${cn(1)}`);
    await expectSlaLevel(tid(sy.page, 'sla-level'), 'closed', '000001 (COMPLETED)');

    await clock('2026-12-01T16:30:00+07:00');
    await off.page.goto(`/officer/cases/${cn(22)}`);
    await expectSlaLevel(tid(off.page, 'sla-level'), 'near', '022 ที่ 16:30:00');
    await clock('2026-12-01T16:31:00+07:00');
    await off.page.goto(`/officer/cases/${cn(22)}`);
    await expectSlaLevel(tid(off.page, 'sla-level'), 'overdue', '022 ที่ 16:31:00');
    expect((await getCase(off.api, cn(22))).slaLevel, 'API 022 ที่ 16:31').toBe('overdue');
  });
});

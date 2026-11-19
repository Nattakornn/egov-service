// TEST-PLAN §6 หมวด PAY (TC-PAY-01..04)
const {
  test, expect, T0, ID, MSG, cn, rc, start, reset, clock, expectStatus, payRaw, payOk, newQr, newPaid, myCases, getCase,
  tid, uiAttach,
} = require('./_lib');

/** ยื่น SV-01 ผ่านหน้าจอจนได้ QR แล้วคืนค่า qr-ref */
async function wizardSv01ToQr(page, qty = 1) {
  await page.goto('/citizen/new/SV-01');
  await tid(page, 'qty-input').fill(String(qty));
  await tid(page, 'to-upload-btn').click();
  await expect(tid(page, 'wizard-step')).toHaveText('2/3 แนบเอกสาร');
  await uiAttach(page, 'upload-input-id-card', 'id-card.pdf');
  await expect(tid(page, 'file-item')).toHaveCount(1);
  await tid(page, 'to-payment-btn').click();
  await expect(tid(page, 'wizard-step')).toHaveText('3/3 ชำระเงิน');
  await tid(page, 'create-qr-btn').click();
  await expect(tid(page, 'qr-ref')).toHaveText(/^PP-\d{4}$/);
  return (await tid(page, 'qr-ref').innerText()).trim();
}

test('TC-PAY-01 · อายุ QR 15:00', async ({ tc }) => {
  await start(T0);

  await test.step('รอบ 1: 09:00:00 (อายุ 5:00) → 200', async () => {
    await tc.citizen(ID.SOMCHAI);
    const b = await payOk('PP-0001', 500, 'รอบ 1 pay PP-0001');
    expect(b.caseNo, 'รอบ 1 caseNo').toBe('EG-2569-000031');
  });

  await test.step('รอบ 2: 09:09:59 (อายุ 14:59) → 200', async () => {
    await start('2026-12-01T09:09:59+07:00');
    await tc.citizen(ID.SOMCHAI);
    const b = await payOk('PP-0001', 500, 'รอบ 2 pay PP-0001');
    expect(b.caseNo, 'รอบ 2 caseNo').toBe('EG-2569-000031');
  });

  await test.step('รอบ 3: 09:10:00 (อายุ 15:00 พอดี) → 410 QR_EXPIRED', async () => {
    await start('2026-12-01T09:10:00+07:00');
    const { page, api } = await tc.citizen(ID.SOMCHAI);
    const r = await payRaw('PP-0001', 500);
    expect(r.status, `รอบ 3 pay PP-0001 (body=${JSON.stringify(r.body)})`).toBe(410);
    expect(r.body.code, 'รอบ 3 code').toBe('QR_EXPIRED');
    const p = await expectStatus(await api.get('/api/payments/PP-0001'), 200, null, 'GET PP-0001');
    expect(p.status, 'PP-0001 status').toBe('EXPIRED');
    expect((await myCases(api)).length, 'GET /api/cases ยัง 10 (ไม่ออกเลข)').toBe(10);

    // บนจอ
    await page.goto('/citizen/new/SV-02?draft=DR-0002');
    await expect(tid(page, 'qr-expired-msg')).toHaveText(MSG.QR_EXPIRED);
    await expect(tid(page, 'payment-status')).toHaveText('QR หมดอายุ');
    await expect(tid(page, 'payment-status')).toHaveAttribute('data-status', 'EXPIRED');
    await expect(tid(page, 'regenerate-qr-btn'), 'มี regenerate-qr-btn').toHaveCount(1);
    await tid(page, 'regenerate-qr-btn').click();
    await expect(tid(page, 'qr-ref')).toHaveText('PP-0002');
    await expect(tid(page, 'qr-expires')).toHaveAttribute('data-iso', '2026-12-01T09:25:00+07:00');
    const b = await payOk('PP-0002', 500, 'รอบ 3 pay PP-0002');
    expect(b.caseNo, 'รอบ 3 QR ใหม่ caseNo').toBe('EG-2569-000031');
  });

  await test.step('รอบ 4: 09:10:01 (อายุ 15:01) → 410', async () => {
    await start('2026-12-01T09:10:01+07:00');
    await tc.citizen(ID.SOMCHAI);
    const r = await payRaw('PP-0001', 500);
    expect(r.status, `รอบ 4 pay PP-0001 (body=${JSON.stringify(r.body)})`).toBe(410);
    expect(r.body.code, 'รอบ 4 code').toBe('QR_EXPIRED');
  });
});

test('TC-PAY-02 · ยอดเงินและ callback ซ้ำ', async ({ tc }) => {
  await start(T0);
  const { api } = await tc.citizen(ID.SOMCHAI);
  const q = await newQr(api, 'SV-01', { qty: 1 });
  expect(q.fee, 'ค่าธรรมเนียม SV-01 qty 1').toBe(20);
  expect(q.ref, 'ref QR แรกหลัง reset').toBe('PP-0002');

  for (const [amount, why] of [[19, 'ขาด ฿1'], [21, 'เกิน ฿1']]) {
    await test.step(`pay ${amount} (${why}) → 422`, async () => {
      const r = await payRaw('PP-0002', amount);
      expect(r.status, `pay ${amount} (body=${JSON.stringify(r.body)})`).toBe(422);
      expect(r.body.code, `pay ${amount} code`).toBe('AMOUNT_MISMATCH');
      expect(r.body.message, `pay ${amount} message`).toBe(MSG.AMOUNT_MISMATCH);
      const p = await expectStatus(await api.get('/api/payments/PP-0002'), 200, null, 'GET PP-0002');
      expect(p.status, `หลัง pay ${amount}: status`).toBe('PENDING');
      expect((await myCases(api)).length, `หลัง pay ${amount}: cases ยัง 10`).toBe(10);
    });
  }

  let first;
  await test.step('pay 20 → 200 PAID', async () => {
    first = await payOk('PP-0002', 20, 'pay 20');
    expect(first.caseNo, 'caseNo').toBe('EG-2569-000031');
    expect(first.receiptNo, 'receiptNo').toBe('RC-2569-000031');
    expect(first.duplicate, 'duplicate').toBe(false);
    expect((await myCases(api)).length, 'cases = 11').toBe(11);
  });

  await test.step('pay 20 ซ้ำ ref เดิม → duplicate:true เลขเดิม', async () => {
    const b = await payOk('PP-0002', 20, 'pay 20 ซ้ำ');
    expect(b.duplicate, 'duplicate').toBe(true);
    expect(b.caseNo, 'caseNo เดิม').toBe('EG-2569-000031');
    expect(b.receiptNo, 'receiptNo เดิม').toBe('RC-2569-000031');
    expect((await myCases(api)).length, 'cases ยัง 11').toBe(11);
  });

  await test.step('ร่างใหม่จ่ายครบ → 000032 (ไม่มีเลขข้าม)', async () => {
    const p = await newPaid(api, 'SV-01', { qty: 1 });
    expect(p.caseNo, 'caseNo ถัดไป').toBe('EG-2569-000032');
    expect(p.receiptNo, 'receiptNo ถัดไป').toBe('RC-2569-000032');
  });
});

test('TC-PAY-03 · ชำระพร้อมกัน เลขไม่ซ้ำ', async ({ tc }) => {
  await start(T0);
  // 2 browser context คนละ cookie
  const somchai = await tc.citizen(ID.SOMCHAI);
  const somying = await tc.citizen(ID.SOMYING);
  const qrs = [];
  for (const who of [somchai, somchai, somchai, somying, somying, somying]) {
    qrs.push({ who, ...(await newQr(who.api, 'SV-01', { qty: 1 })) });
  }
  expect(qrs.map((q) => q.ref).sort(), 'ref ที่สร้าง').toEqual(['PP-0002', 'PP-0003', 'PP-0004', 'PP-0005', 'PP-0006', 'PP-0007']);

  const results = await Promise.all(qrs.map((q) => q.who.api.post(`/api/test/payments/${q.ref}/pay`, { data: { amount: 20 } })));
  const bodies = [];
  for (let i = 0; i < results.length; i++) {
    bodies.push(await expectStatus(results[i], 200, null, `pay ${qrs[i].ref} (พร้อมกัน)`));
  }
  const caseNos = bodies.map((b) => b.caseNo);
  const receipts = bodies.map((b) => b.receiptNo);
  expect(new Set(caseNos).size, `caseNo ต้องไม่ซ้ำ (received ${caseNos.join(',')})`).toBe(6);
  expect([...caseNos].sort(), 'ชุด caseNo').toEqual([31, 32, 33, 34, 35, 36].map((n) => cn(n)));
  expect([...receipts].sort(), 'ชุด receiptNo').toEqual([31, 32, 33, 34, 35, 36].map((n) => rc(n)));

  const mineA = (await myCases(somchai.api)).map((c) => c.caseNo);
  const mineB = (await myCases(somying.api)).map((c) => c.caseNo);
  expect(mineA.length, 'สมชาย cases 10 + 3').toBe(13);
  expect(mineB.length, 'สมหญิง cases 11 + 3').toBe(14);
  for (let i = 0; i < 6; i++) {
    const owner = i < 3 ? mineA : mineB;
    expect(owner, `${caseNos[i]} ต้องอยู่ในรายการของผู้ยื่น ${i < 3 ? 'สมชาย' : 'สมหญิง'}`).toContain(caseNos[i]);
  }

  const next = await newPaid(somchai.api, 'SV-01', { qty: 1 });
  expect(next.caseNo, 'รายการถัดไป').toBe('EG-2569-000037');
});

test('TC-PAY-04 · เลขคำขอข้ามปี', async ({ tc }) => {
  await start(T0);
  const { page, api } = await tc.citizen(ID.SOMCHAI);

  let ref1;
  await test.step('1: 31 ธ.ค. 23:58 สร้างร่าง + QR → ยังไม่มีเลข', async () => {
    await clock('2026-12-31T23:58:00+07:00');
    ref1 = await wizardSv01ToQr(page, 1);
    const p = await expectStatus(await api.get(`/api/payments/${ref1}`), 200, null, `GET ${ref1}`);
    expect(p.status, 'สถานะก่อนจ่าย').toBe('PENDING');
    expect(p.caseNo || null, 'ยังไม่มีเลขคำขอ').toBeNull();
  });

  await test.step('2: 23:59 pay ฿20 → EG-2569-000031', async () => {
    await clock('2026-12-31T23:59:00+07:00');
    const b = await payOk(ref1, 20, `pay ${ref1}`);
    expect(b.caseNo, 'caseNo').toBe('EG-2569-000031');
    expect(b.receiptNo, 'receiptNo').toBe('RC-2569-000031');
    await tid(page, 'refresh-payment-btn').click();
    await expect(tid(page, 'submitted-case-no')).toHaveText('EG-2569-000031');
    await expect(tid(page, 'receipt-paid-at')).toHaveAttribute('data-iso', '2026-12-31T23:59:00+07:00');
    const c = await getCase(api, 'EG-2569-000031');
    expect(c.paidAt, 'paidAt').toBe('2026-12-31T23:59:00+07:00');
  });

  await test.step('3: 1 ม.ค. 2570 00:00 → EG-2570-000001', async () => {
    await clock('2027-01-01T00:00:00+07:00');
    const p = await newPaid(api, 'SV-01', { qty: 1 });
    expect(p.caseNo, 'caseNo ปีใหม่').toBe('EG-2570-000001');
    expect(p.receiptNo, 'receiptNo ปีใหม่').toBe('RC-2570-000001');
  });

  await test.step('4: ใบที่ 2 ของปี 2570', async () => {
    const p = await newPaid(api, 'SV-01', { qty: 1 });
    expect(p.caseNo, 'caseNo ใบที่ 2').toBe('EG-2570-000002');
  });

  await test.step('5: เลขเดิมปี 2569 ไม่ถูกแก้', async () => {
    const c = await getCase(api, 'EG-2569-000031');
    expect(c.caseNo, 'caseNo เดิม').toBe('EG-2569-000031');
  });
});

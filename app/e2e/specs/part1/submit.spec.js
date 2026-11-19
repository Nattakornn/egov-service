// TEST-PLAN §4 หมวด SUBMIT (TC-SUBMIT-01..03)
const {
  test, expect, T0, ID, MSG, cn, start, reset, expectStatus, payOk, payRaw, newDraft, uploadOk, uploadRaw, createQr,
  myCases, getCase, claimApi, queueApi, tid, byAttr, queueRow, attrList, expectPath, uiAttach, uiRemoveFile,
  expectCaseStatus, expectSlaLevel,
} = require('./_lib');

test('TC-SUBMIT-01 · ยื่นคำขอ SV-01 ครบวงจร', async ({ tc }) => {
  await start(T0);
  const { page, api } = await tc.citizen(ID.SOMCHAI);

  await test.step('1: กรอกข้อมูล qty 2 → ฿40', async () => {
    await page.goto('/citizen');
    await tid(page, 'start-service-SV-01').click();
    await expectPath(page, '/citizen/new/SV-01');
    await expect(tid(page, 'wizard-step')).toHaveText('1/3 กรอกข้อมูล');
    await tid(page, 'qty-input').fill('2');
    await expect(tid(page, 'fee-total')).toHaveText('฿40');
    await tid(page, 'to-upload-btn').click();
  });

  await test.step('2: แนบ id-card.pdf', async () => {
    await expect(tid(page, 'wizard-step')).toHaveText('2/3 แนบเอกสาร');
    await expect(tid(page, 'to-payment-btn'), 'ยังไม่แนบ → disabled').toBeDisabled();
    await uiAttach(page, 'upload-input-id-card', 'id-card.pdf');
    await expect(tid(page, 'file-item'), 'file-item 1 ชิ้น').toHaveCount(1);
    await expect(tid(page, 'file-item'), 'data-doc-key').toHaveAttribute('data-doc-key', 'id-card');
    await expect(tid(page, 'to-payment-btn'), 'แนบครบ → ใช้ได้').toBeEnabled();
    await tid(page, 'to-payment-btn').click();
  });

  await test.step('3: สร้าง QR', async () => {
    await expect(tid(page, 'wizard-step')).toHaveText('3/3 ชำระเงิน');
    await expect(tid(page, 'payment-amount')).toHaveText('฿40');
    await tid(page, 'create-qr-btn').click();
    await expect(tid(page, 'qr-ref')).toHaveText('PP-0002');
    await expect(tid(page, 'qr-expires')).toHaveAttribute('data-iso', '2026-12-01T09:15:00+07:00');
    await expect(tid(page, 'payment-status')).toHaveText('รอชำระ');
    await expect(tid(page, 'payment-status')).toHaveAttribute('data-status', 'PENDING');
  });

  await test.step('4: ชำระ PP-0002 ฿40', async () => {
    const r = await payRaw('PP-0002', 40);
    expect(r.status, `pay PP-0002: HTTP (body=${JSON.stringify(r.body)})`).toBe(200);
    expect(r.body, 'pay PP-0002 body').toMatchObject({ status: 'PAID', caseNo: 'EG-2569-000031', receiptNo: 'RC-2569-000031', duplicate: false });
    await tid(page, 'refresh-payment-btn').click();
    await expect(tid(page, 'payment-status')).toHaveText('ชำระแล้ว');
    await expect(tid(page, 'payment-status')).toHaveAttribute('data-status', 'PAID');
    await expect(tid(page, 'submitted-case-no')).toHaveText('EG-2569-000031');
    await expect(tid(page, 'receipt-no')).toHaveText('RC-2569-000031');
    await expect(tid(page, 'receipt-amount')).toHaveText('฿40');
    await expect(tid(page, 'receipt-paid-at')).toHaveAttribute('data-iso', '2026-12-01T09:00:00+07:00');
  });

  await test.step('5: หน้าคำขอ EG-2569-000031', async () => {
    await tid(page, 'go-case-btn').click();
    await expectPath(page, '/citizen/cases/EG-2569-000031');
    await expectCaseStatus(page, 'SUBMITTED');
    await expect(tid(page, 'case-fee')).toHaveText('฿40');
    await expect(tid(page, 'sla-due')).toHaveText('4 ธ.ค. 2569 16:30');
    await expect(tid(page, 'sla-due')).toHaveAttribute('data-iso', '2026-12-04T16:30:00+07:00');
    await expectSlaLevel(tid(page, 'sla-level'), 'normal');
    await expect(tid(page, 'cancel-case-btn'), 'cancel-case-btn มี 1').toHaveCount(1);
    await expect(tid(page, 'case-step'), 'SV-01 ไม่มี case-step').toHaveCount(0);
    const c = await getCase(api, 'EG-2569-000031');
    expect(c, 'API case 031').toMatchObject({ status: 'SUBMITTED', fee: 40, dueAt: '2026-12-04T16:30:00+07:00' });
    expect(c.owner || null, 'API case 031: ยังไม่มีผู้ถือ').toBeNull();
  });

  await test.step('off.reg1 เห็นในคิวท้ายกลุ่ม 4 ธ.ค. หลัง 000030', async () => {
    const off = await tc.staff('off.reg1');
    await off.page.goto('/officer/queue');
    const row = queueRow(off.page, 'EG-2569-000031');
    await expect(row, 'มีแถว 031').toHaveCount(1);
    await expect(row.getByTestId('row-owner'), 'row-owner ว่าง').toHaveText('');
    await expect(row, 'data-owner ว่าง').toHaveAttribute('data-owner', '');
    await expect(row.getByTestId('claim-btn'), 'มี claim-btn').toHaveCount(1);
    const order = await attrList(tid(off.page, 'queue-row'), 'data-case-no');
    const i30 = order.indexOf('EG-2569-000030');
    expect(order.indexOf('EG-2569-000031'), `031 ต้องอยู่ถัดจาก 030 (ลำดับ=${order.join(',')})`).toBe(i30 + 1);
    expect(order[i30 + 2], '031 อยู่ท้ายกลุ่ม 4 ธ.ค. (ถัดไปคือ 000016 กำหนด 8 ธ.ค.)').toBe('EG-2569-000016');
  });
});

test('TC-SUBMIT-02 · เอกสารบังคับครบก่อนชำระ', async ({ tc }) => {
  await start(T0);
  const { page, api } = await tc.citizen(ID.SOMCHAI);

  await test.step('SV-02: บัตร + แผนที่ (ภาพสถานที่ไม่บังคับ)', async () => {
    await page.goto('/citizen/new/SV-02');
    await tid(page, 'to-upload-btn').click();
    await expect(tid(page, 'wizard-step')).toHaveText('2/3 แนบเอกสาร');

    await uiAttach(page, 'upload-input-id-card', 'id-card.pdf');
    await expect(tid(page, 'file-item')).toHaveCount(1);
    await expect(tid(page, 'to-payment-btn'), 'SV-02 id-card อย่างเดียว').toBeDisabled();
    await expect(tid(page, 'missing-docs')).toHaveText('ยังขาดเอกสาร: แผนที่ตั้ง');

    await uiAttach(page, 'upload-input-map', 'map.pdf');
    await expect(tid(page, 'file-item')).toHaveCount(2);
    await expect(tid(page, 'to-payment-btn'), 'SV-02 + map').toBeEnabled();
    await expect(tid(page, 'missing-docs'), 'SV-02 ครบ → missing-docs ไม่ render').toHaveCount(0);

    await uiRemoveFile(page, 'map.pdf');
    await expect(tid(page, 'to-payment-btn'), 'SV-02 ลบ map').toBeDisabled();
    await expect(tid(page, 'missing-docs')).toHaveText('ยังขาดเอกสาร: แผนที่ตั้ง');
  });

  await test.step('SV-03 พื้นที่ 100: บัตร โฉนด แบบแปลน (PDF เท่านั้น)', async () => {
    await page.goto('/citizen/new/SV-03');
    await tid(page, 'area-input').fill('100');
    await tid(page, 'to-upload-btn').click();
    await expect(tid(page, 'wizard-step')).toHaveText('2/3 แนบเอกสาร');

    await uiAttach(page, 'upload-input-id-card', 'id-card.pdf');
    await expect(tid(page, 'file-item')).toHaveCount(1);
    await expect(tid(page, 'to-payment-btn')).toBeDisabled();
    await expect(tid(page, 'missing-docs')).toHaveText('ยังขาดเอกสาร: แบบแปลน, โฉนด');

    await uiAttach(page, 'upload-input-deed', 'deed.pdf');
    await expect(tid(page, 'file-item')).toHaveCount(2);
    await expect(tid(page, 'to-payment-btn')).toBeDisabled();
    await expect(tid(page, 'missing-docs')).toHaveText('ยังขาดเอกสาร: แบบแปลน');

    await uiAttach(page, 'upload-input-plan', 'plan-as-jpg.jpg');
    await expect(tid(page, 'upload-error')).toHaveText(MSG.PLAN_NOT_PDF);
    await expect(tid(page, 'file-item'), 'แบบแปลน JPG ไม่เพิ่ม file-item').toHaveCount(2);
    await expect(tid(page, 'missing-docs')).toHaveText('ยังขาดเอกสาร: แบบแปลน');
    await expect(tid(page, 'to-payment-btn')).toBeDisabled();

    await uiAttach(page, 'upload-input-plan', 'plan.pdf');
    await expect(tid(page, 'file-item')).toHaveCount(3);
    await expect(tid(page, 'to-payment-btn')).toBeEnabled();
    await expect(tid(page, 'missing-docs')).toHaveCount(0);
  });

  await test.step('API: SV-03 ขาดแบบแปลน → 409 MISSING_DOCS · ครบ → 201', async () => {
    const d = await newDraft(api, 'SV-03', { areaSqm: 100 });
    await uploadOk(api, d.draftId, 'id-card', 'id-card.pdf');
    await uploadOk(api, d.draftId, 'deed', 'deed.pdf');
    const res = await uploadRaw(api, d.draftId, 'plan', 'plan-as-jpg.jpg');
    await expectStatus(res, 400, 'PLAN_NOT_PDF', 'API แบบแปลน JPG', MSG.PLAN_NOT_PDF);
    const b = await expectStatus(await api.post(`/api/drafts/${d.draftId}/payment`), 409, 'MISSING_DOCS', 'payment ขาดแบบแปลน');
    expect(b.missing, 'missing').toEqual(['แบบแปลน']);
    await uploadOk(api, d.draftId, 'plan', 'plan.pdf');
    await createQr(api, d.draftId);
  });
});

test('TC-SUBMIT-03 · ร่าง และการยกเลิก', async ({ tc }) => {
  await start(T0);

  await test.step('ส่วน A ร่าง', async () => {
    const { page, api } = await tc.citizen(ID.SOMCHAI);
    await page.goto('/citizen');
    await expect(tid(page, 'my-case-row'), 'my-case-row 10 แถว').toHaveCount(10);
    await expect(tid(page, 'my-draft-row'), 'my-draft-row 2 แถว').toHaveCount(2);
    await expect(byAttr(page, 'my-draft-row', 'data-draft-id', 'DR-0001')).toHaveAttribute('data-status', 'DRAFT');
    await expect(byAttr(page, 'my-draft-row', 'data-draft-id', 'DR-0002')).toHaveAttribute('data-status', 'PENDING_PAYMENT');
    for (const t of await tid(page, 'my-draft-row').allInnerTexts()) expect(t, 'แถวร่างต้องไม่มี EG-').not.toContain('EG-');

    await byAttr(page, 'my-draft-row', 'data-draft-id', 'DR-0001').getByTestId('open-draft-btn').click();
    await expectPath(page, '/citizen/new/SV-01');
    expect(new URL(page.url()).searchParams.get('draft'), 'query draft').toBe('DR-0001');
    await expect(tid(page, 'qty-input')).toHaveValue('2');
    await expect(tid(page, 'fee-total')).toHaveText('฿40');

    await page.goto('/citizen/new/SV-01');
    await tid(page, 'qty-input').fill('3');
    await tid(page, 'save-draft-btn').click();
    await expect(tid(page, 'draft-id')).toHaveText('DR-0003');
    await page.goto('/citizen');
    await expect(tid(page, 'my-case-row'), 'my-case-row ยัง 10').toHaveCount(10);
    expect((await myCases(api)).length, 'GET /api/cases items.length').toBe(10);
    const drafts = await expectStatus(await api.get('/api/drafts'), 200, null, 'GET /api/drafts');
    expect(drafts.items.length, 'GET /api/drafts จำนวน').toBe(3);
  });

  await test.step('ส่วน B ยกเลิก (RESET)', async () => {
    await reset();
    const { page } = await tc.citizen(ID.SOMCHAI);
    await page.goto('/citizen/cases/EG-2569-000030');
    await expect(tid(page, 'cancel-case-btn')).toHaveCount(1);
    await tid(page, 'cancel-case-btn').click();
    await expect(tid(page, 'cancel-confirm-text')).toHaveText(MSG.NO_REFUND);
    await tid(page, 'confirm-cancel-btn').click();
    await expectCaseStatus(page, 'CANCELLED');
    await expect(tid(page, 'no-refund-note')).toHaveText(MSG.NO_REFUND);
    await expect(tid(page, 'cancel-case-btn'), 'ยกเลิกแล้วไม่มีปุ่มยกเลิก').toHaveCount(0);

    const off = await tc.staff('off.reg1');
    await off.page.goto('/officer/queue');
    await expect(tid(off.page, 'queue-row'), 'queue-row เหลือ 16').toHaveCount(16);
    await expect(queueRow(off.page, 'EG-2569-000030'), 'ไม่มี 030 ในคิว').toHaveCount(0);

    const ex = await tc.staff('exec1');
    await ex.page.goto('/dashboard');
    await expect(tid(ex.page, 'kpi-backlog'), 'kpi-backlog').toHaveText('20');
    await expect(tid(ex.page, 'kpi-received'), 'kpi-received ธ.ค.').toHaveText('3');
  });

  await test.step('ส่วน C ยกเลิกไม่ได้เมื่อมีผู้รับ (RESET)', async () => {
    await reset();
    const off = await tc.staff('off.reg1');
    const cl = await claimApi(off.api, 'EG-2569-000030');
    expect(cl.status, `off.reg1 claim 030 (body=${JSON.stringify(cl.body)})`).toBe(200);
    const { page, api } = await tc.citizen(ID.SOMCHAI);
    await page.goto('/citizen/cases/EG-2569-000030');
    await expectCaseStatus(page, 'IN_REVIEW');
    await expect(tid(page, 'cancel-case-btn'), 'มีผู้รับแล้ว ไม่มีปุ่มยกเลิก').toHaveCount(0);
    await expectStatus(await api.post('/api/cases/EG-2569-000030/cancel'), 409, 'CANNOT_CANCEL', 'cancel 030', MSG.CANNOT_CANCEL);
    await expectStatus(await api.post('/api/cases/EG-2569-000013/cancel'), 409, 'CANNOT_CANCEL', 'cancel 013 (IN_REVIEW)');
  });

  await test.step('ส่วน E ลบร่าง (RESET)', async () => {
    await reset();
    const { page, api } = await tc.citizen(ID.SOMCHAI);
    await expectStatus(await api.delete('/api/drafts/DR-0001'), 204, null, 'DELETE DR-0001');
    await expectStatus(await api.get('/api/drafts/DR-0001'), 404, null, 'GET DR-0001 หลังลบ');
    await page.goto('/citizen');
    await expect(tid(page, 'my-draft-row'), 'เหลือร่าง 1').toHaveCount(1);
    await expect(tid(page, 'my-draft-row')).toHaveAttribute('data-draft-id', 'DR-0002');
    await expectStatus(await api.delete('/api/drafts/DR-0002'), 204, null, 'DELETE DR-0002 (PENDING_PAYMENT)');
    await expectStatus(await api.get('/api/payments/PP-0001'), 404, null, 'GET PP-0001 หลังลบร่าง');
    const r = await payRaw('PP-0001', 500);
    expect(r.status, `pay PP-0001 หลังลบร่าง (body=${JSON.stringify(r.body)})`).toBe(404);
    expect((await myCases(api)).length, 'ไม่เกิดเลขคำขอใหม่').toBe(10);
  });

  await test.step('ส่วน F ยกเลิกชนกับรับเรื่อง (RESET · 2 context พร้อมกัน)', async () => {
    await reset();
    const cit = await tc.citizen(ID.SOMCHAI);
    const off = await tc.staff('off.reg1');
    const [rc, rl] = await Promise.all([
      cit.api.post('/api/cases/EG-2569-000030/cancel'),
      off.api.post('/api/officer/cases/EG-2569-000030/claim'),
    ]);
    const cancel = { status: rc.status(), body: await rc.json().catch(() => ({})) };
    const claim = { status: rl.status(), body: await rl.json().catch(() => ({})) };
    const desc = `cancel=${cancel.status} ${JSON.stringify(cancel.body)} · claim=${claim.status} ${JSON.stringify(claim.body)}`;
    expect(cancel.status === 200 && claim.status === 200, `ห้ามได้ 200 ทั้งสองฝั่ง (${desc})`).toBe(false);
    const c = await getCase(off.api, 'EG-2569-000030', '(หลังชน)');
    const mine = await queueApi(off.api, 'mine');
    if (cancel.status === 200) {
      expect(claim.status, `ยกเลิกชนะ → claim 409 (${desc})`).toBe(409);
      expect(claim.body.code, `ยกเลิกชนะ → claim code`).toBe('INVALID_STATE');
      expect(c.status, 'สถานะสุดท้าย').toBe('CANCELLED');
      expect(c.owner || null, 'ไม่มีผู้ถือ').toBeNull();
      expect(mine.length, 'off.reg1 งานในมือยัง 3').toBe(3);
    } else {
      expect(claim.status, `ฝั่งใดฝั่งหนึ่งต้องสำเร็จ (${desc})`).toBe(200);
      expect(cancel.status, `รับเรื่องชนะ → cancel 409 (${desc})`).toBe(409);
      expect(cancel.body.code, 'รับเรื่องชนะ → cancel code').toBe('CANNOT_CANCEL');
      expect(c.status, 'สถานะสุดท้าย').toBe('IN_REVIEW');
      expect(c.owner, 'ผู้ถือ').toBe('off.reg1');
      expect(mine.length, 'off.reg1 งานในมือ 4').toBe(4);
    }
  });
});

// TEST-PLAN §3 หมวด FEE (TC-FEE-01) · ผลคาดหวังคิดจากสูตร BR-04 BR-05 (ไม่ใช่จากหน้าจอ)
const { test, expect, T0, ID, MSG, start, expectStatus, tid } = require('./_lib');

/** SV-03: 1–100 = 1,000 · 101–500 = 1,000 + 10 × (พื้นที่ − 100) · นอกช่วง = null */
function feeSv03(area) {
  if (area < 1 || area > 500) return null;
  return area <= 100 ? 1000 : 1000 + 10 * (area - 100);
}
const baht = (n) => `฿${n.toLocaleString('en-US')}`;

test('TC-FEE-01 · ค่าธรรมเนียม SV-01 / SV-02 / SV-03', async ({ tc }) => {
  await start(T0);
  const { page, api } = await tc.citizen(ID.SOMCHAI);

  // ตารางจากการ์ด TC: [พื้นที่, fee-total, fee-error|null, API code|null]
  const sv03 = [
    [0, '–', MSG.INVALID_AREA, 'INVALID_AREA'],
    [-1, '–', MSG.INVALID_AREA, 'INVALID_AREA'],
    [1, '฿1,000', null, null],
    [100, '฿1,000', null, null],
    [101, '฿1,010', null, null],
    [102, '฿1,020', null, null],
    [250, '฿2,500', null, null],
    [300, '฿3,000', null, null],
    [499, '฿4,990', null, null],
    [500, '฿5,000', null, null],
    [501, '–', MSG.AREA_TOO_LARGE, 'AREA_TOO_LARGE'],
  ];

  await test.step('SV-03 area-input', async () => {
    await page.goto('/citizen/new/SV-03');
    for (const [area, feeText, err, code] of sv03) {
      // ตรวจว่าตารางในการ์ดสอดคล้องสูตร (oracle จากกฎ)
      const f = feeSv03(area);
      expect(f === null ? '–' : baht(f), `สูตร SV-03 พื้นที่ ${area}`).toBe(feeText);

      await tid(page, 'area-input').fill(String(area));
      await expect(tid(page, 'fee-total'), `SV-03 พื้นที่ ${area}: fee-total`).toHaveText(feeText);
      if (err) {
        await expect(tid(page, 'fee-error'), `SV-03 พื้นที่ ${area}: fee-error`).toHaveText(err);
        await expect(tid(page, 'to-upload-btn'), `SV-03 พื้นที่ ${area}: to-upload-btn`).toBeDisabled();
        await expectStatus(await api.post('/api/drafts', { data: { serviceId: 'SV-03', areaSqm: area } }), 400, code, `API SV-03 areaSqm ${area}`, err);
      } else {
        await expect(tid(page, 'fee-error'), `SV-03 พื้นที่ ${area}: ต้องไม่มี fee-error`).toBeHidden();
        await expect(tid(page, 'to-upload-btn'), `SV-03 พื้นที่ ${area}: to-upload-btn`).toBeEnabled();
        const b = await expectStatus(await api.post('/api/drafts', { data: { serviceId: 'SV-03', areaSqm: area } }), 201, null, `API SV-03 areaSqm ${area}`);
        expect(b.fee, `API SV-03 areaSqm ${area}: fee`).toBe(f);
      }
    }
  });

  await test.step('SV-01 qty-input', async () => {
    await page.goto('/citizen/new/SV-01');
    await expect(tid(page, 'qty-input'), 'SV-01 qty ค่าตั้งต้น 1 (A-56)').toHaveValue('1');
    for (const qty of [0, 1, 2, 3, 4, 5, 6]) {
      await tid(page, 'qty-input').fill(String(qty));
      if (qty < 1 || qty > 5) {
        await expect(tid(page, 'fee-error'), `SV-01 qty ${qty}: fee-error`).toHaveText(MSG.INVALID_QTY);
        await expect(tid(page, 'fee-total'), `SV-01 qty ${qty}: fee-total`).toHaveText('–');
        await expect(tid(page, 'to-upload-btn'), `SV-01 qty ${qty}: to-upload-btn`).toBeDisabled();
        await expectStatus(await api.post('/api/drafts', { data: { serviceId: 'SV-01', qty } }), 400, 'INVALID_QTY', `API SV-01 qty ${qty}`, MSG.INVALID_QTY);
      } else {
        await expect(tid(page, 'fee-total'), `SV-01 qty ${qty}: fee-total`).toHaveText(baht(20 * qty));
        await expect(tid(page, 'fee-error'), `SV-01 qty ${qty}: ต้องไม่มี fee-error`).toBeHidden();
        await expect(tid(page, 'to-upload-btn'), `SV-01 qty ${qty}: to-upload-btn`).toBeEnabled();
        const b = await expectStatus(await api.post('/api/drafts', { data: { serviceId: 'SV-01', qty } }), 201, null, `API SV-01 qty ${qty}`);
        expect(b.fee, `API SV-01 qty ${qty}: fee`).toBe(20 * qty);
      }
    }
  });

  await test.step('SV-02 ค่าคงที่ ฿500 ไม่มีช่องกรอก', async () => {
    await page.goto('/citizen/new/SV-02');
    await expect(tid(page, 'fee-total'), 'SV-02 fee-total').toHaveText('฿500');
    await expect(tid(page, 'qty-input'), 'SV-02 ไม่มี qty-input').toHaveCount(0);
    await expect(tid(page, 'area-input'), 'SV-02 ไม่มี area-input').toHaveCount(0);
    const b = await expectStatus(await api.post('/api/drafts', { data: { serviceId: 'SV-02' } }), 201, null, 'API SV-02');
    expect(b.fee, 'API SV-02 fee').toBe(500);
  });
});

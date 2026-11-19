// TEST-PLAN §9 หมวด NOTI (TC-NOTI-01..02) · ชุดแจ้งเตือนตาม TEST-DATA §8
const {
  test, expect, T0, MSG, cn, start, clock, expectStatus, notisApi, notiKeys, tid, attrList,
} = require('./_lib');

const k = (n, level) => `${cn(n)}:${level}`;
const keys = (pairs) => pairs.map(([n, l]) => k(n, l)).sort();

/** อ่าน /notifications ของผู้ใช้: รายการ (caseNo:level เรียงแล้ว) + bell-count */
async function notiUi(page) {
  await page.goto('/notifications');
  await expect(tid(page, 'bell-count')).toBeVisible();
  const items = tid(page, 'noti-item');
  const cases = await attrList(items, 'data-case-no');
  const levels = await attrList(items, 'data-level');
  return { keys: cases.map((c, i) => `${c}:${levels[i]}`).sort(), bell: (await tid(page, 'bell-count').innerText()).trim() };
}
/** ตรวจทั้งหน้าจอและ API ของผู้ใช้หนึ่งคน */
async function expectNotis(actor, expectedKeys, label) {
  await expect.poll(async () => (await notiUi(actor.page)).keys, { message: `${label}: noti-item (หน้าจอ)` }).toEqual(expectedKeys);
  await expect(tid(actor.page, 'bell-count'), `${label}: bell-count`).toHaveText(String(expectedKeys.length));
  if (expectedKeys.length === 0) await expect(tid(actor.page, 'noti-empty'), `${label}: noti-empty`).toHaveText(MSG.NOTI_EMPTY);
  const items = await notisApi(actor.api, label);
  expect(notiKeys(items), `${label}: GET /api/notifications`).toEqual(expectedKeys);
  return items;
}
/** request ธรรมดาที่ไม่ใช่ /api/test/* เพื่อกระตุ้นการประเมิน (CONTRACT 0.7) */
async function poke(actor) {
  await expectStatus(await actor.api.get('/api/me'), 200, null, 'GET /api/me (กระตุ้นการประเมินแจ้งเตือน)');
}

/** TC-NOTI-01 ทั้งหมด (ใช้ซ้ำใน TC-NOTI-02 ส่วน A) · คืน actors */
async function runNoti01(tc) {
  // ยังไม่มี request ใด ๆ หลัง reset · request แรก = LOGIN_S off.reg1 ที่ 09:00
  const reg1 = await tc.staff('off.reg1');
  const reg2 = await tc.staff('off.reg2');
  const head = await tc.staff('head1');
  const works = await tc.staff('off.works1');

  const r1 = await expectNotis(reg1, keys([[24, 'near'], [22, 'near'], [20, 'overdue']]), 'off.reg1 09:00');
  await expectNotis(reg2, keys([[24, 'near']]), 'off.reg2 09:00');
  await expectNotis(head, keys([[20, 'overdue']]), 'head1 09:00');
  await expectNotis(works, [], 'off.works1 09:00');

  // ข้อความรายการ (A-30)
  const t24 = r1.find((i) => i.caseNo === cn(24));
  const t20 = r1.find((i) => i.caseNo === cn(20));
  expect(t24.text, 'ข้อความ near').toBe('คำขอ EG-2569-000024 ใกล้ครบกำหนด');
  expect(t20.text, 'ข้อความ overdue').toBe('คำขอ EG-2569-000020 เกินกำหนด');
  await reg1.page.goto('/notifications');
  await expect(reg1.page.locator('[data-testid="noti-item"][data-case-no="EG-2569-000024"]'), 'noti-item 024 ข้อความ').toContainText('คำขอ EG-2569-000024 ใกล้ครบกำหนด');
  await expect(reg1.page.locator('[data-testid="noti-item"][data-case-no="EG-2569-000020"]'), 'noti-item 020 ข้อความ').toContainText('คำขอ EG-2569-000020 เกินกำหนด');

  // ต่อ: 16:31 → 022 overdue
  await clock('2026-12-01T16:31:00+07:00');
  await poke(reg1);
  await expectNotis(reg1, keys([[24, 'near'], [22, 'near'], [20, 'overdue'], [22, 'overdue']]), 'off.reg1 16:31');
  await expectNotis(head, keys([[20, 'overdue'], [22, 'overdue']]), 'head1 16:31');
  await expectNotis(reg2, keys([[24, 'near']]), 'off.reg2 16:31');
  return { reg1, reg2, head, works };
}

test('TC-NOTI-01 · ผู้รับแจ้งเตือนตามระดับ', async ({ tc }) => {
  await start(T0);
  await runNoti01(tc);
});

test('TC-NOTI-02 · ไม่แจ้งซ้ำ ข้ามระดับ และขั้นรออนุมัติ/รอออกเอกสาร', async ({ tc }) => {
  await start(T0);

  await test.step('ส่วน A: ไม่แจ้งซ้ำ', async () => {
    const { reg1, head } = await runNoti01(tc);
    for (const a of [reg1, head]) {
      for (let i = 0; i < 3; i++) await a.page.goto('/notifications');
      for (let i = 0; i < 3; i++) await notisApi(a.api);
      for (let i = 0; i < 2; i++) await a.page.goto('/officer/queue');
    }
    const i1 = await expectNotis(reg1, keys([[24, 'near'], [22, 'near'], [20, 'overdue'], [22, 'overdue']]), 'off.reg1 หลังเปิดซ้ำ');
    const i2 = await expectNotis(head, keys([[20, 'overdue'], [22, 'overdue']]), 'head1 หลังเปิดซ้ำ');
    for (const items of [i1, i2]) {
      const ks = notiKeys(items);
      expect(new Set(ks).size, `คู่ (คำขอ, ระดับ) ต้องไม่ซ้ำ: ${ks.join(',')}`).toBe(ks.length);
    }
  });

  await test.step('ส่วน B: ข้ามระดับ (request แรกที่ ส. 5 ธ.ค. 10:00)', async () => {
    await start('2026-12-05T10:00:00+07:00'); // RESET + CLOCK (ยังไม่มี request)
    const reg1 = await tc.staff('off.reg1');
    const reg2 = await tc.staff('off.reg2');
    const works = await tc.staff('off.works1');
    const head = await tc.staff('head1');

    const ov = (list) => list.map((n) => [n, 'overdue']);
    await expectNotis(reg1, keys(ov([20, 22, 23, 24, 28, 29, 30])), 'off.reg1 ส.5');
    await expectNotis(reg2, keys([...ov([13, 15, 24, 25, 26, 27, 28, 29, 30]), [16, 'near']]), 'off.reg2 ส.5');
    await expectNotis(works, keys(ov([10])), 'off.works1 ส.5');
    await expectNotis(head, keys([...ov([10, 13, 14, 15, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30]), [11, 'near']]), 'head1 ส.5');

    // ไม่มี near ย้อนหลังของ 024 020 022
    for (const [a, label] of [[reg1, 'off.reg1'], [reg2, 'off.reg2'], [head, 'head1']]) {
      const items = await notisApi(a.api);
      expect(items.filter((i) => i.caseNo === cn(24)).map((i) => i.level), `${label}: 024 เฉพาะ overdue 1 รายการ`).toEqual(['overdue']);
    }
    for (const n of [20, 22]) {
      for (const [a, label] of [[reg1, 'off.reg1'], [head, 'head1']]) {
        const items = await notisApi(a.api);
        expect(items.filter((i) => i.caseNo === cn(n)).map((i) => i.level), `${label}: ${cn(n)} เฉพาะ overdue 1 รายการ`).toEqual(['overdue']);
      }
    }
  });

  await test.step('ส่วน C: ขั้นรออนุมัติและรอออกเอกสาร', async () => {
    await start('2026-12-04T09:00:00+07:00');
    const head = await tc.staff('head1');
    const reg1 = await tc.staff('off.reg1');
    const reg2 = await tc.staff('off.reg2');
    const of = async (a, n) => (await notisApi(a.api)).filter((i) => i.caseNo === cn(n)).map((i) => i.level).sort();

    expect(await of(head, 14), 'ศ.4 09:00 head1: 014').toEqual(['near']);
    expect(await of(reg1, 14), 'ศ.4 09:00 off.reg1: 014').toEqual([]);
    expect(await of(reg2, 14), 'ศ.4 09:00 off.reg2: 014').toEqual([]);

    await clock('2026-12-04T16:31:00+07:00');
    await poke(head);
    expect(await of(head, 14), 'ศ.4 16:31 head1: 014 near + overdue').toEqual(['near', 'overdue']);
    expect(await of(reg1, 14), 'ศ.4 16:31 off.reg1: 014').toEqual([]);
    expect(await of(reg2, 14), 'ศ.4 16:31 off.reg2: 014').toEqual([]);

    await clock('2026-12-08T09:00:00+07:00');
    await poke(reg1);
    expect(await of(reg1, 19), 'อ.8 09:00 off.reg1 (ผู้ออกเอกสาร): 019').toEqual(['near']);
    expect(await of(reg2, 19), 'อ.8 09:00 off.reg2: 019').toEqual([]);
    expect(await of(head, 19), 'อ.8 09:00 head1: 019').toEqual([]);

    await clock('2026-12-09T16:31:00+07:00');
    await poke(reg1);
    expect(await of(reg1, 19), 'พ.9 16:31 off.reg1: 019 near + overdue').toEqual(['near', 'overdue']);
    expect(await of(head, 19), 'พ.9 16:31 head1: 019').toEqual(['overdue']);
    expect(await of(reg2, 19), 'พ.9 16:31 off.reg2: 019').toEqual([]);

    // หน้าจอ: bell-count ของ head1 ตรงกับ API
    const ui = await notiUi(head.page);
    expect(ui.bell, 'head1 bell-count = จำนวนรายการ API').toBe(String((await notisApi(head.api)).length));
  });
});

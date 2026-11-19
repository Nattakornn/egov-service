// TEST-PLAN §5 หมวด UPLOAD (TC-UPLOAD-01..02) · ไฟล์จาก TEST-DATA §11 (global-setup สร้างลง e2e/testfiles/)
const fs = require('fs');
const {
  test, expect, T0, ID, MSG, start, expectStatus, newDraft, uploadRaw, testFile, tid, uiAttach, uiRemoveFile,
} = require('./_lib');

/** ไปที่ขั้นแนบเอกสารของร่าง SV-01 qty 1 ผ่านหน้าจอ */
async function toUploadStep(page) {
  await page.goto('/citizen/new/SV-01');
  await tid(page, 'qty-input').fill('1');
  await tid(page, 'to-upload-btn').click();
  await expect(tid(page, 'wizard-step')).toHaveText('2/3 แนบเอกสาร');
  await expect(tid(page, 'file-item')).toHaveCount(0);
}

/** รายการไฟล์ของร่างจาก GET /api/drafts/:id · ต้องเป็น array เสมอ (ไม่มี → ล้ม ไม่ข้ามการตรวจ) */
function filesOf(draft, label) {
  expect(Array.isArray(draft && draft.files), `${label}: GET /api/drafts/:id ต้องมี files เป็น array (received ${JSON.stringify(draft).slice(0, 300)})`).toBe(true);
  return draft.files;
}

test('TC-UPLOAD-01 · ขนาดและจำนวนไฟล์', async ({ tc }) => {
  await start(T0);
  const { page, api } = await tc.citizen(ID.SOMCHAI);

  await test.step('ตรวจขนาดไฟล์ทดสอบตรงไบต์', async () => {
    for (const n of [5242879, 5242880, 5242881]) {
      expect(fs.statSync(testFile(`size-${n}.pdf`)).size, `size-${n}.pdf`).toBe(n);
    }
  });

  await test.step('ขนาด (หน้าจอ)', async () => {
    await toUploadStep(page);
    await uiAttach(page, 'upload-input-id-card', 'size-5242879.pdf');
    await expect(tid(page, 'file-item'), '5,242,879 ไบต์ → รับ').toHaveCount(1);
    await uiRemoveFile(page, 'size-5242879.pdf');

    await uiAttach(page, 'upload-input-id-card', 'size-5242880.pdf');
    await expect(tid(page, 'file-item'), '5,242,880 ไบต์ (ขอบ ≤ 5 MB) → รับ').toHaveCount(1);
    await expect(tid(page, 'upload-error'), '5,242,880: ไม่มี upload-error').toBeHidden();
    await uiRemoveFile(page, 'size-5242880.pdf');

    await uiAttach(page, 'upload-input-id-card', 'size-5242881.pdf');
    await expect(tid(page, 'upload-error'), '5,242,881 ไบต์ → ปฏิเสธ').toHaveText(MSG.FILE_TOO_LARGE);
    await expect(tid(page, 'file-item'), '5,242,881: file-item 0').toHaveCount(0);
  });

  await test.step('ขนาด (API)', async () => {
    const d = await newDraft(api, 'SV-01', { qty: 1 });
    let b = await expectStatus(await uploadRaw(api, d.draftId, 'id-card', 'size-5242879.pdf'), 201, null, 'API 5,242,879');
    expect(b.size, 'API 5,242,879 size').toBe(5242879);
    b = await expectStatus(await uploadRaw(api, d.draftId, 'extra', 'size-5242880.pdf'), 201, null, 'API 5,242,880 (ไม่ถูกตัด)');
    expect(b.size, 'API 5,242,880 size (ไฟล์ไม่ถูกตัด)').toBe(5242880);
    await expectStatus(await uploadRaw(api, d.draftId, 'extra', 'size-5242881.pdf'), 400, 'FILE_TOO_LARGE', 'API 5,242,881 (ต้องไม่ใช่ 413)', MSG.FILE_TOO_LARGE);
  });

  await test.step('จำนวน (หน้าจอ)', async () => {
    await toUploadStep(page);
    await uiAttach(page, 'upload-input-id-card', 'id-card.pdf');
    await expect(tid(page, 'file-item')).toHaveCount(1);
    for (let i = 1; i <= 4; i++) {
      await uiAttach(page, 'upload-input-extra', `multi-${i}.pdf`);
      await expect(tid(page, 'file-item'), `แนบ multi-${i}.pdf`).toHaveCount(1 + i);
    }
    await expect(tid(page, 'file-item'), 'รวม 5 ไฟล์').toHaveCount(5);

    await uiAttach(page, 'upload-input-extra', 'multi-5.pdf');
    await expect(tid(page, 'upload-error'), 'ไฟล์ที่ 6').toHaveText(MSG.FILE_COUNT);
    await expect(tid(page, 'file-item'), 'ไฟล์ที่ 6 ไม่ถูกเพิ่ม').toHaveCount(5);

    await uiRemoveFile(page, 'multi-1.pdf');
    await uiAttach(page, 'upload-input-extra', 'multi-5.pdf');
    await expect(tid(page, 'file-item'), 'ลบ 1 แล้วแนบ multi-5 → 5 (ไฟล์ที่ถูกปฏิเสธไม่ถูกนับ)').toHaveCount(5);
  });

  await test.step('จำนวน (API)', async () => {
    const d = await newDraft(api, 'SV-01', { qty: 1 });
    await expectStatus(await uploadRaw(api, d.draftId, 'id-card', 'id-card.pdf'), 201, null, 'API id-card');
    for (let i = 1; i <= 4; i++) {
      await expectStatus(await uploadRaw(api, d.draftId, 'extra', `multi-${i}.pdf`), 201, null, `API multi-${i}`);
    }
    await expectStatus(await uploadRaw(api, d.draftId, 'extra', 'multi-5.pdf'), 400, 'FILE_COUNT', 'API ไฟล์ที่ 6', MSG.FILE_COUNT);
    await expectStatus(await uploadRaw(api, d.draftId, 'extra', 'multi-6.pdf'), 400, 'FILE_COUNT', 'API ไฟล์ที่ 6 (ซ้ำ)', MSG.FILE_COUNT);
    const g = await expectStatus(await api.get(`/api/drafts/${d.draftId}`), 200, null, 'GET draft');
    expect(filesOf(g, 'จำนวน (API)').length, 'จำนวนไฟล์ในร่าง (GET /api/drafts/:id files)').toBe(5);
  });
});

test('TC-UPLOAD-02 · ชนิดไฟล์จากเนื้อไฟล์', async ({ tc }) => {
  await start(T0);
  const { page, api } = await tc.citizen(ID.SOMCHAI);

  await test.step('หน้าจอ: รับ PDF/JPEG/PNG จริง', async () => {
    await toUploadStep(page);
    for (const name of ['ok-id.pdf', 'real.jpg', 'real.png']) {
      await uiAttach(page, 'upload-input-id-card', name);
      await expect(tid(page, 'file-item'), `${name} → รับ`).toHaveCount(1);
      await expect(tid(page, 'file-item')).toHaveAttribute('data-name', name);
      await uiRemoveFile(page, name);
    }
  });

  await test.step('หน้าจอ: ปฏิเสธไฟล์ที่เนื้อไม่ใช่ PDF/JPEG/PNG', async () => {
    const rejects = [
      ['fake-text.pdf', 'fake-text.pdf'],
      ['fake-text.jpg', 'fake-text.jpg'],
      ['exe-as.png', 'exe-as.png'],
      ['notes.txt', 'notes.txt'],
      ['fake-text.pdf (mimeType application/pdf)', { name: 'fake-text.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(testFile('fake-text.pdf')) }],
    ];
    for (const [label, file] of rejects) {
      await toUploadStep(page); // หน้าใหม่ทุกค่า เพื่อไม่ให้ข้อความ error เก่าค้าง
      await uiAttach(page, 'upload-input-id-card', file);
      await expect(tid(page, 'upload-error'), `${label} → ปฏิเสธ`).toHaveText(MSG.FILE_TYPE);
      await expect(tid(page, 'file-item'), `${label}: file-item 0`).toHaveCount(0);
    }
  });

  await test.step('API: ตรวจจาก magic bytes ไม่เชื่อ Content-Type', async () => {
    const d = await newDraft(api, 'SV-01', { qty: 1 });
    let accepted = 0;
    for (const [docKey, name] of [['id-card', 'ok-id.pdf'], ['extra', 'real.jpg'], ['extra', 'real.png']]) {
      const b = await expectStatus(await uploadRaw(api, d.draftId, docKey, name), 201, null, `API ${name}`);
      expect(b.name, `API ${name}: name`).toBe(name);
      accepted++;
    }
    const rejects = [
      ['fake-text.pdf', 'application/pdf'],
      ['fake-text.jpg', 'image/jpeg'],
      ['exe-as.png', 'image/png'],
      ['notes.txt', 'text/plain'],
      ['notes.txt', 'application/pdf'],
    ];
    for (const [name, mime] of rejects) {
      await expectStatus(await uploadRaw(api, d.draftId, 'extra', name, mime), 400, 'FILE_TYPE', `API ${name} (${mime})`, MSG.FILE_TYPE);
    }
    const g = await expectStatus(await api.get(`/api/drafts/${d.draftId}`), 200, null, 'GET draft');
    expect(filesOf(g, 'magic bytes (API)').length, 'ไฟล์ที่ปฏิเสธไม่ถูกเก็บ (GET /api/drafts/:id files)').toBe(accepted);
  });
});

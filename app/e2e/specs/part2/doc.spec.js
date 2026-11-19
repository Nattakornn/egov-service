// @ts-check
// TC-DOC-01..03 (TEST-PLAN §11)
'use strict';

const {
  test, expect, T0, ID, C, BASE_URL,
  tid, gotoStatus, expectHttp, expectApiError, okJson, expectCount, expectText, expectPdfLine,
} = require('./_lib');

const RESULT_TH = { VALID: 'เอกสารถูกต้อง', EXPIRED: 'เอกสารหมดอายุ', TAMPERED: 'ลายเซ็นไม่ถูกต้อง', NOT_FOUND: 'ไม่พบเอกสาร' };

/** เปิด /verify/<code> (ไม่ล็อกอิน) แล้วตรวจผล */
async function checkVerify(page, code, result, label, expiresIso) {
  await gotoStatus(page, `/verify/${code}`, result === 'NOT_FOUND' ? 404 : 200, `${label} /verify/${code}`);
  const r = tid(page, 'verify-result');
  await expect(r, `${label} verify-result data-result: expected ${result}`).toHaveAttribute('data-result', result);
  await expectText(r, RESULT_TH[result], `${label} verify-result`);
  if (expiresIso) {
    await expect(tid(page, 'verify-expires'), `${label} verify-expires data-iso: expected ${expiresIso}`).toHaveAttribute('data-iso', expiresIso);
  }
}

/** approve + issue ผ่าน API คืน {docNo, verifyCode} */
async function approveIssue(api, caseNo, label) {
  await okJson(await api.post(`/api/cases/${caseNo}/approve`), `${label} approve ${caseNo}`);
  return issue(api, caseNo, label);
}
async function issue(api, caseNo, label) {
  const j = await okJson(await api.post(`/api/officer/cases/${caseNo}/issue`), `${label} issue ${caseNo}`);
  expect(j.verifyCode, `${label} verifyCode: expected ^[A-Z0-9]{8}$, received ${j.verifyCode}`).toMatch(/^[A-Z0-9]{8}$/);
  return j;
}

test.describe('DOC', () => {
  test('TC-DOC-01 · ออกเอกสารและข้อมูลในเอกสาร', async ({ kit }) => {
    const reg2 = await kit.loginS('off.reg2');
    await okJson(await reg2.post(`/api/cases/${C(25)}/approve`), 'approve …000025');
    const j = await okJson(await reg2.post(`/api/officer/cases/${C(25)}/issue`), 'issue …000025');
    expect(j.docNo, `issue docNo: expected DOC-2569-000002, received ${j.docNo}`).toBe('DOC-2569-000002');
    expect(j.status, `issue status: expected COMPLETED, received ${j.status}`).toBe('COMPLETED');
    expect(j.verifyCode, `verifyCode: expected ^[A-Z0-9]{8}$, received ${j.verifyCode}`).toMatch(/^[A-Z0-9]{8}$/);
    const code = j.verifyCode;

    // PDF ของผู้ยื่น
    const somying = await kit.loginC(ID.somying);
    const res = await somying.get('/api/documents/DOC-2569-000002/pdf');
    await expectHttp(res, 200, 'สมหญิง GET pdf');
    const ct = res.headers()['content-type'] || '';
    const cd = res.headers()['content-disposition'] || '';
    expect(ct, `Content-Type: expected application/pdf, received ${ct}`).toContain('application/pdf');
    expect(cd, `Content-Disposition: expected DOC-2569-000002.pdf, received ${cd}`).toContain('DOC-2569-000002.pdf');
    await expectPdfLine(await res.body(), `docNo=DOC-2569-000002 caseNo=${C(25)} verify=${code} validUntil=2027-02-28`, 'PDF');

    // หน้า /verify
    const anon = await kit.anonPage();
    await checkVerify(anon, code, 'VALID', '/verify', '2027-02-28');
    await expectText(tid(anon, 'verify-doc-no'), 'DOC-2569-000002', 'verify-doc-no');
    await expectText(tid(anon, 'verify-applicant'), 'สมหญิง ร***', 'verify-applicant');
    await expectText(tid(anon, 'verify-service'), 'SV-01 ขอหนังสือรับรอง', 'verify-service');
    await expect(tid(anon, 'verify-issued'), `verify-issued data-iso: expected ${T0}`).toHaveAttribute('data-iso', T0);
    await expectText(tid(anon, 'verify-signer'), 'เจ้าหน้าที่ทะเบียน 2', 'verify-signer');

    // doc-qr บนหน้าเคส
    const op = await kit.pageFor(reg2);
    await gotoStatus(op, `/officer/cases/${C(25)}`, 200, 'off.reg2 เปิด …000025');
    const want = `${BASE_URL}/verify/${code}`;
    await expect(tid(op, 'doc-qr'), `doc-qr data-url: expected ${want}`).toHaveAttribute('data-url', want);

    // API verify
    const h = await kit.anon();
    const v = await okJson(await h.get(`/api/verify/${code}`), 'GET /api/verify');
    expect(v.result, `API result: expected VALID, received ${v.result}`).toBe('VALID');
    expect(v.validUntil, `API validUntil: expected 2027-02-28, received ${v.validUntil}`).toBe('2027-02-28');
    expect(v.issuedAt, `API issuedAt: expected ${T0}, received ${v.issuedAt}`).toBe(T0);

    // ไม่ใช่ผู้ยื่น
    const somchai = await kit.loginC(ID.somchai);
    await expectHttp(await somchai.get('/api/documents/DOC-2569-000002/pdf'), 404, 'สมชาย GET pdf ของสมหญิง');

    // ออกซ้ำ → 409 · เลขถัดไปยังเป็น 000003
    await expectApiError(await reg2.post(`/api/officer/cases/${C(25)}/issue`), 409, 'INVALID_STATE', 'issue ซ้ำ');
    const reg1 = await kit.loginS('off.reg1');
    const next = await okJson(await reg1.post(`/api/officer/cases/${C(19)}/issue`), 'issue …000019 (ตรวจเลขถัดไป)');
    expect(next.docNo, `เอกสารถัดไป: expected DOC-2569-000003, received ${next.docNo}`).toBe('DOC-2569-000003');
  });

  test('TC-DOC-02 · ตรวจเอกสาร /verify', async ({ kit }) => {
    const page = await kit.anonPage();
    const res = await gotoStatus(page, '/verify/K7M2Q9XA', 200, '/verify/K7M2Q9XA');
    expect(new URL(page.url()).pathname, `ไม่ redirect: expected /verify/K7M2Q9XA, received ${page.url()}`).toBe('/verify/K7M2Q9XA');
    expect(res && res.url(), 'response url').toBeTruthy();
    await expect(tid(page, 'verify-result'), 'verify-result data-result: expected VALID').toHaveAttribute('data-result', 'VALID');
    await expectText(tid(page, 'verify-result'), 'เอกสารถูกต้อง', 'verify-result');
    await expectText(tid(page, 'verify-doc-no'), 'DOC-2569-000001', 'verify-doc-no');
    await expectText(tid(page, 'verify-applicant'), 'สมชาย ใ***', 'verify-applicant');
    await expectText(tid(page, 'verify-service'), 'SV-01 ขอหนังสือรับรอง', 'verify-service');
    await expect(tid(page, 'verify-issued'), 'verify-issued data-iso: expected 2026-11-05T10:00:00+07:00').toHaveAttribute('data-iso', '2026-11-05T10:00:00+07:00');
    await expect(tid(page, 'verify-expires'), 'verify-expires data-iso: expected 2027-02-02').toHaveAttribute('data-iso', '2027-02-02');
    await expectText(tid(page, 'verify-signer'), 'เจ้าหน้าที่ทะเบียน 1', 'verify-signer');
    const text = await page.locator('body').innerText();
    expect(text.includes('ใจดี'), 'PDPA: expected page text without "ใจดี", received it').toBe(false);
    expect(text.includes(ID.somchai), `PDPA: expected page text without ${ID.somchai}, received it`).toBe(false);

    await gotoStatus(page, '/verify/ZZZZZZZZ', 404, '/verify/ZZZZZZZZ');
    await expect(tid(page, 'verify-result'), 'verify-result data-result: expected NOT_FOUND').toHaveAttribute('data-result', 'NOT_FOUND');
    await expectText(tid(page, 'verify-result'), 'ไม่พบเอกสาร', 'NOT_FOUND verify-result');
    await expectCount(tid(page, 'verify-applicant'), 0, 'NOT_FOUND verify-applicant');
    await expectCount(tid(page, 'verify-doc-no'), 0, 'NOT_FOUND verify-doc-no');

    const h = await kit.anon();
    const v = await okJson(await h.get('/api/verify/K7M2Q9XA'), 'GET /api/verify/K7M2Q9XA');
    expect(v.result, `API result: expected VALID, received ${v.result}`).toBe('VALID');
    expect(v.applicantMasked, `API applicantMasked: expected "สมชาย ใ***", received ${v.applicantMasked}`).toBe('สมชาย ใ***');
    const nf = await h.get('/api/verify/ZZZZZZZZ');
    await expectHttp(nf, 404, 'GET /api/verify/ZZZZZZZZ');
    const nj = await nf.json();
    expect(nj.result, `API NOT_FOUND: expected result NOT_FOUND, received ${JSON.stringify(nj)}`).toBe('NOT_FOUND');
  });

  test('TC-DOC-03 · เอกสารหมดอายุและลายเซ็นไม่ตรง', async ({ kit }) => {
    // ส่วน A SV-01 · 90 วัน
    {
      const reg2 = await kit.loginS('off.reg2');
      const { verifyCode: c1 } = await approveIssue(reg2, C(25), 'A');
      const page = await kit.anonPage();
      await kit.clock('2027-02-28T23:59:00+07:00');
      await checkVerify(page, c1, 'VALID', 'A 2027-02-28 23:59', '2027-02-28');
      await kit.clock('2027-03-01T00:00:00+07:00');
      await checkVerify(page, c1, 'EXPIRED', 'A 2027-03-01 00:00', '2027-02-28');
    }
    // ส่วน B SV-02 · 1 ปี
    {
      await kit.fresh();
      const reg1 = await kit.loginS('off.reg1');
      const { verifyCode: c2 } = await issue(reg1, C(19), 'B');
      const page = await kit.anonPage();
      await kit.clock('2027-11-30T23:59:00+07:00');
      await checkVerify(page, c2, 'VALID', 'B 2027-11-30 23:59', '2027-11-30');
      await kit.clock('2027-12-01T00:00:00+07:00');
      await checkVerify(page, c2, 'EXPIRED', 'B 2027-12-01 00:00');
    }
    // ส่วน C seed K7M2Q9XA
    {
      await kit.fresh('2027-02-02T23:59:00+07:00');
      const page = await kit.anonPage();
      await checkVerify(page, 'K7M2Q9XA', 'VALID', 'C 2027-02-02 23:59', '2027-02-02');
      await kit.clock('2027-02-03T00:00:00+07:00');
      await checkVerify(page, 'K7M2Q9XA', 'EXPIRED', 'C 2027-02-03 00:00');
    }
    // ส่วน E ออกวันที่ 29 ก.พ. 2028
    {
      await kit.fresh('2028-02-29T10:00:00+07:00');
      const reg2 = await kit.loginS('off.reg2');
      const reg1 = await kit.loginS('off.reg1');
      const e1 = await approveIssue(reg2, C(25), 'E SV-01');
      const e2 = await issue(reg1, C(19), 'E SV-02');
      expect(e1.docNo, `E SV-01 docNo: expected DOC-2571-000001, received ${e1.docNo}`).toBe('DOC-2571-000001');
      expect(e2.docNo, `E SV-02 docNo: expected DOC-2571-000002, received ${e2.docNo}`).toBe('DOC-2571-000002');
      const page = await kit.anonPage();
      await kit.clock('2028-05-28T23:59:00+07:00');
      await checkVerify(page, e1.verifyCode, 'VALID', 'E SV-01 2028-05-28 23:59', '2028-05-28');
      await kit.clock('2028-05-29T00:00:00+07:00');
      await checkVerify(page, e1.verifyCode, 'EXPIRED', 'E SV-01 2028-05-29 00:00');
      await kit.clock('2029-02-27T23:59:00+07:00');
      await checkVerify(page, e2.verifyCode, 'VALID', 'E SV-02 2029-02-27 23:59', '2029-02-27');
      await kit.clock('2029-02-28T00:00:00+07:00');
      await checkVerify(page, e2.verifyCode, 'EXPIRED', 'E SV-02 2029-02-28 00:00');
    }
    // ส่วน D ลายเซ็นไม่ตรง
    {
      await kit.fresh();
      const h = await kit.anon();
      const t = await okJson(await h.post('/api/test/documents/DOC-2569-000001/tamper'), 'D tamper');
      expect(t.ok, `D tamper: expected {"ok":true}, received ${JSON.stringify(t)}`).toBe(true);
      const page = await kit.anonPage();
      await checkVerify(page, 'K7M2Q9XA', 'TAMPERED', 'D');
      await expectCount(tid(page, 'verify-doc-no'), 0, 'D verify-doc-no');
      await expectCount(tid(page, 'verify-applicant'), 0, 'D verify-applicant');
      await kit.clock('2027-03-01T00:00:00+07:00');
      await checkVerify(page, 'K7M2Q9XA', 'TAMPERED', 'D หมดอายุด้วย');
    }
  });
});

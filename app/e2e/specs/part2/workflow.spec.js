// @ts-check
// TC-WORKFLOW-01..06 (TEST-PLAN §10)
'use strict';

const {
  test, expect, T0, ID, C, REASON9, REASON10,
  tid, gotoStatus, expectHttp, expectApiError, okJson, expectCaseStatus, expectLevel,
  expectCount, expectText, rowAttr, uiReturn, uiReject, uiResubmit, auditFilter, auditRows,
  grabDownload, expectPdfLine,
} = require('./_lib');

/** เปิด /verify/<code> แบบไม่ล็อกอิน แล้วตรวจผู้ลงนาม */
async function expectSigner(kit, code, signer, label) {
  const anon = await kit.anonPage();
  await gotoStatus(anon, `/verify/${code}`, 200, `${label} /verify/${code}`);
  await expectText(tid(anon, 'verify-result'), 'เอกสารถูกต้อง', `${label} verify-result`);
  await expectText(tid(anon, 'verify-signer'), signer, `${label} verify-signer`);
}

async function dash(api, period = '2026-12', service = 'ALL') {
  return okJson(await api.get(`/api/dashboard?period=${period}&service=${service}`), `GET /api/dashboard ${period} ${service}`);
}

test.describe('WORKFLOW', () => {
  test('TC-WORKFLOW-01 · SV-01 อนุมัติ + ออกเอกสาร', async ({ kit }) => {
    const reg2 = await kit.loginS('off.reg2');
    const page = await kit.pageFor(reg2);
    await gotoStatus(page, `/officer/cases/${C(25)}`, 200, 'off.reg2 เปิด …000025');

    // 1 ตรวจปุ่ม
    await expectCaseStatus(page, 'IN_REVIEW', '#1');
    await expectCount(tid(page, 'approve-btn'), 1, '#1 approve-btn');
    await expectCount(tid(page, 'return-btn'), 1, '#1 return-btn');
    await expectCount(tid(page, 'reject-btn'), 1, '#1 reject-btn');
    await expectCount(tid(page, 'forward-btn'), 0, '#1 forward-btn');
    await expectCount(tid(page, 'issue-btn'), 0, '#1 issue-btn');
    await expectText(tid(page, 'case-fee'), '฿60', '#1 case-fee');

    // 2 off.reg1 (ไม่ใช่ผู้ถือ) อนุมัติ …000026 → 403
    const reg1 = await kit.loginS('off.reg1');
    await expectApiError(await reg1.post(`/api/cases/${C(26)}/approve`), 403, 'FORBIDDEN', '#2 off.reg1 approve …000026');

    // 3 อนุมัติ
    await tid(page, 'approve-btn').click();
    await expectCaseStatus(page, 'APPROVED', '#3');
    await expectCount(tid(page, 'issue-btn'), 1, '#3 issue-btn');
    await expectCount(tid(page, 'approve-btn'), 0, '#3 approve-btn');

    // 4 ออกเอกสาร
    await tid(page, 'issue-btn').click();
    await expectCaseStatus(page, 'COMPLETED', '#4');
    await expectText(tid(page, 'doc-no'), 'DOC-2569-000002', '#4 doc-no');
    await expect(tid(page, 'verify-code'), '#4 verify-code: expected ^[A-Z0-9]{8}$').toHaveText(/^\s*[A-Z0-9]{8}\s*$/);
    await expect(tid(page, 'closed-at'), `#4 closed-at data-iso: expected ${T0}`).toHaveAttribute('data-iso', T0);
    await expectLevel(page, 'closed', '#4');

    // 5 สมหญิงดาวน์โหลด
    const somying = await kit.loginC(ID.somying);
    const cpage = await kit.pageFor(somying);
    await gotoStatus(cpage, `/citizen/cases/${C(25)}`, 200, '#5 สมหญิงเปิด …000025');
    await expectCaseStatus(cpage, 'COMPLETED', '#5');
    await expectCount(tid(cpage, 'download-doc-btn'), 1, '#5 download-doc-btn');
    const dl = await grabDownload(cpage, tid(cpage, 'download-doc-btn'), '#5 download-doc-btn');
    expect(dl.name, `#5 ชื่อไฟล์ดาวน์โหลด: expected DOC-2569-000002.pdf, received ${dl.name}`).toBe('DOC-2569-000002.pdf');
    const res = await somying.get('/api/documents/DOC-2569-000002/pdf');
    await expectHttp(res, 200, '#5 GET pdf');
    const ct = res.headers()['content-type'] || '';
    const cd = res.headers()['content-disposition'] || '';
    expect(ct, `#5 Content-Type: expected application/pdf, received ${ct}`).toContain('application/pdf');
    expect(cd, `#5 Content-Disposition: expected DOC-2569-000002.pdf, received ${cd}`).toContain('DOC-2569-000002.pdf');
    await expectPdfLine(await res.body(), `docNo=DOC-2569-000002 caseNo=${C(25)}`, '#5 PDF');
    await expectPdfLine(dl.buf, `docNo=DOC-2569-000002 caseNo=${C(25)}`, '#5 PDF (ไฟล์จากปุ่ม)');

    // 6 Dashboard
    const exec = await kit.loginS('exec1');
    const d = await dash(exec);
    expect(d.closed, `#6 closed: expected 1, received ${d.closed}`).toBe(1);
    expect(d.onTime, `#6 onTime: expected 1, received ${d.onTime}`).toBe(1);
    expect(d.received, `#6 received: expected 3, received ${d.received}`).toBe(3);
    expect(d.backlog, `#6 backlog: expected 20, received ${d.backlog}`).toBe(20);
  });

  test('TC-WORKFLOW-02 · SV-02 ผ่านหัวหน้า', async ({ kit }) => {
    const reg2 = await kit.loginS('off.reg2');
    const page = await kit.pageFor(reg2);
    await gotoStatus(page, `/officer/cases/${C(13)}`, 200, 'off.reg2 เปิด …000013');

    // 1
    await expectCount(tid(page, 'approve-btn'), 0, '#1 approve-btn');
    await expectCount(tid(page, 'forward-btn'), 1, '#1 forward-btn');
    await expectCount(tid(page, 'forward-target'), 0, '#1 forward-target (ต้องไม่มีช่องเลือกปลายทาง)');

    // 2 ส่งต่อ
    await tid(page, 'forward-btn').click();
    await expectCaseStatus(page, 'PENDING_APPROVAL', '#2');
    await gotoStatus(page, '/officer/queue', 200, '#2 คิว off.reg2');
    await expectText(tid(page, 'workload-count'), '8', '#2 workload-count off.reg2');
    await expectCount(page.locator(`[data-testid="queue-row"][data-case-no="${C(13)}"]`), 0, '#2 แถว …000013 ในคิวทะเบียน');

    // 3 head1 /head/approvals
    const head = await kit.loginS('head1');
    const hpage = await kit.pageFor(head);
    await gotoStatus(hpage, '/head/approvals', 200, '#3 /head/approvals');
    await expectCount(tid(hpage, 'approval-row'), 3, '#3 approval-row');
    const order = await rowAttr(tid(hpage, 'approval-row'), 'data-case-no');
    expect(order, `#3 ลำดับ approval-row: expected [13,14,11], received ${JSON.stringify(order)}`).toEqual([C(13), C(14), C(11)]);

    // 4 เปิด …000013
    await hpage.locator(`[data-testid="approval-row"][data-case-no="${C(13)}"]`).getByTestId('approval-open').click();
    await expect(hpage, `#4 URL: expected /officer/cases/${C(13)}`).toHaveURL(new RegExp(`/officer/cases/${C(13)}$`));
    await expectCount(tid(hpage, 'approve-btn'), 1, '#4 approve-btn');
    await expectCount(tid(hpage, 'reject-btn'), 1, '#4 reject-btn');
    await expectCount(tid(hpage, 'issue-btn'), 0, '#4 issue-btn');

    // 5 อนุมัติ
    await tid(hpage, 'approve-btn').click();
    await expectCaseStatus(hpage, 'APPROVED', '#5');
    await expectCount(tid(hpage, 'issue-btn'), 0, '#5 หัวหน้าไม่มี issue-btn');

    // 6 off.reg1 ไม่ใช่ผู้รับเรื่อง
    const reg1 = await kit.loginS('off.reg1');
    const r1page = await kit.pageFor(reg1);
    await gotoStatus(r1page, `/officer/cases/${C(13)}`, 200, '#6 off.reg1 เปิด …000013');
    await expectCount(tid(r1page, 'issue-btn'), 0, '#6 off.reg1 issue-btn');
    await expectApiError(await reg1.post(`/api/officer/cases/${C(13)}/issue`), 403, 'FORBIDDEN', '#6 off.reg1 issue API');

    // 7 off.reg2 ออกเอกสาร
    await gotoStatus(page, `/officer/cases/${C(13)}`, 200, '#7 off.reg2 เปิด …000013');
    await tid(page, 'issue-btn').click();
    await expectCaseStatus(page, 'COMPLETED', '#7');
    await expectText(tid(page, 'doc-no'), 'DOC-2569-000002', '#7 doc-no');
    const code = (await tid(page, 'verify-code').innerText()).trim();
    await expectSigner(kit, code, 'หัวหน้าฝ่าย', '#7');

    // 8 RESET · seed …000019 (APPROVED โดย head1 · ผู้ออกเอกสาร off.reg1)
    await kit.fresh();
    const reg1b = await kit.loginS('off.reg1');
    const p8 = await kit.pageFor(reg1b);
    await gotoStatus(p8, `/officer/cases/${C(19)}`, 200, '#8 off.reg1 เปิด …000019');
    await tid(p8, 'issue-btn').click();
    await expectCaseStatus(p8, 'COMPLETED', '#8');
    await expectText(tid(p8, 'doc-no'), 'DOC-2569-000002', '#8 doc-no');
    const code8 = (await tid(p8, 'verify-code').innerText()).trim();
    await expectSigner(kit, code8, 'หัวหน้าฝ่าย', '#8');
  });

  test('TC-WORKFLOW-03 · SV-03 สามขั้นตอน', async ({ kit }) => {
    const reg2 = await kit.loginS('off.reg2');
    const page = await kit.pageFor(reg2);
    await gotoStatus(page, `/officer/cases/${C(12)}`, 200, 'off.reg2 เปิด …000012');

    // 1
    await expectText(tid(page, 'case-step'), 'ขั้นตอน 1/3 · ฝ่ายทะเบียน', '#1 case-step');
    await expectText(tid(page, 'case-fee'), '฿1,010', '#1 case-fee');
    await expectCount(tid(page, 'forward-btn'), 1, '#1 forward-btn');

    // 2 ส่งต่อไปโยธา
    await tid(page, 'forward-btn').click();
    await expectText(tid(page, 'case-step'), 'ขั้นตอน 2/3 · ฝ่ายโยธา', '#2 case-step');
    await expectCaseStatus(page, 'IN_REVIEW', '#2');
    await expectText(tid(page, 'case-owner'), 'ยังไม่มีผู้รับ', '#2 case-owner');

    // 3 คิว off.reg2
    await gotoStatus(page, '/officer/queue', 200, '#3 คิว off.reg2');
    await expectText(tid(page, 'workload-count'), '8', '#2 workload-count off.reg2');
    await expectCount(page.locator(`[data-testid="queue-row"][data-case-no="${C(12)}"]`), 0, '#3 แถว …000012');
    await expectCount(tid(page, 'queue-row'), 16, '#3 queue-row');

    // 4 คิวโยธา
    const works = await kit.loginS('off.works1');
    const wpage = await kit.pageFor(works);
    await gotoStatus(wpage, '/officer/queue', 200, '#4 คิว off.works1');
    await expectCount(tid(wpage, 'queue-row'), 2, '#4 queue-row');
    const order = await rowAttr(tid(wpage, 'queue-row'), 'data-case-no');
    expect(order, `#4 ลำดับคิวโยธา: expected [10,12], received ${JSON.stringify(order)}`).toEqual([C(10), C(12)]);
    await expectCount(tid(wpage, 'claim-btn'), 2, '#4 claim-btn');

    // 5 off.reg1 ข้ามแผนก
    const reg1 = await kit.loginS('off.reg1');
    await expectApiError(await reg1.post(`/api/officer/cases/${C(12)}/claim`), 403, 'FORBIDDEN', '#5 off.reg1 claim …000012');

    // 6 off.works1 รับเรื่อง + ส่งต่อ
    await gotoStatus(wpage, `/officer/cases/${C(12)}`, 200, '#6 off.works1 เปิด …000012');
    await tid(wpage, 'claim-btn').click();
    await expectText(tid(wpage, 'case-owner'), 'off.works1', '#6 case-owner');
    await tid(wpage, 'forward-btn').click();
    await expectCaseStatus(wpage, 'PENDING_APPROVAL', '#6');
    await expectText(tid(wpage, 'case-step'), 'ขั้นตอน 3/3 · หัวหน้าฝ่าย', '#6 case-step');

    // 7 head1
    const head = await kit.loginS('head1');
    const hpage = await kit.pageFor(head);
    await gotoStatus(hpage, '/head/approvals', 200, '#7 /head/approvals');
    await expectCount(tid(hpage, 'approval-row'), 3, '#7 approval-row');
    await expectCount(hpage.locator(`[data-testid="approval-row"][data-case-no="${C(12)}"]`), 1, '#7 แถว …000012');
    await hpage.locator(`[data-testid="approval-row"][data-case-no="${C(12)}"]`).getByTestId('approval-open').click();
    await tid(hpage, 'approve-btn').click();
    await expectCaseStatus(hpage, 'APPROVED', '#7');

    // 8 ผู้ออกเอกสาร = ทะเบียนขั้นแรก
    await gotoStatus(wpage, `/officer/cases/${C(12)}`, 200, '#8 off.works1 เปิด …000012');
    await expectCount(tid(wpage, 'issue-btn'), 0, '#8 off.works1 issue-btn');
    await gotoStatus(page, `/officer/cases/${C(12)}`, 200, '#8 off.reg2 เปิด …000012');
    await expectCount(tid(page, 'issue-btn'), 1, '#8 off.reg2 issue-btn');
    await tid(page, 'issue-btn').click();
    await expectCaseStatus(page, 'COMPLETED', '#8');
    const code = (await tid(page, 'verify-code').innerText()).trim();
    await expectSigner(kit, code, 'หัวหน้าฝ่าย', '#8');
  });

  test('TC-WORKFLOW-04 · ตีกลับสูงสุด 2 ครั้ง และผลหลังครบ', async ({ kit }) => {
    // ส่วน A · …000020 SV-01
    {
      const reg1 = await kit.loginS('off.reg1');
      const somchai = await kit.loginC(ID.somchai);
      const op = await kit.pageFor(reg1);
      const cp = await kit.pageFor(somchai);
      const url = `/officer/cases/${C(20)}`;
      await gotoStatus(op, url, 200, 'A off.reg1 เปิด …000020');
      await expectText(tid(op, 'return-count'), '0', 'A return-count เริ่ม');

      await uiReturn(op, REASON10);
      await expectCaseStatus(op, 'NEED_FIX', 'A1');
      await expectText(tid(op, 'return-count'), '1', 'A1 return-count');

      await uiResubmit(cp, C(20));
      await gotoStatus(op, url, 200, 'A2 off.reg1 เปิดซ้ำ');
      await expectCaseStatus(op, 'IN_REVIEW', 'A2');
      await expectText(tid(op, 'case-owner'), 'off.reg1', 'A2 case-owner เดิม');

      await uiReturn(op, REASON10);
      await expectCaseStatus(op, 'NEED_FIX', 'A3');
      await expectText(tid(op, 'return-count'), '2', 'A3 return-count');

      await uiResubmit(cp, C(20));
      await gotoStatus(op, url, 200, 'A5 off.reg1 เปิดซ้ำ');
      await expectCaseStatus(op, 'IN_REVIEW', 'A4');
      await expectCount(tid(op, 'return-btn'), 0, 'A5 return-btn');
      await expectApiError(await reg1.post(`/api/officer/cases/${C(20)}/return`, { data: { reason: REASON10 } }),
        409, 'RETURN_LIMIT', 'A5 ตีกลับครั้งที่ 3', 'ตีกลับได้สูงสุด 2 ครั้ง');
      await gotoStatus(op, url, 200, 'A5 เปิดซ้ำ');
      await expectCaseStatus(op, 'IN_REVIEW', 'A5');
      await expectText(tid(op, 'return-count'), '2', 'A5 return-count');
      await expectCount(tid(op, 'approve-btn'), 1, 'A5 approve-btn (SV-01 ตัดสินเองได้)');
      await expectCount(tid(op, 'reject-btn'), 1, 'A5 reject-btn');
    }

    // ส่วน B · seed …000023
    {
      await kit.fresh();
      const reg1 = await kit.loginS('off.reg1');
      const op = await kit.pageFor(reg1);
      const url = `/officer/cases/${C(23)}`;
      await gotoStatus(op, url, 200, 'B off.reg1 เปิด …000023');
      await expectText(tid(op, 'return-count'), '2', 'B return-count');
      await expectCount(tid(op, 'return-btn'), 0, 'B return-btn');
      await expectApiError(await reg1.post(`/api/officer/cases/${C(23)}/return`, { data: { reason: REASON10 } }),
        409, 'RETURN_LIMIT', 'B API return', 'ตีกลับได้สูงสุด 2 ครั้ง');
      await gotoStatus(op, url, 200, 'B เปิดซ้ำ');
      await expectCaseStatus(op, 'IN_REVIEW', 'B');
      await expectCount(tid(op, 'approve-btn'), 1, 'B approve-btn');
      await expectCount(tid(op, 'reject-btn'), 1, 'B reject-btn');
    }

    // ส่วน C · SV-02 …000013
    {
      await kit.fresh();
      const reg2 = await kit.loginS('off.reg2');
      const somchai = await kit.loginC(ID.somchai);
      const op = await kit.pageFor(reg2);
      const cp = await kit.pageFor(somchai);
      const url = `/officer/cases/${C(13)}`;
      await gotoStatus(op, url, 200, 'C off.reg2 เปิด …000013');
      await uiReturn(op, REASON10);
      await expectCaseStatus(op, 'NEED_FIX', 'C ตีกลับ 1');
      await uiResubmit(cp, C(13));
      await gotoStatus(op, url, 200, 'C เปิดซ้ำ');
      await uiReturn(op, REASON10);
      await expectCaseStatus(op, 'NEED_FIX', 'C ตีกลับ 2');
      await uiResubmit(cp, C(13));
      await gotoStatus(op, url, 200, 'C เปิดซ้ำหลังส่งแก้ 2');
      await expectCaseStatus(op, 'IN_REVIEW', 'C');
      await expectCount(tid(op, 'return-btn'), 0, 'C return-btn');
      await expectCount(tid(op, 'approve-btn'), 0, 'C approve-btn');
      await expectCount(tid(op, 'reject-btn'), 0, 'C reject-btn (เจ้าหน้าที่ SV-02 ไม่ตัดสิน)');
      await expectCount(tid(op, 'forward-btn'), 1, 'C forward-btn');
      await expectHttp(await reg2.post(`/api/cases/${C(13)}/reject`, { data: { reason: REASON10 } }), 403, 'C off.reg2 reject API');

      const note = 'ส่งต่อให้หัวหน้าพิจารณา';
      await tid(op, 'forward-note').fill(note);
      await tid(op, 'forward-btn').click();
      await expectCaseStatus(op, 'PENDING_APPROVAL', 'C หลังส่งต่อ');

      const aud = await kit.loginS('audit1');
      const ap = await kit.pageFor(aud);
      await gotoStatus(ap, '/audit', 200, 'C /audit');
      await auditFilter(ap, { event: 'FORWARD' });
      const fwd = ap.locator(`[data-testid="audit-row"][data-event="FORWARD"][data-case-no="${C(13)}"]`);
      await expectCount(fwd, 1, 'C แถว FORWARD …000013');
      await expect(fwd.getByTestId('audit-detail'), `C audit-detail: expected to contain "${note}"`).toContainText(note);

      const head = await kit.loginS('head1');
      const hp = await kit.pageFor(head);
      await gotoStatus(hp, url, 200, 'C head1 เปิด …000013');
      await expectCount(tid(hp, 'reject-btn'), 1, 'C head1 reject-btn');
      await expectCount(tid(hp, 'approve-btn'), 1, 'C head1 approve-btn');
    }
  });

  test('TC-WORKFLOW-05 · เหตุผล ≥ 10 ตัวอักษร (ตีกลับ / ไม่อนุมัติ)', async ({ kit }) => {
    const MSG = 'กรุณากรอกเหตุผลอย่างน้อย 10 ตัวอักษร';
    const SP10 = '          ';

    // ส่วน A ตีกลับ …000020
    {
      const reg1 = await kit.loginS('off.reg1');
      const op = await kit.pageFor(reg1);
      const url = `/officer/cases/${C(20)}`;
      await gotoStatus(op, url, 200, 'A เปิด …000020');

      for (const [label, reason] of [['9 ตัว', REASON9], ['เว้นวรรค 10', SP10]]) {
        await uiReturn(op, reason);
        await expectText(tid(op, 'return-reason-error'), MSG, `A ${label} return-reason-error`);
        await expectApiError(await reg1.post(`/api/officer/cases/${C(20)}/return`, { data: { reason } }),
          400, 'REASON_TOO_SHORT', `A ${label} API`);
        await expectCaseStatus(op, 'IN_REVIEW', `A ${label} สถานะยัง`);
      }
      await gotoStatus(op, url, 200, 'A เปิดซ้ำ');
      await uiReturn(op, REASON10);
      await expectCaseStatus(op, 'NEED_FIX', 'A 10 ตัว');

      const somchai = await kit.loginC(ID.somchai);
      const cp = await kit.pageFor(somchai);
      await gotoStatus(cp, `/citizen/cases/${C(20)}`, 200, 'A สมชายเปิด …000020');
      await expectText(tid(cp, 'return-reason-display'), REASON10, 'A return-reason-display');
    }

    // ส่วน B ไม่อนุมัติ SV-01 …000026
    {
      await kit.fresh();
      const reg2 = await kit.loginS('off.reg2');
      const op = await kit.pageFor(reg2);
      await gotoStatus(op, `/officer/cases/${C(26)}`, 200, 'B เปิด …000026');
      await uiReject(op, REASON9);
      await expectText(tid(op, 'reject-reason-error'), MSG, 'B 9 ตัว reject-reason-error');
      await expectApiError(await reg2.post(`/api/cases/${C(26)}/reject`, { data: { reason: REASON9 } }), 400, 'REASON_TOO_SHORT', 'B 9 ตัว API');
      await expectCaseStatus(op, 'IN_REVIEW', 'B 9 ตัว สถานะยัง');
      await gotoStatus(op, `/officer/cases/${C(26)}`, 200, 'B เปิดซ้ำ');
      await uiReject(op, REASON10);
      await expectCaseStatus(op, 'REJECTED', 'B 10 ตัว');
      await expect(tid(op, 'closed-at'), `B closed-at data-iso: expected ${T0}`).toHaveAttribute('data-iso', T0);
      await expectLevel(op, 'closed', 'B');

      const somchai = await kit.loginC(ID.somchai);
      const cp = await kit.pageFor(somchai);
      await gotoStatus(cp, `/citizen/cases/${C(26)}`, 200, 'B สมชายเปิด …000026');
      await expectText(tid(cp, 'no-refund-note'), 'ค่าธรรมเนียมที่ชำระแล้วไม่คืน', 'B no-refund-note');

      const exec = await kit.loginS('exec1');
      const d = await dash(exec);
      expect(d.closed, `B dashboard closed: expected 1, received ${d.closed}`).toBe(1);
      expect(d.onTime, `B dashboard onTime: expected 1, received ${d.onTime}`).toBe(1);
    }

    // ส่วน C หัวหน้าไม่อนุมัติ …000011
    {
      await kit.fresh();
      const head = await kit.loginS('head1');
      const hp = await kit.pageFor(head);
      await gotoStatus(hp, `/officer/cases/${C(11)}`, 200, 'C head1 เปิด …000011');
      await expectApiError(await head.post(`/api/cases/${C(11)}/reject`, { data: { reason: REASON9 } }), 400, 'REASON_TOO_SHORT', 'C 9 ตัว API');
      await uiReject(hp, REASON9);
      await expectText(tid(hp, 'reject-reason-error'), MSG, 'C 9 ตัว reject-reason-error');
      await gotoStatus(hp, `/officer/cases/${C(11)}`, 200, 'C เปิดซ้ำ');
      await uiReject(hp, REASON10);
      await expectCaseStatus(hp, 'REJECTED', 'C 10 ตัว');
    }
  });

  test('TC-WORKFLOW-06 · เวลาแก้ไข 168 ชั่วโมง', async ({ kit }) => {
    const url = `/citizen/cases/${C(17)}`;
    const DEADLINE = '2026-12-04T14:00:00+07:00';

    // หน้าตั้งต้น
    {
      const somchai = await kit.loginC(ID.somchai);
      const cp = await kit.pageFor(somchai);
      await gotoStatus(cp, url, 200, 'เปิด …000017');
      await expectCaseStatus(cp, 'NEED_FIX', 'ตั้งต้น');
      await expectText(tid(cp, 'return-reason-display'), 'ชื่อในเอกสารไม่ตรงกับบัตร กรุณาแก้ไข', 'ตั้งต้น return-reason-display');
      await expectText(tid(cp, 'fix-deadline'), '4 ธ.ค. 2569 14:00', 'ตั้งต้น fix-deadline');
      await expect(tid(cp, 'fix-deadline'), `fix-deadline data-iso: expected ${DEADLINE}`).toHaveAttribute('data-iso', DEADLINE);
      await expectCount(tid(cp, 'submit-fix-btn'), 1, 'ตั้งต้น submit-fix-btn');
    }

    // รอบ A 167:59
    {
      await kit.fresh('2026-12-04T13:59:00+07:00');
      const somchai = await kit.loginC(ID.somchai);
      const cp = await kit.pageFor(somchai);
      await gotoStatus(cp, url, 200, 'A เปิด …000017');
      await expect(tid(cp, 'submit-fix-btn'), 'A submit-fix-btn: expected enabled').toBeEnabled();
      await tid(cp, 'submit-fix-btn').click();
      await expectCaseStatus(cp, 'IN_REVIEW', 'A หลังส่งแก้');
    }

    // รอบ B 168:00
    {
      await kit.fresh(DEADLINE);
      const somchai = await kit.loginC(ID.somchai);
      const cp = await kit.pageFor(somchai);
      await gotoStatus(cp, url, 200, 'B เปิด …000017');
      await expectCaseStatus(cp, 'CANCELLED', 'B');
      await expectCount(tid(cp, 'submit-fix-btn'), 0, 'B submit-fix-btn');
      await expectText(tid(cp, 'no-refund-note'), 'ค่าธรรมเนียมที่ชำระแล้วไม่คืน', 'B no-refund-note');
      await expectHttp(await somchai.post(`/api/cases/${C(17)}/resubmit`, { data: {} }), 409, 'B resubmit API');
      await expect(cp.locator(`[data-testid="timeline-item"][data-iso="${DEADLINE}"]`),
        `B timeline-item data-iso=${DEADLINE}: expected ≥ 1`).not.toHaveCount(0);
      const exec = await kit.loginS('exec1');
      const d = await dash(exec);
      expect(d.backlog, `B dashboard backlog: expected 20, received ${d.backlog}`).toBe(20);
    }
  });
});


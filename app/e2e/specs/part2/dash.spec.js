// @ts-check
// TC-DASH-01..04 (TEST-PLAN §13)
'use strict';

const {
  test, expect, C, REASON10,
  tid, gotoStatus, expectHttp, okJson, expectCount, expectText, auditFilter, auditRows,
  grabDownload, expectPdfLine, readXlsx, piiFindings, pdfPiiFindings,
} = require('./_lib');

const KPI_IDS = ['kpi-received', 'kpi-closed', 'kpi-ontime-pct', 'kpi-backlog', 'kpi-overdue'];
const XLSX_LABELS = ['รับเรื่อง', 'ปิดงาน', 'ทันกำหนด %', 'งานคงค้าง', 'เกินกำหนดคงค้าง'];

async function dashApi(api, period, service) {
  return okJson(await api.get(`/api/dashboard?period=${period}&service=${service}`), `GET /api/dashboard ${period} ${service}`);
}

/** เลือกช่วง/บริการบนจอ */
async function choose(page, period, service) {
  await tid(page, 'period-select').selectOption(period);
  await tid(page, 'service-select').selectOption(service);
}

/** ตรวจ 5 ช่อง kpi บนจอ · exp = [received, closed, ontime, backlog, overdue] (ข้อความ) */
async function expectKpis(page, exp, label) {
  for (let i = 0; i < KPI_IDS.length; i++) {
    if (exp[i] === undefined) continue;
    await expectText(tid(page, KPI_IDS[i]), String(exp[i]), `${label} ${KPI_IDS[i]}`);
  }
}

function expectApiKpis(j, exp, label) {
  const [received, closed, pct, backlog, overdue] = exp;
  const got = { received: j.received, closed: j.closed, ontimePct: j.ontimePct, backlog: j.backlog, overdue: j.overdue };
  const want = {
    received: Number(received),
    closed: Number(closed),
    ontimePct: pct === '–' ? null : Number(String(pct).replace('%', '')),
    backlog: Number(backlog),
    overdue: Number(overdue),
  };
  if (got.ontimePct !== null && got.ontimePct !== undefined) got.ontimePct = Number(got.ontimePct);
  expect(got, `${label} API: expected ${JSON.stringify(want)}, received ${JSON.stringify(got)}`).toEqual(want);
}

test.describe('DASH', () => {
  test('TC-DASH-01 · Dashboard ตัวเลขเริ่มต้น', async ({ kit }) => {
    const exec = await kit.loginS('exec1');
    const page = await kit.pageFor(exec);
    await gotoStatus(page, '/dashboard', 200, '/dashboard');
    await expect(tid(page, 'period-select'), 'period-select ค่าเริ่มต้น: expected 2026-12').toHaveValue('2026-12');
    await expect(tid(page, 'service-select'), 'service-select ค่าเริ่มต้น: expected ALL').toHaveValue('ALL');

    const exp = ['3', '0', '–', '21', '1'];
    await expectKpis(page, exp, 'ธ.ค. ALL');
    const j = await dashApi(exec, '2026-12', 'ALL');
    expectApiKpis(j, exp, 'ธ.ค. ALL');
    expect(j.ontimePct, `ontimePct: expected null, received ${j.ontimePct}`).toBeNull();

    // งานในมือ
    await expectCount(tid(page, 'workload-row'), 3, 'workload-row');
    const wl = {};
    for (const u of ['off.reg1', 'off.reg2', 'off.works1']) {
      wl[u] = (await page.locator(`[data-testid="workload-row"][data-username="${u}"]`).getByTestId('workload-value').innerText()).trim();
    }
    expect(wl, `workload-row: expected {off.reg1:3, off.reg2:9, off.works1:0}, received ${JSON.stringify(wl)}`)
      .toEqual({ 'off.reg1': '3', 'off.reg2': '9', 'off.works1': '0' });
    const apiWl = Object.fromEntries((j.workload || []).map((w) => [w.username, w.count]));
    expect(apiWl, `API workload: expected {off.reg1:3, off.reg2:9, off.works1:0}, received ${JSON.stringify(j.workload)}`)
      .toEqual({ 'off.reg1': 3, 'off.reg2': 9, 'off.works1': 0 });

    // ไม่มีข้อมูลส่วนบุคคล
    const text = await page.locator('body').innerText();
    const pii = piiFindings(text.split(/\n/));
    expect(pii, `/dashboard innerText: expected no PII, received ${JSON.stringify(pii)}`).toEqual([]);

    // ตัวกรองบริการ
    for (const [svc, row] of [
      ['SV-01', ['3', '0', '–', '11', '1']],
      ['SV-02', ['0', '0', '–', '7', '0']],
      ['SV-03', ['0', '0', '–', '3', '0']],
    ]) {
      await choose(page, '2026-12', svc);
      await expectKpis(page, row, `ธ.ค. ${svc}`);
      expectApiKpis(await dashApi(exec, '2026-12', svc), row, `ธ.ค. ${svc}`);
    }
  });

  test('TC-DASH-02 · Dashboard ย้อนหลัง', async ({ kit }) => {
    const exec = await kit.loginS('exec1');
    const page = await kit.pageFor(exec);
    await gotoStatus(page, '/dashboard', 200, '/dashboard');
    const NOW = { ALL: ['21', '1'], 'SV-01': ['11', '1'], 'SV-02': ['7', '0'], 'SV-03': ['3', '0'] };
    const rows = [
      ['2026-10', 'ALL', '1', '1', '100.0%'],
      ['2026-11', 'ALL', '26', '7', '85.7%'],
      ['2026-11', 'SV-01', '12', '3', '100.0%'],
      ['2026-11', 'SV-02', '10', '3', '66.7%'],
      ['2026-11', 'SV-03', '4', '1', '100.0%'],
      ['2026', 'ALL', '30', '8', '87.5%'],
      ['2026', 'SV-01', '16', '4', '100.0%'],
      ['2026', 'SV-02', '10', '3', '66.7%'],
      ['2026', 'SV-03', '4', '1', '100.0%'],
    ];
    for (const [period, svc, rec, closed, pct] of rows) {
      const exp = [rec, closed, pct, ...NOW[svc]];
      await choose(page, period, svc);
      await expectKpis(page, exp, `${period} ${svc}`);
      expectApiKpis(await dashApi(exec, period, svc), exp, `${period} ${svc}`);
    }
  });

  test('TC-DASH-03 · ส่งออก Excel/PDF เท่าหน้าจอ', async ({ kit }) => {
    const exec = await kit.loginS('exec1');
    const page = await kit.pageFor(exec);
    await gotoStatus(page, '/dashboard', 200, '/dashboard');

    async function checkXlsx(exp, label) {
      const screen = [];
      for (const id of KPI_IDS) screen.push((await tid(page, id).innerText()).trim());
      expect(screen, `${label} บนจอ: expected ${JSON.stringify(exp)}, received ${JSON.stringify(screen)}`).toEqual(exp);
      const f = await grabDownload(page, tid(page, 'export-xlsx-btn'), `${label} export-xlsx-btn`);
      const x = await readXlsx(f.buf);
      const head = [x.get(1, 1), x.get(1, 2)];
      expect(head, `${label} xlsx แถว 1: expected ["ตัวชี้วัด","ค่า"], received ${JSON.stringify(head)}`).toEqual(['ตัวชี้วัด', 'ค่า']);
      const labels = [2, 3, 4, 5, 6].map((r) => x.get(r, 1));
      const values = [2, 3, 4, 5, 6].map((r) => x.get(r, 2));
      expect(labels, `${label} xlsx คอลัมน์ A: expected ${JSON.stringify(XLSX_LABELS)}, received ${JSON.stringify(labels)}`).toEqual(XLSX_LABELS);
      expect(values, `${label} xlsx คอลัมน์ B: expected ${JSON.stringify(exp)} (= บนจอ), received ${JSON.stringify(values)}`).toEqual(screen);
      const pii = piiFindings(x.cells);
      expect(pii, `${label} xlsx: expected no PII, received ${JSON.stringify(pii)}`).toEqual([]);
    }

    // พ.ย. ALL xlsx + pdf
    await choose(page, '2026-11', 'ALL');
    const nov = ['26', '7', '85.7%', '21', '1'];
    await expectKpis(page, nov, 'พ.ย. ALL');
    await checkXlsx(nov, 'xlsx พ.ย.');

    const pf = await grabDownload(page, tid(page, 'export-pdf-btn'), 'export-pdf-btn พ.ย.');
    expect(pf.buf.subarray(0, 4).toString('latin1'), 'pdf พ.ย.: expected file start %PDF').toBe('%PDF');
    const KPI_LINE = 'kpi received=26 closed=7 ontime=85.7% backlog=21 overdue=1';
    // บรรทัด KPI และ PII ตรวจบนข้อความที่ pdf-parse ดึงออกมาเท่านั้น (ดึงไม่ได้/ว่าง → ล้ม) · ชื่อไทยเทียบหลังตัด whitespace (pdf-parse แยกสระ/วรรณยุกต์ขึ้นบรรทัดใหม่)
    const { text: pdfNov } = await expectPdfLine(pf.buf, KPI_LINE, 'pdf พ.ย.');
    const piiPdf = pdfPiiFindings(pdfNov, 'pdf พ.ย.');
    expect(piiPdf, `pdf พ.ย.: expected no PII in extracted text (${pdfNov.length} chars), received ${JSON.stringify(piiPdf)}`).toEqual([]);

    // ธ.ค. ALL xlsx
    await choose(page, '2026-12', 'ALL');
    const dec = ['3', '0', '–', '21', '1'];
    await expectKpis(page, dec, 'ธ.ค. ALL');
    await checkXlsx(dec, 'xlsx ธ.ค.');

    // Audit EXPORT = 3
    const aud = await kit.loginS('audit1');
    const ap = await kit.pageFor(aud);
    await gotoStatus(ap, '/audit', 200, '/audit');
    await auditFilter(ap, { event: 'EXPORT' }, 3, 'Audit EXPORT');
    const rows = await auditRows(ap);
    for (const r of rows) {
      expect(r.actor, `EXPORT data-actor: expected exec1, received ${r.actor}`).toBe('exec1');
      expect(r.role, `EXPORT audit-role: expected executive, received ${r.role}`).toBe('executive');
    }
    const details = rows.map((r) => r.detail || '');
    for (const [fmt, period] of [['xlsx', '2026-11'], ['pdf', '2026-11'], ['xlsx', '2026-12']]) {
      const hit = details.some((d) => d.includes(fmt) && d.includes(period));
      expect(hit, `EXPORT detail: expected a row containing "${fmt}" and "${period}", received ${JSON.stringify(details)}`).toBe(true);
    }

    // Content-Type ของ PDF (ตรวจหลังนับ Audit แล้ว เพราะคำขอนี้เพิ่มแถว EXPORT)
    const res = await exec.get('/api/dashboard/export?format=pdf&period=2026-11&service=ALL');
    await expectHttp(res, 200, 'GET export pdf');
    const ct = res.headers()['content-type'] || '';
    expect(ct, `export pdf Content-Type: expected application/pdf, received ${ct}`).toContain('application/pdf');
    const { text: pdfApi } = await expectPdfLine(await res.body(), KPI_LINE, 'export pdf (API)');
    const piiApi = pdfPiiFindings(pdfApi, 'export pdf (API)');
    expect(piiApi, `export pdf (API): expected no PII in extracted text (${pdfApi.length} chars), received ${JSON.stringify(piiApi)}`).toEqual([]);
  });

  test('TC-DASH-04 · ค่าขอบ "ทันกำหนด" 16:29:59 / 16:30:00 / 16:30:01', async ({ kit }) => {
    await kit.clock('2026-12-03T16:00:00+07:00');
    const reg1 = await kit.loginS('off.reg1');
    const reg2 = await kit.loginS('off.reg2');
    const exec = await kit.loginS('exec1');
    const dpage = await kit.pageFor(exec);
    const opage = await kit.pageFor(reg2);

    // 1 อนุมัติที่ 16:00
    await okJson(await reg2.post(`/api/cases/${C(25)}/approve`), '#1 off.reg2 approve …000025');
    await okJson(await reg1.post(`/api/cases/${C(23)}/approve`), '#1 off.reg1 approve …000023');

    async function after(step, caseNo, iso, closed, onTime) {
      await gotoStatus(opage, `/officer/cases/${caseNo}`, 200, `#${step} เปิด ${caseNo}`);
      await expect(tid(opage, 'closed-at'), `#${step} ${caseNo} closed-at data-iso: expected ${iso}`).toHaveAttribute('data-iso', iso);
      const j = await okJson(await exec.get('/api/dashboard?period=2026-12&service=ALL'), `#${step} GET /api/dashboard`);
      expect({ closed: j.closed, onTime: j.onTime }, `#${step} API: expected {closed:${closed}, onTime:${onTime}}, received ${JSON.stringify({ closed: j.closed, onTime: j.onTime })}`)
        .toEqual({ closed, onTime });
      await gotoStatus(dpage, '/dashboard', 200, `#${step} /dashboard`);
      await expectText(tid(dpage, 'kpi-closed'), String(closed), `#${step} kpi-closed`);
      return j;
    }

    // 2 16:29:59 issue …000025
    await kit.clock('2026-12-03T16:29:59+07:00');
    await okJson(await reg2.post(`/api/officer/cases/${C(25)}/issue`), '#2 issue …000025');
    await after(2, C(25), '2026-12-03T16:29:59+07:00', 1, 1);

    // 3 16:30:00 reject …000026
    await kit.clock('2026-12-03T16:30:00+07:00');
    await okJson(await reg2.post(`/api/cases/${C(26)}/reject`, { data: { reason: REASON10 } }), '#3 reject …000026');
    await after(3, C(26), '2026-12-03T16:30:00+07:00', 2, 2);

    // 4 16:30:01 issue …000023
    await kit.clock('2026-12-03T16:30:01+07:00');
    await okJson(await reg1.post(`/api/officer/cases/${C(23)}/issue`), '#4 issue …000023');
    const j = await after(4, C(23), '2026-12-03T16:30:01+07:00', 3, 2);
    expect(j.backlog, `#4 API backlog: expected 18, received ${j.backlog}`).toBe(18);
    await expectText(tid(dpage, 'kpi-backlog'), '18', '#4 kpi-backlog');
  });
});

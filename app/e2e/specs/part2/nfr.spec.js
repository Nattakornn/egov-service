// @ts-check
// TC-NFR-01..04 (TEST-PLAN §16)
'use strict';

const fs = require('fs');
const {
  test, expect, T0, ID, C, STATUS_TH, LEVEL_TH,
  tid, gotoStatus, expectHttp, expectApiError, okJson, newPaid, expectText, inputFile, needleFindings, NFR04_NEEDLES,
} = require('./_lib');

/** ล็อกอินบทบาทต่าง ๆ ผ่าน API (ครั้งเดียว) */
async function roleApis(kit, { mana = false } = {}) {
  const r = {
    somchai: await kit.loginC(ID.somchai),
    reg1: await kit.loginS('off.reg1'),
    head1: await kit.loginS('head1'),
    exec1: await kit.loginS('exec1'),
    audit1: await kit.loginS('audit1'),
    admin1: await kit.loginS('admin1'),
  };
  if (mana) r.mana = await kit.loginC(ID.mana, { expectRegistered: false });
  return r;
}

test.describe('NFR', () => {
  test('TC-NFR-01 · Responsive 375 / 768 / 1280', async ({ kit }) => {
    const apis = await roleApis(kit);
    const PAGES = [
      [null, '/login'],
      ['somchai', '/citizen'],
      ['somchai', '/citizen/new/SV-03'],
      ['somchai', `/citizen/cases/${C(13)}`],
      ['reg1', '/officer/queue'],
      ['reg1', `/officer/cases/${C(20)}`],
      ['head1', '/head/approvals'],
      ['exec1', '/dashboard'],
      ['audit1', '/audit'],
      ['admin1', '/admin/services'],
      [null, '/verify/K7M2Q9XA'],
    ];
    const SIZES = [[375, 812], [768, 1024], [1280, 800]];
    const pages = {};
    const problems = [];
    let checks = 0;
    for (const [who, url] of PAGES) {
      const key = who || 'anon';
      if (!pages[key]) pages[key] = who ? await kit.pageFor(apis[who]) : await kit.anonPage();
      const page = pages[key];
      for (const [w, h] of SIZES) {
        await page.setViewportSize({ width: w, height: h });
        const res = await page.goto(url);
        if (!res || res.status() !== 200) problems.push(`${url} @${w}: expected HTTP 200, received ${res ? res.status() : 'none'}`);
        await page.waitForLoadState('load');
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
        checks++;
        if (m.sw > m.iw) problems.push(`${url} @${w}x${h}: expected scrollWidth ≤ innerWidth (${m.iw}), received scrollWidth ${m.sw}`);
      }
    }
    expect(checks, 'จำนวนการตรวจ: expected 33').toBe(33);
    expect(problems, `Responsive: expected 0 horizontal overflow, received ${problems.length}`).toEqual([]);

    // งานหลักที่ 375 px ผ่านหน้าจอ
    await kit.fresh();
    const page = await kit.anonPage({ viewport: { width: 375, height: 812 } });
    await gotoStatus(page, '/login', 200, '375 /login');
    if (await tid(page, 'login-tab-citizen').count()) await tid(page, 'login-tab-citizen').click();
    await tid(page, 'thaid-id-input').fill(ID.somchai);
    await tid(page, 'thaid-submit').click();
    await tid(page, 'otp-input').fill('123456');
    await tid(page, 'otp-submit').click();
    await expect(page, '375 หลังล็อกอิน: expected /citizen').toHaveURL(/\/citizen$/);
    await tid(page, 'start-service-SV-01').click();
    await tid(page, 'qty-input').fill('1');
    await expectText(tid(page, 'fee-total'), '฿20', '375 fee-total');
    await tid(page, 'to-upload-btn').click();
    await tid(page, 'upload-input-id-card').setInputFiles(inputFile('id-card.pdf'));
    await expect(tid(page, 'to-payment-btn'), '375 to-payment-btn: expected enabled').toBeEnabled();
    await tid(page, 'to-payment-btn').click();
    const qr = tid(page, 'create-qr-btn');
    await expect(qr, '375 create-qr-btn: expected visible').toBeVisible();
    const box = await qr.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 375,
      `375 create-qr-btn: expected 0 ≤ x and x+width ≤ 375, received ${JSON.stringify(box)}`).toBe(true);
  });

  test('TC-NFR-02 · WCAG: axe + คีย์บอร์ด + label + สถานะไม่ใช้สีอย่างเดียว', async ({ kit }) => {
    const { default: AxeBuilder } = require('@axe-core/playwright');
    const apis = await roleApis(kit, { mana: true });
    const PAGES = [
      [null, '/login'],
      ['mana', '/register'],
      ['somchai', '/citizen'],
      ['somchai', '/citizen/new/SV-01'],
      ['somchai', `/citizen/cases/${C(17)}`],
      ['reg1', '/officer/queue'],
      ['reg1', `/officer/cases/${C(20)}`],
      ['head1', '/head/approvals'],
      ['exec1', '/dashboard'],
      ['audit1', '/audit'],
      ['admin1', '/admin/services'],
      ['reg1', '/notifications'],
      [null, '/verify/K7M2Q9XA'],
    ];
    expect(PAGES.length, 'จำนวนหน้า: expected 13').toBe(13);

    const axeProblems = [];
    const labelProblems = [];
    const statusProblems = [];
    const pages = {};

    async function statusTexts(page, where) {
      const items = await page.evaluate(() => {
        const out = [];
        for (const id of ['case-status', 'row-status', 'sla-level', 'row-sla-level']) {
          for (const el of document.querySelectorAll(`[data-testid="${id}"]`)) {
            const row = el.closest('[data-testid="queue-row"],[data-testid="my-case-row"],[data-testid="my-draft-row"]');
            let code = null;
            if (id.endsWith('status')) code = el.getAttribute('data-status') || (row && row.getAttribute('data-status'));
            else code = el.getAttribute('data-level') || (row && (row.getAttribute('data-sla-level') || row.getAttribute('data-level')));
            const r = el.getBoundingClientRect();
            out.push({ id, code, text: (el.textContent || '').replace(/\s+/g, ' ').trim(), inner: (el.innerText || '').trim(), visible: r.width > 0 && r.height > 0 });
          }
        }
        return out;
      });
      for (const it of items) {
        const map = it.id.endsWith('status') ? STATUS_TH : LEVEL_TH;
        if (!it.text) statusProblems.push(`${where} ${it.id}[${it.code}]: expected non-empty text, received ""`);
        else if (!it.code || map[it.code] !== it.text) statusProblems.push(`${where} ${it.id}: expected "${map[it.code]}" for code ${it.code}, received "${it.text}"`);
        if (it.visible && !it.inner) statusProblems.push(`${where} ${it.id}[${it.code}]: expected readable innerText, received ""`);
      }
      return items.length;
    }

    let statusCount = 0;
    for (const [who, url] of PAGES) {
      const key = who || 'anon';
      if (!pages[key]) pages[key] = who ? await kit.pageFor(apis[who]) : await kit.anonPage();
      const page = pages[key];
      await gotoStatus(page, url, 200, `axe ${url}`);

      // A axe
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      for (const v of r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')) {
        axeProblems.push(`${url}: [${v.impact}] ${v.id} (${v.nodes.length} node) ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
      }

      // C label
      const unlabeled = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('input, select, textarea')) {
          if (el.type === 'hidden') continue;
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          if (r.width === 0 || r.height === 0 || st.visibility === 'hidden' || st.display === 'none') continue;
          const al = (el.getAttribute('aria-label') || '').trim();
          const lb = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
            .map((id) => (document.getElementById(id) || { textContent: '' }).textContent.trim()).join('');
          const labels = el.labels ? Array.from(el.labels).map((l) => l.textContent.trim()).join('') : '';
          const title = (el.getAttribute('title') || '').trim();
          if (!al && !lb && !labels && !title) out.push(el.getAttribute('data-testid') || el.name || el.id || el.outerHTML.slice(0, 60));
        }
        return out;
      });
      for (const u of unlabeled) labelProblems.push(`${url}: ${u}`);

      // D สถานะมีข้อความ (ปกติ + forced colors)
      statusCount += await statusTexts(page, url);
      await page.emulateMedia({ forcedColors: 'active' });
      await statusTexts(page, `${url} (forcedColors)`);
      await page.emulateMedia({ forcedColors: 'none' });
    }
    expect(statusCount, 'ส่วน D: expected ≥ 1 status/level element across pages').toBeGreaterThan(0);

    // B คีย์บอร์ดอย่างเดียว
    await kit.fresh();
    const kb = await kit.anonPage();
    const focusProblems = [];
    async function focusedTid() {
      return kb.evaluate(() => (document.activeElement ? document.activeElement.getAttribute('data-testid') : null));
    }
    async function tabTo(testId, max = 60) {
      for (let i = 0; i < max; i++) {
        if ((await focusedTid()) === testId) break;
        await kb.keyboard.press('Tab');
      }
      const got = await focusedTid();
      expect(got, `คีย์บอร์ด: expected focus on ${testId}, received ${got}`).toBe(testId);
      const ring = await kb.evaluate(() => {
        const el = document.activeElement;
        if (!el) return { ok: false };
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
        const shadow = s.boxShadow && s.boxShadow !== 'none';
        return { ok: outline || shadow, visible: r.width > 0 && r.height > 0, outline: `${s.outlineStyle} ${s.outlineWidth}`, shadow: s.boxShadow };
      });
      if (ring.visible && !ring.ok) focusProblems.push(`${testId}: expected visible focus ring, received outline=${ring.outline} box-shadow=${ring.shadow}`);
    }
    await gotoStatus(kb, '/login', 200, 'คีย์บอร์ด /login');
    await tabTo('thaid-id-input');
    await kb.keyboard.type(ID.somchai);
    await kb.keyboard.press('Enter');
    await expect(tid(kb, 'otp-input'), 'คีย์บอร์ด otp-input: expected visible').toBeVisible();
    await tabTo('otp-input');
    await kb.keyboard.type('123456');
    await kb.keyboard.press('Enter');
    await expect(kb, 'คีย์บอร์ด: expected /citizen').toHaveURL(/\/citizen$/);
    await tabTo('start-service-SV-01');
    await kb.keyboard.press('Enter');
    await expect(kb, 'คีย์บอร์ด: expected /citizen/new/SV-01').toHaveURL(/\/citizen\/new\/SV-01/);
    await tabTo('qty-input');
    await kb.keyboard.press('Control+A');
    await kb.keyboard.type('1');
    await tabTo('to-upload-btn');
    await kb.keyboard.press('Enter');
    await tabTo('upload-input-id-card');
    await tid(kb, 'upload-input-id-card').setInputFiles(inputFile('id-card.pdf'));
    await expect(kb.locator('[data-testid="file-item"][data-doc-key="id-card"]'), 'คีย์บอร์ด file-item id-card').toHaveCount(1);
    await tabTo('to-payment-btn');
    await kb.keyboard.press('Enter');
    await expect(tid(kb, 'create-qr-btn'), 'คีย์บอร์ด: expected create-qr-btn visible').toBeVisible();

    expect(axeProblems, `axe serious/critical: expected 0, received ${axeProblems.length}`).toEqual([]);
    expect(labelProblems, `ช่องกรอกไม่มีชื่อที่เข้าถึงได้: expected 0, received ${labelProblems.length}`).toEqual([]);
    expect(statusProblems, `สถานะ/ระดับไม่มีข้อความตรงตาราง: expected 0, received ${statusProblems.length}`).toEqual([]);
    expect(focusProblems, `focus ring: expected all visible, received ${focusProblems.length} problem(s)`).toEqual([]);
  });

  test('TC-NFR-03 · Health เวลาโหลด และผลซ้ำได้', async ({ kit }) => {
    const h = await kit.anon();

    // health
    const hr = await h.get('/api/health');
    await expectHttp(hr, 200, 'GET /api/health');
    const hj = JSON.parse(await hr.text());
    expect(hj, `/api/health: expected {"status":"ok"}, received ${JSON.stringify(hj)}`).toEqual({ status: 'ok' });

    // เวลาโหลด (รอบ 2)
    const somchai = await kit.loginC(ID.somchai);
    const reg1 = await kit.loginS('off.reg1');
    const exec = await kit.loginS('exec1');
    const aud = await kit.loginS('audit1');
    const slow = [];
    for (const [api, url] of [[null, '/login'], [somchai, '/citizen'], [reg1, '/officer/queue'], [exec, '/dashboard'], [aud, '/audit']]) {
      const page = api ? await kit.pageFor(api) : await kit.anonPage();
      await page.goto(url, { waitUntil: 'load' });
      const t = Date.now();
      const res = await page.goto(url, { waitUntil: 'load' });
      const ms = Date.now() - t;
      if (!res || res.status() !== 200) slow.push(`${url}: expected HTTP 200, received ${res ? res.status() : 'none'}`);
      if (ms > 3000) slow.push(`${url}: expected ≤ 3000 ms, received ${ms} ms`);
    }
    expect(slow, `เวลาโหลด: expected all ≤ 3000 ms, received ${JSON.stringify(slow)}`).toEqual([]);

    // ผลซ้ำได้
    async function snapshot() {
      const ck = await okJson(await h.get('/api/test/clock'), 'GET /api/test/clock');
      const r = await kit.loginS('off.reg1');
      const e = await kit.loginS('exec1');
      const q = await okJson(await r.get('/api/officer/queue?filter=all'), 'GET queue');
      const d = await okJson(await e.get('/api/dashboard?period=2026-12&service=ALL'), 'GET dashboard');
      return {
        clock: ck.now,
        queue: (q.items || []).map((x) => ({ caseNo: x.caseNo, dueAt: x.dueAt, status: x.status, owner: x.owner })),
        dashboard: d,
        api: r,
      };
    }
    await kit.fresh();
    const s1 = await snapshot();
    await kit.clock('2026-12-10T12:00:00+07:00');
    await okJson(await s1.api.post(`/api/officer/cases/${C(28)}/claim`), 'claim …000028');
    await newPaid(kit, { serviceId: 'SV-01', qty: 1 });
    await kit.reset();
    const s2 = await snapshot();
    delete s1.api;
    delete s2.api;
    expect(s2.clock, `clock หลัง RESET: expected ${T0}, received ${s2.clock}`).toBe(T0);
    expect(s2, 'S2 หลัง RESET: expected เท่ากับ S1 ทุกค่า').toEqual(s1);

    // นาฬิกา ISO ไม่มี offset
    await expectApiError(await h.put('/api/test/clock', { data: { now: '2026-12-01 09:00' } }), 400, 'INVALID_TIME', 'PUT clock ไม่มี offset');

    // ปิด hook (ถ้ามีเว็บอีกตัวที่ไม่ตั้ง TEST_MODE)
    const off = process.env.BASE_URL_NO_TEST_MODE;
    if (off) {
      const api = await kit.newApi();
      const r = await api.post(`${off.replace(/\/+$/, '')}/api/test/reset`);
      expect(r.status(), `TEST_MODE ปิด: expected 404, received ${r.status()}`).toBe(404);
    } else {
      test.info().annotations.push({ type: 'skip-step', description: 'ไม่ได้ตั้ง BASE_URL_NO_TEST_MODE จึงไม่ตรวจว่า /api/test/reset ตอบ 404 เมื่อปิด TEST_MODE' });
    }
  });

  test.describe('inspection', () => {
    const dbPath = process.env.DB_PATH;
    test.skip(!dbPath, 'ไม่ได้ตั้ง DB_PATH (CONTRACT 0.11) จึงตรวจไฟล์ฐานข้อมูลแบบ inspection ไม่ได้');

    test('TC-NFR-04 · เข้ารหัสข้อมูลส่วนบุคคลที่เก็บ (inspection)', async ({ kit }) => {
      test.skip(!dbPath || !fs.existsSync(dbPath), `ไม่พบไฟล์ DB_PATH=${dbPath} บนเครื่องที่รัน test (เช่น ฐานข้อมูลอยู่ในคอนเทนเนอร์)`);

      // log ของเว็บ (การ์ด: "ค้นใน … และ log ของเว็บ") · WEB_LOG_PATH = ไฟล์ที่เก็บ stdout ของเว็บ
      // run-bugs.sh: docker → `docker compose logs -f web` ลง e2e/results/web.log · local → data/p14/server.log · ทั้งคู่เปิด LOG_REQUESTS=1
      const logPath = process.env.WEB_LOG_PATH || '';
      const REGISTER_LINE = /POST \/api\/auth\/register 201\b/g;
      const readLog = () => (fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '');
      const registerLines = () => (readLog().match(REGISTER_LINE) || []).length;
      const registerBefore = logPath ? registerLines() : 0;

      // มานะลงทะเบียน (เบอร์ 0845678901)
      const mana = await kit.loginC(ID.mana, { expectRegistered: false });
      await expectHttp(await mana.post('/api/auth/register', { data: { mobile: '0845678901', email: '', consent: true } }), 201, 'มานะ register');

      const files = [dbPath, `${dbPath}-wal`, `${dbPath}-journal`, `${dbPath}-shm`].filter((p) => fs.existsSync(p));
      const found = [];
      for (const f of files) found.push(...needleFindings(fs.readFileSync(f), NFR04_NEEDLES, f));
      expect(found, `DB inspection: expected 0 plaintext PII in ${JSON.stringify(files)}, received ${JSON.stringify(found)}`).toEqual([]);

      if (logPath) {
        // ตัวควบคุมบวกของ log: (1) เป็น log ของเว็บโหมดทดสอบจริง (2) เก็บต่อเนื่องจนครอบคำขอลงทะเบียนของมานะที่เพิ่งทำ
        expect(fs.existsSync(logPath), `web log: expected file WEB_LOG_PATH=${logPath}`).toBe(true);
        expect(readLog(), `web log ${logPath}: expected startup line "listening on … TEST_MODE=1"`).toMatch(/listening on :\d+ · TEST_MODE=1/);
        await expect
          .poll(registerLines, {
            message: `web log ${logPath}: expected a new "POST /api/auth/register 201" line after มานะ register (before=${registerBefore} · ต้องเปิด LOG_REQUESTS=1)`,
            timeout: 15_000,
          })
          .toBeGreaterThan(registerBefore);
        const logBuf = fs.readFileSync(logPath);
        const inLog = needleFindings(logBuf, NFR04_NEEDLES, logPath);
        expect(inLog, `web log inspection: expected 0 plaintext PII in ${logPath} (${logBuf.length} bytes), received ${JSON.stringify(inLog)}`).toEqual([]);
        // หลักฐานในผลรัน (JSON reporter ของ 1.49 ไม่เก็บ annotation ที่เพิ่มตอนรัน → พิมพ์ลง stdout)
        const note = `[TC-NFR-04] web log ${logPath}: ${logBuf.length} bytes · ${logBuf.toString('utf8').split('\n').length} lines · register lines ${registerBefore} → ${registerLines()} · PII found 0 · DB files ${files.length}`;
        console.log(note);
        test.info().annotations.push({ type: 'web-log', description: note });
      } else {
        const note = '[TC-NFR-04] ไม่ได้ตั้ง WEB_LOG_PATH จึงไม่ได้ตรวจ log ของเว็บ (ตรวจเฉพาะไฟล์ฐานข้อมูล)';
        console.log(note);
        test.info().annotations.push({ type: 'skip-step', description: note });
      }

      // ตัวควบคุมบวก: ถอดรหัสได้ถูกต้อง
      const somchai = await kit.loginC(ID.somchai);
      const j = await okJson(await somchai.get(`/api/cases/${C(5)}`), 'สมชาย GET …000005');
      expect(j.idNo, `idNo: expected ${ID.somchai}, received ${j.idNo}`).toBe(ID.somchai);
    });
  });
});

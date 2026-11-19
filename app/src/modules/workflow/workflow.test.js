'use strict';
// P08 · FR-14 FR-15 FR-16 FR-29 · BR-19 BR-21 BR-29 · B07 B12 — ทดสอบผ่าน HTTP บน server ชั่วคราว (seed จริง · TEST_MODE)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const nodeCrypto = require('crypto');
const wf = require('./index');

// ---------------------------------------------------------------------------
// helper บริสุทธิ์
// ---------------------------------------------------------------------------
test('BR-19 · A-44 เหตุผล ≥ 10 ตัวอักษรหลัง trim', () => {
  assert.equal(wf.reasonOk('xxxxxxxxx'), false); // 9
  assert.equal(wf.reasonOk('xxxxxxxxxx'), true); // 10
  assert.equal(wf.reasonOk('          '), false); // เว้นวรรค 10
  assert.equal(wf.reasonOk('  xxxxxxxxx  '), false); // 9 หลัง trim
  assert.equal(wf.reasonOk('  xxxxxxxxxx  '), true);
  assert.equal(wf.reasonOk(undefined), false);
  assert.equal(wf.reasonOk(1234567890), false);
});

test('A-40 ป้ายขั้นตอน SV-03 · บริการอื่นไม่มี', () => {
  assert.equal(wf.stepText({ step: 1 }), 'ขั้นตอน 1/3 · ฝ่ายทะเบียน');
  assert.equal(wf.stepText({ step: 2 }), 'ขั้นตอน 2/3 · ฝ่ายโยธา');
  assert.equal(wf.stepText({ step: 3 }), 'ขั้นตอน 3/3 · หัวหน้าฝ่าย');
  assert.equal(wf.stepText({ step: null }), null);
});

test('FR-15 ขั้นถัดไปตามเส้นทาง · BR-29 แผนกที่เคยผ่าน', () => {
  const R3 = ['registry', 'works', 'head'];
  const R2 = ['registry', 'head'];
  assert.deepEqual(wf.nextStage({ step: 1, dept: 'registry' }, R3), { index: 1, dept: 'works' });
  assert.deepEqual(wf.nextStage({ step: 2, dept: 'works' }, R3), { index: 2, dept: 'head' });
  assert.deepEqual(wf.nextStage({ step: null, dept: 'registry' }, R2), { index: 1, dept: 'head' });
  assert.equal(wf.nextStage({ step: null, dept: 'registry' }, ['registry']), null);
  assert.deepEqual(wf.passedDepts({ step: 1, dept: 'registry' }, R3), ['registry']);
  assert.deepEqual(wf.passedDepts({ step: 2, dept: 'works' }, R3), ['registry', 'works']);
  assert.deepEqual(wf.passedDepts({ step: 3, dept: 'head' }, R3), R3);
  assert.deepEqual(wf.passedDepts({ step: null, dept: 'head' }, R2), R2);
  assert.deepEqual(wf.passedDepts({ step: null, dept: null }, ['registry']), ['registry']);
});

test('Content-Disposition รองรับชื่อไทย', () => {
  const v = wf.contentDisposition('inline', 'บัตร.pdf');
  assert.match(v, /^inline; filename="__+\.pdf"; filename\*=UTF-8''/);
});

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'egov-wf-'));
const modDir = path.join(tmp, 'modules');
for (const m of ['workflow', 'documents']) {
  fs.mkdirSync(path.join(modDir, m), { recursive: true });
  fs.writeFileSync(path.join(modDir, m, 'index.js'), `module.exports = require(${JSON.stringify(path.join(__dirname, '..', m, 'index.js'))});`);
}

let srv;
let ctx;
let base;

test.before(async () => {
  const { createServer } = require('../../server');
  const r = await createServer({ env: { DB_PATH: path.join(tmp, 'app.db'), TEST_MODE: '1' }, modulesDir: modDir, log: () => {} });
  ctx = r.ctx;
  assert.deepEqual(ctx.modules.map((m) => m.folder).sort(), ['documents', 'workflow']);
  srv = r.app.listen(0);
  await new Promise((ok) => srv.once('listening', ok));
  base = `http://127.0.0.1:${srv.address().port}`;
});

test.after(() => {
  if (srv) srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const C = (n) => `EG-2569-${String(n).padStart(6, '0')}`;
const USERS = { somchai: 'cit-0001', somying: 'cit-0002' };

function login(name) {
  const username = USERS[name] || name;
  const u = ctx.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  assert.ok(u, `user ${username}`);
  const sid = nodeCrypto.randomBytes(16).toString('hex');
  ctx.db
    .prepare('INSERT INTO sessions(sid, user_id, role, dept, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sid, u.id, u.role, u.dept, 'full', ctx.clock.nowIso());
  return `eg_sid=${sid}`;
}

async function call(cookie, method, url, body) {
  const headers = { Accept: 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, headers: res.headers };
}
const post = (cookie, url, body) => call(cookie, 'POST', url, body);
const get = (cookie, url) => call(cookie, 'GET', url);
const page = async (cookie, url) => {
  const r = await get(cookie, url);
  return { status: r.status, html: Buffer.isBuffer(r.data) ? r.data.toString('utf8') : JSON.stringify(r.data) };
};
const row = (n) => ctx.db.prepare('SELECT * FROM cases WHERE case_no = ?').get(C(n));
const audits = (event) => ctx.db.prepare('SELECT * FROM audit WHERE event = ? ORDER BY id').all(event);
const count = (html, testid) => (html.match(new RegExp(`data-testid="${testid}"`, 'g')) || []).length;

async function fresh() {
  ctx.bugs.set('');
  await ctx.reset();
}

test('TC-WORKFLOW-01 SV-01: ผู้ถือเรื่องอนุมัติ · คนอื่น 403 · หัวหน้า 403', async () => {
  await fresh();
  const reg2 = login('off.reg2');
  const p = await page(reg2, `/officer/cases/${C(25)}`);
  assert.equal(p.status, 200);
  for (const [tid, n] of [['approve-btn', 1], ['return-btn', 1], ['reject-btn', 1], ['forward-btn', 0], ['issue-btn', 0], ['case-step', 0], ['claim-btn', 0]]) {
    assert.equal(count(p.html, tid), n, tid);
  }
  assert.match(p.html, /data-testid="case-fee">฿60</);
  assert.match(p.html, /data-testid="case-owner">off\.reg2</);
  assert.match(p.html, /data-testid="applicant-id">X-XXXX-XXXXX-65-9</);
  assert.ok(!p.html.includes('3100600987659') && !p.html.includes('3-1006-00987-65-9'), 'ไม่มีเลขบัตรเต็มในหน้า');

  const reg1 = login('off.reg1');
  let r = await post(reg1, `/api/cases/${C(26)}/approve`);
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'FORBIDDEN');
  const head = login('head1');
  r = await post(head, `/api/cases/${C(25)}/approve`);
  assert.equal(r.status, 403, 'หัวหน้าไม่อนุมัติแทน SV-01');

  r = await post(reg2, `/api/cases/${C(25)}/approve`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { status: 'APPROVED' });
  const c = row(25);
  assert.equal(c.status, 'APPROVED');
  assert.equal(c.approved_by, 'off.reg2');
  assert.equal(c.owner, null);
  assert.equal(c.dept, 'registry');
  const p2 = await page(reg2, `/officer/cases/${C(25)}`);
  assert.equal(count(p2.html, 'approve-btn'), 0);
  assert.equal(count(p2.html, 'issue-btn'), 1, 'ผู้อนุมัติ SV-01 ออกเอกสารได้ (P09 canIssue)');
  r = await post(reg2, `/api/cases/${C(25)}/approve`);
  assert.equal(r.status, 409, 'อนุมัติซ้ำ → INVALID_STATE');
  const a = audits('APPROVE');
  assert.equal(a.length, 1);
  assert.equal(a[0].username, 'off.reg2');
  assert.equal(a[0].from_status, 'IN_REVIEW');
  assert.equal(a[0].to_status, 'APPROVED');
});

test('TC-WORKFLOW-02 / TC-RBAC-02 SV-02 ผ่านหัวหน้า · เจ้าหน้าที่อนุมัติไม่ได้ (B07 ปิด)', async () => {
  await fresh();
  const reg2 = login('off.reg2');
  let p = await page(reg2, `/officer/cases/${C(13)}`);
  assert.equal(count(p.html, 'approve-btn'), 0);
  assert.equal(count(p.html, 'reject-btn'), 0);
  assert.equal(count(p.html, 'forward-btn'), 1);
  assert.equal(count(p.html, 'forward-note'), 1);
  assert.equal(count(p.html, 'forward-target'), 0);

  let r = await post(reg2, `/api/cases/${C(14)}/approve`);
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'FORBIDDEN');
  assert.equal(row(14).status, 'PENDING_APPROVAL');
  r = await post(reg2, `/api/cases/${C(13)}/approve`);
  assert.equal(r.status, 403);
  assert.equal(row(13).status, 'IN_REVIEW');
  r = await post(reg2, `/api/cases/${C(14)}/reject`, { reason: 'xxxxxxxxxx' });
  assert.equal(r.status, 403);

  // ส่งต่อ (body พยายามเลือกปลายทาง → ถูกละเลย)
  r = await post(reg2, `/api/officer/cases/${C(13)}/forward`, { note: 'ส่งต่อให้หัวหน้าพิจารณา', to: 'works', target: 'registry' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { status: 'PENDING_APPROVAL' });
  const c = row(13);
  assert.equal(c.dept, 'head');
  assert.equal(c.owner, null);
  assert.equal(c.issuer, 'off.reg2');
  const f = audits('FORWARD');
  assert.equal(f.length, 1);
  assert.equal(f[0].detail, 'ส่งต่อให้หัวหน้าพิจารณา');
  assert.equal(f[0].to_status, 'PENDING_APPROVAL');

  const head = login('head1');
  const ap = await page(head, '/head/approvals');
  assert.equal(ap.status, 200);
  const order = [...ap.html.matchAll(/data-testid="approval-row" data-case-no="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, [C(13), C(14), C(11)]);
  assert.equal(count(ap.html, 'approval-open'), 3);

  p = await page(head, `/officer/cases/${C(13)}`);
  assert.equal(count(p.html, 'approve-btn'), 1);
  assert.equal(count(p.html, 'reject-btn'), 1);
  assert.equal(count(p.html, 'issue-btn'), 0);
  r = await post(head, `/api/cases/${C(13)}/approve`);
  assert.equal(r.status, 200);
  p = await page(head, `/officer/cases/${C(13)}`);
  assert.equal(count(p.html, 'issue-btn'), 0, 'หัวหน้าไม่มี issue-btn');
  const reg1 = login('off.reg1');
  p = await page(reg1, `/officer/cases/${C(13)}`);
  assert.equal(count(p.html, 'issue-btn'), 0, 'off.reg1 ไม่ใช่ผู้ออกเอกสาร');
  p = await page(reg2, `/officer/cases/${C(13)}`);
  assert.equal(count(p.html, 'issue-btn'), 1, 'off.reg2 ทะเบียนขั้นแรก');
});

test('B07: off.reg2 อนุมัติ SV-02 ผ่าน API ได้ (ปุ่มยังซ่อน)', async () => {
  await fresh();
  ctx.bugs.set(['B07']);
  try {
    const reg2 = login('off.reg2');
    const p = await page(reg2, `/officer/cases/${C(14)}`);
    assert.equal(count(p.html, 'approve-btn'), 0);
    const r = await post(reg2, `/api/cases/${C(14)}/approve`);
    assert.equal(r.status, 200);
    assert.equal(row(14).status, 'APPROVED');
    // SV-01 ยังตรวจสิทธิ์ตามปกติ
    const reg1 = login('off.reg1');
    assert.equal((await post(reg1, `/api/cases/${C(26)}/approve`)).status, 403);
  } finally {
    ctx.bugs.set('');
  }
});

test('TC-WORKFLOW-03 SV-03 ทะเบียน → โยธา → หัวหน้า', async () => {
  await fresh();
  const reg2 = login('off.reg2');
  let p = await page(reg2, `/officer/cases/${C(12)}`);
  assert.match(p.html, /data-testid="case-step">ขั้นตอน 1\/3 · ฝ่ายทะเบียน</);
  assert.match(p.html, /data-testid="case-fee">฿1,010</);
  let r = await post(reg2, `/api/officer/cases/${C(12)}/forward`, {});
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { status: 'IN_REVIEW', step: 2 });
  let c = row(12);
  assert.equal(c.dept, 'works');
  assert.equal(c.owner, null);
  p = await page(reg2, `/officer/cases/${C(12)}`);
  assert.match(p.html, /data-testid="case-step">ขั้นตอน 2\/3 · ฝ่ายโยธา</);
  assert.match(p.html, /data-testid="case-owner">ยังไม่มีผู้รับ</);
  assert.equal(count(p.html, 'forward-btn'), 0);

  const works = login('off.works1');
  p = await page(works, `/officer/cases/${C(12)}`);
  assert.equal(count(p.html, 'claim-btn'), 1, 'โยธารับเรื่องได้');
  // ส่งต่อก่อนรับเรื่อง → 403
  assert.equal((await post(works, `/api/officer/cases/${C(12)}/forward`)).status, 403);
  // รับเรื่อง (API ของ P07 ไม่อยู่ใน test นี้ → จำลองที่ DB)
  ctx.db.prepare("UPDATE cases SET owner = 'off.works1' WHERE case_no = ?").run(C(12));
  r = await post(works, `/api/officer/cases/${C(12)}/forward`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { status: 'PENDING_APPROVAL', step: 3 });
  c = row(12);
  assert.equal(c.step, 3);
  assert.equal(c.dept, 'head');
  p = await page(works, `/officer/cases/${C(12)}`);
  assert.match(p.html, /data-testid="case-step">ขั้นตอน 3\/3 · หัวหน้าฝ่าย</);

  const head = login('head1');
  assert.equal((await post(head, `/api/cases/${C(12)}/approve`)).status, 200);
  p = await page(works, `/officer/cases/${C(12)}`);
  assert.equal(count(p.html, 'issue-btn'), 0);
  p = await page(reg2, `/officer/cases/${C(12)}`);
  assert.equal(count(p.html, 'issue-btn'), 1);
  const f = audits('FORWARD');
  assert.deepEqual(f.map((x) => [x.username, x.from_status, x.to_status]), [
    ['off.reg2', 'IN_REVIEW', 'IN_REVIEW'],
    ['off.works1', 'IN_REVIEW', 'PENDING_APPROVAL'],
  ]);
});

test('TC-WORKFLOW-04 ตีกลับสูงสุด 2 ครั้ง · B12', async () => {
  await fresh();
  const reg1 = login('off.reg1');
  let p = await page(reg1, `/officer/cases/${C(23)}`);
  assert.match(p.html, /data-testid="return-count">2</);
  assert.equal(count(p.html, 'return-btn'), 0);
  assert.equal(count(p.html, 'approve-btn'), 1);
  assert.equal(count(p.html, 'reject-btn'), 1);
  let r = await post(reg1, `/api/officer/cases/${C(23)}/return`, { reason: 'xxxxxxxxxx' });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'RETURN_LIMIT');
  assert.equal(r.data.message, 'ตีกลับได้สูงสุด 2 ครั้ง');
  assert.equal(row(23).status, 'IN_REVIEW');
  assert.equal(row(23).return_count, 2);
  assert.equal(audits('RETURN').length, 0);

  ctx.bugs.set(['B12']);
  try {
    p = await page(reg1, `/officer/cases/${C(23)}`);
    assert.equal(count(p.html, 'return-btn'), 1, 'B12: return-btn ยังแสดง');
    r = await post(reg1, `/api/officer/cases/${C(23)}/return`, { reason: 'xxxxxxxxxx' });
    assert.equal(r.status, 200);
    assert.equal(r.data.status, 'NEED_FIX');
    assert.equal(r.data.returnCount, 3);
  } finally {
    ctx.bugs.set('');
  }
});

test('TC-WORKFLOW-04 C · SV-02 หลังตีกลับครบ: เจ้าหน้าที่ส่งต่อได้อย่างเดียว', async () => {
  await fresh();
  ctx.db.prepare('UPDATE cases SET return_count = 2 WHERE case_no = ?').run(C(13));
  const reg2 = login('off.reg2');
  const p = await page(reg2, `/officer/cases/${C(13)}`);
  assert.equal(count(p.html, 'return-btn'), 0);
  assert.equal(count(p.html, 'approve-btn'), 0);
  assert.equal(count(p.html, 'reject-btn'), 0);
  assert.equal(count(p.html, 'forward-btn'), 1);
  assert.equal((await post(reg2, `/api/cases/${C(13)}/reject`, { reason: 'xxxxxxxxxx' })).status, 403);
});

test('TC-WORKFLOW-05 เหตุผล 9 ✗ · เว้นวรรค 10 ✗ · 10 ✓ (ตีกลับ / ไม่อนุมัติ)', async () => {
  await fresh();
  const reg1 = login('off.reg1');
  for (const reason of ['xxxxxxxxx', '          ', undefined]) {
    const r = await post(reg1, `/api/officer/cases/${C(20)}/return`, reason === undefined ? {} : { reason });
    assert.equal(r.status, 400);
    assert.equal(r.data.code, 'REASON_TOO_SHORT');
    assert.equal(r.data.message, 'กรุณากรอกเหตุผลอย่างน้อย 10 ตัวอักษร');
  }
  assert.equal(row(20).status, 'IN_REVIEW');
  ctx.clock.set('2026-11-27T14:00:00+07:00');
  let r = await post(reg1, `/api/officer/cases/${C(20)}/return`, { reason: '  xxxxxxxxxx  ' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { status: 'NEED_FIX', returnCount: 1, fixDeadline: '2026-12-04T14:00:00+07:00' });
  const c = row(20);
  assert.equal(c.owner, 'off.reg1', 'ผู้ถือคงเดิม');
  assert.equal(c.returned_at, '2026-11-27T14:00:00+07:00');
  assert.equal(c.fix_deadline, '2026-12-04T14:00:00+07:00');
  const ret = ctx.db.prepare('SELECT * FROM returns WHERE case_no = ?').all(C(20));
  assert.equal(ret.length, 1);
  assert.equal(ret[0].seq, 1);
  assert.equal(ret[0].reason, 'xxxxxxxxxx');
  const a = audits('RETURN');
  assert.equal(a.length, 1);
  assert.equal(a[0].detail, 'xxxxxxxxxx');
  assert.equal(a[0].from_status, 'IN_REVIEW');
  assert.equal(a[0].to_status, 'NEED_FIX');
  // ตีกลับซ้ำระหว่าง NEED_FIX → 409 INVALID_STATE
  assert.equal((await post(reg1, `/api/officer/cases/${C(20)}/return`, { reason: 'xxxxxxxxxx' })).status, 409);

  // ไม่อนุมัติ SV-01 โดยผู้ถือ
  ctx.clock.set('2026-12-01T09:00:00+07:00');
  const reg2 = login('off.reg2');
  r = await post(reg2, `/api/cases/${C(26)}/reject`, { reason: 'xxxxxxxxx' });
  assert.equal(r.status, 400);
  assert.equal(r.data.code, 'REASON_TOO_SHORT');
  r = await post(reg2, `/api/cases/${C(26)}/reject`, { reason: 'xxxxxxxxxx' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { status: 'REJECTED', closedAt: '2026-12-01T09:00:00+07:00' });
  const p = await page(reg2, `/officer/cases/${C(26)}`);
  assert.match(p.html, /data-testid="closed-at" data-iso="2026-12-01T09:00:00\+07:00"/);
  assert.match(p.html, /data-testid="sla-level" data-level="closed"/);
  const rj = audits('REJECT');
  assert.equal(rj.length, 1);
  assert.equal(rj[0].detail, 'xxxxxxxxxx');

  // หัวหน้าไม่อนุมัติ SV-03 ที่ PENDING_APPROVAL
  const head = login('head1');
  r = await post(head, `/api/cases/${C(11)}/reject`, { reason: 'xxxxxxxxx' });
  assert.equal(r.status, 400);
  r = await post(head, `/api/cases/${C(11)}/reject`, { reason: 'xxxxxxxxxx' });
  assert.equal(r.status, 200);
  assert.equal(row(11).status, 'REJECTED');
  assert.equal(row(11).dept, null);
});

test('สิทธิ์ return/forward: แผนกอื่น/หัวหน้า/บทบาทอื่น 403 · ไม่ล็อกอิน 401', async () => {
  await fresh();
  const anon = await post(null, `/api/officer/cases/${C(25)}/return`, { reason: 'xxxxxxxxxx' });
  assert.equal(anon.status, 401);
  for (const who of ['off.reg1', 'off.works1', 'head1', 'exec1', 'audit1', 'admin1', 'somying']) {
    const ck = login(who);
    assert.equal((await post(ck, `/api/officer/cases/${C(25)}/return`, { reason: 'xxxxxxxxxx' })).status, 403, `${who} return`);
    assert.equal((await post(ck, `/api/officer/cases/${C(25)}/forward`)).status, 403, `${who} forward`);
  }
  for (const who of ['exec1', 'audit1', 'admin1', 'somying']) {
    assert.equal((await post(login(who), `/api/cases/${C(14)}/approve`)).status, 403, `${who} approve`);
  }
  assert.equal((await post(login('off.reg2'), `/api/officer/cases/${C(25)}/forward`)).status, 409, 'SV-01 ไม่มีขั้นถัดไป');
  assert.equal((await post(login('off.reg2'), `/api/officer/cases/EG-2569-999999/return`, { reason: 'xxxxxxxxxx' })).status, 404);
  assert.equal(row(25).status, 'IN_REVIEW');
});

test('TC-RBAC-05 สิทธิ์ไฟล์แนบ (BR-29)', async () => {
  await fresh();
  const who = {};
  for (const u of ['off.reg1', 'off.reg2', 'off.works1', 'head1', 'exec1', 'audit1', 'admin1', 'somying', 'somchai']) who[u] = login(u);
  const fileOf = (n) => ctx.db.prepare('SELECT id FROM files WHERE case_no = ? ORDER BY id LIMIT 1').get(C(n)).id;
  const matrix = [
    ['off.reg1', 25, 200, ['id-card.pdf']],
    ['off.works1', 25, 403],
    ['off.reg2', 12, 200, ['deed.pdf', 'id-card.pdf', 'plan.pdf']],
    ['off.works1', 12, 403],
    ['off.works1', 10, 200, ['deed.pdf', 'id-card.pdf', 'plan.pdf']],
    ['off.reg1', 10, 200],
    ['off.works1', 11, 200],
    ['head1', 25, 200],
    ['head1', 10, 200],
    ['head1', 12, 200],
    ['somying', 25, 200, ['id-card.pdf']],
    ['somchai', 25, 404],
    ['exec1', 25, 403],
    ['audit1', 25, 403],
    ['admin1', 25, 403],
    [null, 25, 401],
  ];
  for (const [u, n, st, names] of matrix) {
    const ck = u ? who[u] : null;
    const l = await get(ck, `/api/cases/${C(n)}/files`);
    assert.equal(l.status, st, `${u} files ${n}`);
    if (names) assert.deepEqual(l.data.items.map((x) => x.name).sort(), names);
    if (st === 200) assert.ok(l.data.items.every((x) => x.fileId && x.docKey && x.size > 0));
    const f = await get(ck, `/api/files/${fileOf(n)}`);
    assert.equal(f.status, st, `${u} file ${n}`);
    if (st === 200) {
      assert.match(f.headers.get('content-type'), /application\/pdf/);
      assert.equal(f.data.subarray(0, 4).toString('latin1'), '%PDF');
    }
  }
  assert.equal((await get(who['off.reg1'], '/api/files/no-such-file-000000')).status, 404);
  assert.equal((await get(who['off.reg1'], '/api/cases/EG-2569-999999/files')).status, 404);

  // UI doc-item
  let p = await page(who['off.reg1'], `/officer/cases/${C(25)}`);
  assert.equal(count(p.html, 'doc-item'), 1);
  assert.match(p.html, /data-testid="doc-item" data-name="id-card\.pdf" data-file-id="F-\d+"/);
  assert.equal(count(p.html, 'doc-download-link'), 1);
  p = await page(who['off.reg2'], `/officer/cases/${C(12)}`);
  assert.equal(count(p.html, 'doc-item'), 3);
  p = await page(who['off.works1'], `/officer/cases/${C(25)}`);
  assert.equal(p.status, 200);
  assert.equal(count(p.html, 'doc-item'), 0, 'นอกขอบเขต: ไม่แสดงไฟล์');
});

test('หน้า: 404 · สิทธิ์เข้าหน้า · /head/approvals เฉพาะ head', async () => {
  await fresh();
  const reg1 = login('off.reg1');
  let p = await page(reg1, '/officer/cases/EG-2569-999999');
  assert.equal(p.status, 404);
  assert.match(p.html, /data-testid="not-found-msg">ไม่พบคำขอ</);
  for (const u of ['somchai', 'exec1', 'audit1', 'admin1']) {
    p = await page(login(u), `/officer/cases/${C(25)}`);
    assert.equal(p.status, 403, `${u} /officer/cases`);
  }
  for (const u of ['somchai', 'off.reg1', 'exec1', 'audit1', 'admin1']) {
    p = await page(login(u), '/head/approvals');
    assert.equal(p.status, 403, `${u} /head/approvals`);
  }
  const anon = await get(null, '/head/approvals');
  assert.equal(anon.status, 302);
  const head = login('head1');
  p = await page(head, '/head/approvals');
  const order = [...p.html.matchAll(/data-testid="approval-row" data-case-no="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, [C(14), C(11)]);
  assert.match(p.html, /data-testid="row-due" data-iso="2026-12-04T16:30:00\+07:00"/);
  assert.match(p.html, /href="\/officer\/cases\/EG-2569-000014">เปิดคำขอ</);
  // timeline-item มี data-iso
  p = await page(head, `/officer/cases/${C(23)}`);
  assert.ok(count(p.html, 'timeline-item') >= 3);
  assert.match(p.html, /data-testid="timeline-item" data-iso="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00"/);
  assert.equal(count(p.html, 'show-full-id-btn'), 1);
  assert.equal(count(p.html, 'full-id'), 0);
  assert.equal(count(p.html, 'action-error'), 1);
});

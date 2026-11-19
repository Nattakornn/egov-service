'use strict';
// REVIEW-P14 M1: scripts/pw-summary.js ต้องไม่นับ TC ที่ skipped ว่าผ่าน
// RESULT: MATCH ต้องมีครบ 51 TC (ไม่ซ้ำ) · skipped = 0 · ทุก --expect ล้ม · ที่ล้มอยู่ใน --expect ∪ --allow
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'pw-summary.js');
const IDS = Array.from({ length: 51 }, (_, i) => `TC-X-${String(i + 1).padStart(2, '0')}`);

/** Playwright JSON แบบย่อ · statuses = {id: status} (ไม่ระบุ = passed) */
function run(statuses, args = [], ids = IDS) {
  const report = {
    suites: [{
      title: 'x.spec.js',
      specs: ids.map((id) => ({
        title: `${id} · ชื่อ`,
        tests: [{ results: [{ status: statuses[id] || 'passed', duration: 1, errors: statuses[id] === 'failed' ? [{ message: 'Error: boom' }] : [] }] }],
      })),
      suites: [],
    }],
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-summary-'));
  const file = path.join(dir, 'r.json');
  fs.writeFileSync(file, JSON.stringify(report));
  const r = spawnSync(process.execPath, [SCRIPT, file, ...args], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: r.status, out: r.stdout + r.stderr };
}

test('51 passed → MATCH', () => {
  const r = run({});
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /total=51 unique=51 passed=51 failed=0 skipped=0/);
  assert.match(r.out, /RESULT: MATCH/);
});

test('รอบปกติมี 1 TC skipped → MISMATCH (skip ไม่นับว่าผ่าน)', () => {
  const r = run({ 'TC-X-51': 'skipped' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /passed=50 failed=0 skipped=1/);
  assert.match(r.out, /SKIP TC-X-51/);
  assert.match(r.out, /RESULT: MISMATCH/);
});

test('รอบเปิดบั๊ก: TC ที่ต้องล้มถูก skip → MISMATCH (ไม่ใช่ "ล้มตามคาด")', () => {
  const r = run({ 'TC-X-01': 'skipped' }, ['--expect', 'TC-X-01']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /should-fail-but-passed=\[TC-X-01\]/);
  assert.match(r.out, /RESULT: MISMATCH/);
});

test('รอบเปิดบั๊กถูกต้อง: ต้องล้ม + อาจล้ม → MATCH · ล้มเกิน → MISMATCH', () => {
  assert.equal(run({ 'TC-X-01': 'failed', 'TC-X-02': 'failed' }, ['--expect', 'TC-X-01', '--allow', 'TC-X-02']).code, 0);
  assert.equal(run({ 'TC-X-01': 'failed', 'TC-X-03': 'failed' }, ['--expect', 'TC-X-01', '--allow', 'TC-X-02']).code, 1);
  assert.equal(run({ 'TC-X-01': 'timedOut' }, ['--expect', 'TC-X-01']).code, 0, 'timedOut นับเป็นล้ม');
});

test('จำนวน TC ไม่ครบ 51 หรือมีรหัสซ้ำ → MISMATCH', () => {
  assert.equal(run({}, [], IDS.slice(0, 50)).code, 1);
  assert.equal(run({}, [], [...IDS.slice(0, 50), 'TC-X-01']).code, 1);
});

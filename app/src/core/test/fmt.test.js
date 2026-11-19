'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fmt = require('../fmt');
const time = require('../time');
const { createClock } = require('../clock');
const { parseBugMode, createBugs } = require('../bugs');

test('fmt.money: ฿ + คั่นหลักพัน · ค่าว่าง → –', () => {
  assert.equal(fmt.money(1010), '฿1,010');
  assert.equal(fmt.money(20), '฿20');
  assert.equal(fmt.money(100000), '฿100,000');
  assert.equal(fmt.money(0), '฿0');
  assert.equal(fmt.money(null), '–');
  assert.equal(fmt.money(NaN), '–');
});

test('fmt.dateTime / date: พ.ศ. ย่อ เวลาไทย', () => {
  assert.equal(fmt.dateTime('2026-12-04T16:30:00+07:00'), '4 ธ.ค. 2569 16:30');
  assert.equal(fmt.dateTime('2026-12-04T09:30:00Z'), '4 ธ.ค. 2569 16:30');
  assert.equal(fmt.dateTime('2026-12-01T09:15:00+07:00'), '1 ธ.ค. 2569 09:15');
  assert.equal(fmt.date('2027-02-02'), '2 ก.พ. 2570');
  assert.equal(fmt.date('2026-11-05T10:00:00+07:00'), '5 พ.ย. 2569');
  assert.equal(fmt.dateTime('2026-12-31T23:59:00+07:00'), '31 ธ.ค. 2569 23:59');
  assert.equal(fmt.dateTime('2026-12-31T17:00:00Z'), '1 ม.ค. 2570 00:00');
});

test('fmt.iso: ISO +07:00 ตัดมิลลิวินาที', () => {
  assert.equal(fmt.iso('2026-12-04T09:30:00.123Z'), '2026-12-04T16:30:00+07:00');
  assert.equal(fmt.iso(null), null);
  assert.equal(time.iso(time.fromParts(2026, 12, 1, 9, 0, 0)), '2026-12-01T09:00:00+07:00');
});

test('fmt.pct: 1 ตำแหน่ง · null → –', () => {
  assert.equal(fmt.pct(85.7), '85.7%');
  assert.equal(fmt.pct(100), '100.0%');
  assert.equal(fmt.pct(null), '–');
});

test('fmt.idFull / maskId (BR-24) / maskName (BR-23)', () => {
  assert.equal(fmt.idFull('1101700123456'), '1-1017-00123-45-6');
  assert.equal(fmt.idFull('3100600987659'), '3-1006-00987-65-9');
  assert.equal(fmt.maskId('1101700123456'), 'X-XXXX-XXXXX-45-6');
  assert.equal(fmt.maskId('3100600987659'), 'X-XXXX-XXXXX-65-9');
  assert.equal(fmt.maskId('5500400111221'), 'X-XXXX-XXXXX-22-1');
  assert.equal(fmt.maskId('1909900555015'), 'X-XXXX-XXXXX-01-5');
  assert.equal(fmt.maskName('สมชาย ใจดี'), 'สมชาย ใ***');
  assert.equal(fmt.maskName('สมหญิง รักไทย'), 'สมหญิง ร***');
  assert.equal(fmt.maskName('สมชาย'), 'สมชาย ***');
});

test('fmt.esc กัน HTML injection', () => {
  assert.equal(fmt.esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('time helpers: วันในสัปดาห์และบวกวัน/ชั่วโมง', () => {
  assert.equal(time.parts('2026-12-01T09:00:00+07:00').dow, 2); // อังคาร
  assert.equal(time.dowYmd('2026-12-07'), 1); // จันทร์
  assert.equal(time.addDaysYmd('2026-12-31', 1), '2027-01-01');
  assert.equal(time.iso(time.addHours('2026-11-27T14:00:00+07:00', 168)), '2026-12-04T14:00:00+07:00');
  assert.equal(time.beYear('2026-12-31T23:59:59+07:00'), 2569);
  assert.equal(time.beYear('2027-01-01T00:00:00+07:00'), 2570);
  assert.equal(time.ymd('2026-11-30T17:00:00Z'), '2026-12-01');
  assert.equal(time.iso(time.toDate('2026-12-04 16:30')), '2026-12-04T16:30:00+07:00');
});

test('time.parseIsoStrict: ต้องมี offset (INVALID_TIME)', () => {
  assert.equal(time.parseIsoStrict('2026-12-01 09:00'), null);
  assert.equal(time.parseIsoStrict('2026-12-01T09:00:00'), null);
  assert.equal(time.parseIsoStrict('hello'), null);
  assert.equal(time.parseIsoStrict('2026-02-30T09:00:00+07:00'), null);
  assert.equal(time.parseIsoStrict(123), null);
  assert.equal(time.iso(time.parseIsoStrict('2026-12-01T16:30:00+07:00')), '2026-12-01T16:30:00+07:00');
  assert.equal(time.iso(time.parseIsoStrict('2026-12-01T02:00:00Z')), '2026-12-01T09:00:00+07:00');
  assert.equal(time.iso(time.parseIsoStrict('2026-12-03T16:29:59+07:00')), '2026-12-03T16:29:59+07:00');
});

test('clock: แช่แข็ง ตั้งค่า reset', () => {
  const c = createClock({ frozen: true });
  assert.equal(c.nowIso(), '2026-12-01T09:00:00+07:00');
  assert.equal(c.set('2026-12-05T10:00:00+07:00'), '2026-12-05T10:00:00+07:00');
  assert.equal(c.nowIso(), '2026-12-05T10:00:00+07:00');
  assert.throws(() => c.set('2026-12-05 10:00'), /INVALID_TIME/);
  assert.equal(c.nowIso(), '2026-12-05T10:00:00+07:00');
  c.reset();
  assert.equal(c.nowIso(), '2026-12-01T09:00:00+07:00');
  const t1 = c.now();
  t1.setFullYear(2000);
  assert.equal(c.nowIso(), '2026-12-01T09:00:00+07:00', 'แก้ Date ที่ได้ไม่กระทบนาฬิกา');
  const real = createClock({ frozen: false });
  assert.equal(real.isFrozen(), false);
});

test('BUG_MODE parser (BUGS §1)', () => {
  assert.deepEqual(parseBugMode('B03,B07').active, ['B03', 'B07']);
  assert.deepEqual(parseBugMode(' b07 , B3,,B12;B99 ').active, ['B03', 'B07', 'B12']);
  assert.deepEqual(parseBugMode(' b07 , B3,,B12;B99 ').unknown, ['B99']);
  assert.deepEqual(parseBugMode('').active, []);
  assert.deepEqual(parseBugMode(undefined).active, []);
  const b = createBugs('B01');
  assert.equal(b.on('B01'), true);
  assert.equal(b.on('B1'), true);
  assert.equal(b.on('B02'), false);
  b.set(['B03', 'B04']);
  assert.deepEqual(b.list(), ['B03', 'B04']);
  b.set('');
  assert.deepEqual(b.list(), []);
});

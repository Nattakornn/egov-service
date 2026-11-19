/* JS กลางฝั่ง browser (vanilla) · โหลดทุกหน้าก่อนสคริปต์ของโมดูล · ใช้ผ่าน window.EG
   EG.api(method, url, body?)  → Promise<{ ok, status, data }>  (JSON · ส่ง cookie อัตโนมัติ · body เป็น FormData ได้)
   EG.showError(msg[, el]) / EG.showSuccess(msg[, el]) / EG.clearMessages()  → ใช้กล่อง data-testid="action-error"/"action-success"
   EG.money(1010) → '฿1,010' · EG.dateTime(iso) → '4 ธ.ค. 2569 16:30' · EG.date(iso) → '4 ธ.ค. 2569'
   EG.setTime(el, iso[, prefix]) → ใส่ข้อความวันที่ไทย + data-iso ให้ element
   EG.statusText / EG.levelText → ตารางข้อความไทย (CONTRACT §4)
   ห้ามคำนวณกฎธุรกิจ (ค่าธรรมเนียม/SLA) ฝั่ง browser — เรียก API เสมอเพื่อให้ BUG_MODE ฝั่งเซิร์ฟเวอร์แสดงผลบนจอ */
(function () {
  'use strict';
  var MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  var DASH = '–';
  var STATUS = {
    DRAFT: 'ร่าง', PENDING_PAYMENT: 'รอชำระเงิน', SUBMITTED: 'ส่งคำขอแล้ว', IN_REVIEW: 'กำลังตรวจสอบ',
    NEED_FIX: 'รอแก้ไขเอกสาร', PENDING_APPROVAL: 'รออนุมัติ', APPROVED: 'อนุมัติ', COMPLETED: 'เสร็จสิ้น',
    REJECTED: 'ไม่อนุมัติ', CANCELLED: 'ยกเลิก'
  };
  var LEVEL = { normal: 'ปกติ', near: 'ใกล้ครบกำหนด', overdue: 'เกินกำหนด', paused: 'หยุดนับ', closed: 'ปิดแล้ว' };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function bkk(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    var t = new Date(d.getTime() + 7 * 3600 * 1000);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: t.getUTCHours(), mi: t.getUTCMinutes() };
  }
  function dateTime(iso) {
    if (!iso) return DASH;
    var p = bkk(iso); if (!p) return DASH;
    return p.d + ' ' + MONTHS[p.m - 1] + ' ' + (p.y + 543) + ' ' + pad(p.hh) + ':' + pad(p.mi);
  }
  function date(iso) {
    if (!iso) return DASH;
    var p = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? bkk(iso + 'T00:00:00+07:00') : bkk(iso);
    if (!p) return DASH;
    return p.d + ' ' + MONTHS[p.m - 1] + ' ' + (p.y + 543);
  }
  function money(n) {
    if (n === null || n === undefined || n === '' || !isFinite(Number(n))) return DASH;
    var v = Math.round(Number(n));
    return (v < 0 ? '-฿' : '฿') + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function setTime(el, iso, prefix) {
    if (!el) return;
    el.textContent = (prefix || '') + dateTime(iso);
    if (iso) { el.setAttribute('data-iso', iso); if (el.tagName === 'TIME') el.setAttribute('datetime', iso); }
  }
  function box(testid, el) {
    if (el) return el;
    return document.querySelector('[data-testid="' + testid + '"]');
  }
  function show(testid, msg, el) {
    var b = box(testid, el);
    if (!b) { if (msg) window.alert(msg); return; }
    b.textContent = msg || '';
    if (msg) b.removeAttribute('hidden'); else b.setAttribute('hidden', '');
  }
  function showError(msg, el) { show('action-success', '', null); show('action-error', msg, el); }
  function showSuccess(msg, el) { show('action-error', '', null); show('action-success', msg, el); }
  function clearMessages() { show('action-error', ''); show('action-success', ''); }

  function api(method, url, body) {
    var opts = { method: method || 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body !== undefined && body !== null) {
      if (typeof FormData !== 'undefined' && body instanceof FormData) {
        opts.body = body;
      } else {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
    }
    return fetch(url, opts).then(function (res) {
      var ct = res.headers.get('content-type') || '';
      var p = ct.indexOf('application/json') >= 0 ? res.json().catch(function () { return null; }) : Promise.resolve(null);
      return p.then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
    }).catch(function (e) {
      return { ok: false, status: 0, data: { code: 'NETWORK', message: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' } };
    });
  }

  window.EG = {
    api: api, showError: showError, showSuccess: showSuccess, clearMessages: clearMessages,
    money: money, dateTime: dateTime, date: date, setTime: setTime,
    statusText: STATUS, levelText: LEVEL, DASH: DASH
  };
})();

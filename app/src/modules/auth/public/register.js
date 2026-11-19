/* หน้า /register (P02) · ส่ง POST /api/auth/register แล้วแสดงข้อความจากเซิร์ฟเวอร์ใต้ช่องที่ผิด (CONTRACT §2.3 §5) */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  var form = $('reg-form');
  var boxes = {
    INVALID_MOBILE: [$('reg-mobile-error'), $('reg-mobile')],
    CONSENT_REQUIRED: [$('reg-consent-error'), $('reg-consent')],
    email: [$('reg-email-error'), $('reg-email')]
  };
  var general = $('reg-error');
  var busy = false;
  function clear() {
    Object.keys(boxes).forEach(function (k) { boxes[k][0].hidden = true; boxes[k][1].removeAttribute('aria-invalid'); });
    general.hidden = true;
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    clear();
    EG.api('POST', '/api/auth/register', {
      mobile: $('reg-mobile').value,
      email: $('reg-email').value,
      consent: $('reg-consent').checked
    }).then(function (r) {
      if (r.ok) { location.assign((r.data && r.data.landing) || '/citizen'); return; }
      busy = false;
      var d = r.data || {};
      var msg = d.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่';
      var key = d.code === 'BAD_REQUEST' && d.field === 'email' ? 'email' : d.code;
      var b = boxes[key];
      if (b) {
        b[0].textContent = msg; b[0].hidden = false;
        b[1].setAttribute('aria-invalid', 'true'); b[1].focus();
        return;
      }
      if (r.status === 401 || r.status === 403) { location.assign('/login'); return; }
      general.textContent = msg; general.hidden = false;
    });
  });
})();

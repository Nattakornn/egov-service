/* หน้า /login (P02) · ThaiD จำลอง + SSO เจ้าหน้าที่จำลอง · ใช้ fetch ผ่าน EG.api
   ข้อความ error ใช้ message จากเซิร์ฟเวอร์ (CONTRACT §5) · ใช้คีย์บอร์ดได้ทั้งหมด (NFR-03) */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function show(el, text) {
    if (!el) return;
    if (text !== undefined) el.textContent = text;
    el.hidden = false;
  }
  function hide(el) { if (el) { el.hidden = true; } }
  function msgOf(r) { return (r && r.data && r.data.message) || 'เกิดข้อผิดพลาด กรุณาลองใหม่'; }

  // ---------- แท็บ ----------
  var tabs = [$('tab-citizen'), $('tab-staff')];
  var panels = { 'tab-citizen': $('panel-citizen'), 'tab-staff': $('panel-staff') };
  function selectTab(tab, focus) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      panels[t.id].hidden = !on;
    });
    if (focus) tab.focus();
  }
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { selectTab(t, false); });
    t.addEventListener('keydown', function (e) {
      var k = e.key;
      var j = null;
      if (k === 'ArrowRight' || k === 'ArrowDown') j = (i + 1) % tabs.length;
      else if (k === 'ArrowLeft' || k === 'ArrowUp') j = (i - 1 + tabs.length) % tabs.length;
      else if (k === 'Home') j = 0;
      else if (k === 'End') j = tabs.length - 1;
      if (j !== null) { e.preventDefault(); selectTab(tabs[j], true); }
    });
  });
  if (location.hash === '#staff') selectTab(tabs[1], false);

  // ---------- ThaiD ----------
  var idInput = $('thaid-id');
  var thaidErr = $('thaid-error');
  var otpStep = $('otp-step');
  var otpInput = $('otp');
  var otpErr = $('otp-error');
  var otpLeft = $('otp-attempts-left');
  var lockBox = $('lock-box');
  var lockUntil = $('lock-until');
  var startedId = null;
  var busy = false;

  function showLock(r) {
    hide(otpErr); hide(otpLeft);
    var until = r.data && r.data.lockedUntil;
    if (until && window.EG) EG.setTime(lockUntil, until);
    show(lockBox);
  }

  $('thaid-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    var idNo = idInput.value;
    hide(thaidErr); hide(lockBox);
    idInput.removeAttribute('aria-invalid');
    EG.api('POST', '/api/auth/thaid/start', { idNo: idNo }).then(function (r) {
      busy = false;
      if (r.ok) {
        startedId = idNo;
        hide(otpErr); hide(otpLeft);
        otpInput.value = '';
        show(otpStep);
        otpInput.focus();
        return;
      }
      hide(otpStep);
      startedId = null;
      if (r.status === 423) { showLock(r); return; }
      idInput.setAttribute('aria-invalid', 'true');
      show(thaidErr, msgOf(r));
      idInput.focus();
    });
  });

  $('otp-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy || !startedId) return;
    busy = true;
    hide(otpErr); hide(otpLeft);
    EG.api('POST', '/api/auth/thaid/verify', { idNo: startedId, otp: otpInput.value }).then(function (r) {
      if (r.ok) {
        location.assign(r.data && r.data.registered ? '/citizen' : '/register');
        return;
      }
      busy = false;
      if (r.status === 423) { showLock(r); return; }
      if (r.status === 400 && r.data && r.data.code === 'INVALID_ID') { hide(otpStep); show(thaidErr, msgOf(r)); return; }
      show(otpErr, msgOf(r));
      if (r.data && typeof r.data.attemptsLeft === 'number') show(otpLeft, 'เหลือ ' + r.data.attemptsLeft + ' ครั้ง');
      otpInput.select();
      otpInput.focus();
    });
  });

  // ---------- SSO เจ้าหน้าที่ ----------
  var staffErr = $('staff-error');
  var staffBusy = false;
  $('staff-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (staffBusy) return;
    staffBusy = true;
    hide(staffErr);
    EG.api('POST', '/api/auth/staff/login', {
      username: $('staff-username').value,
      password: $('staff-password').value
    }).then(function (r) {
      if (r.ok && r.data && r.data.landing) { location.assign(r.data.landing); return; }
      staffBusy = false;
      show(staffErr, msgOf(r));
      $('staff-password').value = '';
      $('staff-username').focus();
    });
  });
})();

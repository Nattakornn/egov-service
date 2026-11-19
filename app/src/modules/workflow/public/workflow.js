/* P08 · หน้า /officer/cases/:caseNo (vanilla JS · ใช้ window.EG จาก /static/core/app.js)
   ทุกปุ่มเรียก API ด้วย fetch แล้วโหลดหน้าใหม่เมื่อสำเร็จ (ข้อมูลบนจอมาจากเซิร์ฟเวอร์เสมอ · BUG_MODE เห็นบนจอ)
   - claim-btn        POST /api/officer/cases/:no/claim   (P07)
   - forward-btn      POST /api/officer/cases/:no/forward {note}
   - approve-btn      POST /api/cases/:no/approve
   - return-btn       เปิดฟอร์ม → return-submit POST /api/officer/cases/:no/return {reason}
   - reject-btn       เปิดฟอร์ม → reject-submit POST /api/cases/:no/reject {reason}
   - issue-btn        POST /api/officer/cases/:no/issue   (P09)
   - show-full-id-btn เปิดฟอร์ม → unmask-submit POST /api/officer/cases/:no/unmask {reason} (P07) → full-id ในหน้านี้เท่านั้น */
(function () {
  'use strict';
  var root = document.querySelector('[data-wf-case]');
  if (!root || !window.EG) return;
  var EG = window.EG;
  var enc = root.getAttribute('data-wf-enc') || encodeURIComponent(root.getAttribute('data-wf-case'));
  var FLASH_KEY = 'wf-flash';

  function tid(id) { return document.querySelector('[data-testid="' + id + '"]'); }
  function msgOf(r, fallback) { return (r && r.data && r.data.message) || fallback || 'ทำรายการไม่สำเร็จ'; }
  function setBusy(btn, on) {
    if (!btn) return;
    btn.disabled = !!on;
    if (on) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
  }
  function fieldError(el, msg) {
    if (!el) return;
    el.textContent = msg || '';
    if (msg) el.removeAttribute('hidden'); else el.setAttribute('hidden', '');
  }
  function reloadWith(msg) {
    try { if (msg) window.sessionStorage.setItem(FLASH_KEY, msg); } catch (_) { /* ignore */ }
    window.location.reload();
  }
  function formatId(s) {
    var d = String(s || '').replace(/\D/g, '');
    if (d.length !== 13) return String(s || '');
    return d[0] + '-' + d.slice(1, 5) + '-' + d.slice(5, 10) + '-' + d.slice(10, 12) + '-' + d[12];
  }

  // ข้อความสำเร็จหลังโหลดหน้าใหม่
  try {
    var flash = window.sessionStorage.getItem(FLASH_KEY);
    if (flash) { window.sessionStorage.removeItem(FLASH_KEY); EG.showSuccess(flash); }
  } catch (_) { /* ignore */ }

  /** เรียก API แบบไม่มีฟอร์ม (claim/forward/approve/issue) */
  function simple(btn, url, body, okMsg) {
    if (!btn) return;
    btn.addEventListener('click', function () {
      EG.clearMessages();
      setBusy(btn, true);
      EG.api('POST', url, body ? body() : undefined).then(function (r) {
        if (r.ok) return reloadWith(okMsg);
        setBusy(btn, false);
        EG.showError(msgOf(r));
      });
    });
  }

  /** ปุ่มเปิด/ปิดฟอร์ม (aria-expanded) */
  function toggler(btn, form, input) {
    if (!btn || !form) return;
    btn.addEventListener('click', function () {
      var open = form.hasAttribute('hidden');
      if (open) form.removeAttribute('hidden'); else form.setAttribute('hidden', '');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && input) input.focus();
    });
  }

  /** ฟอร์มเหตุผล (ตีกลับ/ไม่อนุมัติ) · 400 → ข้อความใต้ช่อง · อื่น ๆ → action-error */
  function reasonForm(submit, input, errEl, url, okMsg) {
    if (!submit || !input) return;
    submit.addEventListener('click', function () {
      EG.clearMessages();
      fieldError(errEl, '');
      input.removeAttribute('aria-invalid');
      setBusy(submit, true);
      EG.api('POST', url, { reason: input.value }).then(function (r) {
        if (r.ok) return reloadWith(okMsg);
        setBusy(submit, false);
        if (r.status === 400) {
          fieldError(errEl, msgOf(r));
          input.setAttribute('aria-invalid', 'true');
          input.focus();
        } else {
          EG.showError(msgOf(r));
        }
      });
    });
  }

  simple(tid('claim-btn'), '/api/officer/cases/' + enc + '/claim', null, 'รับเรื่องแล้ว');
  simple(tid('forward-btn'), '/api/officer/cases/' + enc + '/forward', function () {
    var n = tid('forward-note');
    return { note: n ? n.value : '' };
  }, 'ส่งต่อแล้ว');
  simple(tid('approve-btn'), '/api/cases/' + enc + '/approve', null, 'อนุมัติแล้ว');
  simple(tid('issue-btn'), '/api/officer/cases/' + enc + '/issue', null, 'ออกเอกสารแล้ว');

  toggler(tid('return-btn'), document.getElementById('wf-return-form'), tid('return-reason'));
  reasonForm(tid('return-submit'), tid('return-reason'), tid('return-reason-error'), '/api/officer/cases/' + enc + '/return', 'ตีกลับแล้ว');

  toggler(tid('reject-btn'), document.getElementById('wf-reject-form'), tid('reject-reason'));
  reasonForm(tid('reject-submit'), tid('reject-reason'), tid('reject-reason-error'), '/api/cases/' + enc + '/reject', 'บันทึกไม่อนุมัติแล้ว');

  // แสดงเลขเต็ม (BR-24 · A-32) — เห็นเฉพาะในหน้านี้ ไม่เก็บลงหน้า/ที่เก็บใด ๆ
  var unBtn = tid('show-full-id-btn');
  var unForm = document.getElementById('wf-unmask-form');
  var unInput = tid('unmask-reason');
  var unErr = tid('unmask-error');
  var unSubmit = tid('unmask-submit');
  toggler(unBtn, unForm, unInput);
  if (unSubmit && unInput) {
    unSubmit.addEventListener('click', function () {
      EG.clearMessages();
      fieldError(unErr, '');
      unInput.removeAttribute('aria-invalid');
      setBusy(unSubmit, true);
      EG.api('POST', '/api/officer/cases/' + enc + '/unmask', { reason: unInput.value }).then(function (r) {
        setBusy(unSubmit, false);
        if (r.ok && r.data && r.data.idNo) {
          var slot = document.getElementById('wf-full-id-slot');
          var el = tid('full-id');
          if (!el) {
            el = document.createElement('strong');
            el.setAttribute('data-testid', 'full-id');
            if (slot) slot.appendChild(el);
          }
          el.textContent = formatId(r.data.idNo);
          unForm.setAttribute('hidden', '');
          if (unBtn) unBtn.setAttribute('aria-expanded', 'false');
          unInput.value = '';
          return;
        }
        if (r.status === 400) {
          fieldError(unErr, msgOf(r));
          unInput.setAttribute('aria-invalid', 'true');
          unInput.focus();
        } else {
          EG.showError(msgOf(r));
        }
      });
    });
  }
})();

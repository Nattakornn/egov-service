/* P06 · หน้า /citizen/cases/:caseNo — ยกเลิกคำขอ (confirm) และส่งแก้ไข (เรียก API แล้ว reload) */
(function () {
  'use strict';
  function $(sel) { return document.querySelector(sel); }
  function init() {
    var root = $('#case-root');
    if (!root) return;
    var caseNo = root.getAttribute('data-case-no');
    var base = '/api/cases/' + encodeURIComponent(caseNo);

    var cancelBtn = $('[data-testid="cancel-case-btn"]');
    var confirmBox = $('[data-testid="cancel-confirm"]');
    var confirmBtn = $('[data-testid="confirm-cancel-btn"]');
    var keepBtn = $('[data-testid="cancel-cancel-btn"]');
    if (cancelBtn && confirmBox) {
      cancelBtn.addEventListener('click', function () {
        confirmBox.removeAttribute('hidden');
        cancelBtn.setAttribute('aria-expanded', 'true');
        if (confirmBtn) confirmBtn.focus();
      });
    }
    if (keepBtn && confirmBox) {
      keepBtn.addEventListener('click', function () {
        confirmBox.setAttribute('hidden', '');
        cancelBtn.setAttribute('aria-expanded', 'false');
        cancelBtn.focus();
      });
    }
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () {
        confirmBtn.disabled = true;
        EG.clearMessages();
        EG.api('POST', base + '/cancel').then(function (r) {
          if (r.ok) { location.reload(); return; }
          confirmBtn.disabled = false;
          EG.showError((r.data && r.data.message) || 'ยกเลิกไม่สำเร็จ');
        });
      });
    }

    var form = $('#fix-form');
    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var btn = $('[data-testid="submit-fix-btn"]');
        var input = $('[data-testid="fix-upload-input"]');
        var body;
        if (input && input.files && input.files.length) {
          body = new FormData();
          for (var i = 0; i < input.files.length; i++) body.append('file', input.files[i]);
          body.append('docKey', 'extra');
        }
        if (btn) btn.disabled = true;
        EG.clearMessages();
        EG.api('POST', base + '/resubmit', body).then(function (r) {
          if (r.ok) { location.reload(); return; }
          if (btn) btn.disabled = false;
          EG.showError((r.data && r.data.message) || 'ส่งแก้ไขไม่สำเร็จ');
        });
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

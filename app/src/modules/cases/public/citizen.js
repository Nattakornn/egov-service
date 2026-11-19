/* P06 · หน้า /citizen — ลบร่าง (DELETE /api/drafts/:id ของ P04) */
(function () {
  'use strict';
  function init() {
    var btns = document.querySelectorAll('[data-testid="delete-draft-btn"]');
    Array.prototype.forEach.call(btns, function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-draft-id');
        if (!window.confirm('ลบร่าง ' + id + ' หรือไม่')) return;
        btn.disabled = true;
        EG.clearMessages();
        EG.api('DELETE', '/api/drafts/' + encodeURIComponent(id)).then(function (r) {
          if (r.ok) { location.reload(); return; }
          btn.disabled = false;
          EG.showError((r.data && r.data.message) || 'ลบร่างไม่สำเร็จ');
        });
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

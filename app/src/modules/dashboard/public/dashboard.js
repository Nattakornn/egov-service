/* P11 · หน้า /dashboard (vanilla JS)
   เปลี่ยน period-select / service-select → เรียก GET /api/dashboard แล้วแสดงค่า display ที่เซิร์ฟเวอร์คำนวณ
   (ห้ามคำนวณตัวชี้วัดฝั่ง browser เพื่อให้ BUG_MODE B10 แสดงบนจอ) · ลิงก์ส่งออกเปลี่ยนตามตัวกรองทันที */
(function () {
  'use strict';
  var root = document.getElementById('dashboard');
  if (!root || !window.EG) return;
  var form = document.getElementById('dash-filter');
  var pSel = document.getElementById('period-select');
  var sSel = document.getElementById('service-select');
  if (!pSel || !sSel) return;
  var KEYS = ['received', 'closed', 'ontimePct', 'backlog', 'overdue'];
  var seq = 0;

  function enc(v) { return encodeURIComponent(v); }
  function q(sel) { return root.querySelector(sel); }
  function setText(el, v) { if (el) el.textContent = v === null || v === undefined ? window.EG.DASH : String(v); }
  function selectedLabel(sel) {
    var o = sel.options[sel.selectedIndex];
    return o ? o.textContent : '';
  }

  function updateLinks(period, service) {
    var links = root.querySelectorAll('[data-export-format]');
    for (var i = 0; i < links.length; i++) {
      var f = links[i].getAttribute('data-export-format');
      links[i].setAttribute('href', '/api/dashboard/export?format=' + enc(f) + '&period=' + enc(period) + '&service=' + enc(service));
    }
  }

  function renderWorkload(list) {
    var body = document.getElementById('workload-body');
    if (!body || !list) return;
    var html = '';
    var esc = function (s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    };
    for (var i = 0; i < list.length; i++) {
      var w = list[i];
      html += '<tr data-testid="workload-row" data-username="' + esc(w.username) + '"><td>' + esc(w.name || w.username) +
        '</td><td>' + esc(w.username) + '</td><td class="num" data-testid="workload-value">' + esc(w.count) + '</td></tr>';
    }
    body.innerHTML = html;
  }

  function render(d) {
    var disp = d.display || {};
    for (var i = 0; i < KEYS.length; i++) setText(q('[data-key="' + KEYS[i] + '"]'), disp[KEYS[i]]);
    setText(q('[data-field="onTime"]'), d.onTime);
    setText(q('[data-field="closed"]'), d.closed);
    setText(q('[data-field="periodLabel"]'), d.periodLabel);
    setText(q('[data-field="serviceLabel"]'), d.serviceLabel);
    var asOf = q('[data-testid="dash-as-of"]');
    if (asOf && d.asOf) window.EG.setTime(asOf, d.asOf);
    renderWorkload(d.workload);
    root.setAttribute('data-period', d.period);
    root.setAttribute('data-service', d.service);
  }

  function refresh() {
    var period = pSel.value;
    var service = sSel.value;
    var my = ++seq;
    updateLinks(period, service);
    setText(q('[data-field="periodLabel"]'), selectedLabel(pSel));
    setText(q('[data-field="serviceLabel"]'), selectedLabel(sSel));
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', '/dashboard?period=' + enc(period) + '&service=' + enc(service));
    }
    root.setAttribute('aria-busy', 'true');
    window.EG.api('GET', '/api/dashboard?period=' + enc(period) + '&service=' + enc(service)).then(function (r) {
      if (my !== seq) return; // มีคำขอใหม่กว่าแล้ว (เปลี่ยนตัวกรองติดกัน) → ทิ้งผลเก่า
      root.removeAttribute('aria-busy');
      if (!r.ok || !r.data) {
        window.EG.showError((r.data && r.data.message) || 'โหลดข้อมูล Dashboard ไม่สำเร็จ');
        return;
      }
      window.EG.clearMessages();
      render(r.data);
    });
  }

  pSel.addEventListener('change', refresh);
  sSel.addEventListener('change', refresh);
  if (form) form.addEventListener('submit', function (e) { e.preventDefault(); refresh(); });
  // กลับมาหน้านี้ด้วยปุ่มย้อนกลับ (browser คืนค่าตัวกรองเดิม) → ให้ตัวเลขตรงกับตัวกรองที่เห็น
  window.addEventListener('pageshow', function () {
    if (pSel.value !== root.getAttribute('data-period') || sSel.value !== root.getAttribute('data-service')) refresh();
  });
})();

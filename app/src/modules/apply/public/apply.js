/* P04 · หน้า /citizen/new/:service (ฟอร์ม 3 ขั้น) · vanilla JS
 * กฎตัวเลขทั้งหมดคำนวณฝั่งเซิร์ฟเวอร์: ค่าธรรมเนียม = POST /api/drafts/fee (rules ของ P03) · ไฟล์ = POST /api/drafts/:id/files
 * ขั้น 3 เรียก API ชำระของ P05: POST /api/drafts/:id/payment · GET /api/payments/:ref */
(function () {
  'use strict';
  var EG = window.EG;
  var stateEl = document.getElementById('apply-state');
  if (!EG || !stateEl) return;
  var S = JSON.parse(stateEl.textContent || '{}');
  var svc = S.service;
  var draft = S.draft || null;
  var step = S.step || 1;
  var payment = null; // {ref, amount, status, qrCreatedAt, qrExpiresAt, caseNo, receiptNo, paidAt}
  var pollTimer = null;
  var paymentLoading = !!(S.draft && S.draft.paymentRef && S.step === 3);
  var feeSeq = 0;

  var STEP_TEXT = { 1: '1/3 กรอกข้อมูล', 2: '2/3 แนบเอกสาร', 3: '3/3 ชำระเงิน' };
  var PAY_TEXT = { PENDING: 'รอชำระ', PAID: 'ชำระแล้ว', EXPIRED: 'QR หมดอายุ' };
  var QR_EXPIRED_MSG = 'QR หมดอายุ กรุณาสร้าง QR ใหม่';

  function $(id) { return document.getElementById(id); }
  function tid(t) { return document.querySelector('[data-testid="' + t + '"]'); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function sizeText(n) {
    if (n >= 1048576) return (n / 1048576).toFixed(2) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' ไบต์';
  }
  function docName(key) {
    for (var i = 0; i < svc.docs.length; i++) if (svc.docs[i].key === key) return svc.docs[i].name;
    return key;
  }
  function errMsg(r) {
    return (r && r.data && r.data.message) || 'เกิดข้อผิดพลาด กรุณาลองใหม่';
  }

  var qtyEl = tid('qty-input');
  var areaEl = tid('area-input');
  var feeEl = $('fee-total');
  var feeErrEl = tid('fee-error');
  var toUploadBtn = $('to-upload-btn');
  var saveBtn = $('save-draft-btn');
  var toPayBtn = $('to-payment-btn');
  var uploadErr = $('upload-error');

  // ---------------------------------------------------------------- ขั้น
  function setStep(n, focus) {
    step = n;
    tid('wizard-step').textContent = STEP_TEXT[n];
    for (var i = 1; i <= 3; i++) {
      var sec = $('step-' + i);
      if (i === n) sec.removeAttribute('hidden'); else sec.setAttribute('hidden', '');
    }
    var lis = document.querySelectorAll('.apply-progress li');
    for (var j = 0; j < lis.length; j++) {
      if (String(lis[j].getAttribute('data-step')) === String(n)) lis[j].setAttribute('aria-current', 'step');
      else lis[j].removeAttribute('aria-current');
    }
    if (n === 2) renderFiles();
    if (n === 3) renderPay();
    else stopPoll();
    if (focus) {
      var h = $('step-' + n + '-title');
      if (h) h.focus();
    }
  }

  function setDraft(d) {
    draft = d;
    if (!d) return;
    $('draft-id').textContent = d.draftId;
    $('draft-box').removeAttribute('hidden');
    try {
      var u = new URL(window.location.href);
      if (u.searchParams.get('draft') !== d.draftId) {
        u.searchParams.set('draft', d.draftId);
        window.history.replaceState(null, '', u.pathname + u.search);
      }
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- ขั้น 1: ค่าธรรมเนียม (เซิร์ฟเวอร์คำนวณ)
  function feeBody() {
    var b = { serviceId: svc.id };
    if (qtyEl) b.qty = qtyEl.value.trim();
    if (areaEl) b.areaSqm = areaEl.value.trim();
    return b;
  }
  function showFee(ok, fee, message) {
    feeEl.textContent = ok ? EG.money(fee) : EG.DASH;
    if (feeErrEl) {
      feeErrEl.textContent = ok ? '' : (message || '');
      if (ok || !message) feeErrEl.setAttribute('hidden', ''); else feeErrEl.removeAttribute('hidden');
    }
    var inp = qtyEl || areaEl;
    if (inp) { if (ok) inp.removeAttribute('aria-invalid'); else inp.setAttribute('aria-invalid', 'true'); }
    toUploadBtn.disabled = !ok;
  }
  function quote() {
    var seq = ++feeSeq;
    EG.api('POST', '/api/drafts/fee', feeBody()).then(function (r) {
      if (seq !== feeSeq) return; // มีค่าที่ใหม่กว่าแล้ว
      if (r.ok && r.data) showFee(true, r.data.fee);
      else if (r.status === 400 && r.data) showFee(false, null, r.data.message);
      else EG.showError(errMsg(r));
    });
  }
  if (qtyEl) qtyEl.addEventListener('input', quote);
  if (areaEl) areaEl.addEventListener('input', quote);

  /** สร้างร่าง (ยังไม่มี) หรืออัปเดตค่าที่กรอก (มีแล้ว) → Promise<draft|null> */
  function persistDraft() {
    var body = feeBody();
    var p;
    if (draft && draft.status === 'DRAFT') {
      var upd = {};
      if (qtyEl) upd.qty = body.qty;
      if (areaEl) upd.areaSqm = body.areaSqm;
      p = EG.api('PATCH', '/api/drafts/' + encodeURIComponent(draft.draftId), upd);
    } else if (draft) {
      return Promise.resolve(draft);
    } else {
      p = EG.api('POST', '/api/drafts', body).then(function (r) {
        if (!r.ok) return r;
        return EG.api('GET', '/api/drafts/' + encodeURIComponent(r.data.draftId));
      });
    }
    return p.then(function (r) {
      if (r.ok && r.data) {
        feeSeq++;
        showFee(true, r.data.fee);
        setDraft(r.data);
        return r.data;
      }
      if (r.status === 400 && r.data && /^(INVALID_QTY|INVALID_AREA|AREA_TOO_LARGE)$/.test(r.data.code)) {
        feeSeq++;
        showFee(false, null, r.data.message);
      } else {
        EG.showError(errMsg(r));
      }
      return null;
    });
  }

  saveBtn.addEventListener('click', function () {
    EG.clearMessages();
    saveBtn.disabled = true;
    persistDraft().then(function (d) {
      saveBtn.disabled = false;
      if (d) EG.showSuccess('บันทึกร่างแล้ว รหัสร่าง ' + d.draftId);
    });
  });

  var pendingDraft = null; // Promise ของการสร้าง/บันทึกร่างที่กำลังทำ (ไฟล์ที่เลือกระหว่างนี้ต้องรอ ไม่ทิ้ง)
  toUploadBtn.addEventListener('click', function () {
    EG.clearMessages();
    var p = pendingDraft = persistDraft();
    p.then(function (d) {
      if (pendingDraft === p) pendingDraft = null;
      if (d) setStep(2, true);
    });
  });

  // ---------------------------------------------------------------- ขั้น 2: ไฟล์
  function showUploadError(msg) {
    uploadErr.textContent = msg || '';
    if (msg) uploadErr.removeAttribute('hidden'); else uploadErr.setAttribute('hidden', '');
  }

  function renderFiles() {
    var files = (draft && draft.files) || [];
    var list = $('file-list');
    var html = '';
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var href = '/api/drafts/' + encodeURIComponent(draft.draftId) + '/files/' + encodeURIComponent(f.fileId);
      html += '<li class="apply-file" data-testid="file-item" data-name="' + esc(f.name) + '" data-doc-key="' + esc(f.docKey) + '" data-file-id="' + esc(f.fileId) + '">' +
        '<span class="apply-file-info"><span class="apply-file-doc">' + esc(docName(f.docKey)) + ':</span> ' +
        '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(f.name) + '</a> <span class="muted">(' + esc(sizeText(f.size)) + ')</span></span> ' +
        (draft.status === 'DRAFT'
          ? '<button type="button" class="btn btn-small btn-danger" data-testid="file-remove-btn" data-file-id="' + esc(f.fileId) + '" aria-label="ลบไฟล์ ' + esc(f.name) + '">ลบ</button>'
          : '') +
        '</li>';
    }
    list.innerHTML = html;
    $('files-count').textContent = '(' + files.length + '/' + S.maxFiles + ')';
    var missing = (draft && draft.missing) || [];
    var box = $('missing-box');
    if (missing.length) {
      box.innerHTML = '<p class="msg msg-info" data-testid="missing-docs">' + esc('ยังขาดเอกสาร: ' + missing.join(', ')) + '</p>';
    } else {
      box.innerHTML = ''; // ครบแล้วไม่ render
    }
    toPayBtn.disabled = missing.length > 0 || !draft;
  }

  function refreshDraft() {
    if (!draft) return Promise.resolve(null);
    return EG.api('GET', '/api/drafts/' + encodeURIComponent(draft.draftId)).then(function (r) {
      if (r.ok && r.data) { setDraft(r.data); if (step === 2) renderFiles(); return r.data; }
      EG.showError(errMsg(r));
      return null;
    });
  }

  function uploadOne(file, docKey) {
    var fd = new FormData();
    fd.append('docKey', docKey);
    fd.append('file', file, file.name);
    return EG.api('POST', '/api/drafts/' + encodeURIComponent(draft.draftId) + '/files', fd);
  }

  function onFileChange(ev) {
    var input = ev.target;
    var docKey = input.getAttribute('data-doc-key');
    var files = Array.prototype.slice.call(input.files || []);
    if (!files.length) return;
    if (!draft) {
      // ร่างยังสร้างไม่เสร็จ (กด to-upload-btn แล้วเลือกไฟล์ทันที) → รอร่างก่อนแล้วอัปโหลด
      if (pendingDraft) pendingDraft.then(function (d) { if (d) onFileChange({ target: input }); });
      return;
    }
    showUploadError('');
    EG.clearMessages();
    var lastErr = '';
    var chain = Promise.resolve();
    files.forEach(function (f) {
      chain = chain.then(function () {
        return uploadOne(f, docKey).then(function (r) {
          if (!r.ok) lastErr = errMsg(r);
        });
      });
    });
    chain.then(function () {
      try { input.value = ''; } catch (e) { /* ignore */ }
      return refreshDraft();
    }).then(function () {
      showUploadError(lastErr);
    });
  }
  var inputs = document.querySelectorAll('#step-2 input[type="file"]');
  for (var k = 0; k < inputs.length; k++) inputs[k].addEventListener('change', onFileChange);

  $('file-list').addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-testid="file-remove-btn"]');
    if (!btn || !draft) return;
    var fileId = btn.getAttribute('data-file-id');
    btn.disabled = true;
    EG.api('DELETE', '/api/drafts/' + encodeURIComponent(draft.draftId) + '/files/' + encodeURIComponent(fileId)).then(function (r) {
      if (!r.ok) { btn.disabled = false; EG.showError(errMsg(r)); return; }
      showUploadError('');
      refreshDraft().then(function () {
        var next = document.querySelector('[data-testid="upload-input-id-card"]');
        if (next && document.activeElement === document.body) next.focus();
      });
    });
  });

  $('back-to-1').addEventListener('click', function () { setStep(1, true); });

  toPayBtn.addEventListener('click', function () {
    EG.clearMessages();
    refreshDraft().then(function (d) {
      if (!d) return;
      if (d.missing && d.missing.length) { renderFiles(); return; }
      setStep(3, true);
    });
  });

  // ---------------------------------------------------------------- ขั้น 3: ชำระเงิน (API ของ P05)
  function stopPoll() { if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; } }
  function schedulePoll() {
    stopPoll();
    if (step === 3 && payment && payment.status === 'PENDING') pollTimer = setTimeout(checkPayment, 5000);
  }

  function renderPay() {
    var area = $('pay-area');
    var amount = payment ? payment.amount : (draft ? draft.amount : null);
    $('payment-amount').textContent = EG.money(amount);
    var locked = draft && draft.status !== 'DRAFT';
    var back = $('back-to-2');
    if (back) back.hidden = !!(locked || payment);
    var html = '';
    if (!payment && paymentLoading) {
      area.innerHTML = '<p class="muted" role="status">กำลังโหลดสถานะการชำระเงิน…</p>';
      return;
    }
    if (!payment) {
      html = '<p>กดปุ่มเพื่อสร้าง QR PromptPay (จำลอง) แล้วสแกนชำระภายใน 15 นาที</p>' +
        '<div class="actions"><button type="button" class="btn btn-primary" data-testid="create-qr-btn" id="create-qr-btn">สร้าง QR</button></div>';
      area.innerHTML = html;
      $('create-qr-btn').addEventListener('click', createQr);
      return;
    }
    var st = payment.status || 'PENDING';
    if (st !== 'PAID') {
      var qrSrc = '/api/drafts/' + encodeURIComponent(draft.draftId) + '/qr.svg?ref=' + encodeURIComponent(payment.ref);
      html += '<div class="qr-box"><img data-testid="qr-image" src="' + esc(qrSrc) + '" width="200" height="200" alt="QR PromptPay จำลอง เลขอ้างอิง ' + esc(payment.ref) + ' ยอด ' + esc(EG.money(payment.amount)) + '"></div>';
    }
    html += '<dl class="kv">' +
      '<dt>เลขอ้างอิง</dt><dd data-testid="qr-ref">' + esc(payment.ref) + '</dd>' +
      '<dt>อายุ QR</dt><dd><time data-testid="qr-expires" id="qr-expires"></time></dd>' +
      '<dt>สถานะการชำระ</dt><dd><span class="badge pay-' + esc(st) + '" data-testid="payment-status" data-status="' + esc(st) + '">' + esc(PAY_TEXT[st] || st) + '</span></dd>' +
      '</dl>';
    if (st === 'EXPIRED') {
      html += '<p class="msg msg-error" data-testid="qr-expired-msg" role="alert">' + esc(QR_EXPIRED_MSG) + '</p>' +
        '<div class="actions"><button type="button" class="btn btn-primary" data-testid="regenerate-qr-btn" id="regenerate-qr-btn">สร้าง QR ใหม่</button></div>';
    }
    if (st === 'PENDING') {
      html += '<div class="actions"><button type="button" class="btn" data-testid="refresh-payment-btn" id="refresh-payment-btn">ตรวจสอบการชำระเงิน</button></div>';
    }
    if (st === 'PAID') {
      var caseHref = '/citizen/cases/' + encodeURIComponent(payment.caseNo || '');
      html += '<div class="card stack apply-receipt" role="status">' +
        '<p class="msg msg-ok">ชำระเงินสำเร็จ ระบบออกเลขคำขอแล้ว</p>' +
        '<dl class="kv">' +
        '<dt>เลขคำขอ</dt><dd data-testid="submitted-case-no">' + esc(payment.caseNo || '') + '</dd>' +
        '<dt>เลขใบเสร็จ</dt><dd data-testid="receipt-no">' + esc(payment.receiptNo || '') + '</dd>' +
        '<dt>ยอดในใบเสร็จ</dt><dd data-testid="receipt-amount">' + esc(EG.money(payment.amount)) + '</dd>' +
        '<dt>เวลาชำระ</dt><dd><time data-testid="receipt-paid-at" id="receipt-paid-at"></time></dd>' +
        '</dl>' +
        '<div class="actions"><a class="btn btn-primary" data-testid="go-case-btn" href="' + esc(caseHref) + '">ดูคำขอ</a></div>' +
        '</div>';
    }
    area.innerHTML = html;
    EG.setTime($('qr-expires'), payment.qrExpiresAt, 'หมดอายุ ');
    if (st === 'PAID') {
      var pa = $('receipt-paid-at');
      if (payment.paidAt) EG.setTime(pa, payment.paidAt); else pa.textContent = EG.DASH;
    }
    var regen = $('regenerate-qr-btn');
    if (regen) regen.addEventListener('click', createQr);
    var refresh = $('refresh-payment-btn');
    if (refresh) refresh.addEventListener('click', checkPayment);
    schedulePoll();
  }

  function createQr() {
    EG.clearMessages();
    var btn = $('create-qr-btn') || $('regenerate-qr-btn');
    if (btn) btn.disabled = true;
    EG.api('POST', '/api/drafts/' + encodeURIComponent(draft.draftId) + '/payment').then(function (r) {
      if (r.ok && r.data) {
        payment = {
          ref: r.data.ref, amount: r.data.amount, status: r.data.status || 'PENDING',
          qrCreatedAt: r.data.qrCreatedAt, qrExpiresAt: r.data.qrExpiresAt,
        };
        draft.status = 'PENDING_PAYMENT';
        draft.paymentRef = payment.ref;
        renderPay();
        var ref = tid('qr-ref');
        if (ref) { ref.setAttribute('tabindex', '-1'); ref.focus(); }
        return;
      }
      if (btn) btn.disabled = false;
      if (r.status === 409 && r.data && r.data.code === 'MISSING_DOCS') {
        refreshDraft().then(function () { setStep(2, true); });
        return;
      }
      EG.showError(errMsg(r));
    });
  }

  function loadPayment(ref) {
    return EG.api('GET', '/api/payments/' + encodeURIComponent(ref)).then(function (r) {
      if (!r.ok || !r.data) return { error: r };
      var p = r.data;
      var out = {
        ref: p.ref || ref, amount: p.amount, status: p.status, qrCreatedAt: p.qrCreatedAt, qrExpiresAt: p.qrExpiresAt,
        caseNo: p.caseNo || null, receiptNo: p.receiptNo || null, paidAt: p.paidAt || null,
      };
      if (out.status === 'PAID' && out.caseNo && !out.paidAt) {
        return EG.api('GET', '/api/cases/' + encodeURIComponent(out.caseNo)).then(function (c) {
          if (c.ok && c.data && c.data.paidAt) out.paidAt = c.data.paidAt;
          return { payment: out };
        });
      }
      return { payment: out };
    });
  }

  function checkPayment() {
    stopPoll();
    if (!payment) return;
    loadPayment(payment.ref).then(function (res) {
      if (res.payment) {
        payment = res.payment;
        if (payment.status === 'PAID') draft.status = 'PAID';
        renderPay();
      } else {
        EG.showError(errMsg(res.error));
        schedulePoll();
      }
    });
  }

  $('back-to-2').addEventListener('click', function () { setStep(2, true); });

  // ---------------------------------------------------------------- เริ่มต้น
  setStep(step, false);
  if (step === 3 && draft && draft.paymentRef) {
    loadPayment(draft.paymentRef).then(function (res) {
      paymentLoading = false;
      if (res.payment) payment = res.payment;
      else if (res.error && res.error.status !== 404) EG.showError(errMsg(res.error));
      renderPay(); // ไม่พบ ref → แสดงปุ่มสร้าง QR
    });
  }
})();

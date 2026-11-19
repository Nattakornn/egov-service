'use strict';
// HTML กลาง (NFR-01/02/03/10/11 · CONTRACT §2.1 §4)
//
// ctx.ui.send(req, res, { title, body, scripts, styles, status })  → ส่งหน้า HTML เต็ม (layout + body)
// ctx.ui.layout(req, { title, body, scripts, styles })             → สตริง HTML เต็ม
//   - <html lang="th"> · skip link · <header data-testid="app-header"> (เมนูตามบทบาท user-name user-role logout-btn nav-bell bell-count)
//   - <main id="main"> ใส่ body ที่โมดูลส่งมา (ควรมี <h1> 1 ตัว) · <footer>
//   - scripts: ['/static/<โมดูล>/x.js'] (โหลดแบบ defer หลัง /static/core/app.js ที่มี window.EG)
// ctx.ui.forbidden(req, res)   → HTTP 403 + <p data-testid="forbidden-msg">ไม่มีสิทธิ์เข้าถึงหน้านี้</p>
// ctx.ui.notFound(req, res)    → HTTP 404 + <p data-testid="not-found-msg">ไม่พบคำขอ</p> (ใช้ทั้งเลขไม่มีจริง/ของคนอื่น)
// ctx.ui.statusBadge('IN_REVIEW', { testid: 'case-status' })  → <span … data-status="IN_REVIEW">กำลังตรวจสอบ</span>
// ctx.ui.slaBadge('near', { testid: 'sla-level' })            → <span … data-level="near">ใกล้ครบกำหนด</span>
// ctx.ui.time(iso, { testid: 'sla-due', prefix: '', dateOnly: false })  → <time data-iso="…">4 ธ.ค. 2569 16:30</time>
// ctx.ui.money(1010, { testid: 'case-fee' }) → <span data-testid="case-fee">฿1,010</span>
// ctx.ui.messages()            → กล่อง action-error (role=alert) + action-success (role=status) ซ่อนไว้ ใช้คู่กับ EG.showError/showSuccess
// ctx.ui.field({...}) / ctx.ui.select({...})  → ช่องกรอกพร้อม <label for> (NFR-03)
// ctx.ui.attrs({...}) · ctx.ui.esc(s) · ctx.ui.baseUrl(req)
const fmt = require('./fmt');
const { STATUS_TH, LEVEL_TH, ROLE_TH, NAV } = require('./labels');
const { PAGE_TEXT } = require('./errors');

const esc = fmt.esc;
const SITE_NAME = 'e-Service เทศบาลนครตัวอย่าง';

/** สร้างสตริงแอตทริบิวต์ (ข้าม null/undefined/false · true = แอตทริบิวต์เปล่า) */
function attrs(obj) {
  if (!obj) return '';
  let out = '';
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === false) continue;
    out += v === true ? ` ${k}` : ` ${k}="${esc(v)}"`;
  }
  return out;
}

function createUi({ config, hooks, getCtx }) {
  function navFor(req) {
    const u = req.user;
    if (!u || u.scope !== 'full') return [];
    return (NAV[u.role] || []).concat(hooks._nav(u.role));
  }

  function bellCount(req) {
    try {
      return hooks._bell(req.user, getCtx());
    } catch (_) {
      return 0;
    }
  }

  function header(req) {
    const u = req.user;
    const path = req.path || '';
    let navHtml = '';
    let userHtml = '';
    if (u) {
      const items = navFor(req)
        .map((it) => {
          const current = path === it.href || (it.href !== '/' && path.startsWith(it.href + '/'));
          return `<li><a${attrs({ href: it.href, 'data-testid': it.testid, 'aria-current': current ? 'page' : null })}>${esc(it.label)}</a></li>`;
        })
        .join('');
      let bell = '';
      if (u.scope === 'full' && (u.role === 'officer' || u.role === 'head')) {
        const n = bellCount(req);
        bell = `<li><a href="/notifications" data-testid="nav-bell" class="nav-bell"${path === '/notifications' ? ' aria-current="page"' : ''}>แจ้งเตือน <span data-testid="bell-count" class="bell-count">${esc(n)}</span></a></li>`;
      }
      if (items || bell) navHtml = `<nav class="app-nav" aria-label="เมนูหลัก"><ul>${items}${bell}</ul></nav>`;
      userHtml = `<div class="userbox">
  <span class="user-name" data-testid="user-name">${esc(u.name)}</span>
  <span class="user-role" data-testid="user-role"${attrs({ 'data-role': u.role, 'data-dept': u.role === 'officer' ? u.dept || '' : null })}>${esc(ROLE_TH[u.role] || u.role)}</span>
  <form method="post" action="/logout" class="logout-form"><button type="submit" class="btn btn-small btn-ghost" data-testid="logout-btn">ออกจากระบบ</button></form>
</div>`;
    }
    const brand = u ? `<a class="brand" href="/">${esc(SITE_NAME)}</a>` : `<span class="brand">${esc(SITE_NAME)}</span>`;
    return `<header class="app-header" data-testid="app-header">
<div class="header-inner">
${brand}
${navHtml}
${userHtml}
</div>
</header>`;
  }

  function layout(req, { title = '', body = '', scripts = [], styles = [], bodyClass = '' } = {}) {
    const fullTitle = title ? `${title} · ${SITE_NAME}` : SITE_NAME;
    const css = ['/static/core/app.css', ...styles].map((h) => `<link rel="stylesheet" href="${esc(h)}">`).join('\n');
    const js = ['/static/core/app.js', ...scripts].map((s) => `<script src="${esc(s)}" defer></script>`).join('\n');
    return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
${css}
${js}
</head>
<body${bodyClass ? ` class="${esc(bodyClass)}"` : ''}>
<a class="skip-link" href="#main">ข้ามไปเนื้อหาหลัก</a>
${header(req)}
<main id="main" class="app-main" tabindex="-1">
${body}
</main>
<footer class="app-footer">
<p>เทศบาลนครตัวอย่าง (หน่วยงานสมมติเพื่อการเรียนการสอน) · ThaiD, PromptPay QR และลายเซ็นดิจิทัลในระบบนี้เป็นตัวจำลอง</p>
</footer>
</body>
</html>`;
  }

  function send(req, res, opts = {}) {
    const status = opts.status || 200;
    res.status(status).type('html').send(layout(req, opts));
  }

  function forbidden(req, res) {
    send(req, res, {
      status: 403,
      title: 'ไม่มีสิทธิ์',
      body: `<h1>ไม่สามารถเปิดหน้านี้ได้</h1>
<p class="msg msg-error" data-testid="forbidden-msg">${esc(PAGE_TEXT.FORBIDDEN_PAGE)}</p>
<p><a href="/">กลับหน้าหลัก</a></p>`,
    });
  }

  function notFound(req, res) {
    send(req, res, {
      status: 404,
      title: 'ไม่พบคำขอ',
      body: `<h1>ไม่พบข้อมูล</h1>
<p class="msg msg-error" data-testid="not-found-msg">${esc(PAGE_TEXT.NOT_FOUND_CASE)}</p>
<p><a href="/">กลับหน้าหลัก</a></p>`,
    });
  }

  function pageNotFound(req, res) {
    send(req, res, {
      status: 404,
      title: 'ไม่พบหน้า',
      body: `<h1>${esc(PAGE_TEXT.NOT_FOUND_PAGE)}</h1><p><a href="/">กลับหน้าหลัก</a></p>`,
    });
  }

  function errorPage(req, res, status, message) {
    send(req, res, {
      status: status || 500,
      title: 'เกิดข้อผิดพลาด',
      body: `<h1>เกิดข้อผิดพลาด</h1><p class="msg msg-error" role="alert">${esc(message || 'เกิดข้อผิดพลาดภายในระบบ')}</p><p><a href="/">กลับหน้าหลัก</a></p>`,
    });
  }

  function statusBadge(status, { testid = 'case-status', tag = 'span', extra = {} } = {}) {
    const label = STATUS_TH[status] || String(status || '');
    return `<${tag}${attrs({ class: `badge st st-${status}`, 'data-testid': testid, 'data-status': status, ...extra })}>${esc(label)}</${tag}>`;
  }

  function slaBadge(level, { testid = 'sla-level', tag = 'span', extra = {} } = {}) {
    const label = LEVEL_TH[level] || String(level || '');
    return `<${tag}${attrs({ class: `badge lv lv-${level}`, 'data-testid': testid, 'data-level': level, ...extra })}>${esc(label)}</${tag}>`;
  }

  /**
   * วันเวลา: <time data-iso="2026-12-04T16:30:00+07:00">4 ธ.ค. 2569 16:30</time>
   * dateOnly: ข้อความ '2 ก.พ. 2570' · ถ้าค่าเป็น 'YYYY-MM-DD' data-iso = ค่านั้นตรง ๆ (verify-expires)
   */
  function timeEl(value, { testid = null, prefix = '', dateOnly = false, cls = null, extra = {} } = {}) {
    if (value === null || value === undefined || value === '') {
      return `<span${attrs({ 'data-testid': testid, class: cls, ...extra })}>${esc(fmt.DASH)}</span>`;
    }
    const isPlainDate = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    const isoVal = isPlainDate ? value : fmt.iso(value);
    const text = dateOnly ? fmt.date(value) : fmt.dateTime(value);
    return `<time${attrs({ 'data-testid': testid, 'data-iso': isoVal, datetime: isoVal, class: cls, ...extra })}>${esc(prefix + text)}</time>`;
  }

  function money(n, { testid = null, cls = null, extra = {} } = {}) {
    return `<span${attrs({ 'data-testid': testid, class: cls, ...extra })}>${esc(fmt.money(n))}</span>`;
  }

  function messages({ error = '', success = '' } = {}) {
    return `<div class="msg msg-error" data-testid="action-error" role="alert"${error ? '' : ' hidden'}>${esc(error)}</div>
<div class="msg msg-ok" data-testid="action-success" role="status"${success ? '' : ' hidden'}>${esc(success)}</div>`;
  }

  /** ช่องกรอก + label (NFR-03) · errorTestid = กล่อง error ใต้ช่อง (ซ่อนเมื่อไม่มีข้อความ) */
  function field({ id, label, testid, type = 'text', name, value, required = false, hint = '', errorTestid = null, error = '', inputAttrs = {} }) {
    const hintId = hint ? `${id}-hint` : null;
    const errId = errorTestid ? `${id}-error` : null;
    const describedBy = [hintId, errId].filter(Boolean).join(' ') || null;
    return `<div class="field">
<label for="${esc(id)}">${esc(label)}${required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>
${hint ? `<p class="hint" id="${esc(hintId)}">${esc(hint)}</p>` : ''}<input${attrs({ id, name: name || id, type, value, 'data-testid': testid, required: required || null, 'aria-describedby': describedBy, ...inputAttrs })}>
${errorTestid ? `<p class="field-error" id="${esc(errId)}" data-testid="${esc(errorTestid)}"${error ? '' : ' hidden'}>${esc(error)}</p>` : ''}
</div>`;
  }

  function select({ id, label, testid, name, options = [], value, selectAttrs = {} }) {
    const opts = options
      .map((o) => {
        const v = typeof o === 'object' ? o.value : o;
        const l = typeof o === 'object' ? o.label : o;
        return `<option${attrs({ value: v, selected: String(v) === String(value) })}>${esc(l)}</option>`;
      })
      .join('');
    return `<div class="field">
<label for="${esc(id)}">${esc(label)}</label>
<select${attrs({ id, name: name || id, 'data-testid': testid, ...selectAttrs })}>${opts}</select>
</div>`;
  }

  function baseUrl(req) {
    if (config.publicBaseUrl) return config.publicBaseUrl;
    return `${req.protocol}://${req.get('host')}`;
  }

  return {
    SITE_NAME,
    STATUS_TH,
    LEVEL_TH,
    ROLE_TH,
    layout,
    send,
    forbidden,
    notFound,
    pageNotFound,
    errorPage,
    statusBadge,
    slaBadge,
    time: timeEl,
    money,
    messages,
    field,
    select,
    attrs,
    esc,
    baseUrl,
    bellCount,
  };
}

module.exports = { createUi, attrs };

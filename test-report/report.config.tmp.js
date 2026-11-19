// ชั่วคราวสำหรับ test-report (ขั้น 4): ใช้ config เดิมทุกค่า + video='on' + reporter json/html + outputDir แยก
//
// หมายเหตุ: test ทุกตัวเปิด browser context เองผ่าน fixture `tc`/`kit` (browser.newContext) ซึ่ง use.video
// ของ Playwright ไม่ครอบ (ครอบแค่ fixture `page`/`context`) → ไฟล์นี้ห่อ Browser.newContext ให้ใส่ recordVideo
// ลงโฟลเดอร์ผลของ test นั้น และแนบวิดีโอเข้า test เมื่อ context ปิด · ไม่แตะ option อื่น ไม่แตะ assert
const path = require('path');
const base = require('./playwright.config.js');
const OUT = path.join(__dirname, '.test-report-run');

const coreDir = path.dirname(require.resolve('playwright-core/package.json', { paths: [path.dirname(require.resolve('playwright/package.json'))] }));
const { Browser } = require(path.join(coreDir, 'lib/client/browser.js'));
if (!Browser.prototype.__videoPatched) {
  Browser.prototype.__videoPatched = true;
  const orig = Browser.prototype.newContext;
  Browser.prototype.newContext = async function (options = {}) {
    let ti = null;
    try { ti = require('@playwright/test').test.info(); } catch { /* นอก test */ }
    if (!ti || (options && options.recordVideo)) return orig.call(this, options);
    const ctx = await orig.call(this, { ...options, recordVideo: { dir: ti.outputPath('videos'), size: { width: 1280, height: 720 } } });
    const pages = [];
    ctx.on('page', (p) => pages.push(p));
    const origClose = ctx.close.bind(ctx);
    ctx.close = async (...a) => {
      const r = await origClose(...a);
      for (const p of pages) {
        const v = p.video();
        if (!v) continue;
        try { await ti.attach('video', { path: await v.path(), contentType: 'video/webm' }); } catch { /* ignore */ }
      }
      return r;
    };
    return ctx;
  };
}

module.exports = {
  ...base,
  outputDir: path.join(OUT, 'artifacts'),
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(OUT, 'results.json') }],
    ['html', { outputFolder: path.join(OUT, 'html'), open: 'never' }],
  ],
  use: { ...base.use, video: 'on' },
};

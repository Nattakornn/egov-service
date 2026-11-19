'use strict';
// จุดต่อของโมดูล (ctx.hooks) — โมดูลลงทะเบียนตอน register(ctx) ไม่ต้องแก้ไฟล์กลาง
//
// onRequest(priority, fn)   fn(req, ctx) (sync หรือ async) เรียกทุก request ก่อนเข้า route
//                           ยกเว้น /api/test/* (CONTRACT §0 ข้อ 7) และไฟล์ static (/static/*, /favicon.ico)
//                           เรียงตาม priority น้อย → มาก · error ใน hook ถูก log แล้วข้าม (ไม่ทำให้ request ล้ม)
//                           ข้อตกลง: 10 = เปลี่ยนสถานะอัตโนมัติ (ยกเลิกเมื่อเลย 168 ชม. · A-46) · 50 = ประเมินแจ้งเตือน (A-30)
// onReset(fn)               fn(ctx) หลัง seed เสร็จ ทั้งตอน reset และตอน seed ครั้งแรกเมื่อเริ่มเครื่อง
// testRoute(method, path, ...handlers)   ลงทะเบียน route ใต้ /api/test/ (เช่น 'post', '/api/test/payments/:ref/pay')
//                           ใช้ได้จริงเฉพาะ TEST_MODE=1 · ไม่ตั้ง → ทุก /api/test/* ตอบ 404
// bellCount(fn)             fn(user, ctx) → จำนวนแจ้งเตือนของผู้ใช้ (ตัวเลขใน bell-count ของหัวหน้าเว็บ)
// navItems(role, items)     เมนูเพิ่มเติม [{testid, href, label}] (เมนูตาม CONTRACT §2.1 core ใส่ให้แล้ว)

function createHooks({ testRouter, testMode, log }) {
  const reqHooks = [];
  const resetHooks = [];
  const bellProviders = [];
  const extraNav = {};
  let seq = 0;

  return {
    onRequest(priority, fn) {
      if (typeof priority === 'function') {
        fn = priority;
        priority = 100;
      }
      reqHooks.push({ priority: Number(priority) || 100, seq: seq++, fn });
      reqHooks.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    },
    onReset(fn) {
      resetHooks.push(fn);
    },
    testRoute(method, path, ...handlers) {
      const m = String(method || 'get').toLowerCase();
      if (!/^\/api\/test\//.test(path)) throw new Error('hooks.testRoute: path must start with /api/test/');
      if (!testMode) return false;
      testRouter[m](path, ...handlers);
      return true;
    },
    bellCount(fn) {
      bellProviders.push(fn);
    },
    navItems(role, items) {
      extraNav[role] = (extraNav[role] || []).concat(items || []);
    },

    // ---- ใช้ภายใน core ----
    async _runRequest(req, ctx) {
      for (const h of reqHooks) {
        try {
          await h.fn(req, ctx);
        } catch (e) {
          log(`[hooks.onRequest p${h.priority}] ${e && e.stack ? e.stack : e}`);
        }
      }
    },
    async _runReset(ctx) {
      for (const fn of resetHooks) {
        try {
          await fn(ctx);
        } catch (e) {
          log(`[hooks.onReset] ${e && e.stack ? e.stack : e}`);
          throw e;
        }
      }
    },
    _bell(user, ctx) {
      let n = 0;
      for (const fn of bellProviders) {
        try {
          n += Number(fn(user, ctx)) || 0;
        } catch (e) {
          log(`[hooks.bellCount] ${e && e.stack ? e.stack : e}`);
        }
      }
      return n;
    },
    _nav(role) {
      return extraNav[role] || [];
    },
    _counts() {
      return { onRequest: reqHooks.length, onReset: resetHooks.length, bell: bellProviders.length };
    },
  };
}

module.exports = { createHooks };

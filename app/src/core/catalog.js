'use strict';
// อ่านบริการ/วันหยุดปัจจุบันจาก DB (ผู้ดูแลแก้ได้ → อ่านใหม่ทุกครั้ง ไม่ cache)
// ctx.catalog.service('SV-03') → { id, name, feeType, fee, feePerSqm, sla, approver, route: ['registry','works','head'], docs: [{key,name,required,pdfOnly}] }
// ctx.catalog.services()       → ทุกบริการเรียงตาม sort
// ctx.catalog.holidays()       → ['2026-12-07', ...] (เรียงวันที่) · ctx.catalog.holidaySet() → Set
// ctx.catalog.docName('plan')  → 'แบบแปลน'
const { DOC_KEY_TH } = require('./labels');

function createCatalog(db) {
  const toSvc = (r) =>
    r && {
      id: r.id,
      name: r.name,
      feeType: r.fee_type,
      fee: r.fee,
      feePerSqm: r.fee_per_sqm,
      sla: r.sla,
      approver: r.approver,
      route: JSON.parse(r.route),
      docs: JSON.parse(r.docs),
    };
  return {
    service(id) {
      return toSvc(db.prepare('SELECT * FROM services WHERE id = ?').get(id));
    },
    services() {
      return db.prepare('SELECT * FROM services ORDER BY sort, id').all().map(toSvc);
    },
    holidays() {
      return db.prepare('SELECT date FROM holidays ORDER BY date').all().map((r) => r.date);
    },
    holidaySet() {
      return new Set(this.holidays());
    },
    docName(key) {
      return DOC_KEY_TH[key] || key;
    },
  };
}

module.exports = { createCatalog };

'use strict';
// สร้างข้อมูล seed ทั้งหมดตาม TEST-DATA (เรียกจาก reset และตอนเริ่มเครื่องครั้งแรก)
// deterministic: reset 2 ครั้งได้ผลเหมือนกันทุกค่า (ยกเว้น ciphertext ของ PII ที่ใช้ IV สุ่ม แต่ถอดได้ค่าเดิม)
const time = require('../time');
const D = require('./data');
const { minimalPdf } = require('./pdf');

const iso = (local) => time.iso(time.toDate(local));

/** จำนวนวันทำการในช่วง (fromYmd, toYmd] (ใช้เฉพาะคำนวณ paused_days ของประวัติ seed) */
function businessDaysBetween(fromYmd, toYmd, holidaySet) {
  let n = 0;
  let d = fromYmd;
  while (d < toYmd) {
    d = time.addDaysYmd(d, 1);
    const dow = time.dowYmd(d);
    if (dow !== 0 && dow !== 6 && !holidaySet.has(d)) n++;
  }
  return n;
}

function caseNoOf(no) {
  return `EG-2569-${String(no).padStart(6, '0')}`;
}

/**
 * จำลองเหตุการณ์ของคำขอ → สถานะสุดท้าย + ไทม์ไลน์ + ประวัติตีกลับ
 * (กติกาเดียวกับที่โมดูล workflow ต้องทำ: ส่งต่อ SV-03 ทะเบียน → โยธา → หัวหน้า · APPROVED ไม่มีผู้ถือ ผู้ออกเอกสาร = issuer)
 */
function simulate(c, people, holidaySet) {
  const caseNo = caseNoOf(c.no);
  const applicant = people.citizens[c.who];
  const st = {
    status: null, step: null, dept: null, owner: null, issuer: null, approved_by: null, approved_at: null,
    return_count: 0, returned_at: null, fix_deadline: null, closed_at: null, cancelled_at: null, doc_no: null,
  };
  const timeline = [];
  const returns = [];
  const actorOf = (who) => {
    if (who === 'citizen') return { actor: applicant.username, actorName: applicant.name, actorRole: 'citizen' };
    const s = people.staff[who];
    if (!s) throw new Error(`seed: unknown actor ${who} in ${caseNo}`);
    return { actor: s.username, actorName: s.name, actorRole: s.role };
  };
  const push = (at, event, from, to, who, text, detail = null) => {
    timeline.push({ caseNo, at, event, from, to, ...actorOf(who), text, detail });
  };

  const paidAt = iso(c.paid);
  const receiptNo = `RC-2569-${String(c.no).padStart(6, '0')}`;
  st.status = 'SUBMITTED';
  st.dept = 'registry';
  st.step = c.svc === 'SV-03' ? 1 : null;
  push(paidAt, 'PAID', null, 'SUBMITTED', 'citizen', `ชำระค่าธรรมเนียมแล้ว ส่งคำขอ (ใบเสร็จ ${receiptNo})`);

  for (const [type, when, who, note] of c.events) {
    const at = iso(when);
    const from = st.status;
    switch (type) {
      case 'CLAIM': {
        const s = people.staff[who];
        if (st.status === 'SUBMITTED') st.status = 'IN_REVIEW';
        else if (!(st.status === 'IN_REVIEW' && !st.owner)) throw new Error(`seed: bad CLAIM ${caseNo}`);
        st.owner = who;
        if (st.dept === 'registry' && !st.issuer) st.issuer = who;
        push(at, 'CLAIM', from, st.status, who, `รับเรื่องโดย ${s.name}`);
        break;
      }
      case 'RETURN': {
        if (st.status !== 'IN_REVIEW') throw new Error(`seed: bad RETURN ${caseNo}`);
        st.status = 'NEED_FIX';
        st.return_count += 1;
        st.returned_at = at;
        st.fix_deadline = time.iso(time.addHours(at, 168));
        returns.push({ caseNo, seq: st.return_count, returned_at: at, returned_by: who, reason: note, fix_deadline: st.fix_deadline, resubmitted_at: null, paused_days: null });
        push(at, 'RETURN', from, 'NEED_FIX', who, `ตีกลับให้แก้ไขเอกสาร (ครั้งที่ ${st.return_count})`, note);
        break;
      }
      case 'RESUBMIT': {
        if (st.status !== 'NEED_FIX') throw new Error(`seed: bad RESUBMIT ${caseNo}`);
        st.status = 'IN_REVIEW';
        st.fix_deadline = null;
        const r = returns[returns.length - 1];
        r.resubmitted_at = at;
        r.paused_days = businessDaysBetween(time.ymd(r.returned_at), time.ymd(at), holidaySet);
        push(at, 'RESUBMIT', from, 'IN_REVIEW', 'citizen', 'ประชาชนส่งแก้ไขเอกสาร');
        break;
      }
      case 'FORWARD': {
        if (st.status !== 'IN_REVIEW') throw new Error(`seed: bad FORWARD ${caseNo}`);
        if (c.svc === 'SV-03' && st.step === 1) {
          st.step = 2;
          st.dept = 'works';
          st.owner = null;
          push(at, 'FORWARD', from, 'IN_REVIEW', who, 'ส่งต่อฝ่ายโยธาตรวจแบบ (ขั้นตอน 2/3)', note || null);
        } else if (c.svc !== 'SV-01') {
          st.status = 'PENDING_APPROVAL';
          if (c.svc === 'SV-03') st.step = 3;
          st.dept = 'head';
          st.owner = null;
          push(at, 'FORWARD', from, 'PENDING_APPROVAL', who, 'ส่งต่อหัวหน้าฝ่ายพิจารณาอนุมัติ', note || null);
        } else throw new Error(`seed: SV-01 cannot FORWARD ${caseNo}`);
        break;
      }
      case 'APPROVE': {
        const ok = (c.svc === 'SV-01' && st.status === 'IN_REVIEW') || (c.svc !== 'SV-01' && st.status === 'PENDING_APPROVAL');
        if (!ok) throw new Error(`seed: bad APPROVE ${caseNo}`);
        st.status = 'APPROVED';
        st.approved_by = who;
        st.approved_at = at;
        st.dept = 'registry';
        st.owner = null;
        push(at, 'APPROVE', from, 'APPROVED', who, `อนุมัติโดย ${people.staff[who].name}`);
        break;
      }
      case 'REJECT': {
        st.status = 'REJECTED';
        st.closed_at = at;
        st.dept = null;
        st.owner = null;
        push(at, 'REJECT', from, 'REJECTED', who, 'ไม่อนุมัติคำขอ', note);
        break;
      }
      case 'ISSUE': {
        if (st.status !== 'APPROVED') throw new Error(`seed: bad ISSUE ${caseNo}`);
        st.status = 'COMPLETED';
        st.closed_at = at;
        st.dept = null;
        st.owner = null;
        if (c.document) {
          st.doc_no = D.DOCUMENT.docNo;
          push(at, 'ISSUE', from, 'COMPLETED', who, `ออกเอกสารดิจิทัล ${D.DOCUMENT.docNo}`, D.DOCUMENT.docNo);
        } else {
          push(at, 'ISSUE', from, 'COMPLETED', who, 'ออกเอกสารแล้ว (ออกจากระบบเดิม)');
        }
        break;
      }
      case 'CANCEL': {
        if (st.status !== 'SUBMITTED' || st.owner) throw new Error(`seed: bad CANCEL ${caseNo}`);
        st.status = 'CANCELLED';
        st.cancelled_at = at;
        st.dept = null;
        push(at, 'CANCEL', from, 'CANCELLED', 'citizen', 'ประชาชนยกเลิกคำขอ (ค่าธรรมเนียมที่ชำระแล้วไม่คืน)');
        break;
      }
      default:
        throw new Error(`seed: unknown event ${type}`);
    }
  }

  // ตรวจตัวเองกับ TEST-DATA
  if (st.status !== c.status) throw new Error(`seed: ${caseNo} status ${st.status} != ${c.status}`);
  if ((c.closed ? iso(c.closed) : null) !== st.closed_at) throw new Error(`seed: ${caseNo} closed_at mismatch`);
  if ((c.cancelled ? iso(c.cancelled) : null) !== st.cancelled_at) throw new Error(`seed: ${caseNo} cancelled_at mismatch`);
  const exp = D.EXPECT[caseNo];
  if (exp) {
    const map = { owner: 'owner', returnCount: 'return_count', fixDeadline: 'fix_deadline', step: 'step', dept: 'dept', issuer: 'issuer', approvedBy: 'approved_by', approvedAt: 'approved_at' };
    for (const [k, v] of Object.entries(exp)) {
      if (st[map[k]] !== v) throw new Error(`seed: ${caseNo} ${k} = ${st[map[k]]} != ${v}`);
    }
  }
  const lastAt = timeline[timeline.length - 1].at;
  return { caseNo, receiptNo, paidAt, state: st, timeline, returns, updatedAt: lastAt };
}

/**
 * @param {{db, crypto, sign, storage}} deps
 * @returns สรุปจำนวนที่ seed
 */
function seedAll({ db, crypto, sign, storage }) {
  const created = '2026-10-01T09:00:00+07:00';
  const holidaySet = new Set(D.HOLIDAYS.map((h) => h.date));
  const people = { citizens: {}, staff: {} };
  let fileSeq = 0;
  const nextFileId = () => `F-${String(++fileSeq).padStart(6, '0')}`;

  db.tx(() => {
    // ---- users ----
    const insUser = db.prepare(
      `INSERT INTO users(id, username, password_hash, name, role, dept, id_enc, id_hash, mobile_enc, mobile_hash, email, registered, consent_at, active, created_at, updated_at)
       VALUES (@id, @username, @password_hash, @name, @role, @dept, @id_enc, @id_hash, @mobile_enc, @mobile_hash, '', @registered, @consent_at, 1, @created_at, @created_at)`
    );
    let uid = 0;
    for (const c of D.CITIZENS) {
      uid += 1;
      insUser.run({
        id: uid,
        username: c.username,
        password_hash: null,
        name: c.name,
        role: 'citizen',
        dept: null,
        id_enc: crypto.enc(c.idNo),
        id_hash: crypto.hash(c.idNo),
        mobile_enc: c.mobile ? crypto.enc(c.mobile) : null,
        mobile_hash: c.mobile ? crypto.hash(c.mobile) : null,
        registered: c.registered ? 1 : 0,
        consent_at: c.registered ? created : null,
        created_at: created,
      });
      people.citizens[c.key] = { id: uid, username: c.username, name: c.name };
    }
    for (const s of D.STAFF) {
      uid += 1;
      insUser.run({
        id: uid,
        username: s.username,
        password_hash: crypto.hashPassword(D.PASSWORD, s.username),
        name: s.name,
        role: s.role,
        dept: s.dept,
        id_enc: null,
        id_hash: null,
        mobile_enc: null,
        mobile_hash: null,
        registered: 1,
        consent_at: null,
        created_at: created,
      });
      people.staff[s.username] = { id: uid, username: s.username, name: s.name, role: s.role, dept: s.dept };
    }

    // ---- services / holidays ----
    const insSvc = db.prepare(
      `INSERT INTO services(id, name, fee_type, fee, fee_per_sqm, sla, approver, route, docs, sort, updated_at)
       VALUES (@id, @name, @fee_type, @fee, @fee_per_sqm, @sla, @approver, @route, @docs, @sort, @updated_at)`
    );
    for (const s of D.SERVICES) {
      insSvc.run({ ...s, route: JSON.stringify(s.route), docs: JSON.stringify(s.docs), updated_at: created });
    }
    const insHol = db.prepare('INSERT INTO holidays(date, name) VALUES (?, ?)');
    for (const h of D.HOLIDAYS) insHol.run(h.date, h.name);

    // ---- cases + timeline + returns + files ----
    const insCase = db.prepare(
      `INSERT INTO cases(case_no, draft_id, citizen_id, service_id, qty, area_sqm, fee, status, step, dept, owner, issuer, approved_by, approved_at,
                         payment_ref, receipt_no, paid_at, due_at, return_count, returned_at, fix_deadline, closed_at, cancelled_at, doc_no, created_at, updated_at)
       VALUES (@case_no, NULL, @citizen_id, @service_id, @qty, @area_sqm, @fee, @status, @step, @dept, @owner, @issuer, @approved_by, @approved_at,
               NULL, @receipt_no, @paid_at, @due_at, @return_count, @returned_at, @fix_deadline, @closed_at, @cancelled_at, @doc_no, @created_at, @updated_at)`
    );
    const insTl = db.prepare(
      `INSERT INTO case_timeline(case_no, at, event, from_status, to_status, actor, actor_name, actor_role, text, detail)
       VALUES (@caseNo, @at, @event, @from, @to, @actor, @actorName, @actorRole, @text, @detail)`
    );
    const insRet = db.prepare(
      `INSERT INTO returns(case_no, seq, returned_at, returned_by, reason, fix_deadline, resubmitted_at, paused_days)
       VALUES (@caseNo, @seq, @returned_at, @returned_by, @reason, @fix_deadline, @resubmitted_at, @paused_days)`
    );
    const insFile = db.prepare(
      `INSERT INTO files(id, draft_id, case_no, doc_key, name, mime, size, storage, seed, uploaded_by, uploaded_at)
       VALUES (@id, @draft_id, @case_no, @doc_key, @name, 'application/pdf', @size, @storage, 1, @uploaded_by, @uploaded_at)`
    );
    const writeSeedFile = ({ draftId = null, caseNo = null, docKey, name, uploadedBy, uploadedAt }) => {
      const id = nextFileId();
      const buf = minimalPdf([
        'e-Service demo attachment (fictional municipality)',
        `file: ${name}`,
        `ref: ${caseNo || draftId}`,
        `fileId: ${id}`,
        'sample document for testing only',
      ]);
      const rel = storage.save(`${id}.pdf`, buf, 'seed');
      insFile.run({ id, draft_id: draftId, case_no: caseNo, doc_key: docKey, name, size: buf.length, storage: rel, uploaded_by: uploadedBy, uploaded_at: uploadedAt });
    };

    for (const c of D.CASES) {
      const sim = simulate(c, people, holidaySet);
      const st = sim.state;
      const citizen = people.citizens[c.who];
      insCase.run({
        case_no: sim.caseNo,
        citizen_id: citizen.id,
        service_id: c.svc,
        qty: c.svc === 'SV-01' ? c.qty : null,
        area_sqm: c.svc === 'SV-03' ? c.area : null,
        fee: c.fee,
        status: st.status,
        step: st.step,
        dept: st.dept,
        owner: st.owner,
        issuer: st.issuer,
        approved_by: st.approved_by,
        approved_at: st.approved_at,
        receipt_no: sim.receiptNo,
        paid_at: sim.paidAt,
        due_at: iso(c.due),
        return_count: st.return_count,
        returned_at: st.returned_at,
        fix_deadline: st.fix_deadline,
        closed_at: st.closed_at,
        cancelled_at: st.cancelled_at,
        doc_no: st.doc_no,
        created_at: sim.paidAt,
        updated_at: sim.updatedAt,
      });
      for (const t of sim.timeline) insTl.run(t);
      for (const r of sim.returns) insRet.run(r);
      const upAt = time.iso(time.addMinutes(sim.paidAt, -10));
      for (const [docKey, name] of D.SEED_FILES[c.svc]) {
        writeSeedFile({ caseNo: sim.caseNo, docKey, name, uploadedBy: citizen.id, uploadedAt: upAt });
      }
    }

    // ---- drafts / payments ----
    const insDraft = db.prepare(
      `INSERT INTO drafts(id, citizen_id, service_id, status, qty, area_sqm, fee, locked_amount, case_no, created_at, updated_at)
       VALUES (@id, @citizen_id, @service_id, @status, @qty, @area_sqm, @fee, @locked_amount, NULL, @created_at, @updated_at)`
    );
    for (const d of D.DRAFTS) {
      const citizen = people.citizens[d.who];
      const lastFile = d.files.length ? iso(d.files[d.files.length - 1][2]) : null;
      const pay = D.PAYMENTS.find((p) => p.draft === d.id);
      insDraft.run({
        id: d.id,
        citizen_id: citizen.id,
        service_id: d.svc,
        status: d.status,
        qty: d.qty || null,
        area_sqm: d.area || null,
        fee: d.fee,
        locked_amount: d.locked || null,
        created_at: iso(d.created),
        updated_at: pay ? pay.created : lastFile || iso(d.created),
      });
      for (const [docKey, name, at] of d.files) {
        writeSeedFile({ draftId: d.id, docKey, name, uploadedBy: citizen.id, uploadedAt: iso(at) });
      }
    }
    const insPay = db.prepare(
      `INSERT INTO payments(ref, draft_id, amount, status, qr_created_at, qr_expires_at, paid_at, case_no, receipt_no)
       VALUES (?, ?, ?, 'PENDING', ?, ?, NULL, NULL, NULL)`
    );
    for (const p of D.PAYMENTS) insPay.run(p.ref, p.draft, p.amount, p.created, p.expires);

    // ---- document (ลายเซ็นคำนวณจริงด้วยคีย์ทดสอบ) ----
    const doc = D.DOCUMENT;
    const signature = sign.signDoc(doc);
    db.prepare(
      `INSERT INTO documents(doc_no, case_no, verify_code, applicant, service_id, issued_at, valid_until, signer, signer_username, signature, issued_by, created_at)
       VALUES (@docNo, @caseNo, @verifyCode, @applicant, @serviceId, @issuedAt, @validUntil, @signer, @signerUsername, @signature, @issuedBy, @issuedAt)`
    ).run({ ...doc, signature });

    // ---- counters (§12) ----
    const insCounter = db.prepare('INSERT INTO counters(name, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(D.COUNTERS)) insCounter.run(k, v);
    insCounter.run('file', fileSeq);
  });

  return {
    users: D.CITIZENS.length + D.STAFF.length,
    cases: D.CASES.length,
    drafts: D.DRAFTS.length,
    files: fileSeq,
    documents: 1,
  };
}

module.exports = { seedAll, simulate, businessDaysBetween, caseNoOf };

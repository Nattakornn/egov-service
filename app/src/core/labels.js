'use strict';
// ตารางรหัส ↔ ข้อความไทย (CONTRACT §4 · §2.1) · ใช้ร่วมทุกโมดูล ห้ามพิมพ์ข้อความซ้ำเอง

const STATUS_TH = {
  DRAFT: 'ร่าง',
  PENDING_PAYMENT: 'รอชำระเงิน',
  SUBMITTED: 'ส่งคำขอแล้ว',
  IN_REVIEW: 'กำลังตรวจสอบ',
  NEED_FIX: 'รอแก้ไขเอกสาร',
  PENDING_APPROVAL: 'รออนุมัติ',
  APPROVED: 'อนุมัติ',
  COMPLETED: 'เสร็จสิ้น',
  REJECTED: 'ไม่อนุมัติ',
  CANCELLED: 'ยกเลิก',
};

const LEVEL_TH = {
  normal: 'ปกติ',
  near: 'ใกล้ครบกำหนด',
  overdue: 'เกินกำหนด',
  paused: 'หยุดนับ',
  closed: 'ปิดแล้ว',
};

const ROLE_TH = {
  citizen: 'ประชาชน',
  officer: 'เจ้าหน้าที่',
  head: 'หัวหน้าฝ่าย',
  executive: 'ผู้บริหาร',
  auditor: 'ผู้ตรวจสอบภายใน',
  admin: 'ผู้ดูแลระบบ',
};

const DEPT_TH = {
  registry: 'ฝ่ายทะเบียน',
  works: 'ฝ่ายโยธา',
  head: 'หัวหน้าฝ่าย',
};

const PAYMENT_STATUS_TH = {
  PENDING: 'รอชำระ',
  PAID: 'ชำระแล้ว',
  EXPIRED: 'QR หมดอายุ',
};

const DOC_KEY_TH = {
  'id-card': 'บัตรประชาชน',
  map: 'แผนที่ตั้ง',
  'site-photo': 'ภาพสถานที่',
  plan: 'แบบแปลน',
  deed: 'โฉนด',
  extra: 'เอกสารเพิ่มเติม',
};

// หน้าตั้งต้นหลังล็อกอิน (CONTRACT §1)
const LANDING = {
  citizen: '/citizen',
  officer: '/officer/queue',
  head: '/head/approvals',
  executive: '/dashboard',
  auditor: '/audit',
  admin: '/admin/services',
};

// เมนูตามบทบาท (CONTRACT §2.1 · แสดงเฉพาะบทบาทที่เข้าหน้านั้นได้)
const NAV = {
  citizen: [{ testid: 'nav-my-cases', href: '/citizen', label: 'คำขอของฉัน' }],
  officer: [{ testid: 'nav-queue', href: '/officer/queue', label: 'คิวงาน' }],
  head: [
    { testid: 'nav-queue', href: '/officer/queue', label: 'คิวงาน' },
    { testid: 'nav-approvals', href: '/head/approvals', label: 'รออนุมัติ' },
  ],
  executive: [{ testid: 'nav-dashboard', href: '/dashboard', label: 'Dashboard' }],
  auditor: [{ testid: 'nav-audit', href: '/audit', label: 'Audit Trail' }],
  admin: [
    { testid: 'nav-admin-services', href: '/admin/services', label: 'บริการ' },
    { testid: 'nav-admin-holidays', href: '/admin/holidays', label: 'วันหยุด' },
    { testid: 'nav-admin-users', href: '/admin/users', label: 'ผู้ใช้' },
  ],
};

// ข้อความตั้งต้นของไทม์ไลน์ (caseEvents ใช้เมื่อไม่ส่ง text มาเอง)
const TIMELINE_TH = {
  PAID: 'ชำระค่าธรรมเนียมแล้ว ส่งคำขอ',
  CLAIM: 'เจ้าหน้าที่รับเรื่อง',
  RETURN: 'ตีกลับให้แก้ไขเอกสาร',
  RESUBMIT: 'ประชาชนส่งแก้ไขเอกสาร',
  FORWARD: 'ส่งต่อ',
  APPROVE: 'อนุมัติ',
  REJECT: 'ไม่อนุมัติ',
  ISSUE: 'ออกเอกสารดิจิทัล',
  CANCEL: 'ประชาชนยกเลิกคำขอ',
  AUTO_CANCEL: 'ระบบยกเลิกอัตโนมัติ เนื่องจากเลยเวลาแก้ไข 168 ชั่วโมง',
  NOTE: 'บันทึก',
};

const OPEN_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'NEED_FIX', 'PENDING_APPROVAL', 'APPROVED']; // งานคงค้าง (BR-25)
const CLOSED_STATUSES = ['COMPLETED', 'REJECTED']; // ปิดงาน (มี closed_at)

module.exports = {
  STATUS_TH, LEVEL_TH, ROLE_TH, DEPT_TH, PAYMENT_STATUS_TH, DOC_KEY_TH, LANDING, NAV, TIMELINE_TH,
  OPEN_STATUSES, CLOSED_STATUSES,
};

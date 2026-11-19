'use strict';
// NFR-04: เลขบัตร/เบอร์โทรเก็บเข้ารหัส AES-256-GCM + คอลัมน์ hash (HMAC-SHA256) สำหรับค้นหา
// ใช้: const enc = ctx.crypto.enc('1101700123456')   → 'v1:<base64(iv|tag|ciphertext)>'
//      ctx.crypto.dec(enc)                             → '1101700123456'
//      ctx.crypto.hash('1101700123456')                → hex 64 ตัว (ค่าเดิมทุกครั้ง ใช้ WHERE id_hash = ?)
// ห้ามเก็บ/ล็อกค่าเต็มที่ใดนอกจากผ่าน enc() (TC-NFR-04 grep ไฟล์ DB)
const nodeCrypto = require('crypto');

const DEV_SECRET = 'egov-eservice-demo-pii-key (dev/test only · set PII_KEY in production)';

function deriveKeys(piiKey) {
  let master;
  if (piiKey && /^[0-9a-fA-F]{64}$/.test(piiKey)) master = Buffer.from(piiKey, 'hex');
  else master = nodeCrypto.createHash('sha256').update(piiKey || DEV_SECRET).digest();
  const encKey = nodeCrypto.createHmac('sha256', master).update('enc').digest();
  const macKey = nodeCrypto.createHmac('sha256', master).update('lookup').digest();
  return { encKey, macKey };
}

function createCrypto({ piiKey } = {}) {
  const { encKey, macKey } = deriveKeys(piiKey);
  return {
    /** เข้ารหัสสตริง (null/undefined/'' → null) */
    enc(plain) {
      if (plain === null || plain === undefined || plain === '') return null;
      const iv = nodeCrypto.randomBytes(12);
      const cipher = nodeCrypto.createCipheriv('aes-256-gcm', encKey, iv);
      const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return 'v1:' + Buffer.concat([iv, tag, ct]).toString('base64');
    },
    /** ถอดรหัส (null → null) · ข้อมูลเสีย → throw */
    dec(token) {
      if (token === null || token === undefined || token === '') return null;
      const s = String(token);
      if (!s.startsWith('v1:')) throw new Error('crypto.dec: unknown format');
      const buf = Buffer.from(s.slice(3), 'base64');
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(12, 28);
      const ct = buf.subarray(28);
      const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', encKey, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    },
    /** HMAC-SHA256 hex สำหรับค้นหาแบบตรงตัว (deterministic) */
    hash(plain) {
      if (plain === null || plain === undefined || plain === '') return null;
      return nodeCrypto.createHmac('sha256', macKey).update(String(plain)).digest('hex');
    },
    /** รหัสผ่านเจ้าหน้าที่: scrypt (salt คงที่ต่อ username เพื่อให้ seed ซ้ำได้) */
    hashPassword,
    verifyPassword,
    /** สุ่ม hex */
    randomHex(bytes = 32) {
      return nodeCrypto.randomBytes(bytes).toString('hex');
    },
  };
}

const pwCache = new Map();
function hashPassword(password, saltHint = '') {
  const salt = nodeCrypto.createHash('sha256').update('egov-pw-salt:' + saltHint).digest().subarray(0, 16);
  const key = salt.toString('hex') + ':' + password;
  if (pwCache.has(key)) return pwCache.get(key);
  const dk = nodeCrypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 });
  const out = `scrypt$${salt.toString('hex')}$${dk.toString('hex')}`;
  pwCache.set(key, out);
  return out;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [algo, saltHex, hashHex] = stored.split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const key = saltHex + ':' + password;
  let computed = pwCache.get(key);
  if (!computed) {
    const dk = nodeCrypto.scryptSync(String(password || ''), salt, 32, { N: 16384, r: 8, p: 1 });
    computed = `scrypt$${saltHex}$${dk.toString('hex')}`;
    if (computed === stored) pwCache.set(key, computed);
  }
  const a = Buffer.from(computed);
  const b = Buffer.from(stored);
  return a.length === b.length && nodeCrypto.timingSafeEqual(a, b);
}

module.exports = { createCrypto, hashPassword, verifyPassword };

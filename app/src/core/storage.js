'use strict';
// ที่เก็บไฟล์อัปโหลด: UPLOAD_DIR (ค่าเริ่มต้น <DATA_DIR>/uploads = /data/uploads ใน Docker)
// reset ล้างทั้งโฟลเดอร์แล้วเขียนไฟล์ seed ใหม่ (NFR-09)
// ใช้: const rel = ctx.storage.save(fileId, buffer)   → เก็บที่ UPLOAD_DIR/u/<fileId> คืน path สัมพัทธ์สำหรับคอลัมน์ files.storage
//      ctx.storage.read(fileRow)                      → Buffer
//      ctx.storage.remove(fileRow)
//      ctx.storage.detectType(buffer)                 → {type:'pdf'|'jpg'|'png', mime, ext} | null  (magic bytes เท่านั้น · BR-06)
const fs = require('fs');
const path = require('path');

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5,242,880 (BR-07 · ≤ รับ)
const MAX_FILES_PER_CASE = 5;

function detectType(buf) {
  if (!buf || buf.length < 3) return null;
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return { type: 'pdf', mime: 'application/pdf', ext: 'pdf' }; // %PDF
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { type: 'jpg', mime: 'image/jpeg', ext: 'jpg' };
  }
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { type: 'png', mime: 'image/png', ext: 'png' };
  }
  return null;
}

function createStorage(uploadDir) {
  const root = path.resolve(uploadDir);
  fs.mkdirSync(root, { recursive: true });

  function abs(rel) {
    const p = path.resolve(root, rel);
    if (!p.startsWith(root + path.sep)) throw new Error('storage: invalid path');
    return p;
  }

  return {
    dir: root,
    MAX_FILE_BYTES,
    MAX_FILES_PER_CASE,
    detectType,
    save(fileId, buffer, subdir = 'u') {
      const safe = String(fileId).replace(/[^A-Za-z0-9._-]/g, '_');
      const rel = `${subdir}/${safe}`;
      const p = abs(rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, buffer);
      return rel;
    },
    read(row) {
      return fs.readFileSync(abs(typeof row === 'string' ? row : row.storage));
    },
    exists(row) {
      try {
        return fs.existsSync(abs(typeof row === 'string' ? row : row.storage));
      } catch (_) {
        return false;
      }
    },
    remove(row) {
      try {
        fs.rmSync(abs(typeof row === 'string' ? row : row.storage), { force: true });
      } catch (_) {
        /* ignore */
      }
    },
    /** ล้างไฟล์ทั้งหมด (reset) */
    wipe() {
      fs.mkdirSync(root, { recursive: true });
      for (const name of fs.readdirSync(root)) {
        fs.rmSync(path.join(root, name), { recursive: true, force: true });
      }
    },
  };
}

module.exports = { createStorage, detectType, MAX_FILE_BYTES, MAX_FILES_PER_CASE };

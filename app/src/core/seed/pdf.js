'use strict';
// สร้าง PDF จริงขนาดเล็ก (1 หน้า ข้อความ ASCII) แบบ deterministic สำหรับไฟล์แนบของ seed
// ไม่มีข้อมูลส่วนบุคคลในไฟล์

function esc(s) {
  return String(s).replace(/[^\x20-\x7e]/g, '?').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** @param {string[]} lines ข้อความ ASCII แต่ละบรรทัด */
function minimalPdf(lines) {
  const textOps = lines.map((l, i) => (i === 0 ? `(${esc(l)}) Tj` : `0 -20 Td (${esc(l)}) Tj`)).join('\n');
  const stream = `BT\n/F1 14 Tf\n72 770 Td\n${textOps}\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

module.exports = { minimalPdf };

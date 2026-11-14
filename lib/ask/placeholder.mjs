// A stand-in picture for the ask page examples, so `wf ask example <template>`
// builds as it is in a project that has none of the screens it names. A plain
// PNG the kit writes itself: a ground, a header band, a side bar, and a few
// rows, wide or narrow by the file's name.

import { deflateSync } from "node:zlib";

const TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** Whether a picture's name says it is a narrow screen. */
export const narrow = (name) => /narrow|phone|mobile/i.test(name);

/** A placeholder screen as PNG bytes: 960 by 600, or 390 by 700 for a narrow one; `tone` shifts its accent so two differ. */
export function placeholderPng(name, tone = 0) {
  const [w, h] = narrow(name) ? [390, 700] : [960, 600];
  const side = narrow(name) ? 0 : 200;
  const accent = [[64, 120, 200], [200, 110, 60], [70, 160, 110]][tone % 3];
  const at = (x, y) => {
    if (y < 48) return [38, 42, 54];
    if (x < side) return [228, 230, 236];
    const row = Math.floor((y - 80) / 56);
    const inRow = y >= 80 && (y - 80) % 56 < 36 && x > side + 24 && x < w - 24 && row < 7;
    if (inRow) return row === 1 ? accent : [214, 218, 226];
    return [246, 247, 250];
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const line = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) raw.set(at(x, y), line + 1 + x * 3);
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

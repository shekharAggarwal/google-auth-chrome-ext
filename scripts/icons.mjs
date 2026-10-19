// Generates the extension icons (no image tooling needed): a blue rounded square with a white padlock.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

// Signed-distance helpers in a unit square [0,1]^2.
const roundRect = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const ring = (x, y, cx, cy, r, w) => Math.abs(Math.hypot(x - cx, y - cy) - r) - w;

function shade(x, y) {
  const bg = roundRect(x, y, 0.5, 0.5, 0.5, 0.5, 0.22);
  const body = roundRect(x, y, 0.5, 0.62, 0.24, 0.18, 0.04);
  const shackle = y < 0.46 ? ring(x, y, 0.5, 0.4, 0.14, 0.045) : Infinity;
  const shackleLegs = Math.min(roundRect(x, y, 0.36, 0.46, 0.045, 0.06, 0), roundRect(x, y, 0.64, 0.46, 0.045, 0.06, 0));
  const hole = Math.hypot(x - 0.5, y - 0.6) - 0.045;
  const lock = Math.max(Math.min(body, shackle, shackleLegs), -hole);
  return { bg, lock };
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const ss = 4;
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let a = 0, white = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const { bg, lock } = shade((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
        if (bg <= 0) { a++; if (lock <= 0) white++; }
      }
      const n = ss * ss, t = a ? white / a : 0;
      const o = py * (size * 4 + 1) + 1 + px * 4;
      raw[o] = Math.round(26 + (255 - 26) * t);
      raw[o + 1] = Math.round(115 + (255 - 115) * t);
      raw[o + 2] = Math.round(232 + (255 - 232) * t);
      raw[o + 3] = Math.round((a / n) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
for (const s of [16, 32, 48, 128]) writeFileSync(`public/icons/${s}.png`, png(s));
console.log('icons written');

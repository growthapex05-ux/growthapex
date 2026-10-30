// Generates assets/icon.png (512) and assets/tray.png (32): a blue rounded square with a white clock.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function icon(x, y, s) {
  const u = x / s, v = y / s;
  // rounded square
  const r = 0.22, dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0), dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
  if (Math.hypot(dx, dy) > r) return [0, 0, 0, 0];
  const t = (u + v) / 2;
  let col = [Math.round(37 + (6 - 37) * t), Math.round(99 + (182 - 99) * t), Math.round(235 + (212 - 235) * t), 255];
  // clock: white ring + hands
  const cx = u - 0.5, cy = v - 0.5, d = Math.hypot(cx, cy);
  const white = [255, 255, 255, 255];
  if (d > 0.27 && d < 0.33) return white;
  if (Math.abs(cx) < 0.03 && cy < 0.02 && cy > -0.2) return white;          // minute hand (up)
  if (Math.abs(cy) < 0.03 && cx > -0.02 && cx < 0.14) return white;         // hour hand (right)
  if (d < 0.045) return white;
  return col;
}

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), png(512, icon));
fs.writeFileSync(path.join(out, 'tray.png'), png(32, icon));
console.log('icons written to', out);

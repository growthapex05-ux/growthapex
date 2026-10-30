// Builds the app images from the GrowthApex logo (assets/images/logo/growthapex-logo.png):
//   assets/mark.png  — 160 px logo mark on transparent, for the window header
//   assets/icon.png  — 512 px app icon: the logo mark on a white rounded square
//   assets/tray.png  — 32 px tray icon: the logo mark
// Run with Electron (uses nativeImage): npx electron scripts/make-icons.js
const fs = require('fs');
const path = require('path');
const { app, nativeImage } = require('electron');

const src = path.join(__dirname, '..', '..', 'assets', 'images', 'logo', 'growthapex-logo.png');
const out = f => path.join(__dirname, '..', 'assets', f);
const MARK = { x: 55, y: 45, width: 650, height: 600 }; // logo mark (left part), source pixels

// Bounding box of non-transparent pixels (BGRA bitmap)
function trim(img) {
  const { width, height } = img.getSize();
  const px = img.toBitmap();
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (px[(y * width + x) * 4 + 3] > 12) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  return img.crop({ x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 });
}

// Centre `img` in a size×size square, optionally on a white rounded square
function square(img, size, pad, background) {
  const s = img.getSize();
  const k = (size * (1 - 2 * pad)) / Math.max(s.width, s.height);
  const w = Math.round(s.width * k), h = Math.round(s.height * k);
  const fg = img.resize({ width: w, height: h, quality: 'best' }).toBitmap();
  const buf = Buffer.alloc(size * size * 4);
  const ox = Math.round((size - w) / 2), oy = Math.round((size - h) / 2), r = size * 0.22;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4;
    if (background) {
      const dx = Math.max(Math.abs(x + 0.5 - size / 2) - (size / 2 - r), 0), dy = Math.max(Math.abs(y + 0.5 - size / 2) - (size / 2 - r), 0);
      if (Math.hypot(dx, dy) <= r) { buf[o] = buf[o + 1] = buf[o + 2] = buf[o + 3] = 255; }
    }
    const fx = x - ox, fy = y - oy;
    if (fx < 0 || fy < 0 || fx >= w || fy >= h) continue;
    const f = (fy * w + fx) * 4, a = fg[f + 3] / 255;
    for (let c = 0; c < 3; c++) buf[o + c] = Math.round(fg[f + c] * a + buf[o + c] * (1 - a) * (buf[o + 3] / 255));
    buf[o + 3] = Math.max(buf[o + 3], fg[f + 3]);
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

app.whenReady().then(() => {
  const logo = nativeImage.createFromPath(src);
  if (logo.isEmpty()) throw new Error(`Logo not found: ${src}`);
  const mark = trim(logo.crop(MARK));
  fs.writeFileSync(out('icon.png'), square(mark, 512, 0.14, true).toPNG());
  fs.writeFileSync(out('mark.png'), square(mark, 160, 0.02, false).toPNG());
  fs.writeFileSync(out('tray.png'), square(mark, 32, 0.02, false).toPNG());
  console.log('assets: mark.png, icon.png, tray.png');
  app.exit(0);
});

// Generates the app icons (a white heart on a pink-to-plum gradient) as PNGs, with no dependencies.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
fs.mkdirSync(OUT, { recursive: true });

const inHeart = (x, y) => (x * x + y * y - 1) ** 3 - x * x * y ** 3 <= 0;

function render(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const samples = 4;
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      // Background gradient from top-left pink to bottom-right plum.
      const t = (px + py) / (2 * size);
      let r = 255 + (122 - 255) * t;
      let g = 92 + (45 - 92) * t;
      let b = 138 + (110 - 138) * t;

      // Heart fills ~45% of the icon so it stays inside the maskable safe zone.
      let hits = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = ((px + (sx + 0.5) / samples) / size - 0.5) * 3.2;
          const y = -((py + (sy + 0.5) / samples) / size - 0.53) * 3.2;
          if (inHeart(x, y)) hits++;
        }
      }
      const a = hits / samples ** 2;
      r += (255 - r) * a;
      g += (246 - g) * a;
      b += (249 - b) * a;

      const i = py * (size * 4 + 1) + 1 + px * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = 255;
    }
  }
  return raw;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([len, body, crc]);
}

for (const size of [192, 512]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(render(size))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(path.join(OUT, `icon-${size}.png`), png);
  console.log(`wrote icon-${size}.png`);
}

// Renders PWA icons from the brand mark: purple #7B3FF2 rounded square + white "R".
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const svg = (size, { radius, scale }) => {
  const fs = Math.round(size * 0.58 * scale);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="#7B3FF2"/>
  <text x="${size / 2}" y="${size / 2 + fs * 0.35}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="800" font-size="${fs}" fill="#fff">R</text></svg>`);
};
const out = async (name, size, o) => writeFileSync(`public/${name}`, await sharp(svg(size, o)).png().toBuffer());
await out('pwa-192.png', 192, { radius: 44, scale: 1 });
await out('pwa-512.png', 512, { radius: 112, scale: 1 });
await out('pwa-maskable-512.png', 512, { radius: 0, scale: 0.7 }); // full-bleed, glyph inside the safe zone
await out('apple-touch-icon.png', 180, { radius: 0, scale: 0.85 });

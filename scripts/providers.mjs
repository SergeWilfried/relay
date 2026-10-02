// Optimises the source provider logos in design-assets/providers into 128px PNGs in public/providers.
// Orange's source is a wide wordmark on black; at chip size it is unreadable, so we crop to the arrow mark.
import sharp from 'sharp';

const jobs = [
  { src: 'Wave.png', out: 'wave' },
  { src: 'orange-money.png', out: 'orange', crop: { left: 40, top: 125, width: 200, height: 200 } },
  { src: 'moov-money.png', out: 'moov' },
  { src: 'pi-spi.png', out: 'pispi' },
];
for (const { src, out, crop } of jobs) {
  let img = sharp(`design-assets/providers/${src}`);
  if (crop) img = img.extract(crop);
  await img.resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toFile(`public/providers/${out}.png`);
}

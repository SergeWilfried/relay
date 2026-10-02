// Square (centre-cropped) 96px flags for circular avatars, from design-assets/country -> public/country.
import sharp from 'sharp';
const map = { 'sen.webp': 'sn', 'civ.png': 'ci', 'bfa.webp': 'bf' };
for (const [src, out] of Object.entries(map)) {
  await sharp(`design-assets/country/${src}`).resize(96, 96, { fit: 'cover', position: 'centre' }).png({ compressionLevel: 9 }).toFile(`public/country/${out}.png`);
}

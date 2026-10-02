// Optimises the source token logos in design-assets/tokens into small PNGs served from /tokens.
import sharp from 'sharp';
const map = { 'Bitcoin.svg.webp': 'btc', 'Solana_logo.png': 'sol', 'USDT_Logo.png': 'usdt', 'usdc.png': 'usdc' };
for (const [src, name] of Object.entries(map)) {
  await sharp(`design-assets/tokens/${src}`).resize(96, 96, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toFile(`public/tokens/${name}.png`);
}

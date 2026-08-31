/**
 * Generates PNG PWA icons required for Android "Install app" (not just shortcut).
 * Run: node scripts/generate-pwa-icons.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const svgPath = path.join(publicDir, 'icon-512.svg');

async function main() {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.warn('[PWA icons] sharp not installed — run: npm install -D sharp');
    process.exit(0);
  }

  const svg = fs.readFileSync(svgPath);
  for (const size of [192, 512]) {
    const out = path.join(publicDir, `icon-${size}.png`);
    await sharp(svg).resize(size, size).png().toFile(out);
    console.log(`Wrote ${out}`);
  }

  // Maskable: icon with safe-zone padding (~20%)
  const maskable = path.join(publicDir, 'icon-maskable-512.png');
  const inner = 410;
  const padded = await sharp(svg)
    .resize(inner, inner)
    .extend({
      top: 51,
      bottom: 51,
      left: 51,
      right: 51,
      background: { r: 18, g: 18, b: 18, alpha: 1 },
    })
    .png()
    .toBuffer();
  await sharp(padded).resize(512, 512).png().toFile(maskable);
  console.log(`Wrote ${maskable}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

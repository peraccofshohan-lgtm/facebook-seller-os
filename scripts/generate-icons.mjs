/**
 * Generates all PWA icons and the favicon from an inline SVG source.
 *
 * Run: `npm run icons`
 * Output: public/icons/{icon.svg, icon-192.png, icon-512.png, apple-touch-icon.png}, public/favicon.ico
 *
 * No webfonts, no external assets: the monogram is drawn from a plain path so the
 * generated PNGs are byte-for-byte reproducible on any machine that has sharp.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '..', 'public');
const iconsDir = resolve(publicDir, 'icons');

/** A simple monogram: rounded square + a stylised "S" (for Seller) in white. */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#166534"/>
      <stop offset="1" stop-color="#15803d"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#g)"/>
  <path d="M330 176c-9.5-17.5-29-29-52.5-29-32.5 0-55.5 17.5-55.5 43 0 24 17.5 36.5 50 43.5 41 9 63.5 22.5 63.5 51.5 0 31-27.5 53.5-65.5 53.5-30.5 0-53-12-64-32"
        fill="none" stroke="#ffffff" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="256" cy="256" r="0" fill="none"/>
</svg>`;

const maskable = svg.replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512"');

async function main() {
  await mkdir(iconsDir, { recursive: true });
  await writeFile(resolve(iconsDir, 'icon.svg'), svg, 'utf8');

  const sizes = [
    { file: 'icon-192.png', size: 192, padded: false },
    { file: 'icon-512.png', size: 512, padded: false },
    { file: 'icon-maskable-512.png', size: 512, padded: true },
    { file: 'apple-touch-icon.png', size: 180, padded: false },
  ];

  for (const { file, size, padded } of sizes) {
    const source = padded ? maskable : svg;
    // Maskable icons need safe-zone padding: the artwork lives inside the inner 80%.
    const inner = padded ? Math.round(size * 0.8) : size;
    await sharp(Buffer.from(source))
      .resize(inner, inner)
      .flatten({ background: '#15803d' })
      .extend({
        top: Math.round((size - inner) / 2),
        bottom: size - inner - Math.round((size - inner) / 2),
        left: Math.round((size - inner) / 2),
        right: size - inner - Math.round((size - inner) / 2),
        background: '#15803d',
      })
      .png({ compressionLevel: 9 })
      .toFile(resolve(iconsDir, file));
    console.log(`icons/${file} (${size}x${size})`);
  }

  // favicon.ico: multi-size ICO built from PNG frames (32 + 16).
  const ico = await sharp(Buffer.from(svg)).resize(64, 64).png().toBuffer();
  const ico16 = await sharp(Buffer.from(svg)).resize(16, 16).png().toBuffer();
  await writeIco(resolve(publicDir, 'favicon.ico'), [ico, ico16]);
  console.log('favicon.ico');
}

/**
 * Minimal ICO writer. Windows expects a 6-byte header + 16-byte directory entries
 * followed by the raw image payloads; PNG frames are valid in Vista+ ICO files.
 */
async function writeIco(target, pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);

  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const png of pngs) {
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(16 + 4);
    const size = png.length;
    const entry = Buffer.alloc(16);
    entry.writeUInt8(width >= 256 ? 0 : width, 0);
    entry.writeUInt8(height >= 256 ? 0 : height, 1);
    entry.writeUInt8(0, 2); // palette count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(size, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += size;
  }

  await writeFile(target, Buffer.concat([header, ...entries, ...pngs]));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

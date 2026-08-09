// Generates simple PNG icons as SVG-based data for the PWA
// Run: node generate-icons.js
const fs = require('fs');
const path = require('path');

function makeSVG(size) {
  const r = Math.round(size * 0.15);
  const innerSize = Math.round(size * 0.45);
  const innerR = Math.round(size * 0.08);
  const cx = size / 2;
  const cy = size / 2;
  const fontSize = Math.round(size * 0.32);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="#0f1720"/>
  <rect x="${cx - innerSize/2}" y="${cy - innerSize/2}" width="${innerSize}" height="${innerSize}" rx="${innerR}" fill="#FFD100"/>
  <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="Arial,sans-serif" font-weight="900" font-size="${fontSize}" fill="#000">T</text>
</svg>`;
}

// Write SVG files that can be used directly (browsers support SVG icons)
// For maximum compat, write as .png extension but SVG content won't work for all.
// Instead, let's write proper SVGs and reference them.

const publicDir = path.join(__dirname, 'public');

// Write SVG icons
fs.writeFileSync(path.join(publicDir, 'icon-192.svg'), makeSVG(192));
fs.writeFileSync(path.join(publicDir, 'icon-512.svg'), makeSVG(512));

// For PNG fallback, write a simple HTML that can be screenshot'd, or use the SVGs directly
// Most modern Android browsers support SVG icons in manifests.
// Let's update manifest to use SVG

console.log('SVG icons generated. Updating manifest...');

const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, 'manifest.json'), 'utf8'));
manifest.icons = [
  { src: '/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
  { src: '/icon-512.svg', sizes: '512x512', type: 'image/svg+xml' },
  { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }
];
fs.writeFileSync(path.join(publicDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

// Also write a general-purpose icon
fs.writeFileSync(path.join(publicDir, 'icon.svg'), makeSVG(512));

console.log('Done!');

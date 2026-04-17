/**
 * Копирует веб-сборку в www/ для `npx cap sync`.
 * Без этого в iOS/Android попадает пустой webDir — белый экран.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const www = path.join(root, 'www');

const dirs = ['pages', 'icons', 'icon-animations', 'nav'];
const files = [
  'index.html',
  'script.js',
  'styles.css',
  'sw.js',
  'manifest.json',
  'gestures.js',
  'swipe-engine.js'
];

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

rmrf(www);
fs.mkdirSync(www, { recursive: true });

for (const d of dirs) {
  const src = path.join(root, d);
  if (fs.existsSync(src)) {
    fs.cpSync(src, path.join(www, d), { recursive: true });
  }
}

for (const f of files) {
  const src = path.join(root, f);
  if (!fs.existsSync(src)) {
    console.warn('[prepare-web] пропуск (нет файла):', f);
    continue;
  }
  fs.copyFileSync(src, path.join(www, f));
}

console.log('[prepare-web] готово →', www);

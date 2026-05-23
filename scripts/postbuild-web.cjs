const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'www');
const buildStamp = String(Date.now());

const copyDirs = ['icons', 'icon-animations'];
const copyFiles = ['manifest.json', 'sw.js'];

for (const dirName of copyDirs) {
  const src = path.join(root, dirName);
  const dest = path.join(outDir, dirName);
  if (!fs.existsSync(src)) continue;
  fs.cpSync(src, dest, { recursive: true });
}

for (const fileName of copyFiles) {
  const src = path.join(root, fileName);
  const dest = path.join(outDir, fileName);
  if (!fs.existsSync(src)) continue;
  fs.copyFileSync(src, dest);
}

const builtIndexPath = path.join(outDir, 'index.html');
if (fs.existsSync(builtIndexPath)) {
  const html = fs.readFileSync(builtIndexPath, 'utf8');
  const buildStampScript = `    <script>window.__TD_BUILD_STAMP__ = ${JSON.stringify(buildStamp)};</script>\n`;
  const patchedHtml = html.includes('</head>')
    ? html.replace('</head>', `${buildStampScript}</head>`)
    : `${buildStampScript}${html}`;
  fs.writeFileSync(builtIndexPath, patchedHtml, 'utf8');
}

console.log('[postbuild-web] static assets copied ->', outDir, '| buildStamp =', buildStamp);

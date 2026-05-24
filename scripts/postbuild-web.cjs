const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'www');
const buildStamp = String(Date.now());
const swTemplatePath = path.join(root, 'sw.js');

const copyDirs = ['icons', 'icon-animations'];
const copyFiles = ['manifest.json', 'sw.js'];

function toPosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function walkFiles(dirPath, bucket = []) {
  if (!fs.existsSync(dirPath)) return bucket;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, bucket);
      continue;
    }
    bucket.push(fullPath);
  }

  return bucket;
}

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

const precacheFiles = walkFiles(outDir)
  .map((fullPath) => path.relative(outDir, fullPath))
  .map((relativePath) => `./${toPosixPath(relativePath)}`)
  .filter((relativePath) => relativePath !== './sw.js')
  .sort((a, b) => a.localeCompare(b, 'en'));

if (!precacheFiles.includes('./')) {
  precacheFiles.unshift('./');
}
if (!precacheFiles.includes('./index.html')) {
  precacheFiles.unshift('./index.html');
}

const swOutPath = path.join(outDir, 'sw.js');
if (fs.existsSync(swTemplatePath) && fs.existsSync(swOutPath)) {
  const cacheName = `training-diary-${buildStamp}`;
  const swTemplate = fs.readFileSync(swTemplatePath, 'utf8');
  const swBootstrap = [
    `self.__TD_CACHE_NAME__ = ${JSON.stringify(cacheName)};`,
    `self.__TD_PRECACHE_URLS__ = ${JSON.stringify(precacheFiles, null, 2)};`,
    ''
  ].join('\n');
  const patchedSw = `${swBootstrap}${swTemplate}`;
  fs.writeFileSync(swOutPath, patchedSw, 'utf8');
}

console.log('[postbuild-web] static assets copied ->', outDir, '| buildStamp =', buildStamp, '| precache =', precacheFiles.length);

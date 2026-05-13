/**
 * Removes UTF-8 mojibake mega-comments from styles.css.
 * Run: node scripts/strip-styles-mojibake.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.join(__dirname, '..', 'styles.css');

const MOJIBAKE = /\u00c3\u0192|\u00c3Æ|ÃƒÆ|Ã¢â‚¬/;

function stripMojibakeFromLine(line) {
    if (!MOJIBAKE.test(line)) return line;

    const lastClose = line.lastIndexOf('*/');
    if (lastClose === -1) return '';

    const after = line.slice(lastClose + 2).trim();
    if (after.length > 0 && /[;{}]|::?root|[.#][\w-]/.test(after)) {
        const indent = /^(\s*)/.exec(line)?.[1] ?? '';
        return indent + after;
    }
    return '';
}

function removeNavPlaceholderBlocks(lines) {
    const out = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const openOnly = /^\s*\/\*\s*$/.test(line);
        if (openOnly && lines[i + 1]?.includes('#main-nav-switcher')) {
            let j = i + 1;
            while (j < lines.length && !/^\s*\*\/\s*$/.test(lines[j])) j++;
            if (j < lines.length) {
                i = j + 1;
                continue;
            }
        }
        out.push(line);
        i++;
    }
    return out;
}

const raw = fs.readFileSync(cssPath, 'utf8');
let lines = raw.split(/\r?\n/);
const beforeBytes = Buffer.byteLength(raw, 'utf8');

lines = lines.map((line) => stripMojibakeFromLine(line));
lines = lines.filter((line) => line.length > 0);
lines = removeNavPlaceholderBlocks(lines);

// Drop consecutive empty lines (max one blank)
const compact = [];
for (const line of lines) {
    if (line.trim() === '' && compact.length && compact[compact.length - 1].trim() === '') continue;
    compact.push(line);
}

const result = compact.join('\n') + (raw.endsWith('\n') ? '\n' : '');
const afterBytes = Buffer.byteLength(result, 'utf8');

fs.writeFileSync(cssPath, result, 'utf8');
console.log(`styles.css: ${beforeBytes} → ${afterBytes} bytes (${((1 - afterBytes / beforeBytes) * 100).toFixed(1)}% smaller)`);

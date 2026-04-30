const fs = require('fs');
const path = require('path');

const CALLBACK_SCHEME = 'App';
const root = path.join(__dirname, '..');
const infoPlistPath = path.join(root, 'ios', 'App', 'App', 'Info.plist');

function ensureCustomUrlScheme(plistContent, scheme) {
  const escapedScheme = scheme.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const schemeRegex = new RegExp(`<string>${escapedScheme}</string>`, 'i');
  if (schemeRegex.test(plistContent)) {
    return { changed: false, content: plistContent };
  }

  if (plistContent.includes('<key>CFBundleURLTypes</key>')) {
    const urlSchemesArrayRegex =
      /(<key>CFBundleURLTypes<\/key>\s*<array>\s*<dict>[\s\S]*?<key>CFBundleURLSchemes<\/key>\s*<array>)([\s\S]*?)(\s*<\/array>)/i;

    if (urlSchemesArrayRegex.test(plistContent)) {
      return {
        changed: true,
        content: plistContent.replace(
          urlSchemesArrayRegex,
          `$1$2\n\t\t\t\t<string>${scheme}</string>$3`
        )
      };
    }
  }

  const urlTypesBlock = `
\t<key>CFBundleURLTypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>CFBundleTypeRole</key>
\t\t\t<string>Editor</string>
\t\t\t<key>CFBundleURLName</key>
\t\t\t<string>com.trenpetrov.trainingdiary.shortcuts</string>
\t\t\t<key>CFBundleURLSchemes</key>
\t\t\t<array>
\t\t\t\t<string>${scheme}</string>
\t\t\t</array>
\t\t</dict>
\t</array>
`;

  const closingDictTag = '\n</dict>\n</plist>';
  if (!plistContent.includes(closingDictTag)) {
    throw new Error('Could not find the closing </dict></plist> sequence in Info.plist.');
  }

  return {
    changed: true,
    content: plistContent.replace(closingDictTag, `${urlTypesBlock}${closingDictTag}`)
  };
}

function main() {
  if (!fs.existsSync(infoPlistPath)) {
    console.log(`[configure-capacitor-ios] skipped: ${infoPlistPath} not found`);
    return;
  }

  const original = fs.readFileSync(infoPlistPath, 'utf8');
  const result = ensureCustomUrlScheme(original, CALLBACK_SCHEME);

  if (!result.changed) {
    console.log(`[configure-capacitor-ios] already configured with URL scheme "${CALLBACK_SCHEME}"`);
    return;
  }

  fs.writeFileSync(infoPlistPath, result.content, 'utf8');
  console.log(`[configure-capacitor-ios] added URL scheme "${CALLBACK_SCHEME}" to ${infoPlistPath}`);
}

main();

const fs = require('fs');
const path = require('path');

const CALLBACK_SCHEME = 'App';
const root = path.join(__dirname, '..');
const infoPlistPath = path.join(root, 'ios', 'App', 'App', 'Info.plist');
const IOS_PRIVACY_MESSAGES = {
  NSCameraUsageDescription: 'Камера используется для фото и видео в тренировках и приемах пищи.',
  NSPhotoLibraryUsageDescription: 'Доступ к фото нужен, чтобы выбирать изображения и видео для тренировок и приемов пищи.',
  NSMicrophoneUsageDescription: 'Микрофон используется при записи видео в тренировках.'
};

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

function ensurePlistStringValue(plistContent, key, value) {
  const keyRegex = new RegExp(`(<key>${key}<\\/key>\\s*<string>)([^<]*)(<\\/string>)`, 'i');
  if (keyRegex.test(plistContent)) {
    return {
      changed: !new RegExp(`(<key>${key}<\\/key>\\s*<string>${value}<\\/string>)`, 'i').test(plistContent),
      content: plistContent.replace(keyRegex, `$1${value}$3`)
    };
  }

  const insertion = `\n\t<key>${key}</key>\n\t<string>${value}</string>`;
  const closingDictTag = '\n</dict>\n</plist>';
  if (!plistContent.includes(closingDictTag)) {
    throw new Error(`Could not find the closing </dict></plist> sequence while inserting ${key}.`);
  }

  return {
    changed: true,
    content: plistContent.replace(closingDictTag, `${insertion}${closingDictTag}`)
  };
}

function ensurePlistBoolValue(plistContent, key, boolValue) {
  const valueTag = boolValue ? '<true/>' : '<false/>';
  const keyRegex = new RegExp(`(<key>${key}<\\/key>\\s*)(<true\\/>|<false\\/>)`, 'i');
  if (keyRegex.test(plistContent)) {
    return {
      changed: !new RegExp(`(<key>${key}<\\/key>\\s*${valueTag})`, 'i').test(plistContent),
      content: plistContent.replace(keyRegex, `$1${valueTag}`)
    };
  }

  const insertion = `\n\t<key>${key}</key>\n\t${valueTag}`;
  const closingDictTag = '\n</dict>\n</plist>';
  if (!plistContent.includes(closingDictTag)) {
    throw new Error(`Could not find the closing </dict></plist> sequence while inserting ${key}.`);
  }

  return {
    changed: true,
    content: plistContent.replace(closingDictTag, `${insertion}${closingDictTag}`)
  };
}

function main() {
  if (!fs.existsSync(infoPlistPath)) {
    console.log(`[configure-capacitor-ios] skipped: ${infoPlistPath} not found`);
    return;
  }

  const original = fs.readFileSync(infoPlistPath, 'utf8');
  let content = original;
  let changed = false;

  const schemeResult = ensureCustomUrlScheme(content, CALLBACK_SCHEME);
  content = schemeResult.content;
  changed = changed || schemeResult.changed;

  const controllerAppearanceResult = ensurePlistBoolValue(
    content,
    'UIViewControllerBasedStatusBarAppearance',
    true
  );
  content = controllerAppearanceResult.content;
  changed = changed || controllerAppearanceResult.changed;

  const styleResult = ensurePlistStringValue(content, 'UIStatusBarStyle', 'UIStatusBarStyleDarkContent');
  content = styleResult.content;
  changed = changed || styleResult.changed;

  for (const [key, value] of Object.entries(IOS_PRIVACY_MESSAGES)) {
    const result = ensurePlistStringValue(content, key, value);
    content = result.content;
    changed = changed || result.changed;
  }

  if (!changed) {
    console.log(
      `[configure-capacitor-ios] already configured with URL scheme "${CALLBACK_SCHEME}", dark-content status bar defaults, and iOS privacy usage descriptions`
    );
    return;
  }

  fs.writeFileSync(infoPlistPath, content, 'utf8');
  console.log(
    `[configure-capacitor-ios] updated ${infoPlistPath} with URL scheme "${CALLBACK_SCHEME}", dark-content status bar defaults, and iOS privacy usage descriptions`
  );
}

main();

const fs = require('fs');
const path = require('path');

const CALLBACK_SCHEME = 'App';
const root = path.join(__dirname, '..');
const infoPlistPath = path.join(root, 'ios', 'App', 'App', 'Info.plist');
const appDelegatePath = path.join(root, 'ios', 'App', 'App', 'AppDelegate.swift');
const mainStoryboardPath = path.join(root, 'ios', 'App', 'App', 'Base.lproj', 'Main.storyboard');
const IOS_PRIVACY_MESSAGES = {
  NSCameraUsageDescription: 'Камера используется для фото и видео в тренировках и приемах пищи.',
  NSPhotoLibraryUsageDescription: 'Доступ к фото нужен, чтобы выбирать изображения и видео для тренировок и приемов пищи.',
  NSMicrophoneUsageDescription: 'Микрофон используется при записи видео в тренировках.'
};
const PROVISIONING_PLUGIN_MARKER_START = '// [TrainingDiaryProvisioningProfile:start]';
const PROVISIONING_PLUGIN_MARKER_END = '// [TrainingDiaryProvisioningProfile:end]';
const IOS_BRIDGE_VIEW_CONTROLLER_CLASS = 'TrialAwareViewController';

const PROVISIONING_PLUGIN_SWIFT_BLOCK = `
${PROVISIONING_PLUGIN_MARKER_START}
private enum TrainingDiaryProvisioningProfileReader {
  static func decodeProfile() -> [String: Any]? {
    guard let profileUrl = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
          let rawData = try? Data(contentsOf: profileUrl),
          let rawString = String(data: rawData, encoding: .isoLatin1) ?? String(data: rawData, encoding: .ascii),
          let plistStart = rawString.range(of: "<?xml"),
          let plistEnd = rawString.range(of: "</plist>") else {
      return nil
    }

    let plistString = String(rawString[plistStart.lowerBound..<plistEnd.upperBound])
    guard let plistData = plistString.data(using: .utf8),
          let plist = try? PropertyListSerialization.propertyList(from: plistData, options: [], format: nil) as? [String: Any] else {
      return nil
    }

    return plist
  }

  static func isoString(from value: Any?) -> String? {
    guard let date = value as? Date else { return nil }
    return ISO8601DateFormatter().string(from: date)
  }
}

@objc(ProvisioningProfilePlugin)
class ProvisioningProfilePlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "ProvisioningProfilePlugin"
  public let jsName = "ProvisioningProfile"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "getInfo", returnType: CAPPluginReturnPromise)
  ]

  @objc func getInfo(_ call: CAPPluginCall) {
    guard let profile = TrainingDiaryProvisioningProfileReader.decodeProfile() else {
      call.resolve(["available": false])
      return
    }

    var payload: [String: Any] = [
      "available": true
    ]

    if let expiresAt = TrainingDiaryProvisioningProfileReader.isoString(from: profile["ExpirationDate"]) {
      payload["expiresAt"] = expiresAt
    }

    if let issuedAt = TrainingDiaryProvisioningProfileReader.isoString(from: profile["CreationDate"]) {
      payload["issuedAt"] = issuedAt
    }

    if let name = profile["Name"] as? String, !name.isEmpty {
      payload["name"] = name
    }

    if let uuid = profile["UUID"] as? String, !uuid.isEmpty {
      payload["uuid"] = uuid
    }

    if let ttlDays = profile["TimeToLive"] as? NSNumber {
      payload["timeToLiveDays"] = ttlDays.intValue
    }

    call.resolve(payload)
  }
}

class ${IOS_BRIDGE_VIEW_CONTROLLER_CLASS}: CAPBridgeViewController {
  override open func capacitorDidLoad() {
    super.capacitorDidLoad()
    bridge?.registerPluginType(ProvisioningProfilePlugin.self)
  }
}
${PROVISIONING_PLUGIN_MARKER_END}
`.trim();

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

function ensureSwiftImport(swiftContent, moduleName) {
  const importRegex = new RegExp(`^import\\s+${moduleName}\\s*$`, 'm');
  if (importRegex.test(swiftContent)) {
    return { changed: false, content: swiftContent };
  }

  const firstImportRegex = /^import\s+\w+\s*$/m;
  const match = swiftContent.match(firstImportRegex);
  if (!match || match.index == null) {
    return {
      changed: true,
      content: `import ${moduleName}\n${swiftContent}`
    };
  }

  const insertAt = match.index + match[0].length;
  return {
    changed: true,
    content: `${swiftContent.slice(0, insertAt)}\nimport ${moduleName}${swiftContent.slice(insertAt)}`
  };
}

function ensureMarkedSwiftBlock(swiftContent, block, insertBeforePattern) {
  if (
    swiftContent.includes(PROVISIONING_PLUGIN_MARKER_START) &&
    swiftContent.includes(PROVISIONING_PLUGIN_MARKER_END)
  ) {
    const regex = new RegExp(
      `${PROVISIONING_PLUGIN_MARKER_START}[\\s\\S]*?${PROVISIONING_PLUGIN_MARKER_END}`,
      'm'
    );
    return {
      changed: !regex.test(swiftContent) || swiftContent.match(regex)?.[0] !== block,
      content: swiftContent.replace(regex, block)
    };
  }

  if (!insertBeforePattern.test(swiftContent)) {
    throw new Error('Could not find insertion point for provisioning profile bridge in AppDelegate.swift.');
  }

  return {
    changed: true,
    content: swiftContent.replace(insertBeforePattern, `${block}\n\n$&`)
  };
}

function ensureStoryboardViewControllerClass(storyboardContent, className) {
  const currentClassRegex = new RegExp(
    `customClass="(?:CAPBridgeViewController|${IOS_BRIDGE_VIEW_CONTROLLER_CLASS})"`
  );
  if (!currentClassRegex.test(storyboardContent)) {
    return { changed: false, content: storyboardContent };
  }

  const nextContent = storyboardContent.replace(currentClassRegex, `customClass="${className}"`);
  return {
    changed: nextContent !== storyboardContent,
    content: nextContent
  };
}

function main() {
  if (!fs.existsSync(infoPlistPath)) {
    console.log(`[configure-capacitor-ios] skipped: ${infoPlistPath} not found`);
    return;
  }

  const original = fs.readFileSync(infoPlistPath, 'utf8');
  let content = original;
  let plistChanged = false;

  const schemeResult = ensureCustomUrlScheme(content, CALLBACK_SCHEME);
  content = schemeResult.content;
  plistChanged = plistChanged || schemeResult.changed;

  const controllerAppearanceResult = ensurePlistBoolValue(
    content,
    'UIViewControllerBasedStatusBarAppearance',
    true
  );
  content = controllerAppearanceResult.content;
  plistChanged = plistChanged || controllerAppearanceResult.changed;

  const styleResult = ensurePlistStringValue(content, 'UIStatusBarStyle', 'UIStatusBarStyleDarkContent');
  content = styleResult.content;
  plistChanged = plistChanged || styleResult.changed;

  for (const [key, value] of Object.entries(IOS_PRIVACY_MESSAGES)) {
    const result = ensurePlistStringValue(content, key, value);
    content = result.content;
    plistChanged = plistChanged || result.changed;
  }

  if (plistChanged) {
    fs.writeFileSync(infoPlistPath, content, 'utf8');
  }

  let swiftChanged = false;
  if (fs.existsSync(appDelegatePath)) {
    let swiftContent = fs.readFileSync(appDelegatePath, 'utf8');

    const capacitorImportResult = ensureSwiftImport(swiftContent, 'Capacitor');
    swiftContent = capacitorImportResult.content;
    swiftChanged = swiftChanged || capacitorImportResult.changed;

    const blockResult = ensureMarkedSwiftBlock(
      swiftContent,
      PROVISIONING_PLUGIN_SWIFT_BLOCK,
      /@UIApplicationMain|@main|class\s+AppDelegate\b/
    );
    swiftContent = blockResult.content;
    swiftChanged = swiftChanged || blockResult.changed;

    if (swiftChanged) {
      fs.writeFileSync(appDelegatePath, swiftContent, 'utf8');
    }
  } else {
    console.log(`[configure-capacitor-ios] skipped AppDelegate patch: ${appDelegatePath} not found`);
  }

  let storyboardChanged = false;
  if (fs.existsSync(mainStoryboardPath)) {
    const storyboardOriginal = fs.readFileSync(mainStoryboardPath, 'utf8');
    const storyboardResult = ensureStoryboardViewControllerClass(
      storyboardOriginal,
      IOS_BRIDGE_VIEW_CONTROLLER_CLASS
    );
    storyboardChanged = storyboardResult.changed;
    if (storyboardChanged) {
      fs.writeFileSync(mainStoryboardPath, storyboardResult.content, 'utf8');
    }
  } else {
    console.log(`[configure-capacitor-ios] skipped storyboard patch: ${mainStoryboardPath} not found`);
  }

  if (!plistChanged && !swiftChanged && !storyboardChanged) {
    console.log(
      `[configure-capacitor-ios] already configured with URL scheme "${CALLBACK_SCHEME}", dark-content status bar defaults, iOS privacy usage descriptions, and provisioning profile bridge`
    );
    return;
  }

  console.log(
    `[configure-capacitor-ios] updated iOS configuration (plist=${plistChanged}, appDelegate=${swiftChanged}, storyboard=${storyboardChanged})`
  );
}

main();

# Capacitor + Shortcuts Return

This project now supports returning from the `Sync Training Diary` Shortcut back into the native Capacitor shell through `x-success`.

## What was added in the web app

- `script.js` now builds native callback URLs like `App://apple-health-sync?...`
- `script.js` listens for Capacitor `App` plugin `appUrlOpen` and `getLaunchUrl()`
- web/PWA behavior stays unchanged:
  - standalone PWA still launches Shortcuts without auto-return
  - browser mode still uses web `x-success` query params

## Important native requirement

The callback scheme in `script.js` is:

`App`

Your iOS Capacitor wrapper must register the same custom URL scheme in `Info.plist`.

Apple/Capacitor example:

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key>
    <string>com.trenpetrov.trainingdiary</string>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>App</string>
    </array>
  </dict>
</array>
```

If your native wrapper uses a different scheme, change `APPLE_HEALTH_CAPACITOR_CALLBACK_SCHEME` in `script.js` to the same value.

For generated iOS projects, this repo now includes:

- `scripts/configure-capacitor-ios.cjs`
- `npm run cap:ios:configure`
- `.github/workflows/build-ios.yml`

The script patches `ios/App/App/Info.plist` after `cap add ios` / `cap sync ios`, so the URL scheme is restored even when `ios/` is not committed to Git.

## Capacitor plugin requirement

This repo now includes `@capacitor/app` in `package.json`.

In the Capacitor wrapper repo:

1. Run `npm install`
2. Run `npm run cap:ios`

That installs the plugin and syncs native code.

## Rebuild web assets for Capacitor

To refresh `www/` before syncing:

```powershell
npm run build
```

To rebuild and sync iOS:

```powershell
npm run cap:ios
```

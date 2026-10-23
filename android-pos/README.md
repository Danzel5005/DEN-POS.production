# DEN POS Android

This is a separate Android wrapper for the existing React POS. It builds the web app into the APK assets and keeps Android-specific code here; the Windows/Electron app and the license-key-generator Android app are unchanged.

## Build a debug APK (Windows)

From this folder run:

```powershell
.\gradlew.bat assembleDebug
```

The installable APK is written to `app\build\outputs\apk\debug\app-debug.apk`. The build runs the root `npm run build` first and bundles its `dist` output.

## Bluetooth thermal printing

1. Pair the ESC/POS-compatible printer in Android Bluetooth settings.
2. Open DEN POS and tap **Printer Bluetooth** to select the paired printer.
3. Print a receipt from the POS as usual.

Receipt data is stored in the Android WebView's local storage on that device. The Android build does not include Electron-only backup, cloud device-sync, or PDF-export services.

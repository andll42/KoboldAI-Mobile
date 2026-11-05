@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo KoboldAI Mobile - prepare and build Debug APK
echo ============================================

where node >nul 2>nul || (echo ERROR: Install Node.js 22 or newer. ^& exit /b 1)
where npm >nul 2>nul || (echo ERROR: npm was not found. ^& exit /b 1)
where python >nul 2>nul || (echo ERROR: Install Python 3.10+ and add it to PATH. ^& exit /b 1)

node -e "const v=Number(process.versions.node.split('.')[0]); if(v<22){console.error('Node.js 22+ required; found '+process.versions.node);process.exit(1)}" || exit /b 1

if not defined ANDROID_HOME if not defined ANDROID_SDK_ROOT (
  echo WARNING: ANDROID_HOME / ANDROID_SDK_ROOT is not set. Android Studio must still be installed and Gradle must be able to find its SDK.
)

echo [1/9] Installing pinned Capacitor dependencies...
npm install || exit /b 1

echo [2/9] Running source and JavaScript checks...
python -m unittest discover -s tests -v || exit /b 1
node --check patch\kobold_lite_external_asr_mobile.js || exit /b 1
node --check src\android-speech-bridge.mjs || exit /b 1

echo [3/9] Building the Capacitor native plugin bridge...
node scripts\build_native_bridge.mjs || exit /b 1

echo [4/9] Downloading and patching official KoboldAI Lite...
python scripts\prepare_lite.py || exit /b 1

echo [5/9] Creating Android Studio project if it does not exist...
if not exist android\app\src\main\AndroidManifest.xml (
  npx cap add android || exit /b 1
)

echo [6/9] Installing native Android on-device ASR plugin...
python scripts\patch_android_native_asr.py || exit /b 1

echo [7/9] Applying microphone, speech service and LAN network permissions...
python scripts\patch_android_manifest.py || exit /b 1

echo [8/9] Syncing web assets into Android project...
npx cap sync android || exit /b 1

echo [9/9] Building APK...
if not exist android\gradlew.bat (echo ERROR: Gradle wrapper was not generated. Open android folder in Android Studio and sync Gradle. & exit /b 1)
pushd android
call gradlew.bat assembleDebug
if errorlevel 1 (popd & exit /b 1)
popd

if not exist android\app\build\outputs\apk\debug\app-debug.apk (
  echo ERROR: Gradle returned success but APK file was not found.
  exit /b 1
)

echo.
echo BUILD SUCCESSFUL
echo APK: android\app\build\outputs\apk\debug\app-debug.apk
echo Copy that APK to your Android phone and install it.
endlocal

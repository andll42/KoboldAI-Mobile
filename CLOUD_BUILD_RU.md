# Облачная сборка KoboldAI Mobile APK без Android Studio на домашнем ПК

Отдельная ветка: `mobile/android-apk`.

Workflow `.github/workflows/build-android-apk.yml` запускает сборку debug APK на GitHub-hosted Ubuntu runner. На домашнем ПК не требуется Android Studio, Android SDK, Gradle, Node.js или Python, если вы используете GitHub для сборки.

## 1. Создайте пустой репозиторий

На GitHub создайте пустой репозиторий, например `KoboldAI-Mobile` (без README, license и `.gitignore`, чтобы избежать конфликтующей истории).

## 2. Импортируйте отдельную ветку из Git Bundle

В комплекте проекта находится bundle-архив `KoboldAI-Mobile-android-apk.bundle`, если он предоставлен вместе с ZIP. Установите только Git for Windows или GitHub Desktop. В PowerShell в папке с bundle выполните:

```powershell
git clone --branch mobile/android-apk .\KoboldAI-Mobile-android-apk.bundle KoboldAI-Mobile
cd KoboldAI-Mobile
git remote add origin https://github.com/ВАШ_АККАУНТ/KoboldAI-Mobile.git
git push -u origin mobile/android-apk
```

Замените `ВАШ_АККАУНТ` на имя своего GitHub-пользователя.

Если у вас только ZIP, распакуйте его, откройте GitHub Desktop, выберите **Add an Existing Repository** и опубликуйте проект как новый репозиторий; проверьте, что активная ветка называется `mobile/android-apk`.

## 3. Скачайте APK

1. Откройте свой репозиторий GitHub.
2. Перейдите на вкладку **Actions**.
3. Откройте последний запуск **Build KoboldAI Mobile APK**.
4. Дождитесь зелёного статуса `Success`.
5. Внизу откройте `Artifacts` и скачайте `KoboldAI-Mobile-debug-apk`.
6. Распакуйте artifact ZIP и установите `app-debug.apk` на Android.

Артефакт хранится 14 дней. Новый push создаёт новую сборку.

## Что выполняется на GitHub runner

- Node.js 22, JDK 21 и Android SDK Platform/Build Tools 36.
- `npm install` закреплённых Capacitor 8.6.0 и esbuild.
- 24 unit-теста и JS syntax checks.
- Сборка Capacitor bridge для AndroidSpeech.
- Загрузка официального Lite и проверка LITEVER 341/якорей.
- Добавление native `SpeechRecognizer.createOnDeviceSpeechRecognizer()` plugin.
- Добавление RECORD_AUDIO, package visibility для RecognitionService и LAN HTTP config.
- `npx cap sync android` и `gradlew assembleDebug`.

## Важно

- Workflow не требует GitHub Secrets и не создаёт публичный Release; APK выдаётся как Actions Artifact репозитория.
- Само наличие workflow не означает, что APK собран. Ждите успешного завершения первого запуска.
- Если upstream Lite изменит LITEVER или структуру, сборка остановится fail-closed, пока патчер не будет проверен под новую версию.
- APK — debug build для личного тестирования, не подписанный release-ключом.
- Сохраняйте AGPL-совместимые исходники и изменения вместе с распространяемым APK.

# Сборка APK в GitHub Actions без установки Android Studio на домашний ПК

Ветка проекта: `mobile/android-apk`.

В этой ветке добавлен workflow `.github/workflows/build-android-apk.yml`. При каждом push в эту ветку GitHub Actions на собственном Ubuntu runner устанавливает Node.js, JDK, Android SDK и собирает debug APK. На домашнем ПК не нужно устанавливать Node.js, Python, Android Studio, Gradle или Android SDK только ради сборки.

## Как отправить отдельную ветку в свой GitHub

1. Создайте **пустой** репозиторий GitHub, например `KoboldAI-Mobile` (не добавляйте README, license или `.gitignore`, чтобы не создавать лишнюю историю).
2. Скачайте файл `KoboldAI-Mobile-android-apk.bundle` из комплекта.
3. Установите только Git for Windows (или используйте GitHub Desktop).
4. В CMD/PowerShell в папке, где лежит bundle, выполните:

```powershell
git clone --branch mobile/android-apk .\KoboldAI-Mobile-android-apk.bundle KoboldAI-Mobile
cd KoboldAI-Mobile
git remote add origin https://github.com/ВАШ_АККАУНТ/KoboldAI-Mobile.git
git push -u origin mobile/android-apk
```

Замените `ВАШ_АККАУНТ` на своё имя пользователя или организацию GitHub. Авторизуйтесь, когда Git попросит это сделать.

В репозитории появится отдельная ветка `mobile/android-apk`; исходная ветка официального KoboldAI Lite не изменяется. При первом push GitHub Actions автоматически запустит сборку.

## Как скачать APK

1. Откройте ваш репозиторий на GitHub.
2. Перейдите во вкладку **Actions**.
3. Откройте последний успешный запуск **Build KoboldAI Mobile APK**.
4. Внизу страницы в разделе **Artifacts** скачайте `KoboldAI-Mobile-debug-apk`.
5. Распакуйте ZIP из артефакта и установите `app-debug.apk` на Android.

Артефакт хранится 14 дней. Новый push в ветку создаёт новую сборку. Это debug APK для личного тестирования, не release-сборка для Play Store.

## Что остаётся установить локально

Для описанного сценария нужен только Git for Windows или GitHub Desktop и браузер для работы с GitHub. Android SDK, Android Studio, Node.js, Python и Gradle устанавливаются на временном GitHub runner и не устанавливаются на ваш ПК.

## Важно

- Workflow не использует секреты и не публикует APK в публичный Release; APK скачивается как Actions Artifact из вашего репозитория.
- Workflow запускается только при push в `mobile/android-apk` или вручную из Actions, если GitHub показывает доступный `workflow_dispatch`.
- Исходный Lite скачивается из официального публичного upstream во время сборки. Скрипт проверяет `LITEVER 353` и останавливается при неожиданном изменении upstream.
- Сборка CI ещё не считается проверенной до первого успешного запуска в вашем GitHub-репозитории. Наличие workflow и локальные unit/syntax checks не доказывают, что Android APK уже собран.
- Из-за лицензии AGPL-3.0 сохраняйте исходники и модификации рядом с распространяемым APK; ознакомьтесь с `SOURCES.md` и `README_RU.md`.

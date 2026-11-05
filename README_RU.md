# KoboldAI Mobile (Android) — исходный проект

Android-приложение на Capacitor поверх **официального KoboldAI Lite**. В меню `Settings → Media → Audio Input → ASR Provider` доступны три независимых провайдера:

1. **Built-in KoboldCpp Whisper** — штатная транскрибация на компьютере через KoboldCpp.
2. **GigaSTT / OpenAI-compatible ASR** — внешний ASR на компьютере по Wi-Fi (`POST /v1/audio/transcriptions`).
3. **Android On-device ASR** — нативный `SpeechRecognizer.createOnDeviceSpeechRecognizer()` непосредственно на телефоне. Используется системная служба Android (например, Speech Services by Google, если она является on-device провайдером на устройстве). Сетевой распознаватель как резервный вариант не создаётся.

> **Состояние:** это исходный проект и reproducible build scripts. APK в этой среде не собран и на POCO M5s не проверен: отсутствуют Android SDK/Gradle и физическое устройство. Проектные тесты не являются подтверждением работы микрофона/русской модели на телефоне.

## Архитектура

- В APK упаковывается HTML официального KoboldAI Lite, скачиваемый из `LostRuins/lite.koboldai.net` во время сборки.
- `scripts/prepare_lite.py` требует структуру `LITEVER 341` и точные upstream-якоря. Доступный при проверке публичный raw-снимок показывал 341, но веб-индекс помечал его как не совсем свежий; поэтому сборка заново скачивает upstream и прекращает работу, если live-файл уже другой. При изменении Lite нужна повторная проверка и обновление патчера.
- `patch/kobold_lite_external_asr_mobile.js` добавляет меню из трёх ASR-провайдеров, GigaSTT multipart-адаптер и интеграцию с Android-мостом.
- Built-in KoboldCpp Whisper сохраняет штатный `POST /api/extra/transcribe` и исходный цикл `MediaRecorder → VAD → WAV 16 kHz`.
- GigaSTT сохраняет штатный веб-цикл записи Lite и отправляет WAV через `multipart/form-data` в настраиваемый endpoint.
- Android ASR использует отдельный Capacitor-плагин `native/android/AndroidSpeechPlugin.java.template`. Он захватывает микрофон через `SpeechRecognizer.createOnDeviceSpeechRecognizer()`; браузерный `MediaRecorder` при этом не запускается. Он не использует обычный `createSpeechRecognizer()` и не переключается на online recognizer.
- Android plugin проверяет доступность on-device SpeechRecognizer. На Android 13+ дополнительно запрашивает список установленных/поддерживаемых offline языков; при необходимости пользователь вручную нажимает `Download language model`. На Android 12 список может быть недоступен — тогда фактическая поддержка `ru-RU` проверяется при старте.
- `CapacitorHttp` выключен: штатный WebView `fetch`/XHR остаётся для потоковой генерации LLM и GigaSTT.

## Поведение режимов записи

Для KoboldCpp Whisper и GigaSTT остаются оригинальные Detect Voice, Push-To-Talk и Toggle-To-Talk KoboldAI Lite.

Для Android On-device ASR используются те же команды интерфейса, но микрофон контролирует нативный Android распознаватель:

- **Detect Voice:** Android сам определяет начало/конец фразы; законченная фраза отправляется в Lite. На время генерации прослушивание приостанавливается, затем возобновляется, когда Lite снова разрешает ввод.
- **Push-To-Talk:** нажатие/удержание запускает повторяющиеся нативные фразовые сессии; Android может возвращать несколько фразовых результатов внутри удержания. Отпускание останавливает распознаватель, объединяет накопленные фрагменты и отправляет их одним сообщением.
- **Toggle-To-Talk:** первое нажатие запускает повторяющиеся системные распознавания фраз, второе останавливает прослушивание; распознанные фрагменты объединяются и отправляются одним сообщением.

Android `SpeechRecognizer` сам определяет конец фразы; это не тот же VAD, который используется настольными провайдерами. Он не предназначен для бесконечного непрерывного аудиопотока, поэтому Android-режим реализован как повторяющиеся короткие сессии фраз.

## Требования к телефону

- Android 12 (API 31) или новее и доступная системная on-device SpeechRecognitionService.
- Разрешение Android на `RECORD_AUDIO`.
- Локальный пакет распознавания `ru-RU` в системной службе. Наличие голосового ввода Gboard само по себе **не гарантирует**, что у системного on-device `SpeechRecognizer` есть офлайн-пакет русского языка.
- Android 13+ (API 33+) предоставляет API для проверки установленных/загружаемых on-device языковых моделей. Кнопка загрузки вызывает системный запрос модели; сам запрос может требовать интернет/подтверждение Android, но аудио в этом действии не отправляется. После загрузки нажмите `Check device support`.
- Если on-device служба/язык недоступны, приложение сообщает об этом и не делает сетевой fallback. Можно выбрать GigaSTT или KoboldCpp Whisper.

## Требования для сборки Windows

1. Node.js 22+ и npm.
2. Python 3.10+.
3. Android Studio 2025.2.1+ с Android SDK Platform 36 и Build Tools 36.0.0.
4. Интернет при первой сборке: npm-пакеты и чистый HTML Lite загружаются из официальных источников.

Capacitor закреплён на 8.6.0. Требования: https://capacitorjs.com/docs/getting-started/environment-setup

## Сборка APK на домашнем ПК

1. Распакуйте архив, например, в `D:\KoboldAI-Mobile`.
2. Установите Android Studio и Android SDK Platform 36 / Build Tools 36.0.0.
3. Откройте CMD в корне проекта.
4. Выполните:

```bat
build-android.bat
```

Скрипт установит закреплённые JS-зависимости, выполнит тесты, соберёт JS-мост через esbuild, скачает/проверит Lite LITEVER 341, добавит Android-плагин и разрешения, синхронизирует Capacitor и запустит Gradle.

APK после успешной сборки:

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

Это debug APK для личной установки/тестирования. Для release/Play Store потребуется отдельная подпись и проверка требований магазина.

## Сборка в GitHub Actions (без Android Studio на ПК)

Ветка проекта — `mobile/android-apk`; workflow `.github/workflows/build-android-apk.yml` собирает debug APK на временном runner и публикует Actions Artifact. Пошагово: [`CLOUD_BUILD_RU.md`](CLOUD_BUILD_RU.md).

Workflow ещё должен быть отправлен в ваш GitHub-репозиторий и успешно выполнен. Пока этого не произошло, готового APK нет.

## LAN-настройка (телефон ↔ ПК)

Телефон и ПК должны быть в одной доверенной Wi-Fi сети. `127.0.0.1` на телефоне — сам телефон, не ПК. Используйте IPv4 компьютера из `ipconfig`.

- KoboldCpp: например `http://192.168.1.105:5001`.
- GigaSTT: например `http://192.168.1.105:9876/v1` и endpoint `/audio/transcriptions`.
- GigaSTT должен слушать LAN-интерфейс (`--bind-all`) и разрешать origin `https://localhost` (`--allow-origin https://localhost`). Не используйте wildcard `--cors-allow-any`.
- Windows Firewall должен разрешать эти TCP-порты только из домашней/доверенной подсети. Не пробрасывайте порты KoboldCpp/GigaSTT в интернет.

Для мобильного WebView включён HTTP/mixed content, чтобы приложение могло обращаться к заданным локальным HTTP-серверам. Это снижает сетевую защиту приложения; используйте только доверенную LAN. См. [`docs/LAN_SECURITY.md`](docs/LAN_SECURITY.md).

## Ручные тесты после установки APK

1. **Built-in Whisper:** выбрать Built-in KoboldCpp Whisper, убедиться, что у KoboldCpp загружен Whisper, проверить короткую русскую фразу во всех трёх режимах.
2. **GigaSTT:** выбрать GigaSTT, ввести LAN IP ПК, проверить `Test connection` (`GET /models`) и `Check GigaSTT readiness` (`GET /ready`), затем отдельно произнести тестовую фразу в каждом режиме. GET-проверки не включают микрофон и не отправляют аудио.
3. **Android ASR:** выбрать Android On-device ASR, язык `Russian (ru-RU)`, нажать `Check device support`. На Android 13+ при `downloadable` явно нажать `Download language model`, дождаться установки и проверить поддержку повторно. Затем провести отдельные тесты Detect / PTT / Toggle.
4. **Отсутствие offline модели:** проверить, что приложение сообщает об ошибке и не переключается на сетевой распознаватель.
5. **LLM/TTS:** проверить отправку текста, streaming generation и штатный TTS после каждого провайдера.
6. **Отказ доступа:** запретить разрешение микрофона Android, проверить ясное сообщение; затем разрешить и повторить.
7. **LAN:** выключить GigaSTT или KoboldCpp и проверить понятные ошибки подключения. Убедиться, что локальный Android ASR продолжает работать без этих серверов (при наличии offline-модели).

## Проверки, выполненные при подготовке исходников

- `python -m unittest discover -s tests -v`: 24 теста пройдены.
- `node --check patch/kobold_lite_external_asr_mobile.js`: пройдено.
- `node --check src/android-speech-bridge.mjs`: пройдено.
- `python -m py_compile scripts/*.py tests/*.py`: пройдено.
- Проверены синтетические примеры регистрации Capacitor plugin в MainActivity и идемпотентности правки AndroidManifest.

Не выполнялись: npm install/esbuild bundle, загрузка upstream HTML, `npx cap add/sync`, Gradle assembleDebug, тесты на эмуляторе/POCO M5s, реальные сетевые ASR-запросы и проверка микрофона. В среде подготовки нет Android SDK/Gradle и доступа к физическому устройству.

## Лицензия

KoboldAI Lite распространяется по AGPL-3.0. При распространении APK/производного продукта соблюдайте требования лицензии и предоставляйте исходники соответствующих изменений. См. `SOURCES.md`.

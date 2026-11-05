# История изменений

## 0.2.1 — проверка upstream и стабилизация режимов записи

- Зафиксирована проверяемая цель `LITEVER 341`; предыдущая документация с `353` была ошибочной. Patcher и cloud build останавливаются, если загруженный upstream не соответствует 341 и проверенным якорям.
- Уточнено поведение Android Push-To-Talk и Toggle-To-Talk: фразы накапливаются до отпускания/повторного нажатия и отправляются одним сообщением.
- Обновлён статус сборки: Android APK и работа офлайн-модели ru-RU на POCO M5s пока не проверены на устройстве.

## 0.2.0 — Android native ASR и три провайдера

- Добавлен третий ASR provider: Android On-device ASR.
- Добавлен Capacitor plugin `AndroidSpeech` на Android `SpeechRecognizer.createOnDeviceSpeechRecognizer()`.
- Добавлено разрешение RECORD_AUDIO и Android package-visibility query для `android.speech.RecognitionService`.
- Добавлена проверка availability и on-device языков; на Android 13+ можно явно запросить загрузку офлайн-модели.
- Добавлен русский `ru-RU` по умолчанию, а также `en-US` и `de-DE`.
- Сетевой распознаватель не используется как fallback; Android plugin не вызывает обычный `createSpeechRecognizer()`.
- Нативный микрофон интегрирован с Detect Voice, Push-To-Talk и Toggle-To-Talk; для Detect система возвращает отдельные фразы, для PTT/Toggle фразы буферизуются до отпускания/второго нажатия.
- Добавлена буферизация фраз для Toggle-To-Talk и обработка пустых PTT-попыток без выключения Voice Input.
- GigaSTT и KoboldCpp сохраняют штатный Lite MediaRecorder/VAD/WAV путь.
- Обновлены source tests, Windows build script, GitHub Actions и документация.

## 0.1.0 — Android source package

- Обёртка официального KoboldAI Lite на Capacitor Android 8.6.0.
- Сохранён штатный Built-in KoboldCpp Whisper path.
- Добавлен конфигурируемый OpenAI-compatible multipart adapter для GigaSTT.
- Проверка GET `/models` и GigaSTT GET `/ready` не отправляют аудио.
- Добавлен Android manifest/network setup для микрофона и LAN backend.
- Подготовлен fail-closed patcher; в v0.2.1 версия upstream уточнена до 341 после повторной сверки публичного raw-снимка.

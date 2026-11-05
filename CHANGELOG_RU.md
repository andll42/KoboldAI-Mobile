# История изменений

## 0.1.0 — Android source package

- Обёртка официального KoboldAI Lite на Capacitor Android 8.6.0.
- Сохранён штатный Built-in KoboldCpp Whisper path.
- Добавлен конфигурируемый OpenAI-compatible ASR multipart adapter для GigaSTT.
- Проверка GET `/models` не отправляет аудио.
- Отдельная GigaSTT readiness-проверка GET `/ready` не отправляет аудио.
- Android manifest получает разрешения микрофона и LAN networking.
- Android WebView допускает HTTP/mixed content для локальной сети; это явно описано как риск.
- Подготовка upstream HTML проверяет LITEVER 353 и все якоря до инъекции.
- `CapacitorHttp` оставлен выключенным, чтобы не заменять `fetch`/XHR потоковой генерации.
- Подготовлен Windows build script для получения debug APK.

# KoboldAI Mobile (Android) — исходный проект

Android-оболочка Capacitor для **официального KoboldAI Lite** с сохранением штатного интерфейса и аудио-потоков Lite. Внешнее распознавание добавлено как дополнительный провайдер GigaSTT; встроенный KoboldCpp Whisper остаётся доступен.

> **Статус комплекта:** это исходный проект и воспроизводимый Windows build-скрипт. Готовый APK в текущей среде не собран: здесь нет Android SDK / Android Studio и Gradle wrapper. APK создаётся на Windows-компьютере командой `build-android.bat`. Не выдаём исходный проект за проверенный APK.

## Архитектура

- В APK локально упаковывается HTML официального KoboldAI Lite, который скачивается из официального репозитория во время сборки.
- Скрипт `scripts/prepare_lite.py` проверяет `LITEVER 353` и полный набор якорей штатных функций. Если upstream изменился, сборка останавливается вместо рискованной подмены не той версии.
- `patch/kobold_lite_external_asr_mobile.js` инъектируется в официальный `pwa-setup` до `init()`.
- `Built-in KoboldCpp` продолжает вызывать штатный `/api/extra/transcribe` с исходным JSON-контрактом.
- `Custom OpenAI-compatible ASR` отправляет WAV `multipart/form-data` на настраиваемый маршрут, для GigaSTT — `POST /v1/audio/transcriptions`.
- Запись, VAD, `MediaRecorder`, ресемплинг WAV 16 kHz, Detect Voice, Push-To-Talk, Toggle-To-Talk, отправка распознанного текста в `prepare_submit_generation()` и существующий TTS не переписываются.
- `CapacitorHttp` отключён: оставляем стандартный WebView `fetch`/XHR, чтобы не вмешиваться в существующие потоковые ответы LLM.

## Требования для сборки Windows

1. **Node.js 22 или новее** и npm.
2. **Python 3.10+**.
3. **Android Studio 2025.2.1 или новее**, Android SDK (платформа API 36 рекомендуется). Android Studio устанавливает подходящий JDK.
4. Интернет при первой сборке: npm-пакеты и чистый официальный `index.html` загружаются из официальных источников.

Официальные требования Capacitor 8: https://capacitorjs.com/docs/getting-started/environment-setup

## Сборка APK в облаке GitHub Actions (без Android Studio на домашнем ПК)

Если не хочется устанавливать Android Studio, Android SDK, Node.js, Python и Gradle, используйте отдельную ветку `mobile/android-apk` и workflow `.github/workflows/build-android-apk.yml`. GitHub Actions выполняет сборку на временном Ubuntu runner и прикладывает `app-debug.apk` как artifact. На домашнем ПК достаточно Git for Windows или GitHub Desktop и браузера. Пошаговая инструкция: [`CLOUD_BUILD_RU.md`](CLOUD_BUILD_RU.md).

Пока ветка не отправлена в ваш GitHub-репозиторий и workflow не завершился успешно, готового APK нет.

## Сборка APK

1. Распакуйте архив в папку, например `D:\KoboldAI-Mobile`.
2. Установите Android Studio и через **Tools → SDK Manager** поставьте Android SDK Platform 36 и Android SDK Build-Tools.
3. Откройте CMD в корне распакованного проекта.
4. Выполните:

```bat
build-android.bat
```

Скрипт:

- установит закреплённые версии Capacitor 8.6.0;
- выполнит Python/JS тесты;
- скачает чистый официальный Lite и проверит LITEVER + якоря;
- создаст платформу Android (`npx cap add android` при первом запуске);
- добавит `INTERNET`, `ACCESS_NETWORK_STATE`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`;
- включит локальный HTTP для адресов backend в доверенной Wi-Fi сети;
- выполнит `npx cap sync android` и `gradlew assembleDebug`.

Готовый debug APK:

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

Скопируйте APK на Android, разрешите установку приложения из выбранного файлового менеджера и установите. Это **debug APK**, он не подписан вашим release-ключом и предназначен для личной установки/тестирования. Для публикации нужен отдельный release signing и проверка политик магазина.

### Сборка вручную / открытие Android Studio

После выполнения `build-android.bat` можно открыть `android` в Android Studio. Для обновления web-ресурсов повторите:

```bat
python -m unittest discover -s tests -v
node --check patch\kobold_lite_external_asr_mobile.js
python scripts\prepare_lite.py
python scripts\patch_android_manifest.py
npx cap sync android
```

Затем в Android Studio выполните **Build → Build Bundle(s) / APK(s) → Build APK(s)** либо из `android` запустите `gradlew.bat assembleDebug`.

## Настройка локальной сети (телефон ↔ ПК)

Телефон и ПК должны находиться в одной доверенной Wi-Fi сети. `127.0.0.1` на телефоне указывает на сам телефон, а не на ПК.

### 1. Узнайте IP компьютера

На ПК:

```bat
ipconfig
```

Найдите IPv4 Wi-Fi, например `192.168.1.105`. Далее вместо этого примера используйте свой адрес. Желательно закрепить IP в настройках роутера (DHCP reservation), чтобы он не менялся.

### 2. Настройте KoboldCpp

Запустите KoboldCpp так, чтобы он принимал подключения из LAN (не только loopback). Типичная настройка — bind/listen на `0.0.0.0`, порт обычно `5001`.

Разрешите входящий TCP-порт KoboldCpp в Windows Firewall **только для Private network**. В Lite укажите обычный KoboldCpp API endpoint:

```text
http://192.168.1.105:5001
```

Встроенный ASR при этом остаётся на стороне KoboldCpp и требует загруженную/поддерживаемую Whisper-модель. Если внешний GigaSTT выбран, Whisper в KoboldCpp не требуется.

### 3. Настройте GigaSTT для Wi-Fi

Официальный GigaSTT по умолчанию слушает `127.0.0.1`; для удалённого телефона нужно явно разрешить bind на LAN. Запустите сервер на ПК (или используйте `start_gigastt_lan.bat` после активации среды GigaSTT):

```bat
gigastt serve --host 0.0.0.0 --port 9876 --bind-all --allow-origin https://localhost
```

`--bind-all` нужен, чтобы GigaSTT слушал не только loopback. `--allow-origin https://localhost` разрешает origin локального Capacitor-приложения. **Не добавляйте `--cors-allow-any`**. Разрешите входящий TCP-порт `9876` в Windows Firewall только для Private network и локальной подсети. В PowerShell от администратора (при необходимости):

```powershell
New-NetFirewallRule -DisplayName "GigaSTT LAN 9876" -Direction Inbound -Protocol TCP -LocalPort 9876 -Action Allow -Profile Private -RemoteAddress LocalSubnet
New-NetFirewallRule -DisplayName "KoboldCpp LAN 5001" -Direction Inbound -Protocol TCP -LocalPort 5001 -Action Allow -Profile Private -RemoteAddress LocalSubnet
```

Если CLI вашей установленной сборки GigaSTT отличается, сверяйтесь с `gigastt serve --help` и документацией именно этой версии.

### 4. Настройте ASR в KoboldAI Lite внутри APK

Откройте **Settings → Media → Audio Input**:

| Поле | Значение |
|---|---|
| ASR Provider | `Custom OpenAI-compatible ASR` |
| ASR Base URL | `http://192.168.1.105:9876/v1` |
| ASR Endpoint Path | `/audio/transcriptions` |
| ASR Model | `whisper-1` (GigaSTT принимает и игнорирует это имя) |
| ASR API Key | пусто, если сервер не настроил собственную авторизацию |
| Language | `ru` |
| Extra multipart fields | пусто |

GigaSTT использует загруженную при старте модельный вариант. `rnnt` по умолчанию предназначен для русского; `e2e_rnnt` даёт встроенную пунктуацию и регистр. Поле `language=ru` само по себе не переключает модельный вариант.

Нажмите:

- **Test connection** — GET `/v1/models`; только проверяет API endpoint, звука не отправляет.
- **Check GigaSTT readiness** — GET `/ready`; проверяет, готов ли пул inference. Тоже не отправляет звук.

Реальная проверка происходит только после сознательного включения Voice Input и записи речи: Lite отправит WAV на `POST /v1/audio/transcriptions`.

## Микрофон и режимы записи

При первом старте Android покажет системный запрос разрешения микрофона — разрешите его. Если отказали, откройте Android **Настройки → Приложения → KoboldAI Mobile → Разрешения → Микрофон**.

В APK WebView использует локальный secure origin `https://localhost`; Capacitor Android WebChromeClient обрабатывает запросы веб-микрофона и разрешение `RECORD_AUDIO`. Это устраняет ограничение Firefox для `http://<LAN-IP>` на телефоне, но не отменяет системное разрешение Android.

Штатные режимы Lite сохраняются:

- Detect Voice — запись с VAD;
- Push-To-Talk — запись пока удерживается действие;
- Toggle-To-Talk — запись переключается нажатием.

Внешний ASR не требует Whisper в KoboldCpp. При выборе Built-in KoboldCpp прежняя проверка Whisper остаётся включённой.

## Безопасность — прочитать перед использованием

- Это приложение предназначено для **личной доверенной Wi-Fi сети**. Не используйте его как публичный сервис.
- Чтобы телефон мог обращаться к `http://<PC-IP>:5001` и `http://<PC-IP>:9876`, WebView и Android manifest разрешают cleartext HTTP и mixed content. Это осознанное упрощение для LAN, но оно не шифрует трафик и не ограничивает HTTP исключительно одним IP-адресом.
- Не делайте port forwarding этих портов на роутере и не используйте открытые/гостевые Wi-Fi сети.
- Ограничьте Windows Firewall Private profile и включите пароль/доступ-контроль KoboldCpp, если функция включена в вашей конфигурации.
- GigaSTT обычно не требует API key. Если внешний сервер требует ключ, ключ остаётся в приложении/локальной базе Lite и может быть извлечён пользователем устройства. Это не секретное хранилище и не подходит для недоверенных клиентов.
- Для использования через интернет или в недоверенной сети настройте TLS и серверный reverse proxy с аутентификацией; не используйте `--cors-allow-any`.
- `CapacitorHttp` намеренно отключён, чтобы не подменять глобальные `fetch`/XHR и не менять потоковую генерацию Lite.

## Проверка и известные ограничения

Автоматические проверки проекта:

```bat
python -m unittest discover -s tests -v
node --check patch\kobold_lite_external_asr_mobile.js
```

Они проверяют целостность патчера, ожидаемые upstream-якоря в synthetic fixture, конфигурацию и ключевые контракты кода. Они **не** заменяют сборку Android, тест на реальном телефоне, реальный GigaSTT inference или проверку Bluetooth/гарнитур.

Известные ограничения текущего комплекта:

1. Внешний GigaSTT должен быть запущен отдельно на ПК; он не встроен в APK и не переносится на телефон.
2. На первом build нужен доступ к GitHub raw и npm registry. Версия Lite закреплена на `LITEVER 353`; при изменении upstream скрипт откажется патчить, пока якоря и адаптер не будут повторно проверены.
3. Это debug APK. Release подпись/Play Store не настроены.
4. Сетевой трафик LAN — обычный HTTP без TLS.
5. Разрешение микрофона при первом запросе выдаёт Android. Приложение не может обойти системный диалог.
6. GigaSTT endpoint `POST /v1/audio/transcriptions` возвращает JSON `{ "text": "..." }`; адаптер ожидает строковое поле `text`.

## Лицензия и upstream

KoboldAI Lite распространяется по AGPL-3.0. Этот проект инъектирует модификацию в web-ресурс Lite; если вы распространяете APK или производный бинарный продукт, соблюдайте применимые требования AGPL и предоставляйте соответствующий исходный код изменений. Capacitor распространяется по MIT.

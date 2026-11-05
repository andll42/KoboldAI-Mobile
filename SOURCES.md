# Публичные исходники и документация

## KoboldAI Lite

- При проверке публичного raw URL `main/index.html` доступный снимок показывал `LITEVER = 341`; веб-индекс помечал снимок как полученный около двух месяцев назад, поэтому это не выдаётся за свежую синхронную проверку Git HEAD. Cloud/Windows build заново загружает raw-файл и fail-closed прекращает сборку, если live-файл не соответствует LITEVER 341 и точным якорям. Перед обновлением цели требуется повторная проверка upstream.

- Репозиторий: https://github.com/LostRuins/lite.koboldai.net
- Сырой `index.html`: https://raw.githubusercontent.com/LostRuins/lite.koboldai.net/main/index.html
- Patcher проверяет LITEVER 341 и точные anchors: `is_using_kcpp_with_whisper()`, `init_voice_typing()`, `ready_to_record()`, `dispatch_transcribe_audio(dataurl)`, `ptt_start()`, `ptt_end()`, VAD, MediaRecorder, WAV conversion, `prepare_submit_generation()` и встроенный `/api/extra/transcribe`.

## KoboldCpp

- Репозиторий: https://github.com/LostRuins/koboldcpp
- Python server: https://raw.githubusercontent.com/LostRuins/koboldcpp/concedo/koboldcpp.py
- Embedded Lite: https://raw.githubusercontent.com/LostRuins/koboldcpp/concedo/embd_res/klite.embd

## GigaSTT

- Репозиторий: https://github.com/ekhodzitsky/gigastt
- API: https://github.com/ekhodzitsky/gigastt/blob/main/docs/api.md
- CLI: https://github.com/ekhodzitsky/gigastt/blob/main/docs/cli.md
- `/v1/audio/transcriptions`: multipart `file`, optional `model` and `language`, response JSON with `text`.
- `/ready`: engine readiness.
- LAN options: `--bind-all` and explicit `--allow-origin https://localhost`; do not use permissive wildcard CORS.

## Android native speech recognition

- `SpeechRecognizer`: https://developer.android.com/reference/android/speech/SpeechRecognizer
- `RecognitionSupport`: https://developer.android.com/reference/android/speech/RecognitionSupport
- `RecognitionSupportCallback`: https://developer.android.com/reference/android/speech/RecognitionSupportCallback
- `RecognizerIntent`: https://developer.android.com/reference/android/speech/RecognizerIntent
- Android 12 / API 31 introduced `createOnDeviceSpeechRecognizer()` and `isOnDeviceRecognitionAvailable()`.
- Android 13 / API 33 adds on-device language support enumeration and `triggerModelDownload()`.
- Project code only creates the on-device recognizer; it does not create the default/network recognizer. `EXTRA_PREFER_OFFLINE` is also set, but strictness comes from `createOnDeviceSpeechRecognizer()`.

## Capacitor

- Android: https://capacitorjs.com/docs/android
- Environment setup: https://capacitorjs.com/docs/getting-started/environment-setup
- Local plugins: https://capacitorjs.com/docs/plugins/creating-plugins
- WebView microphone: https://github.com/ionic-team/capacitor/blob/main/android/capacitor/src/main/java/com/getcapacitor/BridgeWebChromeClient.java
- Project pins `@capacitor/core`, `@capacitor/android`, `@capacitor/cli` to 8.6.0; esbuild 0.28.2.

## Version scope

Mobile patcher intentionally targets reviewed LITEVER 341 and aborts if upstream structure changes. Run a new source review before raising `EXPECTED_LITEVER`.

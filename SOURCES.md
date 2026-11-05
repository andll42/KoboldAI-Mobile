# Проверенные публичные исходники и документация

## KoboldAI Lite

- Репозиторий: https://github.com/LostRuins/lite.koboldai.net
- Файл для сборки (скачивается build-скриптом): https://raw.githubusercontent.com/LostRuins/lite.koboldai.net/main/index.html
- Проверено: `LITEVER 353`; реальная структура включает `is_using_kcpp_with_whisper()`, `init_voice_typing()`, `ready_to_record()`, `dispatch_transcribe_audio(dataurl)`, `ptt_start()`, `ptt_end()`, VAD callbacks, `MediaRecorder`, WAV conversion, `prepare_submit_generation()` и штатный `/api/extra/transcribe`.
- README: https://github.com/LostRuins/lite.koboldai.net/blob/main/README.md

## KoboldCpp

- Репозиторий: https://github.com/LostRuins/koboldcpp
- Официальный файл server: https://raw.githubusercontent.com/LostRuins/koboldcpp/concedo/koboldcpp.py
- Lite bundle: https://raw.githubusercontent.com/LostRuins/koboldcpp/concedo/embd_res/klite.embd

## GigaSTT

- Репозиторий: https://github.com/ekhodzitsky/gigastt
- HTTP API: https://github.com/ekhodzitsky/gigastt/blob/main/docs/api.md
- CLI: https://github.com/ekhodzitsky/gigastt/blob/main/docs/cli.md
- `/v1/audio/transcriptions`: multipart `file`, принимает `model` и игнорирует его; `language` опционален; стандартный JSON содержит `text`.
- `/ready`: readiness endpoint.
- CLI для сетевого доступа: `--bind-all`; дополнительные разрешённые origins задаются `--allow-origin`; wildcard `--cors-allow-any` не рекомендуется.

## Capacitor

- Android docs: https://capacitorjs.com/docs/android
- Environment setup: https://capacitorjs.com/docs/getting-started/environment-setup
- Capacitor Android WebChromeClient (микрофон/WebView): https://github.com/ionic-team/capacitor/blob/main/android/capacitor/src/main/java/com/getcapacitor/BridgeWebChromeClient.java
- Config reference: https://capacitorjs.com/docs/config
- Проект закрепляет `@capacitor/core`, `@capacitor/android`, `@capacitor/cli` на 8.6.0.

## Важное о версии

Патчер намеренно ограничен текущей проверенной структурой KoboldAI Lite `LITEVER 353`; сборка не должна молча продолжаться на несовместимом upstream. Повторная проверка upstream требуется при обновлении проекта.

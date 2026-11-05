from __future__ import annotations
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS = (ROOT / "patch" / "kobold_lite_external_asr_mobile.js").read_text(encoding="utf-8")
JAVA = (ROOT / "native" / "android" / "AndroidSpeechPlugin.java.template").read_text(encoding="utf-8")
CONFIG = json.loads((ROOT / "capacitor.config.json").read_text(encoding="utf-8"))
PACKAGE = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))


class MobileContractTests(unittest.TestCase):
    def test_keeps_built_in_koboldcpp_route(self):
        self.assertIn("custom_kobold_endpoint + koboldcpp_transcribe_endpoint", JS)
        self.assertIn('var koboldcpp_transcribe_endpoint = "/api/extra/transcribe";', (ROOT / "scripts" / "apply_lite_patch.py").read_text(encoding="utf-8"))
        self.assertIn("originalKcppWhisperProbe()", JS)
        self.assertIn('if (cfg.provider === "android")', JS)
        self.assertIn('return originalKcppWhisperProbe();', JS)

    def test_external_asr_posts_openai_multipart(self):
        self.assertIn('form.append("file", audioBlob, "speech.wav")', JS)
        self.assertIn('form.append("model", cfg.model)', JS)
        self.assertIn('form.append("language", cfg.language.toLowerCase())', JS)
        self.assertIn('fetch(endpointUrl,', JS)
        self.assertIn('typeof data.text !== "string"', JS)

    def test_language_auto_is_not_sent(self):
        self.assertIn('cfg.language.toLowerCase() !== "auto"', JS)

    def test_get_checks_do_not_send_audio(self):
        self.assertIn('method: "GET"', JS)
        self.assertIn('GET /ready', JS)
        self.assertIn('No audio will be uploaded', JS)

    def test_settings_ui_uses_unique_asr_test_button_id(self):
        self.assertEqual(JS.count('id="asr_test_btn"'), 1)
        self.assertEqual(JS.count('id="asr_ready_btn"'), 1)
        self.assertEqual(JS.count('id="asr_android_check_btn"'), 1)

    def test_three_providers_are_exposed(self):
        for token in (
            'value="koboldcpp">Built-in KoboldCpp Whisper',
            'value="openai">GigaSTT / OpenAI-compatible ASR',
            'value="android">Android On-device ASR (Google/System)',
        ):
            self.assertIn(token, JS)
        self.assertIn('asr_provider: ["openai", "android"]', JS)

    def test_android_plugin_is_strictly_on_device(self):
        self.assertIn('SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext())', JAVA)
        self.assertIn('SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext())', JAVA)
        self.assertIn('RecognizerIntent.EXTRA_PREFER_OFFLINE, true', JAVA)
        self.assertNotIn('SpeechRecognizer.createSpeechRecognizer(getContext())', JAVA)
        self.assertIn('No network recognizer fallback is used', JAVA)

    def test_android_language_support_and_download_are_explicit(self):
        self.assertIn('getInstalledOnDeviceLanguages()', JAVA)
        self.assertIn('getSupportedOnDeviceLanguages()', JAVA)
        self.assertIn('triggerModelDownload(buildRecognizerIntent(language))', JAVA)
        self.assertIn('Android ASR language', JS)
        self.assertIn('Download language model', JS)

    def test_android_recording_modes_have_separate_native_controls(self):
        self.assertIn('mode === 1) scheduleAndroidDetectResume()', JS)
        self.assertIn('startAndroidListening(Number(localsettings.voice_typing_mode) === 2 || Number(localsettings.voice_typing_mode) === 3)', JS)
        self.assertIn('mode === 2 || mode === 3', JS)
        self.assertIn('androidManualStopRequested', JS)
        self.assertIn('ptt_start = function', JS)
        self.assertIn('ptt_end = function', JS)

    def test_android_manual_modes_buffer_phrases_until_user_stops(self):
        self.assertIn('if (mode === 2 || mode === 3)', JS)
        self.assertIn('androidToggleTranscriptBuffer.push(text)', JS)
        self.assertIn('androidToggleTranscriptBuffer.join(" ").trim()', JS)
        self.assertIn('androidManualStopRequested = true', JS)
        self.assertIn('if (!androidManualStopRequested) voice_is_speaking = true', JS)
        self.assertIn('(stoppedMode === 2 || stoppedMode === 3)', JS)

    def test_three_recording_modes_are_left_upstream_for_pc_asr(self):
        patcher = (ROOT / "scripts" / "apply_lite_patch.py").read_text(encoding="utf-8")
        for token in ("voice_start: function ()", "voice_stop: function ()", "function ptt_start()", "function ptt_end(force=false)", "function ready_to_record()"):
            self.assertIn(token, patcher)

    def test_mixed_content_is_enabled_only_in_android_project_config(self):
        self.assertTrue(CONFIG["android"]["allowMixedContent"])
        self.assertEqual(CONFIG["server"]["hostname"], "localhost")
        self.assertEqual(CONFIG["server"]["androidScheme"], "https")
        self.assertFalse(CONFIG["plugins"]["CapacitorHttp"]["enabled"])
        self.assertIn('!isLoopback && !isCapacitorNative', JS)

    def test_android_permissions_and_speech_service_visibility(self):
        script = (ROOT / "scripts" / "patch_android_manifest.py").read_text(encoding="utf-8")
        for permission in ("INTERNET", "ACCESS_NETWORK_STATE", "RECORD_AUDIO", "MODIFY_AUDIO_SETTINGS"):
            self.assertIn("android.permission." + permission, script)
        self.assertIn("android.speech.RecognitionService", script)

    def test_native_bridge_is_bundled_before_lite_bootstrap(self):
        prepare = (ROOT / "scripts" / "prepare_lite.py").read_text(encoding="utf-8")
        self.assertIn('android-speech-bridge.js', prepare)
        self.assertIn("registerPlugin('AndroidSpeech')", (ROOT / "src" / "android-speech-bridge.mjs").read_text(encoding="utf-8"))
        self.assertIn('"esbuild": "0.28.2"', (ROOT / "package.json").read_text(encoding="utf-8"))

    def test_capacitor_version_is_pinned(self):
        self.assertEqual(PACKAGE["dependencies"]["@capacitor/core"], "8.6.0")
        self.assertEqual(PACKAGE["dependencies"]["@capacitor/android"], "8.6.0")
        self.assertEqual(PACKAGE["devDependencies"]["@capacitor/cli"], "8.6.0")


if __name__ == "__main__":
    unittest.main()

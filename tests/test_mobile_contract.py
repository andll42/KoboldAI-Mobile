from __future__ import annotations
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS = (ROOT / "patch" / "kobold_lite_external_asr_mobile.js").read_text(encoding="utf-8")
CONFIG = json.loads((ROOT / "capacitor.config.json").read_text(encoding="utf-8"))
PACKAGE = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))


class MobileContractTests(unittest.TestCase):
    def test_keeps_built_in_koboldcpp_route(self):
        self.assertIn("custom_kobold_endpoint + koboldcpp_transcribe_endpoint", JS)
        self.assertIn('var koboldcpp_transcribe_endpoint = "/api/extra/transcribe";', (ROOT / "scripts" / "apply_lite_patch.py").read_text(encoding="utf-8"))
        self.assertIn("originalKcppWhisperProbe()", JS)
        self.assertIn('provider === "openai" ? isExternalAsrConfigured() : originalKcppWhisperProbe()', JS)

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

    def test_three_recording_modes_are_left_upstream(self):
        # The adapter doesn't reimplement VAD/PTT/TTT; the patcher binds to known upstream anchors.
        patcher = (ROOT / "scripts" / "apply_lite_patch.py").read_text(encoding="utf-8")
        for token in ("voice_start: function ()", "voice_stop: function ()", "function ptt_start()", "function ptt_end(force=false)", "function ready_to_record()"):
            self.assertIn(token, patcher)

    def test_mixed_content_is_enabled_only_in_android_project_config(self):
        self.assertTrue(CONFIG["android"]["allowMixedContent"])
        self.assertEqual(CONFIG["server"]["hostname"], "localhost")
        self.assertEqual(CONFIG["server"]["androidScheme"], "https")
        self.assertFalse(CONFIG["plugins"]["CapacitorHttp"]["enabled"])
        # Browser non-native HTTPS pages still reject non-loopback HTTP ASR URLs.
        self.assertIn('!isLoopback && !isCapacitorNative', JS)

    def test_android_permissions_are_declared_by_manifest_script(self):
        script = (ROOT / "scripts" / "patch_android_manifest.py").read_text(encoding="utf-8")
        for permission in ("INTERNET", "ACCESS_NETWORK_STATE", "RECORD_AUDIO", "MODIFY_AUDIO_SETTINGS"):
            self.assertIn("android.permission." + permission, script)

    def test_capacitor_version_is_pinned(self):
        self.assertEqual(PACKAGE["dependencies"]["@capacitor/core"], "8.6.0")
        self.assertEqual(PACKAGE["dependencies"]["@capacitor/android"], "8.6.0")
        self.assertEqual(PACKAGE["devDependencies"]["@capacitor/cli"], "8.6.0")


if __name__ == "__main__":
    unittest.main()

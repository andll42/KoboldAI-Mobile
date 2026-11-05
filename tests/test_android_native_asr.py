from __future__ import annotations
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from patch_android_native_asr import patch_main_activity_text  # noqa: E402
from patch_android_manifest import patch_manifest_text  # noqa: E402


class NativeAndroidAsrTests(unittest.TestCase):
    def test_registers_plugin_in_empty_capacitor_main_activity(self):
        source = """package net.koboldai.mobile;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {}
"""
        patched = patch_main_activity_text(source, "net.koboldai.mobile")
        self.assertIn("import net.koboldai.mobile.AndroidSpeechPlugin;", patched)
        self.assertIn("import android.os.Bundle;", patched)
        self.assertIn("registerPlugin(AndroidSpeechPlugin.class);", patched)
        self.assertLess(patched.index("registerPlugin(AndroidSpeechPlugin.class);"), patched.index("super.onCreate(savedInstanceState);"))

    def test_registration_is_idempotent(self):
        source = """package net.koboldai.mobile;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {}
"""
        once = patch_main_activity_text(source, "net.koboldai.mobile")
        twice = patch_main_activity_text(once, "net.koboldai.mobile")
        self.assertEqual(once, twice)

    def test_manifest_adds_permissions_and_speech_query_once(self):
        source = """<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="KoboldAI Mobile">
    </application>
</manifest>
"""
        once = patch_manifest_text(source)
        twice = patch_manifest_text(once)
        self.assertEqual(once, twice)
        self.assertIn('android:name="android.permission.RECORD_AUDIO"', once)
        self.assertIn('android:name="android.speech.RecognitionService"', once)
        self.assertIn('android:usesCleartextTraffic="true"', once)
        self.assertIn('android:networkSecurityConfig="@xml/network_security_config"', once)

    def test_refuses_unknown_activity(self):
        with self.assertRaisesRegex(ValueError, "does not extend Capacitor BridgeActivity"):
            patch_main_activity_text("public class MainActivity {}", "net.koboldai.mobile")


if __name__ == "__main__":
    unittest.main()

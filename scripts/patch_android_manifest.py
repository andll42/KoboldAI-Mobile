#!/usr/bin/env python3
"""Add Android audio/service discovery and trusted-LAN network settings."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "android" / "app" / "src" / "main" / "AndroidManifest.xml"
NETWORK_CONFIG = ROOT / "android" / "app" / "src" / "main" / "res" / "xml" / "network_security_config.xml"

PERMISSIONS = [
    "android.permission.INTERNET",
    "android.permission.ACCESS_NETWORK_STATE",
    "android.permission.RECORD_AUDIO",
    "android.permission.MODIFY_AUDIO_SETTINGS",
]


def patch_manifest_text(text: str) -> str:
    for permission in PERMISSIONS:
        if f'name="{permission}"' not in text:
            text = text.replace("<application", f'<uses-permission android:name="{permission}" />\n    <application', 1)

    # Android 11+ package visibility: SpeechRecognizer service discovery requires
    # the recognition-service intent query in the manifest.
    if "android.speech.RecognitionService" not in text:
        query = (
            "    <queries>\n"
            "        <intent>\n"
            "            <action android:name=\"android.speech.RecognitionService\" />\n"
            "        </intent>\n"
            "    </queries>\n"
        )
        app_index = text.find("<application")
        if app_index < 0:
            raise ValueError("<application> element not found in AndroidManifest.xml")
        text = text[:app_index] + query + text[app_index:]

    app_open = re.search(r"<application\b[^>]*>", text)
    if not app_open:
        raise ValueError("<application> element not found in AndroidManifest.xml")
    app_tag = app_open.group(0)
    if "android:usesCleartextTraffic=" not in app_tag:
        updated = app_tag[:-1] + ' android:usesCleartextTraffic="true">'
        text = text[:app_open.start()] + updated + text[app_open.end():]
    if "android:networkSecurityConfig=" not in text:
        text = text.replace("<application", '<application android:networkSecurityConfig="@xml/network_security_config"', 1)
    return text


def main() -> int:
    if not MANIFEST.is_file():
        print(f"ERROR: {MANIFEST} not found. Run `npx cap add android` first.", file=sys.stderr)
        return 2
    try:
        text = patch_manifest_text(MANIFEST.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2
    MANIFEST.write_text(text, encoding="utf-8")
    NETWORK_CONFIG.parent.mkdir(parents=True, exist_ok=True)
    NETWORK_CONFIG.write_text(
        '''<?xml version="1.0" encoding="utf-8"?>\n'''
        '''<network-security-config>\n'''
        '''    <!-- User-configured KoboldCpp/GigaSTT endpoints are reachable only on a trusted private Wi-Fi LAN. -->\n'''
        '''    <base-config cleartextTrafficPermitted="true" />\n'''
        '''</network-security-config>\n''',
        encoding="utf-8",
    )
    print("Android manifest patched: permissions and speech RecognitionService query are present.")
    print("Cleartext HTTP is enabled for configured private-LAN backend URLs; do not port-forward these services to the Internet.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

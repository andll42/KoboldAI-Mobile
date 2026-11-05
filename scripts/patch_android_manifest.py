#!/usr/bin/env python3
"""Add the narrow permissions/network settings required by this LAN-only Android shell."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "android" / "app" / "src" / "main" / "AndroidManifest.xml"
NETWORK_CONFIG = ROOT / "android" / "app" / "src" / "main" / "res" / "xml" / "network_security_config.xml"
ANDROID = "http://schemas.android.com/apk/res/android"

PERMISSIONS = [
    "android.permission.INTERNET",
    "android.permission.ACCESS_NETWORK_STATE",
    "android.permission.RECORD_AUDIO",
    "android.permission.MODIFY_AUDIO_SETTINGS",
]


def main() -> int:
    if not MANIFEST.is_file():
        print(f"ERROR: {MANIFEST} not found. Run `npx cap add android` first.", file=sys.stderr)
        return 2
    text = MANIFEST.read_text(encoding="utf-8")

    for permission in PERMISSIONS:
        if f'name="{permission}"' not in text:
            text = text.replace("<application", f'<uses-permission android:name="{permission}" />\n    <application', 1)

    app_open = re.search(r"<application\b[^>]*>", text)
    if not app_open:
        print("ERROR: <application> element not found in generated AndroidManifest.xml", file=sys.stderr)
        return 2
    app_tag = app_open.group(0)
    if "android:usesCleartextTraffic=" not in app_tag:
        updated = app_tag[:-1] + ' android:usesCleartextTraffic="true">'
        text = text[:app_open.start()] + updated + text[app_open.end():]
    if "android:networkSecurityConfig=" not in text:
        text = text.replace("<application", '<application android:networkSecurityConfig="@xml/network_security_config"', 1)

    MANIFEST.write_text(text, encoding="utf-8")
    NETWORK_CONFIG.parent.mkdir(parents=True, exist_ok=True)
    NETWORK_CONFIG.write_text(
        '''<?xml version="1.0" encoding="utf-8"?>\n'''
        '''<network-security-config>\n'''
        '''    <!-- KoboldCpp/GigaSTT are user-configured plain-HTTP services on a trusted private Wi-Fi LAN. -->\n'''
        '''    <base-config cleartextTrafficPermitted="true" />\n'''
        '''</network-security-config>\n''',
        encoding="utf-8",
    )
    print("Android manifest patched: INTERNET, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, ACCESS_NETWORK_STATE, private-LAN cleartext access.")
    print("Reminder: do not expose these backend ports to the public Internet.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

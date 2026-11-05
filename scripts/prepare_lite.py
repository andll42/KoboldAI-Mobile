#!/usr/bin/env python3
"""Fetch the verified official KoboldAI Lite source and apply the mobile ASR adapter."""
from __future__ import annotations

import sys
import urllib.error
import urllib.request
from pathlib import Path

from apply_lite_patch import patch_source

UPSTREAM_URL = "https://raw.githubusercontent.com/LostRuins/lite.koboldai.net/main/index.html"
EXPECTED_LITEVER = 341
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "www" / "index.html"
EXTENSION = ROOT / "patch" / "kobold_lite_external_asr_mobile.js"
BRIDGE_BUNDLE = ROOT / "www" / "android-speech-bridge.js"


def main() -> int:
    request = urllib.request.Request(
        UPSTREAM_URL,
        headers={"User-Agent": "KoboldAI-Mobile-Builder/0.2 (upstream-source-fetch)"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            if response.status != 200:
                raise RuntimeError(f"upstream returned HTTP {response.status}")
            raw = response.read()
        source = raw.decode("utf-8-sig")
        extension = EXTENSION.read_text(encoding="utf-8")
        if not BRIDGE_BUNDLE.is_file():
            raise RuntimeError("www/android-speech-bridge.js is missing; run `npm run build:native-bridge` before preparing Lite.")
        patched, version = patch_source(source, extension)
        bridge_tag = '<script src="android-speech-bridge.js"></script>\n'
        pwa_tag = '<script id="pwa-setup">'
        if patched.count(pwa_tag) != 1:
            raise RuntimeError('expected exactly one <script id="pwa-setup"> while injecting the Android bridge')
        patched = patched.replace(pwa_tag, bridge_tag + pwa_tag, 1)
    except (urllib.error.URLError, TimeoutError, UnicodeError, OSError, ValueError, RuntimeError) as exc:
        print(f"ERROR: could not prepare official KoboldAI Lite: {exc}", file=sys.stderr)
        return 2

    if version != EXPECTED_LITEVER:
        print(f"ERROR: reviewed LITEVER {EXPECTED_LITEVER}, found {version}; refusing to build.", file=sys.stderr)
        return 2

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(patched, encoding="utf-8", newline="\n")
    print(f"Prepared official KoboldAI Lite LITEVER {version}")
    print(f"Upstream: {UPSTREAM_URL}")
    print(f"Output:   {OUT}")
    print("Prepared the Android speech bridge script before pwa-setup.")
    print("KoboldCpp Whisper and GigaSTT retain the upstream Web microphone/VAD/WAV path; Android ASR uses native SpeechRecognizer.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

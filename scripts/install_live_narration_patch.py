#!/usr/bin/env python3
"""Append the opt-in Live Narration extension to the mobile ASR extension safely."""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

MARKER = "KOBOLD_LITE_LIVE_NARRATION_PATCH v1.0.0"
ASR_MARKER = "KOBOLD_LITE_EXTERNAL_ASR_PATCH"
ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "patch" / "kobold_lite_external_asr_mobile.js"
SOURCE = ROOT / "patch" / "kobold_lite_live_narration.js"


def main() -> int:
    parser = argparse.ArgumentParser(description="Install the optional Live Narration patch into the mobile Lite extension.")
    parser.add_argument("--force", action="store_true", help="Replace an existing backup file.")
    args = parser.parse_args()

    if not TARGET.is_file():
        print(f"ERROR: expected mobile ASR extension not found: {TARGET}", file=sys.stderr)
        return 2
    if not SOURCE.is_file():
        print(f"ERROR: Live Narration extension not found: {SOURCE}", file=sys.stderr)
        return 2

    target_text = TARGET.read_text(encoding="utf-8-sig")
    live_text = SOURCE.read_text(encoding="utf-8-sig").strip()
    if ASR_MARKER not in target_text:
        print("ERROR: target does not look like the KoboldAI Mobile ASR extension; refusing to modify it.", file=sys.stderr)
        return 2
    if MARKER in target_text:
        print("Live Narration patch is already installed; no changes made.")
        return 0
    if MARKER not in live_text:
        print(f"ERROR: Live Narration source is missing marker {MARKER!r}.", file=sys.stderr)
        return 2
    if not target_text.rstrip().endswith("})();"):
        print("ERROR: ASR extension does not end with the expected IIFE terminator; refusing to append.", file=sys.stderr)
        return 2

    backup = TARGET.with_suffix(TARGET.suffix + ".pre-live-narration.bak")
    if backup.exists() and not args.force:
        print(f"ERROR: backup already exists: {backup} (use --force to replace it)", file=sys.stderr)
        return 2

    try:
        shutil.copy2(TARGET, backup)
        updated = target_text.rstrip() + "\n\n" + live_text + "\n"
        temp = TARGET.with_suffix(TARGET.suffix + ".tmp")
        temp.write_text(updated, encoding="utf-8", newline="\n")
        temp.replace(TARGET)
    except OSError as exc:
        print(f"ERROR: could not install Live Narration patch: {exc}", file=sys.stderr)
        return 2

    print(f"Installed Live Narration patch into: {TARGET}")
    print(f"Backup: {backup}")
    print("The patch is opt-in and disabled by default. Open Settings > Media > Audio Output and enable Live Narration.")
    print("It uses the existing TTS queue; GigaSTT, Whisper and Android ASR code is not modified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

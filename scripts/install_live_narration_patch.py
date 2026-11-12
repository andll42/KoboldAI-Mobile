
#!/usr/bin/env python3
"""Install or update the Live Narration extension in the mobile ASR patch."""
from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

MARKER = "KOBOLD_LITE_LIVE_NARRATION_PATCH v1.0.0"
BLOCK_MARKER = "/* " + MARKER
ASR_MARKER = "KOBOLD_LITE_EXTERNAL_ASR_PATCH"

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "patch" / "kobold_lite_external_asr_mobile.js"
SOURCE = ROOT / "patch" / "kobold_lite_live_narration.js"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Install or update Live Narration in the mobile ASR extension."
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Replace an existing update backup."
    )
    args = parser.parse_args()

    if not TARGET.is_file():
        print(f"ERROR: ASR extension not found: {TARGET}", file=sys.stderr)
        return 2

    if not SOURCE.is_file():
        print(f"ERROR: Live Narration source not found: {SOURCE}", file=sys.stderr)
        return 2

    try:
        target_text = TARGET.read_text(encoding="utf-8-sig")
        live_text = SOURCE.read_text(encoding="utf-8-sig").strip()
    except OSError as exc:
        print(f"ERROR: Could not read files: {exc}", file=sys.stderr)
        return 2

    if ASR_MARKER not in target_text:
        print(
            "ERROR: Target is not the expected mobile ASR extension.",
            file=sys.stderr
        )
        return 2

    if BLOCK_MARKER not in live_text:
        print(
            f"ERROR: Source is missing marker: {BLOCK_MARKER}",
            file=sys.stderr
        )
        return 2

    if not live_text.endswith("})();"):
        print(
            "ERROR: Live Narration source has an unexpected ending.",
            file=sys.stderr
        )
        return 2

    positions = [
        match.start()
        for match in re.finditer(re.escape(BLOCK_MARKER), target_text)
    ]

    if len(positions) > 1:
        print(
            "ERROR: Multiple embedded Live Narration blocks found. "
            "No changes made.",
            file=sys.stderr
        )
        return 2

    if positions:
        # Replace the old embedded Live Narration block, preserving ASR.
        prefix = target_text[:positions[0]].rstrip()

        if not prefix.endswith("})();"):
            print(
                "ERROR: ASR block does not end before Live Narration. "
                "No changes made.",
                file=sys.stderr
            )
            return 2

        updated = prefix + "\n\n" + live_text + "\n"
        operation = "Updated"
    else:
        # First installation: append Live Narration after the ASR extension.
        prefix = target_text.rstrip()

        if not prefix.endswith("})();"):
            print(
                "ERROR: ASR extension has an unexpected ending. "
                "No changes made.",
                file=sys.stderr
            )
            return 2

        updated = prefix + "\n\n" + live_text + "\n"
        operation = "Installed"

    backup = TARGET.with_suffix(
        TARGET.suffix + ".pre-live-narration-update.bak"
    )

    if backup.exists() and not args.force:
        print(
            f"ERROR: Backup already exists: {backup}\n"
            "Use --force to replace that backup.",
            file=sys.stderr
        )
        return 2

    temp = TARGET.with_suffix(TARGET.suffix + ".tmp")

    try:
        shutil.copy2(TARGET, backup)
        temp.write_text(updated, encoding="utf-8", newline="\n")
        temp.replace(TARGET)
    except OSError as exc:
        try:
            if temp.exists():
                temp.unlink()
        except OSError:
            pass

        print(f"ERROR: Could not update extension: {exc}", file=sys.stderr)
        return 2

    print(f"{operation} Live Narration patch successfully.")
    print(f"Target: {TARGET}")
    print(f"Backup: {backup}")
    print("The existing ASR extension was preserved.")
    print("GigaSTT, KoboldCpp Whisper and Android ASR code was not intentionally changed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

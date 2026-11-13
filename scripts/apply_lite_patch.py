#!/usr/bin/env python3
"""Apply the external ASR adapter to the reviewed official KoboldAI Lite LITEVER 354 for Android."""
from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

PATCH_MARKER = "KOBOLD_LITE_EXTERNAL_ASR_PATCH v5-android-asr"
EXPECTED_LITEVER = 355

REQUIRED_ANCHORS = (
    'const LITEVER = 355;',
    'const PROTECTED_FIELDS = {',
    'const defaultsettings = JSON.parse(JSON.stringify(localsettings));',
    'function indexeddb_save(objkey, objdatastr)',
    'function indexeddb_load(objkey, defaultvalue)',
    'function init() { // Setup and initialization on startup',
    'function is_using_kcpp_with_whisper()',
    'function display_settings()',
    'function confirm_settings()',
    'function import_props_into_object(existingObj, objToImport)',
    'function generate_savefile(save_images,export_settings,export_aesthetic_settings)',
    'function prepare_submit_generation() //wrap websearch into this',
    'function is_using_kcpp_with_tts()',
    'function init_voice_typing()',
    'let onRecordingReady = function (e)',
    'audioBlobToDecodedAudioBuffer(completeRecording,(buffer)=>{',
    'resampleAudioBuffer(buffer,16000,(rsBuffer)=>{',
    'audioBufferToWavBlob(rsBuffer)',
    'dispatch_transcribe_audio(dataurl);',
    'new MediaRecorder(stream)',
    'let myvad = new VAD(options);',
    'voice_stop: function ()',
    'voice_start: function ()',
    'function ptt_start()',
    'function ptt_end(force=false)',
    'function ready_to_record()',
    'function submit_generation_button(aesthetic_ui)',
    'function update_submit_button(full_update)',
    'function dispatch_transcribe_audio(dataurl)',
    'function transcribe_audio_file(audiohash,onDone)',
    'function transcribe_file_btn()',
    'var koboldcpp_transcribe_endpoint = "/api/extra/transcribe";',
    'id="voice_typing_mode"',
    'id="voice_langcode"',
    'id="voice_suppress_nonspeech"',
    'id="transcribe_file_input"',
    'id="transcribe_file_btn"',
)


def fail(message: str) -> int:
    print(f"ERROR: {message}", file=sys.stderr)
    return 2


def patch_source(source: str, extension: str) -> tuple[str, int]:
    if "KOBOLD_LITE_EXTERNAL_ASR_PATCH" in source:
        raise ValueError("this HTML already contains an ASR patch marker; start from a clean official upstream index.html")
    if PATCH_MARKER not in extension:
        raise ValueError(f"extension does not contain required marker {PATCH_MARKER!r}")

    version_match = re.search(r"const\s+LITEVER\s*=\s*(\d+)\s*;", source)
    if not version_match:
        raise ValueError("could not identify LITEVER; refusing to patch an unknown HTML structure")
    version = int(version_match.group(1))
    if version != EXPECTED_LITEVER:
        raise ValueError(f"this reviewed patch targets LITEVER {EXPECTED_LITEVER}; found {version}")

    missing = [anchor for anchor in REQUIRED_ANCHORS if anchor not in source]
    if missing:
        raise ValueError("upstream structure differs from the reviewed source; missing anchor(s):\n  - " + "\n  - ".join(missing))

    script_open = '<script id="pwa-setup">'
    script_start = source.find(script_open)
    if script_start < 0 or source.find(script_open, script_start + len(script_open)) >= 0:
        raise ValueError('expected exactly one <script id="pwa-setup"> block')
    script_end = source.find("</script>", script_start)
    if script_end < 0:
        raise ValueError("pwa-setup script is not closed")

    pwa_script = source[script_start:script_end]
    init_matches = list(re.finditer(r"(?m)^\s*init\(\);\s*$", pwa_script))
    if len(init_matches) != 1:
        raise ValueError("expected exactly one standalone init(); call inside pwa-setup")

    match = init_matches[0]
    absolute_start = script_start + match.start()
    absolute_end = script_start + match.end()
    indent = re.match(r"\s*", match.group(0)).group(0)
    newline = "\r\n" if "\r\n" in source else "\n"

    # Keep startup resilient: if the extension fails to install or its profile cannot
    # be read, Lite still runs its original init() path.
    extension_block = extension.strip().replace("\r\n", "\n").replace("\n", newline + indent)
    bootstrap = (
        indent + "// BEGIN " + PATCH_MARKER + newline
        + indent + "try {" + newline
        + indent + "\t" + extension_block + newline
        + indent + "} catch (asrPatchError) { console.error('External ASR patch failed to initialize:', asrPatchError); }" + newline
        + indent + "Promise.resolve(typeof window.load_kobold_lite_external_asr_settings === 'function' ? window.load_kobold_lite_external_asr_settings() : null)" + newline
        + indent + "  .catch(asrLoadError => console.warn('ASR profile load failed; continuing Lite startup:', asrLoadError))" + newline
        + indent + "  .then(() => init());" + newline
        + indent + "// END " + PATCH_MARKER + newline
    )
    patched = source[:absolute_start] + bootstrap + source[absolute_end:]
    return patched, version


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Patch the reviewed official KoboldAI Lite LITEVER 354 with KoboldCpp, GigaSTT and native Android on-device ASR."
    )
    parser.add_argument("index_html", type=Path, help="Path to the official Lite index.html")
    parser.add_argument(
        "--extension", type=Path,
        default=Path(__file__).resolve().parent.parent / "patch" / "kobold_lite_external_asr_mobile.js",
        help="Companion JS file (default: next to this script)",
    )
    parser.add_argument("--output", type=Path, default=None, help="Output path; default: <input>.asr-patched.html")
    parser.add_argument("--in-place", action="store_true", help="Patch input in place after creating .asr.bak")
    parser.add_argument("--force", action="store_true", help="Allow replacing an existing output or backup")
    args = parser.parse_args(argv)

    source_path = args.index_html.resolve()
    extension_path = args.extension.resolve()
    if not source_path.is_file():
        return fail(f"source file not found: {source_path}")
    if not extension_path.is_file():
        return fail(f"extension JS file not found: {extension_path}")

    try:
        source_bytes = source_path.read_bytes()
        source = source_bytes.decode("utf-8-sig")
        extension = extension_path.read_text(encoding="utf-8-sig")
        patched, version = patch_source(source, extension)
    except (UnicodeError, OSError, ValueError) as error:
        return fail(str(error))

    if args.in_place:
        output_path = source_path
        backup_path = source_path.with_suffix(source_path.suffix + ".asr.bak")
        if backup_path.exists() and not args.force:
            return fail(f"backup already exists: {backup_path} (use --force to replace it)")
        try:
            shutil.copy2(source_path, backup_path)
        except OSError as error:
            return fail(f"could not create backup: {error}")
    else:
        output_path = (args.output or source_path.with_name(source_path.stem + ".asr-patched" + source_path.suffix)).resolve()
        if output_path.exists() and not args.force:
            return fail(f"output already exists: {output_path} (use --force to overwrite)")

    try:
        output_path.write_bytes(patched.encode("utf-8"))
    except OSError as error:
        return fail(f"could not write patched HTML: {error}")

    print(f"Patched official KoboldAI Lite LITEVER {version}: {output_path}")
    if args.in_place:
        print(f"Original backup: {backup_path}")
    else:
        print("Original HTML was not modified.")
    print("The original init() is called after the separate ASR profile load; startup falls back to init() if profile loading fails.")
    print("Configure Settings > Media > Audio Input > ASR Provider: KoboldCpp Whisper, GigaSTT or Android On-device ASR.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

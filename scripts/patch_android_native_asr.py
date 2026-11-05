#!/usr/bin/env python3
"""Install and register the strict native Android SpeechRecognizer plugin."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "android"
TEMPLATE = ROOT / "native" / "android" / "AndroidSpeechPlugin.java.template"


def fail(message: str) -> int:
    print(f"ERROR: {message}", file=sys.stderr)
    return 2


def patch_main_activity_text(text: str, package_name: str) -> str:
    if "AndroidSpeechPlugin.class" in text:
        return text
    if not re.search(r"\bextends\s+BridgeActivity\b", text):
        raise ValueError("MainActivity does not extend Capacitor BridgeActivity; refusing to patch unknown activity.")

    import_line = f"import {package_name}.AndroidSpeechPlugin;"
    if import_line not in text:
        package_match = re.search(r"(?m)^\s*package\s+[\w.]+\s*;", text)
        if not package_match:
            raise ValueError("Could not find MainActivity package declaration.")
        text = text[:package_match.end()] + "\n\n" + import_line + text[package_match.end():]

    oncreate = re.search(r"(?s)(@Override\s+public\s+void\s+onCreate\s*\(\s*Bundle\s+\w+\s*\)\s*\{)", text)
    if oncreate:
        text = text[:oncreate.end()] + "\n        registerPlugin(AndroidSpeechPlugin.class);" + text[oncreate.end():]
    else:
        activity = re.search(r"public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{\s*\}", text)
        if not activity:
            raise ValueError("Could not safely find MainActivity.onCreate() or an empty MainActivity class.")
        replacement = (
            "public class MainActivity extends BridgeActivity {\n"
            "    @Override\n"
            "    public void onCreate(Bundle savedInstanceState) {\n"
            "        registerPlugin(AndroidSpeechPlugin.class);\n"
            "        super.onCreate(savedInstanceState);\n"
            "    }\n"
            "}"
        )
        text = text[:activity.start()] + replacement + text[activity.end():]

    if "import android.os.Bundle;" not in text:
        bridge_import = re.search(r"(?m)^import\s+com\.getcapacitor\.BridgeActivity\s*;", text)
        if not bridge_import:
            raise ValueError("Could not find the Capacitor BridgeActivity import to add Bundle.")
        text = text[:bridge_import.start()] + "import android.os.Bundle;\n" + text[bridge_import.start():]
    return text


def install_native_plugin(android_root: Path, template_path: Path) -> Path:
    activities = list((android_root / "app" / "src" / "main" / "java").rglob("MainActivity.java"))
    if len(activities) != 1:
        raise ValueError(f"Expected exactly one generated MainActivity.java; found {len(activities)}.")
    activity = activities[0]
    source = activity.read_text(encoding="utf-8")
    package_match = re.search(r"(?m)^\s*package\s+([\w.]+)\s*;", source)
    if not package_match:
        raise ValueError(f"Could not identify Java package in {activity}.")
    package_name = package_match.group(1)
    plugin_dir = android_root / "app" / "src" / "main" / "java" / Path(*package_name.split("."))
    plugin_dir.mkdir(parents=True, exist_ok=True)
    plugin_path = plugin_dir / "AndroidSpeechPlugin.java"
    plugin_text = template_path.read_text(encoding="utf-8").replace("package __PACKAGE__;", f"package {package_name};")
    plugin_path.write_text(plugin_text, encoding="utf-8")
    activity.write_text(patch_main_activity_text(source, package_name), encoding="utf-8")
    return plugin_path


def main() -> int:
    if not ANDROID.is_dir():
        return fail("android/ project not found. Run `npx cap add android` first.")
    if not TEMPLATE.is_file():
        return fail(f"Native plugin template missing: {TEMPLATE}")
    try:
        plugin_path = install_native_plugin(ANDROID, TEMPLATE)
    except (OSError, ValueError) as error:
        return fail(str(error))
    print(f"Installed strict on-device SpeechRecognizer plugin: {plugin_path}")
    print("Registered AndroidSpeechPlugin in MainActivity before BridgeActivity.onCreate().")
    print("Only SpeechRecognizer.createOnDeviceSpeechRecognizer() is used; there is no online fallback.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

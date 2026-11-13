from __future__ import annotations
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from apply_lite_patch import PATCH_MARKER, REQUIRED_ANCHORS, patch_source  # noqa: E402

EXTENSION = (ROOT / "patch" / "kobold_lite_external_asr_mobile.js").read_text(encoding="utf-8")


def fixture(version: int = 355) -> str:
    lines = [f"const LITEVER = {version};"]
    lines.extend(anchor for anchor in REQUIRED_ANCHORS if anchor != f"const LITEVER = {version};")
    # The source validator checks these anchors as real strings. The synthetic fixture
    # deliberately validates patcher behavior, not runtime behavior of the whole Lite app.
    return "<html><script id=\"pwa-setup\">\n" + "\n".join(lines) + "\ninit();\n</script></html>"


class PatcherTests(unittest.TestCase):
    def test_patch_inserts_mobile_extension_and_preserves_init(self):
        patched, version = patch_source(fixture(), EXTENSION)
        self.assertEqual(version, 355)
        self.assertIn(PATCH_MARKER, patched)
        self.assertIn("load_kobold_lite_external_asr_settings", patched)
        self.assertIn(".then(() => init());", patched)
        self.assertNotIn("\ninit();\n</script>", patched)

    def test_refuses_unreviewed_upstream_version(self):
        with self.assertRaisesRegex(ValueError, "targets LITEVER 355"):
            patch_source(fixture(356), EXTENSION)

    def test_refuses_html_already_patched(self):
        already = fixture() + "<!-- KOBOLD_LITE_EXTERNAL_ASR_PATCH -->"
        with self.assertRaisesRegex(ValueError, "already contains"):
            patch_source(already, EXTENSION)

    def test_refuses_missing_anchor(self):
        with self.assertRaisesRegex(ValueError, "missing anchor"):
            patch_source("<script id=\"pwa-setup\">const LITEVER = 355; init();</script>", EXTENSION)

    def test_requires_exactly_one_pwa_script(self):
        with self.assertRaisesRegex(ValueError, "exactly one"):
            patch_source(fixture() + '<script id="pwa-setup">init();</script>', EXTENSION)


if __name__ == "__main__":
    unittest.main()

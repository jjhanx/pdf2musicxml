"""OSMD TO_CODA label patch: "To" → "To Coda" (+ coda glyph still drawn by VexFlow)."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIN_JS = (
    ROOT
    / "node_modules"
    / "opensheetmusicdisplay"
    / "build"
    / "opensheetmusicdisplay.min.js"
)
PATCH_SCRIPT = ROOT / "scripts" / "patch_osmd_to_coda_label.mjs"


def test_patch_script_exists():
    assert PATCH_SCRIPT.is_file(), PATCH_SCRIPT


def test_osmd_min_has_to_coda_label():
    assert MIN_JS.is_file(), MIN_JS
    src = MIN_JS.read_text(encoding="utf-8", errors="replace")
    assert 'TO_CODA:this.drawSymbolText(t,e,"To Coda",!0)' in src, (
        "OSMD min.js must render TO_CODA as 'To Coda'+symbol "
        "(run: node scripts/patch_osmd_to_coda_label.mjs)"
    )
    assert 'TO_CODA:this.drawSymbolText(t,e,"To",!0)' not in src


if __name__ == "__main__":
    test_patch_script_exists()
    test_osmd_min_has_to_coda_label()
    print("osmd to-coda label patch ok")

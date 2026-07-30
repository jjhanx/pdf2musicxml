"""OSMD navigation label patches: To Coda text, D.S.+Segno glyph."""
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
PATCH_SCRIPT = ROOT / "scripts" / "patch_osmd_navigation_labels.mjs"


def test_patch_script_exists():
    assert PATCH_SCRIPT.is_file(), PATCH_SCRIPT


def test_osmd_min_navigation_labels():
    assert MIN_JS.is_file(), MIN_JS
    src = MIN_JS.read_text(encoding="utf-8", errors="replace")
    assert 'TO_CODA:this.drawSymbolText(t,e,"To Coda",!0)' in src
    assert 'TO_CODA:this.drawSymbolText(t,e,"To",!0)' not in src
    assert 'type.DS:this.drawSymbolText(t,e,"D.S.",!0)' in src
    assert 'type.DS:this.drawSymbolText(t,e,"D.S.",!1)' not in src
    assert 'this.symbol_type===pt.type.DS?"v8c":"v4d"' in src
    # Coda must stay visible even when To Coda already found / no open repetition
    assert (
        "if(0===this.openRepetitions.length){this.currentMeasure.FirstRepetitionInstructions.push"
        in src
    )
    assert (
        "case s.RepetitionInstructionEnum.Coda:i>0&&this.findInstructionInPreviousMeasure"
        not in src
    )


if __name__ == "__main__":
    test_patch_script_exists()
    test_osmd_min_navigation_labels()
    print("osmd navigation label patch ok")

"""font_separator must not wait on deskew_save_needed (no UI → hang)."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = (ROOT / "server" / "index.ts").read_text(encoding="utf-8")


def main() -> None:
    # font_separator 본문은 detect parts 직후 part_labels로 가야 함
    marker = "Detecting part labels from ${inputPdfPath}"
    i = SRC.find(marker)
    assert i >= 0, "detect parts log missing"
    # 같은 분기의 다음 단계
    j = SRC.find("Pausing for early part label setup", i)
    assert j > i, "part labels pause missing after detect parts"
    chunk = SRC[i:j]
    assert "deskew_save_needed" not in chunk, (
        "font_separator still pauses on deskew_save_needed without deskew UI — conversion hangs"
    )
    assert "Pausing for deskew save" not in chunk
    print("ok font_separator_no_deskew_save_hang")


if __name__ == "__main__":
    main()

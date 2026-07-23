#!/usr/bin/env python3
"""Export patched cheongsan raw to XML for OSMD tests."""
from __future__ import annotations

import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from apply_score_patches_mxl import patch_mxl_file


def extract_xml(mxl: Path) -> str:
    with zipfile.ZipFile(mxl) as z:
        c = z.read("META-INF/container.xml").decode()
        rp = re.search(r'full-path="([^"]+)"', c).group(1)
        return z.read(rp).decode("utf-8")


def main() -> None:
    src = Path("청산에 살리라 F/_inspect_0ea5/audiveris_raw.mxl")
    out = Path("_smoke/_patched_cheongsan_m26.xml")
    with tempfile.TemporaryDirectory() as td:
        dst = Path(td) / "patched.mxl"
        shutil.copy2(src, dst)
        patch_mxl_file(dst)
        out.write_text(extract_xml(dst), encoding="utf-8")
    print(out)


if __name__ == "__main__":
    main()

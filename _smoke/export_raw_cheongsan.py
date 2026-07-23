#!/usr/bin/env python3
"""Export raw audiveris XML (no score patches)."""
from __future__ import annotations

import re
import zipfile
from pathlib import Path


def main() -> None:
    p = Path("청산에 살리라 F/_inspect_0ea5/audiveris_raw.mxl")
    with zipfile.ZipFile(p) as z:
        c = z.read("META-INF/container.xml").decode()
        rp = re.search(r'full-path="([^"]+)"', c).group(1)
        out = Path("_smoke/_raw_cheongsan.xml")
        out.write_bytes(z.read(rp))
    print(out)


if __name__ == "__main__":
    main()

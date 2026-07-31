#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path


def export(mxl: Path, out: Path) -> None:
    with zipfile.ZipFile(mxl) as z:
        c = z.read("META-INF/container.xml").decode()
        rp = re.search(r'full-path="([^"]+)"', c).group(1)
        out.write_bytes(z.read(rp))
    print(out)


def main() -> None:
    mxl = Path(sys.argv[1])
    out = Path(sys.argv[2])
    export(mxl, out)


if __name__ == "__main__":
    main()

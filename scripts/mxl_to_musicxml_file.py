#!/usr/bin/env python3
"""Copy MusicXML bytes from an MXL (zip) or plain .musicxml/.xml file to a destination path."""
from __future__ import annotations

import re
import shutil
import sys
import zipfile


def _rootfile_from_container(z: zipfile.ZipFile) -> str | None:
    try:
        container = z.read("META-INF/container.xml").decode("utf-8", errors="replace")
    except KeyError:
        return None
    m = re.search(r'full-path="([^"]+)"', container)
    if m and m.group(1) in z.namelist():
        return m.group(1)
    return None


def main() -> None:
    if len(sys.argv) < 3:
        print("usage: mxl_to_musicxml_file.py <src.mxl|src.musicxml> <dest.xml>", file=sys.stderr)
        sys.exit(1)
    src, dest = sys.argv[1], sys.argv[2]
    lower = src.lower()
    if lower.endswith(".mxl"):
        with zipfile.ZipFile(src) as z:
            name = _rootfile_from_container(z)
            if name is None:
                # container.xml이 없으면 META-INF 밖의 .xml 중 가장 짧은 이름 사용
                names = [
                    n
                    for n in z.namelist()
                    if n.lower().endswith(".xml") and not n.startswith("META-INF/")
                ]
                if not names:
                    print("no .xml entry in mxl", file=sys.stderr)
                    sys.exit(1)
                names.sort(key=len)
                name = names[0]
            data = z.read(name)
        with open(dest, "wb") as f:
            f.write(data)
        return

    shutil.copyfile(src, dest)


if __name__ == "__main__":
    main()

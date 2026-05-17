#!/usr/bin/env python3
"""Copy MusicXML bytes from an MXL (zip) or plain .musicxml/.xml file to a destination path."""
from __future__ import annotations

import shutil
import sys
import zipfile


def main() -> None:
    if len(sys.argv) < 3:
        print("usage: mxl_to_musicxml_file.py <src.mxl|src.musicxml> <dest.xml>", file=sys.stderr)
        sys.exit(1)
    src, dest = sys.argv[1], sys.argv[2]
    lower = src.lower()
    if lower.endswith(".mxl"):
        with zipfile.ZipFile(src) as z:
            names = [n for n in z.namelist() if n.lower().endswith(".xml")]
            if not names:
                print("no .xml entry in mxl", file=sys.stderr)
                sys.exit(1)
            names.sort(key=len)
            data = z.read(names[0])
        with open(dest, "wb") as f:
            f.write(data)
        return

    shutil.copyfile(src, dest)


if __name__ == "__main__":
    main()

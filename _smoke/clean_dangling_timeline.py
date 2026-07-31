#!/usr/bin/env python3
import xml.etree.ElementTree as ET
from pathlib import Path

def local(t):
    return t.split("}", 1)[-1] if "}" in t else t

def clean(path_in: str, path_out: str) -> None:
    root = ET.parse(path_in).getroot()
    removed = 0
    for part in root:
        if local(part.tag) != "part":
            continue
        for meas in part:
            if local(meas.tag) != "measure":
                continue
            for i, c in enumerate(list(meas)):
                if local(c.tag) not in ("backup", "forward"):
                    continue
                if not any(local(meas[j].tag) == "note" for j in range(i + 1, len(meas))):
                    meas.remove(c)
                    removed += 1
    out = '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode")
    Path(path_out).write_text(out, encoding="utf-8")
    print("removed", removed, "dangling timeline elements")

if __name__ == "__main__":
    clean("_smoke/_cheongsan_review.xml", "_smoke/_cheongsan_review_nobackup.xml")

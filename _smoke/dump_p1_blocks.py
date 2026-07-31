#!/usr/bin/env python3
import json
from pathlib import Path

items = json.loads(Path("review_backup_남촌 D프렛.pdf.json").read_text(encoding="utf-8"))["items"]
ly = [x for x in items if x.get("type") == "lyrics" and int(x.get("lyricPartIndex", 1) or 1) == 1]
ly.sort(key=lambda x: (x.get("page", 1), x.get("y", 0), x.get("x", 0)))
Path("_smoke/p1_blocks.txt").write_text(
    "\n".join(f"{i}: {x.get('text', '')}" for i, x in enumerate(ly[:25])),
    encoding="utf-8",
)

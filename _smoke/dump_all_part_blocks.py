#!/usr/bin/env python3
import json
from pathlib import Path

for pi in (1, 2, 3, 4):
    items = json.loads(Path("review_backup_남촌 D프렛.pdf.json").read_text(encoding="utf-8"))["items"]
    ly = [x for x in items if x.get("type") == "lyrics" and int(x.get("lyricPartIndex", 1) or 1) == pi]
    ly.sort(key=lambda x: (x.get("page", 1), x.get("y", 0), x.get("x", 0)))
    lines = [f"=== P{pi} ({len(ly)} blocks) ==="]
    for i, x in enumerate(ly[:12]):
        lines.append(f"{i}: {x.get('text', '')}")
    Path(f"_smoke/p{pi}_blocks.txt").write_text("\n".join(lines), encoding="utf-8")

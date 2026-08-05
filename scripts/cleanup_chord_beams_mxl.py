#!/usr/bin/env python3
"""MXL 전체에서 chord 멤버 orphan beam 제거 (OSMD 미리보기 호환)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from omr_hitl_lib import cleanup_chord_beams_in_root, load_mxl_root, write_mxl_root


def cleanup_orphaned_parts(root) -> int:
    removed_count = 0
    part_list = root.find("part-list")
    if part_list is None:
        return 0
        
    valid_part_ids = set()
    for sp in part_list.findall("score-part"):
        pid = sp.get("id")
        if pid:
            valid_part_ids.add(pid)
            
    for part in root.findall("part"):
        pid = part.get("id")
        if pid not in valid_part_ids:
            root.remove(part)
            removed_count += 1
            
    return removed_count


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: cleanup_chord_beams_mxl.py <path.mxl>", file=sys.stderr)
        return 1
    mxl_path = Path(sys.argv[1])
    files, root_path, root = load_mxl_root(mxl_path)
    
    cleaned_beams = cleanup_chord_beams_in_root(root)
    removed_parts = cleanup_orphaned_parts(root)
    
    if cleaned_beams > 0 or removed_parts > 0:
        write_mxl_root(mxl_path, files, root_path, root)
        
    print(json.dumps({
        "chordBeamMeasuresCleaned": cleaned_beams + removed_parts,
        "orphanedPartsRemoved": removed_parts
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

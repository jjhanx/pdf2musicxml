#!/usr/bin/env python3
"""MXL in-place — omr_score_patches (최종 fix_audiveris_mxl 전용, HITL 미사용)."""
from __future__ import annotations

import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

from omr_score_patches import apply_score_patches


def mxl_ns(root: ET.Element) -> str:
    if root.tag.startswith("{"):
        return root.tag.split("}")[0][1:]
    return ""


def patch_mxl_file(mxl_path: Path) -> int:
    with zipfile.ZipFile(mxl_path, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    container_xml = files.get("META-INF/container.xml")
    if not container_xml:
        raise ValueError("Invalid MXL: no container.xml")
    match = re.search(r'full-path="([^"]+)"', container_xml.decode("utf-8"))
    if not match:
        raise ValueError("Could not find rootfile in container.xml")
    root_path = match.group(1)

    root = ET.fromstring(files[root_path])
    ns = mxl_ns(root)
    applied = apply_score_patches(root, ns)
    files[root_path] = ET.tostring(root, encoding="utf-8", xml_declaration=True)

    with zipfile.ZipFile(mxl_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, data in files.items():
            zout.writestr(name, data)
    return applied


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: apply_score_patches_mxl.py <score.mxl>", file=sys.stderr)
        sys.exit(2)
    applied = patch_mxl_file(Path(sys.argv[1]))
    print(json.dumps({"score_patches_applied": applied}))


if __name__ == "__main__":
    main()

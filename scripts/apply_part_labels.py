#!/usr/bin/env python3
"""part_labels.json 라벨을 MusicXML score-part 이름에 반영 (PR·PL → Piano)."""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

# mxl_quality_lint와 동일 규칙
_PIANO_LABELS = frozenset({"PR", "PL"})


def _ns(root: ET.Element) -> str:
    t = root.tag
    return t[1 : t.index("}")] if t.startswith("{") else ""


def _q(ns: str, local: str) -> str:
    return f"{{{ns}}}{local}" if ns else local


def load_part_labels_json(path: Path | None) -> list[str] | None:
    if path is None or not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if isinstance(data, dict) and isinstance(data.get("labelsByIndex"), list):
        labels = [str(x).strip() for x in data["labelsByIndex"]]
        if labels and all(labels):
            return labels
    return None


def label_to_part_name(label: str) -> str:
    """lint/UI 라벨 → MusicXML part-name (PR·PL은 Piano)."""
    text = (label or "").strip()
    if not text:
        return "Part"
    if text.upper() in _PIANO_LABELS:
        return "Piano"
    return text


def label_to_part_abbrev(label: str, display_name: str) -> str:
    if display_name == "Piano":
        return "Pno."
    if len(display_name) <= 4:
        return display_name
    return display_name[:4]


def apply_part_labels_to_root(root: ET.Element, labels_by_index: list[str]) -> int:
    """score-part 순서대로 part-name·abbrev·instrument-name 갱신. 변경 건수 반환."""
    ns = _ns(root)
    part_list = root.find(_q(ns, "part-list"))
    if part_list is None:
        return 0
    score_parts = part_list.findall(_q(ns, "score-part"))
    changed = 0
    for i, sp in enumerate(score_parts):
        if i >= len(labels_by_index):
            break
        display = label_to_part_name(labels_by_index[i])
        abbrev = label_to_part_abbrev(labels_by_index[i], display)

        pn = sp.find(_q(ns, "part-name"))
        if pn is None:
            pn = ET.SubElement(sp, _q(ns, "part-name"))
        if (pn.text or "").strip() != display:
            pn.text = display
            changed += 1

        pa = sp.find(_q(ns, "part-abbreviation"))
        if pa is None:
            pa = ET.SubElement(sp, _q(ns, "part-abbreviation"))
        if (pa.text or "").strip() != abbrev:
            pa.text = abbrev
            changed += 1

        for inst in sp.iter():
            if inst.tag == _q(ns, "instrument-name") or (
                inst.tag.endswith("instrument-name") and "instrument-name" in inst.tag
            ):
                if (inst.text or "").strip() != display:
                    inst.text = display
                    changed += 1
    return changed


def _load_mxl_score_xml(mxl_path: Path) -> tuple[dict[str, bytes], str]:
    with zipfile.ZipFile(mxl_path, "r") as z:
        files = {name: z.read(name) for name in z.namelist()}
    container = files.get("META-INF/container.xml")
    if not container:
        raise ValueError("META-INF/container.xml 없음")
    m = re.search(rb'full-path="([^"]+)"', container)
    if not m:
        raise ValueError("container.xml에 rootfile 없음")
    root_path = m.group(1).decode("utf-8")
    if root_path not in files:
        raise ValueError(f"루트 MusicXML 없음: {root_path}")
    return files, root_path


def apply_part_labels_mxl(
    mxl_in: Path,
    mxl_out: Path,
    labels_path: Path | None,
) -> dict[str, Any]:
    labels = load_part_labels_json(labels_path)
    if not labels:
        if mxl_in.resolve() != mxl_out.resolve():
            mxl_out.write_bytes(mxl_in.read_bytes())
        return {"applied": False, "reason": "no_labels", "changed": 0}

    files, root_path = _load_mxl_score_xml(mxl_in)
    root = ET.parse(io.BytesIO(files[root_path])).getroot()
    changed = apply_part_labels_to_root(root, labels)
    files[root_path] = ET.tostring(root, encoding="UTF-8", xml_declaration=True)

    mxl_out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(mxl_out, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, data)

    return {
        "applied": True,
        "changed": changed,
        "labelsByIndex": labels,
        "partNames": [label_to_part_name(l) for l in labels],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="MXL part-name에 성부 라벨 반영 (PR/PL → Piano)")
    ap.add_argument("mxl_in", type=Path)
    ap.add_argument("mxl_out", type=Path, nargs="?", default=None)
    ap.add_argument("--part-labels-json", type=Path, default=None)
    args = ap.parse_args()
    out = args.mxl_out or args.mxl_in
    labels_path = args.part_labels_json
    if labels_path is None:
        labels_path = args.mxl_in.parent / "part_labels.json"
    try:
        result = apply_part_labels_mxl(args.mxl_in, out, labels_path)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (OSError, ValueError, zipfile.BadZipFile) as e:
        print(str(e), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

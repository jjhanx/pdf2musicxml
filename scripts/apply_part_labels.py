#!/usr/bin/env python3
"""part_labels.json / preset 라벨을 MusicXML score-part 이름에 반영 (PR·PL → Piano)."""
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

_PIANO_LABELS = frozenset({"P", "PR", "PL"})
_DISPLAY_NAME_TAGS = frozenset({"part-name", "instrument-name", "midi-name"})
_ABBREV_TAGS = frozenset({"part-abbreviation", "instrument-abbreviation"})
_NAME_CONTAINER_TAGS = frozenset({"part-name", "part-abbreviation"})


def _ns(root: ET.Element) -> str:
    t = root.tag
    return t[1 : t.index("}")] if t.startswith("{") else ""


def _q(ns: str, local: str) -> str:
    return f"{{{ns}}}{local}" if ns else local


def _local(el: ET.Element) -> str:
    t = el.tag
    return t[t.index("}") + 1 :] if t.startswith("{") else t


def _parent_map(root: ET.Element) -> dict[ET.Element, ET.Element]:
    return {child: parent for parent in root.iter() for child in parent}


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


def resolve_labels_json_path(session_dir: Path, explicit: Path | None) -> Path | None:
    if explicit is not None and explicit.is_file():
        return explicit
    saved = session_dir / "part_labels.json"
    if saved.is_file():
        return saved
    preset = session_dir / "part_labels_preset.json"
    if preset.is_file():
        return preset
    return None


def label_to_part_name(label: str) -> str:
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


def _set_text(el: ET.Element, text: str) -> bool:
    cur = (el.text or "").strip()
    if cur == text:
        return False
    el.text = text
    return True


def _flatten_name_element(el: ET.Element, text: str) -> bool:
    """Audiveris: <part-name><display-text>Voice</display-text></part-name> → 단순 텍스트."""
    changed = False
    for child in list(el):
        el.remove(child)
    if _set_text(el, text):
        changed = True
    return changed


def _display_text_context(
    el: ET.Element,
    score_part: ET.Element,
    parents: dict[ET.Element, ET.Element],
) -> str | None:
    p: ET.Element | None = el
    while p is not None and p is not score_part:
        pl = _local(p)
        if pl in ("part-name-display", "part-name"):
            return "display"
        if pl in ("part-abbreviation-display", "part-abbreviation"):
            return "abbrev"
        p = parents.get(p)
    return None


def _apply_names_to_score_part(
    sp: ET.Element,
    display: str,
    abbrev: str,
    parents: dict[ET.Element, ET.Element],
) -> int:
    changed = 0
    for el in sp.iter():
        loc = _local(el)
        if loc == "part-name":
            if _flatten_name_element(el, display):
                changed += 1
        elif loc == "part-abbreviation":
            if _flatten_name_element(el, abbrev):
                changed += 1
        elif loc in _DISPLAY_NAME_TAGS - _NAME_CONTAINER_TAGS:
            if _set_text(el, display):
                changed += 1
        elif loc in _ABBREV_TAGS - _NAME_CONTAINER_TAGS:
            if _set_text(el, abbrev):
                changed += 1
        elif loc == "display-text":
            ctx = _display_text_context(el, sp, parents)
            if ctx == "display" and _set_text(el, display):
                changed += 1
            elif ctx == "abbrev" and _set_text(el, abbrev):
                changed += 1
    return changed


def apply_part_labels_to_root(root: ET.Element, labels_by_index: list[str]) -> int:
    ns = _ns(root)
    part_list = root.find(_q(ns, "part-list"))
    if part_list is None:
        return 0

    score_parts: list[ET.Element] = []
    for child in part_list:
        if _local(child) == "score-part":
            score_parts.append(child)

    parents = _parent_map(root)
    changed = 0
    for i, sp in enumerate(score_parts):
        if i >= len(labels_by_index):
            break
        display = label_to_part_name(labels_by_index[i])
        abbrev = label_to_part_abbrev(labels_by_index[i], display)
        changed += _apply_names_to_score_part(sp, display, abbrev, parents)
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
        return {"applied": False, "reason": "no_labels", "changed": 0, "path": str(mxl_in)}

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
        "path": str(mxl_out),
        "format": "mxl",
    }


def apply_part_labels_musicxml(
    xml_in: Path,
    xml_out: Path,
    labels_path: Path | None,
) -> dict[str, Any]:
    labels = load_part_labels_json(labels_path)
    if not labels:
        if xml_in.resolve() != xml_out.resolve():
            xml_out.write_bytes(xml_in.read_bytes())
        return {"applied": False, "reason": "no_labels", "changed": 0, "path": str(xml_in)}

    root = ET.parse(xml_in).getroot()
    changed = apply_part_labels_to_root(root, labels)
    xml_out.parent.mkdir(parents=True, exist_ok=True)
    xml_out.write_bytes(ET.tostring(root, encoding="UTF-8", xml_declaration=True))

    return {
        "applied": True,
        "changed": changed,
        "labelsByIndex": labels,
        "partNames": [label_to_part_name(l) for l in labels],
        "path": str(xml_out),
        "format": "musicxml",
    }


def apply_part_labels_file(
    score_in: Path,
    score_out: Path,
    labels_path: Path | None,
) -> dict[str, Any]:
    low = score_in.suffix.lower()
    if low == ".mxl":
        return apply_part_labels_mxl(score_in, score_out, labels_path)
    if low in (".musicxml", ".xml"):
        return apply_part_labels_musicxml(score_in, score_out, labels_path)
    raise ValueError(f"지원하지 않는 확장자: {score_in.suffix}")


def main() -> int:
    ap = argparse.ArgumentParser(description="MXL/MusicXML part-name에 성부 라벨 반영 (PR/PL → Piano)")
    ap.add_argument("score_in", type=Path)
    ap.add_argument("score_out", type=Path, nargs="?", default=None)
    ap.add_argument("--part-labels-json", type=Path, default=None)
    args = ap.parse_args()
    out = args.score_out or args.score_in
    labels_path = resolve_labels_json_path(args.score_in.parent, args.part_labels_json)
    try:
        result = apply_part_labels_file(args.score_in, out, labels_path)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (OSError, ValueError, zipfile.BadZipFile) as e:
        print(str(e), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

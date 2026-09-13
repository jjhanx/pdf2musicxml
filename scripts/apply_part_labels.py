#!/usr/bin/env python3
"""part_labels.json / preset 라벨을 MusicXML score-part 이름에 반영 (PR·PL → Piano, S/A/T/B/M/W/U/P는 라벨 그대로)."""
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

# 양손 피아노 약어(PR·PL)만 MusicXML 표시명 Piano. 단일 P는 S/A/T/B처럼 라벨 그대로.
_PIANO_DISPLAY_LABELS = frozenset({"PR", "PL"})
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
    if text.upper() in _PIANO_DISPLAY_LABELS:
        return "Piano"
    return text


def label_to_part_abbrev(label: str, display_name: str) -> str:
    text = (label or "").strip().upper()
    # 오선 앞 짧은 표시: 피아노도 P (Pno.는 너무 김·혼동)
    if text in _PIANO_DISPLAY_LABELS or display_name == "Piano":
        return "P"
    if len(display_name) <= 4:
        return display_name
    return display_name[:4]


def _part_has_pitched_notes(measure: ET.Element, ns: str) -> bool:
    for el in measure:
        if _local(el) != "note":
            continue
        if el.find(_q(ns, "rest")) is not None:
            continue
        if el.find(_q(ns, "chord")) is not None:
            continue
        if el.find(_q(ns, "grace")) is not None or el.get("cue") == "yes":
            continue
        return True
    return False


def _measure_is_system_start(measure: ET.Element, ns: str, *, is_first: bool) -> bool:
    if is_first:
        return True
    for el in measure:
        if _local(el) != "print":
            continue
        if (el.get("new-system") or "").strip().lower() in ("yes", "1", "true"):
            return True
        if (el.get("new-page") or "").strip().lower() in ("yes", "1", "true"):
            return True
    return False


def _ensure_print_element(measure: ET.Element, ns: str) -> ET.Element:
    for el in measure:
        if _local(el) == "print":
            return el
    print_el = ET.Element(_q(ns, "print"))
    # attributes 앞·첫 note 앞
    insert_at = 0
    for i, el in enumerate(measure):
        loc = _local(el)
        if loc in ("note", "backup", "forward", "direction", "barline"):
            insert_at = i
            break
        if loc == "attributes":
            insert_at = i + 1
    measure.insert(insert_at, print_el)
    return print_el


def _set_part_abbreviation_display(print_el: ET.Element, ns: str, abbrev: str) -> bool:
    """print 아래 part-abbreviation-display를 보이게 설정."""
    changed = False
    pad = None
    for child in list(print_el):
        if _local(child) == "part-abbreviation-display":
            pad = child
            break
    if pad is None:
        pad = ET.SubElement(print_el, _q(ns, "part-abbreviation-display"))
        changed = True
    if (pad.get("print-object") or "").strip().lower() != "yes":
        pad.set("print-object", "yes")
        changed = True
    display_text = None
    for child in list(pad):
        if _local(child) == "display-text":
            display_text = child
            break
    if display_text is None:
        display_text = ET.SubElement(pad, _q(ns, "display-text"))
        changed = True
    if (display_text.text or "").strip() != abbrev:
        display_text.text = abbrev
        changed = True
    # 긴 이름은 시스템마다 반복하지 않음
    for child in list(print_el):
        if _local(child) == "part-name-display":
            if (child.get("print-object") or "").strip().lower() != "no":
                child.set("print-object", "no")
                changed = True
            break
    else:
        pnd = ET.SubElement(print_el, _q(ns, "part-name-display"))
        pnd.set("print-object", "no")
        changed = True
    return changed


def ensure_system_part_abbreviation_displays(root: ET.Element) -> int:
    """시스템 시작·성부 구성이 바뀌는 마디에 오선 앞 약어(S/A/T/B/P)를 표시.

    S+A만 또는 T+B만 나오는 구간에서 파트 표시가 없으면 혼동되므로,
    활성(실음) 성부 집합이 바뀌거나 new-system 때 각 파트의 part-abbreviation-display를 켠다.
    """
    ns = _ns(root)
    part_list = root.find(_q(ns, "part-list"))
    if part_list is None:
        return 0
    abbrev_by_id: dict[str, str] = {}
    for sp in part_list:
        if _local(sp) != "score-part":
            continue
        pid = sp.get("id") or ""
        if not pid:
            continue
        pa = sp.find(_q(ns, "part-abbreviation"))
        pn = sp.find(_q(ns, "part-name"))
        abbrev = (pa.text or "").strip() if pa is not None else ""
        name = (pn.text or "").strip() if pn is not None else ""
        abbrev_by_id[pid] = abbrev or name or pid
        if pa is not None:
            if (pa.get("print-object") or "").strip().lower() != "yes":
                pa.set("print-object", "yes")

    parts = [p for p in root if _local(p) == "part" and (p.get("id") or "") in abbrev_by_id]
    if not parts:
        return 0

    # measure number → 활성(실음) 파트 id 집합
    measures_by_num: dict[str, list[tuple[ET.Element, ET.Element]]] = {}
    for part in parts:
        for measure in part:
            if _local(measure) != "measure":
                continue
            num = measure.get("number") or ""
            measures_by_num.setdefault(num, []).append((part, measure))

    ordered_nums = sorted(
        measures_by_num.keys(),
        key=lambda n: (int(n) if str(n).isdigit() else 10**9, str(n)),
    )
    changed = 0
    prev_active: frozenset[str] | None = None
    for i, num in enumerate(ordered_nums):
        entries = measures_by_num[num]
        active = frozenset(
            (part.get("id") or "")
            for part, measure in entries
            if _part_has_pitched_notes(measure, ns)
        )
        # 피아노(실음 있는 비보컬)도 표시 대상에 포함 — active에 이미 들어감
        is_first = i == 0
        system_start = any(
            _measure_is_system_start(measure, ns, is_first=is_first)
            for _part, measure in entries
        )
        active_changed = prev_active is not None and active != prev_active and bool(active)
        if system_start or active_changed or is_first:
            for part, measure in entries:
                pid = part.get("id") or ""
                abbrev = abbrev_by_id.get(pid)
                if not abbrev:
                    continue
                # 실음이 있거나, 같은 시스템에서 다른 성부가 노래하는 동안 쉼표만인 성부도
                # 오선이 보이면 약어를 붙여 혼동을 줄인다.
                print_el = _ensure_print_element(measure, ns)
                if _set_part_abbreviation_display(print_el, ns, abbrev):
                    changed += 1
        if active:
            prev_active = active
        elif prev_active is None:
            prev_active = active
    return changed


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
    changed += ensure_system_part_abbreviation_displays(root)
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
    ap = argparse.ArgumentParser(description="MXL/MusicXML part-name에 성부 라벨 반영 (PR/PL→Piano, P·SATB는 라벨 그대로)")
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

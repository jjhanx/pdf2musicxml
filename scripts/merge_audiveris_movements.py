#!/usr/bin/env python3
"""Audiveris가 파트 구성 변화로 나눈 mvt1/mvt2 MXL을 한 악보로 이어 붙인다.

페이지마다 성부 수가 바뀌면 Audiveris는 Score 1·2를 만들고
`*.mvt1.mxl` / `*.mvt2.mxl` 로 따로 보낸다. 이후 HITL이 첫 파일만
`audiveris_raw.mxl`로 복사하면 뒷 페이지 마디가 통째로 빠진다.

이 스크립트는 같은 stem의 mvt 파일을 마디 번호만 이어 붙여 단일 MXL로 만든다.
곡명·마디 하드코딩 없음.
"""
from __future__ import annotations

import argparse
import copy
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from omr_hitl_lib import _local, _ns, _q, load_mxl_root, write_mxl_root

_MVT_NAME_RE = re.compile(r"^(?P<stem>.+)\.mvt(?P<n>\d+)\.(?P<ext>mxl|musicxml)$", re.I)
_PIANO_NAMES = frozenset({"piano", "pno", "p", "pr", "pl", "pianoforte", "kbd", "keyboard"})


def _normalize_part_name(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (text or "").lower())


def _is_piano_name(name: str) -> bool:
    n = _normalize_part_name(name)
    if not n:
        return False
    if n in _PIANO_NAMES:
        return True
    return n.startswith("pno")


def _part_name_text(score_part: ET.Element, ns: str) -> str:
    el = score_part.find(_q(ns, "part-name"))
    if el is None:
        return ""
    dt = el.find(_q(ns, "display-text"))
    if dt is not None and (dt.text or "").strip():
        return (dt.text or "").strip()
    return "".join(el.itertext()).strip()


def _score_parts(root: ET.Element, ns: str) -> list[ET.Element]:
    part_list = root.find(_q(ns, "part-list"))
    if part_list is None:
        return []
    return [el for el in part_list if _local(el) == "score-part"]


def _parts(root: ET.Element, ns: str) -> list[ET.Element]:
    return [el for el in root if _local(el) == "part"]


def _measures(part: ET.Element) -> list[ET.Element]:
    return [el for el in part if _local(el) == "measure"]


def _measure_number_int(measure: ET.Element) -> int | None:
    raw = (measure.get("number") or "").strip()
    try:
        return int(raw)
    except ValueError:
        return None


def _part_infos(root: ET.Element, ns: str) -> list[dict[str, object]]:
    out: list[dict[str, object]] = []
    for sp in _score_parts(root, ns):
        pid = (sp.get("id") or "").strip()
        name = _part_name_text(sp, ns)
        out.append({"id": pid, "name": name, "piano": _is_piano_name(name), "score_part": sp})
    return out


def match_parts(
    dest_infos: list[dict[str, object]],
    src_infos: list[dict[str, object]],
) -> tuple[dict[str, str], list[dict[str, object]], list[dict[str, object]]]:
    """src part id → dest part id. 이름(유일) → 피아노 → 나머지 순서."""
    mapping: dict[str, str] = {}
    used_dest: set[str] = set()

    dest_by_norm: dict[str, list[dict[str, object]]] = {}
    for d in dest_infos:
        n = _normalize_part_name(str(d["name"]))
        dest_by_norm.setdefault(n, []).append(d)
    src_by_norm: dict[str, list[dict[str, object]]] = {}
    for s in src_infos:
        n = _normalize_part_name(str(s["name"]))
        src_by_norm.setdefault(n, []).append(s)

    for n, srcs in src_by_norm.items():
        if not n:
            continue
        dests = dest_by_norm.get(n, [])
        if len(srcs) == 1 and len(dests) == 1:
            sid = str(srcs[0]["id"])
            did = str(dests[0]["id"])
            mapping[sid] = did
            used_dest.add(did)

    src_p = [s for s in src_infos if s["piano"] and str(s["id"]) not in mapping]
    dest_p = [d for d in dest_infos if d["piano"] and str(d["id"]) not in used_dest]
    for s, d in zip(src_p, dest_p):
        mapping[str(s["id"])] = str(d["id"])
        used_dest.add(str(d["id"]))

    src_r = [s for s in src_infos if str(s["id"]) not in mapping]
    dest_r = [d for d in dest_infos if str(d["id"]) not in used_dest]
    for s, d in zip(src_r, dest_r):
        mapping[str(s["id"])] = str(d["id"])
        used_dest.add(str(d["id"]))

    unmatched_src = [s for s in src_infos if str(s["id"]) not in mapping]
    unmatched_dest = [d for d in dest_infos if str(d["id"]) not in used_dest]
    return mapping, unmatched_src, unmatched_dest


def group_movement_paths(paths: list[Path]) -> list[list[Path]]:
    """같은 stem의 mvtN 파일을 번호 순 그룹으로. 한 개짜리 그룹은 호출측에서 건너뛴다."""
    buckets: dict[str, list[tuple[int, Path]]] = {}
    for p in paths:
        m = _MVT_NAME_RE.match(p.name)
        if not m:
            continue
        key = f"{p.parent.resolve()}::{m.group('stem').lower()}::{m.group('ext').lower()}"
        buckets.setdefault(key, []).append((int(m.group("n")), p))
    groups: list[list[Path]] = []
    for items in buckets.values():
        items.sort(key=lambda t: t[0])
        groups.append([p for _, p in items])
    return groups


def _time_from_measure(measure: ET.Element | None, ns: str) -> tuple[int, int, int, int]:
    divisions, beats, beat_type, staves = 1, 4, 4, 1
    if measure is None:
        return divisions, beats, beat_type, staves
    for child in measure:
        if _local(child) != "attributes":
            continue
        div_el = child.find(_q(ns, "divisions"))
        if div_el is not None and (div_el.text or "").strip():
            try:
                divisions = max(1, int(div_el.text))
            except ValueError:
                pass
        time_el = child.find(_q(ns, "time"))
        if time_el is not None:
            b = time_el.find(_q(ns, "beats"))
            bt = time_el.find(_q(ns, "beat-type"))
            try:
                if b is not None and b.text:
                    beats = max(1, int(b.text))
                if bt is not None and bt.text:
                    beat_type = max(1, int(bt.text))
            except ValueError:
                pass
        st_el = child.find(_q(ns, "staves"))
        if st_el is not None and (st_el.text or "").strip():
            try:
                staves = max(1, int(st_el.text))
            except ValueError:
                pass
        break
    return divisions, beats, beat_type, staves


def _first_attributes(measure: ET.Element, ns: str) -> ET.Element | None:
    for child in measure:
        if _local(child) == "attributes":
            return child
    return None


def _ensure_new_page(measure: ET.Element, ns: str) -> None:
    print_el = None
    for child in measure:
        if _local(child) == "print":
            print_el = child
            break
    if print_el is None:
        print_el = ET.Element(_q(ns, "print"))
        attrs = _first_attributes(measure, ns)
        if attrs is not None:
            idx = list(measure).index(attrs) + 1
            measure.insert(idx, print_el)
        else:
            measure.insert(0, print_el)
    print_el.set("new-page", "yes")


def _rest_measure(
    number: str,
    template: ET.Element | None,
    ns: str,
    *,
    new_page: bool = False,
) -> ET.Element:
    m = ET.Element(_q(ns, "measure"), {"number": str(number)})
    divisions, beats, beat_type, staves = _time_from_measure(template, ns)
    if template is not None:
        src_attr = _first_attributes(template, ns)
        if src_attr is not None:
            m.append(copy.deepcopy(src_attr))
    else:
        attr = ET.SubElement(m, _q(ns, "attributes"))
        d = ET.SubElement(attr, _q(ns, "divisions"))
        d.text = str(divisions)
        time_el = ET.SubElement(attr, _q(ns, "time"))
        ET.SubElement(time_el, _q(ns, "beats")).text = str(beats)
        ET.SubElement(time_el, _q(ns, "beat-type")).text = str(beat_type)
    if new_page:
        _ensure_new_page(m, ns)
    dur = max(1, round(divisions * beats * 4 / beat_type))
    for staff_i in range(1, staves + 1):
        if staff_i > 1:
            backup = ET.SubElement(m, _q(ns, "backup"))
            ET.SubElement(backup, _q(ns, "duration")).text = str(dur)
        note = ET.SubElement(m, _q(ns, "note"))
        ET.SubElement(note, _q(ns, "rest"), {"measure": "yes"})
        ET.SubElement(note, _q(ns, "duration")).text = str(dur)
        ET.SubElement(note, _q(ns, "type")).text = "whole"
        ET.SubElement(note, _q(ns, "voice")).text = str(staff_i)
        if staves > 1:
            ET.SubElement(note, _q(ns, "staff")).text = str(staff_i)
    return m


def _prepare_appended_measure(
    measure: ET.Element,
    new_number: str,
    ns: str,
    *,
    is_first: bool,
) -> ET.Element:
    out = copy.deepcopy(measure)
    out.set("number", str(new_number))
    if out.get("implicit") == "yes":
        del out.attrib["implicit"]
    if is_first:
        _ensure_new_page(out, ns)
    return out


def _next_part_id(existing: set[str]) -> str:
    n = 1
    while f"P{n}" in existing:
        n += 1
    return f"P{n}"


def _retarget_score_part(sp: ET.Element, new_id: str) -> ET.Element:
    el = copy.deepcopy(sp)
    old = el.get("id") or ""
    el.set("id", new_id)
    if old:
        for child in el.iter():
            cid = child.get("id")
            if cid and old in cid:
                child.set("id", cid.replace(old, new_id, 1))
    return el


def _dest_max_measure(root: ET.Element, ns: str) -> int:
    mx = 0
    count = 0
    for part in _parts(root, ns):
        ms = _measures(part)
        count = max(count, len(ms))
        for m in ms:
            n = _measure_number_int(m)
            if n is not None:
                mx = max(mx, n)
    return max(mx, count)


def merge_movement_roots(dest_root: ET.Element, src_root: ET.Element) -> int:
    """src 마디를 dest 뒤에 붙인다. 추가된 마디 수(타임라인 기준)를 반환."""
    ns = _ns(dest_root)
    dest_infos = _part_infos(dest_root, ns)
    src_infos = _part_infos(src_root, ns)
    if not dest_infos or not src_infos:
        return 0

    mapping, unmatched_src, unmatched_dest = match_parts(dest_infos, src_infos)
    dest_by_id = {p.get("id"): p for p in _parts(dest_root, ns)}
    src_by_id = {p.get("id"): p for p in _parts(src_root, ns)}
    dest_max = _dest_max_measure(dest_root, ns)

    src_len = 0
    for info in src_infos:
        part = src_by_id.get(str(info["id"]))
        if part is not None:
            src_len = max(src_len, len(_measures(part)))
    if src_len < 1:
        return 0

    new_numbers = [str(dest_max + i) for i in range(1, src_len + 1)]

    part_list = dest_root.find(_q(ns, "part-list"))
    existing_ids = {str(info["id"]) for info in dest_infos}

    for info in unmatched_src:
        src_part = src_by_id.get(str(info["id"]))
        if src_part is None:
            continue
        new_id = _next_part_id(existing_ids)
        existing_ids.add(new_id)
        if part_list is not None:
            part_list.append(_retarget_score_part(info["score_part"], new_id))  # type: ignore[arg-type]
        new_part = ET.Element(src_part.tag, {"id": new_id})
        template_lead = None
        first_dest = dest_by_id.get(str(dest_infos[0]["id"]))
        if first_dest is not None:
            dms = _measures(first_dest)
            if dms:
                template_lead = dms[-1]
        for i in range(dest_max):
            new_part.append(_rest_measure(str(i + 1), template_lead, ns, new_page=(i == 0 and dest_max == 0)))
        src_ms = _measures(src_part)
        for i, num in enumerate(new_numbers):
            if i < len(src_ms):
                new_part.append(_prepare_appended_measure(src_ms[i], num, ns, is_first=(i == 0)))
            else:
                tmpl = src_ms[-1] if src_ms else template_lead
                new_part.append(_rest_measure(num, tmpl, ns, new_page=(i == 0)))
        dest_root.append(new_part)
        dest_by_id[new_id] = new_part

    for src_id, dest_id in mapping.items():
        dest_part = dest_by_id.get(dest_id)
        src_part = src_by_id.get(src_id)
        if dest_part is None or src_part is None:
            continue
        src_ms = _measures(src_part)
        for i, num in enumerate(new_numbers):
            if i < len(src_ms):
                dest_part.append(_prepare_appended_measure(src_ms[i], num, ns, is_first=(i == 0)))
            else:
                tmpl = _measures(dest_part)[-1] if _measures(dest_part) else None
                dest_part.append(_rest_measure(num, tmpl, ns, new_page=(i == 0)))

    for info in unmatched_dest:
        dest_part = dest_by_id.get(str(info["id"]))
        if dest_part is None:
            continue
        dms = _measures(dest_part)
        tmpl = dms[-1] if dms else None
        for i, num in enumerate(new_numbers):
            dest_part.append(_rest_measure(num, tmpl, ns, new_page=(i == 0)))

    return src_len


def merge_mxl_files(paths: list[Path], out_path: Path) -> dict[str, object]:
    if len(paths) < 2:
        raise ValueError("mvt 파일이 2개 이상 필요합니다")
    files, root_path, root = load_mxl_root(paths[0])
    added = 0
    for extra in paths[1:]:
        _, _, src_root = load_mxl_root(extra)
        added += merge_movement_roots(root, src_root)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    write_mxl_root(out_path, files, root_path, root)
    ns = _ns(root)
    return {
        "out": str(out_path),
        "movements": len(paths),
        "appendedMeasureChunks": added,
        "maxMeasure": _dest_max_measure(root, ns),
        "partCount": len(_parts(root, ns)),
        "inputs": [str(p) for p in paths],
    }


def merge_path_list(paths: list[Path]) -> dict[str, object]:
    """입력 경로 목록에서 mvt 그룹을 병합하고, HITL/다운로드용 경로 목록을 돌려준다."""
    resolved = [p.resolve() for p in paths if p.is_file()]
    groups = [g for g in group_movement_paths(resolved) if len(g) >= 2]
    merged_meta: list[dict[str, object]] = []
    replaced: set[Path] = set()
    outputs: list[Path] = []

    for group in groups:
        stem_m = _MVT_NAME_RE.match(group[0].name)
        if not stem_m:
            continue
        out_path = group[0].with_name(f"{stem_m.group('stem')}.{stem_m.group('ext')}")
        info = merge_mxl_files(group, out_path)
        merged_meta.append(info)
        replaced.update(group)
        outputs.append(out_path)

    for p in resolved:
        if p not in replaced:
            outputs.append(p)

    seen: set[Path] = set()
    unique: list[str] = []
    for p in outputs:
        if p in seen:
            continue
        seen.add(p)
        unique.append(str(p))

    return {
        "ok": True,
        "merged": merged_meta,
        "outputs": unique,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Audiveris mvt1/mvt2 MXL을 한 악보로 병합")
    ap.add_argument("paths", nargs="*", type=Path, help="MXL 경로들")
    ap.add_argument("--out", type=Path, help="단일 그룹 출력 경로")
    args = ap.parse_args()
    paths = [p for p in args.paths if p.is_file()]
    if not paths:
        print(json.dumps({"ok": True, "merged": [], "outputs": []}, ensure_ascii=False))
        return 0
    try:
        if args.out is not None:
            mvt = [p for p in paths if _MVT_NAME_RE.match(p.name)]
            if len(mvt) < 2:
                mvt = paths
            info = merge_mxl_files(mvt, args.out)
            print(json.dumps({"ok": True, "merged": [info], "outputs": [str(args.out)]}, ensure_ascii=False))
            return 0
        print(json.dumps(merge_path_list(paths), ensure_ascii=False))
        return 0
    except (OSError, ValueError, ET.ParseError) as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Dump measure 64 staff-2 (PL) timeline from omr-work zips."""
from __future__ import annotations

import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def load_score_root(zpath: Path) -> tuple[ET.Element, str]:
    z = zipfile.ZipFile(zpath)
    cand = None
    for prefer in ("review.mxl", "omr_hitl_baseline.mxl", "audiveris_raw.mxl"):
        for n in z.namelist():
            if n.endswith(prefer):
                cand = n
                break
        if cand:
            break
    if not cand:
        raise SystemExit(f"no mxl in {zpath}")
    data = z.read(cand)
    try:
        inner = zipfile.ZipFile(io.BytesIO(data))
        xmlname = next(n for n in inner.namelist() if n.endswith(".xml") and "META" not in n)
        root = ET.fromstring(inner.read(xmlname))
    except zipfile.BadZipFile:
        root = ET.fromstring(data)
    return root, cand


def dump_m64(zpath: Path) -> None:
    root, cand = load_score_root(zpath)
    ns = root.tag[1 : root.tag.index("}")] if root.tag.startswith("{") else ""

    def q(n: str) -> str:
        return f"{{{ns}}}{n}" if ns else n

    print(f"=== {zpath.name} ({cand}) ===")
    for part in root.findall(q("part")):
        pid = part.get("id")
        for m in part.findall(q("measure")):
            if m.get("number") != "64":
                continue
            seq: list[str] = []
            for c in m:
                t = local(c.tag)
                if t == "note":
                    st_el = c.find(q("staff"))
                    st = st_el.text if st_el is not None else "1"
                    v_el = c.find(q("voice"))
                    v = v_el.text if v_el is not None else "?"
                    d_el = c.find(q("duration"))
                    d = d_el.text if d_el is not None else "?"
                    typ_el = c.find(q("type"))
                    typ = typ_el.text if typ_el is not None else "?"
                    rest = c.find(q("rest")) is not None
                    pitch = c.find(q("pitch"))
                    if pitch is not None:
                        p = f"{pitch.find(q('step')).text}{pitch.find(q('octave')).text}"
                    else:
                        p = "rest" if rest else "?"
                    chord = c.find(q("chord")) is not None
                    dx = c.get("default-x") or "-"
                    seq.append(f"note s{st} v{v} d{d} {typ} {p}{' chord' if chord else ''} x={dx}")
                elif t in ("backup", "forward"):
                    d_el = c.find(q("duration"))
                    d = d_el.text if d_el is not None else "?"
                    v_el = c.find(q("voice"))
                    vv = f" v{v_el.text}" if v_el is not None else ""
                    seq.append(f"{t} d{d}{vv}")
                elif t == "attributes":
                    div = c.find(q("divisions"))
                    div_t = div.text if div is not None else "?"
                    seq.append(f"attrs div={div_t}")
            has_s2 = any(" s2 " in s for s in seq)
            if pid == "P5" or has_s2:
                print(f"part {pid}:")
                for s in seq:
                    print(" ", s)


def main() -> None:
    zips = sys.argv[1:] or [
        "omr-work-23ddc764.zip",
        "청산에 살리라 F/omr-work-23ddc764.zip",
        "omr-work-0ea5ea52.zip",
        "청산에 살리라 F/omr-work-0ea5ea52.zip",
        "omr-work-4637986c.zip",
        "청산에 살리라 F/omr-work-4637986c.zip",
        "omr-work-ddbf5994.zip" if False else "",
    ]
    for z in zips:
        if not z:
            continue
        p = Path(z)
        if p.exists():
            try:
                dump_m64(p)
            except Exception as e:
                print(p, e)


if __name__ == "__main__":
    main()

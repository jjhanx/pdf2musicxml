#!/usr/bin/env python3
"""인쇄 26마디(MXL 25) — ♩. ♪ ♩ ♪ ♪ 점4분·피아노 병렬 voice 회귀."""
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from fix_audiveris_mxl import fix_mxl_file  # noqa: E402

SRC = ROOT / "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"
OUT = ROOT / "_smoke/_m25_reg.mxl"
MXL_M25 = "25"  # 인쇄 26 (pickup offset 1)


def load_xml(mxl: Path):
    with zipfile.ZipFile(mxl) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        root = ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()
    ns = root.tag.split("}")[0][1:] if root.tag.startswith("{") else ""
    return root, ns


def q(ns, local):
    return f"{{{ns}}}{local}" if ns else local


def voice_groups(part, ns, mnum):
    for measure in part.findall(q(ns, "measure")):
        if measure.get("number") != mnum:
            continue
        by_v: dict[str, list[tuple[str, int, bool]]] = {}
        for note in measure.findall(q(ns, "note")):
            if note.find(q(ns, "chord")) is not None:
                continue
            v_el = note.find(q(ns, "voice"))
            v = v_el.text if v_el is not None else "1"
            typ = note.find(q(ns, "type"))
            t = typ.text if typ is not None else "?"
            dur = int(note.find(q(ns, "duration")).text)
            dot = note.find(q(ns, "dot")) is not None
            tm = note.find(q(ns, "time-modification")) is not None
            by_v.setdefault(v, []).append((t, dur, dot, tm))
        return by_v
    return {}


def test_satb_dotted_quarter_pattern():
    """S/A/T/B: ♩. + ♪ + ♩ + ♪ + ♪ — 세잇단화·점4분 dot 유실 금지."""
    fix_mxl_file(str(SRC), str(OUT))
    root, ns = load_xml(OUT)
    ok = True
    for pi in range(4):
        part = root.findall(".//" + q(ns, "part"))[pi]
        groups = voice_groups(part, ns, MXL_M25)
        v1 = groups.get("1") or []
        if len(v1) < 5:
            print(f"FAIL part{pi+1}: too few groups {v1}")
            ok = False
            continue
        if not (v1[0][0] == "quarter" and v1[0][2] and v1[0][1] == 18):
            print(f"FAIL part{pi+1}: first not dotted quarter {v1[0]}")
            ok = False
        if not (v1[1][0] == "eighth" and v1[1][1] == 6):
            print(f"FAIL part{pi+1}: second not eighth {v1[1]}")
            ok = False
        if not (v1[2][0] == "quarter" and v1[2][1] == 12 and not v1[2][3]):
            print(f"FAIL part{pi+1}: third not plain quarter {v1[2]}")
            ok = False
        if any(x[3] for x in v1):
            print(f"FAIL part{pi+1}: spurious triplet {v1}")
            ok = False
    if ok:
        print("PASS: SATB m25 dotted-quarter + quarter + eighth pattern")
    return ok


def test_piano_pr_parallel_voices():
    """PR staff1: v1/v2 병렬 유지, ♩. C + ♩ B / ♩ C + ♪♪ — flatten·세잇단 오인 금지."""
    root, ns = load_xml(OUT)
    part = root.findall(".//" + q(ns, "part"))[4]
    by_staff_v: dict[tuple[str, str], list] = {}
    for measure in part.findall(q(ns, "measure")):
        if measure.get("number") != MXL_M25:
            continue
        for note in measure.findall(q(ns, "note")):
            if note.find(q(ns, "chord")) is not None:
                continue
            st_el = note.find(q(ns, "staff"))
            st = st_el.text if st_el is not None else "1"
            v = note.find(q(ns, "voice")).text if note.find(q(ns, "voice")) is not None else "1"
            typ = note.find(q(ns, "type")).text
            dur = int(note.find(q(ns, "duration")).text)
            dot = note.find(q(ns, "dot")) is not None
            tm = note.find(q(ns, "time-modification")) is not None
            by_staff_v.setdefault((st, v), []).append((typ, dur, dot, tm))
    v1 = by_staff_v.get(("1", "1"), [])
    v2 = by_staff_v.get(("1", "2"), [])
    ok = True
    if len(v1) != 2 or not (v1[0][2] and v1[0][1] == 18 and v1[1][0] == "quarter" and v1[1][1] == 12):
        print(f"FAIL PR v1 {v1}")
        ok = False
    if len(v2) != 3 or not (v2[0][0] == "quarter" and v2[0][1] == 12):
        print(f"FAIL PR v2 {v2}")
        ok = False
    if any(x[3] for x in v1 + v2):
        print(f"FAIL PR spurious triplet v1={v1} v2={v2}")
        ok = False
    if ok:
        print("PASS: PR m25 parallel voices + dotted quarter preserved")
    return ok


def main():
    if not SRC.is_file():
        print("SKIP: sample missing")
        return 0
    ok = test_satb_dotted_quarter_pattern()
    ok = test_piano_pr_parallel_voices() and ok
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

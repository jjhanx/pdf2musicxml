#!/usr/bin/env python3
"""Verify fix_audiveris_mxl on 6cbf reference: rests, piano m4/m18, SATB m32-33."""
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

RAW = ROOT / "_smoke" / "_6cbf_final" / "audiveris_raw.mxl"
FIXED = ROOT / "_smoke" / "6cbf_fixed.mxl"


def load_xml(mxl_path: Path) -> tuple[ET.Element, str]:
    with zipfile.ZipFile(mxl_path) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        return ET.fromstring(z.read(rf)), rf


def q(ns, t):
    return f"{{{ns}}}{t}" if ns else t


def local_tag(el):
    return el.tag.split("}")[-1] if "}" in el.tag else el.tag


def staff_voice_timeline(measure, ns, staff: str) -> dict[str, int]:
    cursors: dict[str, int] = {}
    for el in measure:
        tag = local_tag(el)
        if tag == "note":
            voice_el = el.find(q(ns, "voice"))
            staff_el = el.find(q(ns, "staff"))
            voice = voice_el.text if voice_el is not None else "1"
            st = staff_el.text if staff_el is not None else "1"
            if st != staff:
                continue
            if el.find(q(ns, "chord")) is not None:
                continue
            dur_el = el.find(q(ns, "duration"))
            dur = int(dur_el.text) if dur_el is not None and dur_el.text else 0
            cursors[voice] = cursors.get(voice, 0) + dur
        elif tag == "backup":
            voice_el = el.find(q(ns, "voice"))
            voice = voice_el.text if voice_el is not None else "1"
            dur_el = el.find(q(ns, "duration"))
            dur = int(dur_el.text) if dur_el is not None and dur_el.text else 0
            cursors[voice] = max(0, cursors.get(voice, 0) - dur)
    return cursors


def measure_expected(measure, ns) -> int:
    div = 1
    beats = 4
    beat_type = 4
    for attr in measure.findall(q(ns, "attributes")):
        d = attr.find(q(ns, "divisions"))
        if d is not None and d.text:
            div = int(d.text)
        time_el = attr.find(q(ns, "time"))
        if time_el is not None:
            b = time_el.find(q(ns, "beats"))
            bt = time_el.find(q(ns, "beat-type"))
            if b is not None and b.text:
                beats = int(b.text)
            if bt is not None and bt.text:
                beat_type = int(bt.text)
    return div * beats * 4 // beat_type


def count_rest_display(root, ns) -> dict:
    out = {"whole_high": 0, "half_high": 0, "whole_total": 0, "half_total": 0}
    for note in root.iter():
        if local_tag(note) != "note":
            continue
        rest = note.find(q(ns, "rest"))
        if rest is None:
            continue
        typ = note.find(q(ns, "type"))
        tval = (typ.text or "").strip() if typ is not None else ""
        step_el = rest.find(q(ns, "display-step"))
        step = step_el.text.strip().upper() if step_el is not None and step_el.text else None
        if tval == "whole":
            out["whole_total"] += 1
            if step in ("C", "D", "E"):
                out["whole_high"] += 1
        elif tval == "half":
            out["half_total"] += 1
            if step in ("C", "D", "E"):
                out["half_high"] += 1
    return out


def inspect_measures(root, ns, part_idx: int, mnums: list[str], label: str):
    parts = root.findall(q(ns, "part"))
    p = parts[part_idx]
    print(f"\n--- {label} part {p.get('id')} idx {part_idx} ---")
    for meas in p.findall(q(ns, "measure")):
        m = meas.get("number")
        if m not in mnums:
            continue
        expected = measure_expected(meas, ns)
        print(f" m{m} expected={expected}")
        for attr in meas.findall(q(ns, "attributes")):
            bits = []
            for c in attr:
                ct = local_tag(c)
                if ct == "clef":
                    sign = c.find(q(ns, "sign"))
                    bits.append(f"clef#{c.get('number') or '1'}:{sign.text if sign is not None else '?'}")
                elif ct == "key":
                    f = c.find(q(ns, "fifths"))
                    bits.append(f"key:{f.text if f is not None else '?'}")
            if bits:
                print("   ATTR", " ".join(bits))
        for staff in ("1", "2"):
            tl = staff_voice_timeline(meas, ns, staff)
            if tl:
                print(f"   staff{staff} voices", tl, "gap", expected - max(tl.values(), default=0))
        notes = [el for el in meas if local_tag(el) == "note"]
        tail = []
        for note in notes[-4:]:
            rest = note.find(q(ns, "rest"))
            typ = note.find(q(ns, "type"))
            tval = typ.text if typ is not None else "?"
            voice = note.find(q(ns, "voice"))
            staff = note.find(q(ns, "staff"))
            if rest is not None:
                tail.append(f"rest:{tval}/v{voice.text if voice is not None else '?'}/s{staff.text if staff is not None else '?'}")
            else:
                pitch = note.find(q(ns, "pitch"))
                step = pitch.find(q(ns, "step")).text
                octv = pitch.find(q(ns, "octave")).text
                tail.append(f"{step}{octv}/{tval}")
        print("   tail:", ", ".join(tail))


def main():
    for path in (RAW, FIXED):
        if not path.exists():
            print("missing", path)
            return 1
    raw_root, _ = load_xml(RAW)
    fix_root, _ = load_xml(FIXED)
    ns = raw_root.tag.split("}")[0].strip("{") if "}" in raw_root.tag else ""

    print("=== rest display-step counts ===")
    for label, root in ("raw", raw_root), ("fixed", fix_root):
        c = count_rest_display(root, ns)
        print(label, c)

    parts = raw_root.findall(q(ns, "part"))
    for i, p in enumerate(parts):
        print(i, p.get("id"))

    # P4 piano = index 3 typically
    inspect_measures(raw_root, ns, 3, ["4", "18"], "RAW piano")
    inspect_measures(fix_root, ns, 3, ["4", "18"], "FIXED piano")
    inspect_measures(raw_root, ns, 0, ["32", "33"], "RAW SATB T")
    inspect_measures(fix_root, ns, 0, ["32", "33"], "FIXED SATB T")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

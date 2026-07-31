"""Test rebuild_measure_timeline_clean on P4 m4/m18."""
import shutil
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import rebuild_measure_timeline_clean, _ns, _q


def load_mxl(path: Path):
    d = Path("_smoke/_rebuild_test")
    d.mkdir(exist_ok=True)
    sub = d / path.stem
    if sub.exists():
        shutil.rmtree(sub)
    sub.mkdir()
    with zipfile.ZipFile(path) as z:
        z.extractall(sub)
    xml = next(sub.rglob("*.xml"))
    tree = ET.parse(xml)
    return tree, xml, sub


def staff_totals(measure, ns, expected=16):
    cursors = {}
    for el in measure:
        tag = el.tag.split("}")[-1]
        if tag == "note":
            if el.find(_q(ns, "grace")) is not None or el.find(_q(ns, "chord")) is not None:
                continue
            v = el.find(_q(ns, "voice"))
            s = el.find(_q(ns, "staff"))
            voice = (v.text or "1").strip() if v is not None and v.text else "1"
            staff = (s.text or "1").strip() if s is not None and s.text else "1"
            key = (voice, staff)
            dur = int(el.find(_q(ns, "duration")).text or 0)
            cursors[key] = cursors.get(key, 0) + dur
        elif tag == "backup":
            dur = int(el.find(_q(ns, "duration")).text or 0)
            for k in list(cursors):
                cursors[k] = max(0, cursors[k] - dur)
        elif tag == "forward":
            dur = int(el.find(_q(ns, "duration")).text or 0)
            v = el.find(_q(ns, "voice"))
            s = el.find(_q(ns, "staff"))
            voice = (v.text or "1").strip() if v is not None and v.text else "1"
            staff = (s.text or "1").strip() if s is not None and s.text else "1"
            key = (voice, staff)
            cursors[key] = cursors.get(key, 0) + dur
    by_staff = {}
    for (_v, st), t in cursors.items():
        by_staff[st] = max(by_staff.get(st, 0), t)
    return by_staff, expected - min(by_staff.get("1", 0), expected) if by_staff else expected


tree, xml_path, _ = load_mxl(Path("_smoke/_6cbf_q/audiveris_raw.mxl"))
root = tree.getroot()
ns = _ns(root)
part = root.find(f".//{_q(ns, 'part')}[@id='P4']")
for mn in ["4", "18"]:
    meas = next(m for m in part.findall(_q(ns, "measure")) if m.get("number") == mn)
    before, _ = staff_totals(meas, ns)
    rebuild_measure_timeline_clean(meas, ns)
    after, _ = staff_totals(meas, ns)
    print(f"m{mn} before staff totals {before}")
    print(f"m{mn} after  staff totals {after}")
    # trailing rests
    notes = [el for el in meas if el.tag.split('}')[-1] == 'note']
    for n in notes[-3:]:
        rest = n.find(_q(ns, 'rest')) is not None
        typ = n.find(_q(ns, 'type'))
        print(" ", 'rest' if rest else 'note', typ.text if typ is not None else '?', 'staff', (n.find(_q(ns,'staff')).text if n.find(_q(ns,'staff')) is not None else '1'))

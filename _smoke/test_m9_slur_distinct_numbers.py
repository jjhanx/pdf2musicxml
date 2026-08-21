# -*- coding: utf-8 -*-
"""m9 PR+PL overlapping slurs must get distinct MusicXML numbers (OSMD time match).

omr-work-e363bc61: staff1 E5→E5 and staff2 E3→E4 both used number=1; OSMD dropped one.
"""
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import normalize_slurs_in_root, _ns, _q  # noqa: E402


def load_review(zip_name: str) -> ET.Element:
    z = zipfile.ZipFile(zip_name)
    d = z.read("review.mxl")
    z2 = zipfile.ZipFile(io.BytesIO(d))
    c = z2.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    return ET.parse(io.BytesIO(z2.read(rf))).getroot()


def m9_slurs(root: ET.Element) -> list[tuple[str, str, dict]]:
    ns = _ns(root)
    out: list[tuple[str, str, dict]] = []
    for part in root.findall(_q(ns, "part")):
        if part.get("id") != "P5":
            continue
        for m in part.findall(_q(ns, "measure")):
            if m.get("number") != "9":
                continue
            for note in m.findall(_q(ns, "note")):
                pitch = note.find(_q(ns, "pitch"))
                if pitch is None:
                    continue
                step = (pitch.findtext(_q(ns, "step")) or "?") + (
                    pitch.findtext(_q(ns, "octave")) or "?"
                )
                staff = note.findtext(_q(ns, "staff")) or "?"
                notations = note.find(_q(ns, "notations"))
                if notations is None:
                    continue
                for slur in notations.findall(_q(ns, "slur")):
                    out.append((step, staff, dict(slur.attrib)))
    return out


root = load_review("omr-work-e363bc61.zip")
before = m9_slurs(root)
assert any(p == "E3" and s.get("type") == "start" for p, _, s in before), before
assert any(p == "E4" and s.get("type") == "stop" for p, _, s in before), before
# Both pairs incorrectly share number 1 before normalize
starts = [(p, st, s) for p, st, s in before if s.get("type") == "start"]
assert len(starts) >= 2 and all(s.get("number") == "1" for _, _, s in starts), starts

normalize_slurs_in_root(root)
after = m9_slurs(root)

pr_start = next(s for p, st, s in after if p.startswith("E") and st == "1" and s.get("type") == "start")
pr_stop = next(s for p, st, s in after if st == "1" and s.get("type") == "stop")
pl_start = next(s for p, st, s in after if p == "E3" and st == "2" and s.get("type") == "start")
pl_stop = next(s for p, st, s in after if p == "E4" and st == "2" and s.get("type") == "stop")

assert pr_start.get("number") == pr_stop.get("number"), (pr_start, pr_stop)
assert pl_start.get("number") == pl_stop.get("number"), (pl_start, pl_stop)
assert pr_start.get("number") != pl_start.get("number"), after
print("m9 slur distinct numbers ok", after)

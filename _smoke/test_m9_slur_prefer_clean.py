"""m9 E3→E4: prefer clean slur (no bezier) over Audiveris layout noise."""
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, "scripts")
from omr_hitl_lib import normalize_slurs_in_root, _ns, _q  # noqa: E402


def load_review() -> ET.Element:
    z = zipfile.ZipFile("omr-work-9ea1d514.zip")
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


root = load_review()
before = m9_slurs(root)
assert any(p == "E3" and s.get("type") == "start" and s.get("number") == "2" for p, _, s in before), before
normalize_slurs_in_root(root)
after = m9_slurs(root)
e3 = [s for p, st, s in after if p == "E3"]
e4 = [s for p, st, s in after if p == "E4"]
assert len(e3) == 1 and e3[0].get("type") == "start", e3
assert len(e4) == 1 and e4[0].get("type") == "stop", e4
assert e3[0].get("placement") == "below", e3  # clean HITL/secondary, not Audiveris above+bezier
assert e3[0].get("number") == e4[0].get("number") == "1", (e3, e4)
for s in e3 + e4:
    for a in ("bezier-x", "bezier-y", "default-x", "default-y"):
        assert a not in s, s
print("m9 slur prefer-clean ok", after)

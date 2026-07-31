import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import apply_fixes_to_root, _ns, _q

ZIP = Path(__file__).resolve().parents[1] / "omr-work-29eb585d.zip"


def load(name: str) -> ET.Element:
    with zipfile.ZipFile(ZIP) as z:
        inner = zipfile.ZipFile(io.BytesIO(z.read(name)))
        return ET.fromstring(inner.read([n for n in inner.namelist() if n.endswith(".xml")][0]))


def tied(note, ns, end):
    n = note.find(_q(ns, "notations"))
    if n is None:
        return False
    return any((t.get("type") or "") == end for t in n.findall(_q(ns, "tied")))


raw = load("review.mxl")
r = deepcopy(raw)
stats = apply_fixes_to_root(
    r,
    [
        {
            "kind": "addTie",
            "partId": "P3",
            "measureMxl": "12",
            "fromNoteIndex": 1,
            "toMeasureMxl": "13",
            "toPitchStep": "C",
            "toPitchOctave": 4,
        }
    ],
)
assert stats["applied"] == 1, stats
ns = _ns(r)
part = r.find('.//{*}part[@id="P3"]')
m12 = next(x for x in part.findall("{*}measure") if x.get("number") == "12")
m13 = next(x for x in part.findall("{*}measure") if x.get("number") == "13")
notes12 = [n for n in m12 if n.tag.endswith("note")]
notes13 = [n for n in m13 if n.tag.endswith("note")]
assert tied(notes12[1], ns, "start")
assert tied(notes13[0], ns, "stop")
print("cross measure tie ok")

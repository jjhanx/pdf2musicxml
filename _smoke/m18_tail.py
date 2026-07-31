import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import shutil
import zipfile
import xml.etree.ElementTree as ET
from omr_hitl_lib import _ns, _q, list_note_elements, _note_voice_staff


def load(name):
    p = Path("_smoke/_6cbf_q") / name
    d = Path("_smoke/x2")
    d.mkdir(exist_ok=True)
    sub = d / name
    if sub.exists():
        shutil.rmtree(sub)
    sub.mkdir()
    with zipfile.ZipFile(p) as z:
        z.extractall(sub)
    return ET.parse(next(sub.rglob("*.xml"))).getroot()


for name in ["audiveris_raw.mxl", "review.mxl"]:
    root = load(name)
    ns = _ns(root)
    part = root.find(".//{*}part[@id='P4']")
    m = next(x for x in part.findall(_q(ns, "measure")) if x.get("number") == "18")
    notes = list_note_elements(m, ns)
    print(f"\n{name} m18 last 5 notes:")
    for n in notes[-5:]:
        rest = n.find(_q(ns, "rest")) is not None
        typ = n.find(_q(ns, "type"))
        dur = n.find(_q(ns, "duration"))
        st = n.find(_q(ns, "staff"))
        print(
            " ",
            "rest" if rest else "note",
            typ.text if typ is not None else "?",
            "dur",
            dur.text if dur is not None else "?",
            "staff",
            st.text if st is not None else "1",
        )

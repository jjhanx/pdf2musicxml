import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import shutil
import zipfile
import xml.etree.ElementTree as ET
from omr_hitl_lib import (
    _rebuild_measure_flat_staffs,
    _ns,
    _q,
    _voice_layer_duration,
    list_note_elements,
    _note_voice_staff,
)


def load():
    p = Path("_smoke/_6cbf_q/audiveris_raw.mxl")
    d = Path("_smoke/x")
    shutil.rmtree(d, True)
    d.mkdir()
    with zipfile.ZipFile(p) as z:
        z.extractall(d)
    return ET.parse(next(d.rglob("*.xml"))).getroot()


root = load()
ns = _ns(root)
part = root.find(".//{*}part[@id='P4']")
for mn in ["4", "18"]:
    m = next(x for x in part.findall(_q(ns, "measure")) if x.get("number") == mn)
    s1 = [n for n in list_note_elements(m, ns) if _note_voice_staff(n, ns)[1] == "1"]
    s2 = [n for n in list_note_elements(m, ns) if _note_voice_staff(n, ns)[1] == "2"]
    print(f"m{mn} before s1_dur={_voice_layer_duration(s1, ns)} s2_dur={_voice_layer_duration(s2, ns)}")
    _rebuild_measure_flat_staffs(m, ns)
    s1 = [n for n in list_note_elements(m, ns) if _note_voice_staff(n, ns)[1] == "1"]
    s2 = [n for n in list_note_elements(m, ns) if _note_voice_staff(n, ns)[1] == "2"]
    print(f"m{mn} after  s1_dur={_voice_layer_duration(s1, ns)} s2_dur={_voice_layer_duration(s2, ns)}")
    # check trailing rest
    for n in list_note_elements(m, ns)[-4:]:
        rest = n.find(_q(ns, "rest")) is not None
        typ = n.find(_q(ns, "type"))
        st = n.find(_q(ns, "staff"))
        print(" ", "rest" if rest else "note", typ.text if typ is not None else "?", "staff", st.text if st is not None else "1")

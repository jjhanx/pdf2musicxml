import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import shutil
import zipfile
import xml.etree.ElementTree as ET
from omr_hitl_lib import _ns, _q, list_note_elements, _note_voice_staff, _note_duration


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
    by_voice = {}
    for n in list_note_elements(m, ns):
        st = _note_voice_staff(n, ns)[1]
        if st not in ("1", "2"):
            continue
        if n.find(_q(ns, "chord")) is not None:
            continue
        v = _note_voice_staff(n, ns)[0]
        key = f"s{st}v{v}"
        by_voice[key] = by_voice.get(key, 0) + (_note_duration(n, ns) or 0)
    print(f"m{mn} voice durs", by_voice)

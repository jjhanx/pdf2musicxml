import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import shutil
import zipfile
import xml.etree.ElementTree as ET
from omr_hitl_lib import _ns, _q


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
div, beats, bt = 4, 4, 4
for m in part.findall(_q(ns, "measure")):
    mn = m.get("number")
    for attr in m.findall(_q(ns, "attributes")):
        d = attr.find(_q(ns, "divisions"))
        if d is not None and d.text:
            div = int(d.text)
        time = attr.find(_q(ns, "time"))
        if time is not None:
            b = time.find(_q(ns, "beats"))
            t = time.find(_q(ns, "beat-type"))
            if b is not None and b.text:
                beats = int(b.text)
            if t is not None and t.text:
                bt = int(t.text)
    if mn in ("17", "18", "19", "4", "5"):
        ml = round(div * beats * 4 / bt)
        print(f"m{mn} div={div} time={beats}/{bt} measure_len={ml}")

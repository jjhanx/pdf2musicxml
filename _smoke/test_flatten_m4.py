import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import shutil
import zipfile
import xml.etree.ElementTree as ET
from fix_audiveris_mxl import _flatten_underfull_voices_in_measure, mxl_ns_uri


def load():
    p = Path("_smoke/_6cbf_q/audiveris_raw.mxl")
    d = Path("_smoke/x")
    shutil.rmtree(d, True)
    d.mkdir()
    with zipfile.ZipFile(p) as z:
        z.extractall(d)
    return ET.parse(next(d.rglob("*.xml"))).getroot()


root = load()
ns = mxl_ns_uri(root)
part = root.find(".//{*}part[@id='P4']")
for mn in ["4", "18"]:
    m = next(x for x in part.findall("{*}measure") if x.get("number") == mn)
    n = _flatten_underfull_voices_in_measure(m, ns, 16)
    print(f"m{mn} flatten={n} note_count={len(m.findall('{*}note'))}")

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import shutil
import zipfile
import xml.etree.ElementTree as ET
from fix_audiveris_mxl import (
    _repair_piano_spurious_voices,
    _iter_measures_with_timing,
    _max_staff_in_part,
    mxl_ns_uri,
    qname,
)
from omr_hitl_lib import _rebuild_measure_flat_staffs, _calculate_staff1_duration_robust, _ns


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
max_staff = _max_staff_in_part(part, ns)
for measure, _div, expected in _iter_measures_with_timing(part, ns):
    mn = measure.get("number")
    if mn not in ("4", "18"):
        continue
    before = _calculate_staff1_duration_robust(measure, ns)
    n = _repair_piano_spurious_voices(measure, ns, expected or 0)
    if max_staff >= 2:
        _rebuild_measure_flat_staffs(measure, ns)
    after = _calculate_staff1_duration_robust(measure, ns)
    print(f"m{mn} repair={n} robust_before={before} robust_after={after} expected={expected}")

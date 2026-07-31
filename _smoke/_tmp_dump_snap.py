import sys
from pathlib import Path
import zipfile
sys.path.insert(0, "scripts")
from omr_hitl_lib import (
    load_mxl_root, find_part, find_measure, measure_elements_snapshot,
)

zf = zipfile.ZipFile("omr-work-4637986c.zip")
Path("_smoke/_tmp_463_review.mxl").write_bytes(zf.read("review.mxl"))
files, entry, root = load_mxl_root(Path("_smoke/_tmp_463_review.mxl"))
ns = root.tag.split("}")[0].strip("{") if "}" in root.tag else ""
part = find_part(root, ns, "P5")
m = find_measure(part, ns, "17")
els = measure_elements_snapshot(m, ns)
print("snapshot order (timeline sorted):")
for e in els:
    if e.get("staff") != 1 or e.get("rest"):
        continue
    print(
        f"  idx={e['index']} chord={e.get('chord')} "
        f"pitch={e.get('pitch') or (str(e.get('step'))+str(e.get('octave')))} "
        f"playOrder={e.get('playOrder')} defaultPO={e.get('defaultPlayOrder')} "
        f"display={e.get('displayPlayOrder')} timelineX={e.get('timelineX')} voice={e.get('voice')}"
    )

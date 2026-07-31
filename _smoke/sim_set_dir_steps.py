import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import (
    apply_fix,
    apply_fixes_to_root,
    find_part,
    find_measure,
    _ns,
    rebuild_measure_timeline_clean,
    _migrate_directions_to_notes,
    _normalize_measure_note_engraving,
    _strip_chord_member_beams,
    list_note_elements,
)


def local_tag(el):
    t = el.tag
    return t.rsplit("}", 1)[-1] if "}" in t else t


def dump_dirs(m, label):
    print(label)
    for i, c in enumerate(m):
        if local_tag(c) == "direction":
            st = c.find("{*}staff")
            w = c.find(".//{*}words")
            v = c.find("{*}voice")
            print(
                f"  {i} dir staff={st.text if st is not None else '-'} "
                f"voice={v.text if v is not None else '-'} words={w.text if w is not None else ''}"
            )


z = zipfile.ZipFile("omr-work-20e53bc4.zip")
inner = zipfile.ZipFile(io.BytesIO(z.read("review.mxl")))
root = ET.fromstring(inner.read([n for n in inner.namelist() if n.endswith(".xml")][0]))
ns = _ns(root)
part = find_part(root, ns, "P5")
m = find_measure(part, ns, "17")

fix = {
    "kind": "setNoteDirection",
    "partId": "P5",
    "measureMxl": "17",
    "noteIndex": 24,
    "staff": 2,
    "directionType": "words",
    "directionValue": "PL TEST",
}
apply_fix(root, ns, fix)
dump_dirs(m, "after apply_fix")
_normalize_measure_note_engraving(part, ns, m)
_strip_chord_member_beams(list_note_elements(m, ns), ns)
rebuild_measure_timeline_clean(m, ns)
dump_dirs(m, "after rebuild")
_migrate_directions_to_notes(m, ns)
dump_dirs(m, "after migrate")

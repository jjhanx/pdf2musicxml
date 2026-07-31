import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import apply_fix, measure_snapshot  # noqa: E402

ZIP = Path(__file__).resolve().parents[1] / "omr-work-035fd994.zip"


def load_root() -> ET.Element:
    with zipfile.ZipFile(ZIP) as z:
        inner = zipfile.ZipFile(io.BytesIO(z.read("audiveris_raw.mxl")))
        return ET.fromstring(inner.read([n for n in inner.namelist() if n.endswith(".xml")][0]))


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def dump(m: ET.Element, title: str) -> None:
    print(title)
    note_i = 0
    for child in m:
        loc = local(child.tag)
        if loc == "direction":
            st = child.find("{*}staff")
            has_p = child.find(".//{*}p") is not None
            print(f"  direction staff={st.text if st is not None else '?'} p={has_p}")
        elif loc == "note":
            st = child.find("{*}staff")
            rest = child.find("{*}rest") is not None
            typ = child.find("{*}type")
            chord = child.find("{*}chord") is not None
            pitch = child.find("{*}pitch")
            p = "rest" if rest else ""
            if pitch is not None:
                p = pitch.find("{*}step").text + pitch.find("{*}octave").text
            print(
                f"  #{note_i} staff={st.text if st is not None else '1'} {p} "
                f"type={typ.text if typ is not None else ''} chord={chord} x={child.get('default-x','')}"
            )
            note_i += 1
        elif loc == "backup":
            print("  backup")


def main() -> None:
    root = load_root()
    fix = {
        "kind": "insertDirection",
        "partId": "P5",
        "measureMxl": "8",
        "afterNoteIndex": 4,
        "directionType": "dynamics",
        "directionValue": "p",
        "staff": 2,
    }
    assert apply_fix(root, "", fix)
    part = root.find('.//{*}part[@id="P5"]')
    m8 = next(x for x in part.findall("{*}measure") if x.get("number") == "8")
    dump(m8, "after insertDirection #4 (before apply_fixes rebuild - single fix only)")

    # full pipeline with rebuild
    from omr_hitl_lib import apply_fixes_to_root

    root2 = load_root()
    stats = apply_fixes_to_root(root2, [fix])
    print("stats", stats)
    part2 = root2.find('.//{*}part[@id="P5"]')
    m8b = next(x for x in part2.findall("{*}measure") if x.get("number") == "8")
    dump(m8b, "after apply_fixes_to_root (with rebuild)")

    snap = measure_snapshot(root2, "", "P5", "8")
    pl = [e for e in snap["elements"] if e.get("staff") == 2 or e.get("elementKind") == "direction"]
    print("snapshot PL elements:")
    for e in pl:
        print(" ", e)


if __name__ == "__main__":
    main()

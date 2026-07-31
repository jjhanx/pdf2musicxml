import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import apply_fixes_to_root, _local

ZIP = Path(__file__).resolve().parents[1] / "omr-work-4b7162d2.zip"


def load(name: str) -> ET.Element:
    with zipfile.ZipFile(ZIP) as z:
        inner = zipfile.ZipFile(io.BytesIO(z.read(name)))
        return ET.fromstring(inner.read([n for n in inner.namelist() if n.endswith(".xml")][0]))


def rest_info(note: ET.Element) -> str:
    rest = note.find("{*}rest")
    st = note.find("{*}staff")
    ds = note.find("{*}display-step")
    do = note.find("{*}display-octave")
    typ = note.find("{*}type")
    x = note.get("default-x", "")
    y = note.get("default-y", "")
    return (
        f"staff={st.text if st is not None else '?'} type={typ.text if typ is not None else '?'} "
        f"display={ds.text if ds is not None else '-'}{do.text if do is not None else ''} "
        f"x={x} y={y}"
    )


def dump_pl_rests(root: ET.Element, label: str) -> None:
    m = next(
        x
        for x in root.find('.//{*}part[@id="P5"]').findall("{*}measure")
        if x.get("number") == "8"
    )
    print(f"\n=== {label} ===")
    for c in m:
        loc = _local(c)
        if loc == "direction":
            st = c.find("{*}staff")
            pl = c.get("placement", "")
            dy = c.find(".//{*}p") is not None
            print(f"  direction staff={st.text if st is not None else '?'} placement={pl} p={dy}")
        elif loc == "note":
            st = c.find("{*}staff")
            if st is None or st.text != "2":
                continue
            if c.find("{*}rest") is not None:
                print(f"  REST {rest_info(c)}")
            else:
                pitch = c.find("{*}pitch")
                if pitch is not None:
                    print(
                        f"  note {pitch.find('{*}step').text}{pitch.find('{*}octave').text} "
                        f"x={c.get('default-x','')}"
                    )


raw = load("audiveris_raw.mxl")
dump_pl_rests(raw, "BEFORE")

r = deepcopy(raw)
apply_fixes_to_root(
    r,
    [
        {
            "kind": "insertDirection",
            "partId": "P5",
            "measureMxl": "8",
            "afterNoteIndex": 4,
            "directionType": "dynamics",
            "directionValue": "p",
            "staff": 2,
        }
    ],
)
dump_pl_rests(r, "AFTER insertDirection on rest #4")

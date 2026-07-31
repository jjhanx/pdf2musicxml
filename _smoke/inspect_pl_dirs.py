import io
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ZIP = Path(__file__).resolve().parents[1] / "omr-work-035fd994.zip"


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def dump_pl(m: ET.Element, mnum: str) -> None:
    print(f"=== MXL {mnum} PL + directions ===")
    note_i = 0
    for child in m:
        loc = local(child.tag)
        if loc == "direction":
            staff = child.find("{*}staff")
            st = staff.text if staff is not None else "?"
            has_p = child.find(".//{*}p") is not None
            print(f"  direction staff={st} p={has_p}")
        elif loc == "note":
            staff = child.find("{*}staff")
            st = staff.text if staff is not None else "1"
            rest = child.find("{*}rest") is not None
            typ = child.find("{*}type")
            t = typ.text if typ is not None else ""
            chord = child.find("{*}chord") is not None
            pitch = child.find("{*}pitch")
            p = "rest" if rest else ""
            if pitch is not None:
                step = pitch.find("{*}step")
                octv = pitch.find("{*}octave")
                if step is not None and octv is not None:
                    p = f"{step.text}{octv.text}"
            if st == "2":
                print(f"  PL #{note_i} {p} type={t} chord={chord} x={child.get('default-x','')}")
            note_i += 1
        elif loc == "backup":
            pass


with zipfile.ZipFile(ZIP) as z:
    inner = zipfile.ZipFile(io.BytesIO(z.read("audiveris_raw.mxl")))
    root = ET.fromstring(inner.read([n for n in inner.namelist() if n.endswith(".xml")][0]))
    part = root.find('.//{*}part[@id="P5"]')
    for mnum in ("6", "7", "8", "9"):
        m = next(meas for meas in part.findall("{*}measure") if meas.get("number") == mnum)
        dump_pl(m, mnum)

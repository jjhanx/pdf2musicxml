import io
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ZIP = Path(__file__).resolve().parents[1] / "omr-work-410e0c25.zip"


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def dump_xml_order(part: ET.Element, mnum: str) -> None:
    m = next(meas for meas in part.findall("{*}measure") if meas.get("number") == mnum)
    print(f"\n=== XML order MXL {mnum} ===")
    for child in m:
        loc = local(child.tag)
        if loc == "backup":
            print(f"  backup dur={child.find('{*}duration').text}")
        elif loc == "note":
            st = child.find("{*}staff")
            v = child.find("{*}voice")
            chord = child.find("{*}chord") is not None
            pitch = child.find("{*}pitch")
            p = "rest" if child.find("{*}rest") is not None else ""
            if pitch is not None:
                p = pitch.find("{*}step").text + pitch.find("{*}octave").text
            typ = child.find("{*}type")
            dur = child.find("{*}duration")
            print(
                f"  note staff={st.text if st is not None else '?'} v={v.text if v is not None else '?'} "
                f"{p} {typ.text if typ is not None else ''} dur={dur.text if dur is not None else ''} "
                f"chord={chord} x={child.get('default-x','')}"
            )
        else:
            print(f"  {loc}")


with zipfile.ZipFile(ZIP) as z:
    for name in ("audiveris_raw.mxl", "review.mxl"):
        inner = zipfile.ZipFile(io.BytesIO(z.read(name)))
        root = ET.fromstring(inner.read([n for n in inner.namelist() if n.endswith(".xml")][0]))
        part = root.find('.//{*}part[@id="P5"]')
        print("\n########", name, "########")
        dump_xml_order(part, "7")

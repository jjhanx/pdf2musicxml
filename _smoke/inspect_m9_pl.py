import io
import json
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ZIP = Path(__file__).resolve().parents[1] / "omr-work-035fd994.zip"


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def load_review_xml(z: zipfile.ZipFile) -> ET.Element:
    inner = zipfile.ZipFile(io.BytesIO(z.read("review.mxl")))
    xml_name = [n for n in inner.namelist() if n.endswith(".xml")][0]
    return ET.fromstring(inner.read(xml_name))


def dump_measure(part: ET.Element, mnum: str) -> None:
    m = next(meas for meas in part.findall("{*}measure") if meas.get("number") == mnum)
    print(f"\n=== MXL measure {mnum} ===")
    note_i = 0
    for child in m:
        loc = local(child.tag)
        if loc == "direction":
            dt = child.find(".//{*}direction-type")
            txt = ET.tostring(dt, encoding="unicode")[:120] if dt is not None else ""
            staff = child.find("{*}staff")
            st = staff.text if staff is not None else "?"
            print(f"  direction staff={st} {txt}")
        elif loc == "note":
            rest = child.find("{*}rest") is not None
            staff = child.find("{*}staff")
            st = staff.text if staff is not None else "1"
            typ = child.find("{*}type")
            t = typ.text if typ is not None else ""
            chord = child.find("{*}chord") is not None
            pitch = child.find("{*}pitch")
            p = ""
            if pitch is not None:
                step = pitch.find("{*}step")
                octv = pitch.find("{*}octave")
                if step is not None and octv is not None:
                    p = f"{step.text}{octv.text}"
            x = child.get("default-x", "")
            kind = "rest" if rest else p
            print(f"  #{note_i} staff={st} {kind} type={t} chord={chord} x={x}")
            note_i += 1
        elif loc in ("backup", "forward"):
            dur = child.find("{*}duration")
            print(f"  {loc} dur={dur.text if dur is not None else ''}")


def main() -> None:
    with zipfile.ZipFile(ZIP) as z:
        data = json.loads(z.read("omr_hitl_fixes.json"))
        fixes = data.get("fixes", data) if isinstance(data, dict) else data
        dir_fixes = [f for f in fixes if isinstance(f, dict) and "irection" in f.get("kind", "")]
        print("direction fixes:", len(dir_fixes))
        for f in dir_fixes:
            print(json.dumps(f, ensure_ascii=False))

        labels = json.loads(z.read("part_labels.json"))
        print("labels:", labels)

        root = load_review_xml(z)
        part = root.find('.//{*}part[@id="P5"]')
        assert part is not None
        print("--- review.mxl ---")
        for mnum in ("8", "9", "10"):
            dump_measure(part, mnum)

        inner = zipfile.ZipFile(io.BytesIO(z.read("audiveris_raw.mxl")))
        xml_name = [n for n in inner.namelist() if n.endswith(".xml")][0]
        raw_root = ET.fromstring(inner.read(xml_name))
        raw_part = raw_root.find('.//{*}part[@id="P5"]')
        print("\n--- audiveris_raw.mxl measure 9 ---")
        dump_measure(raw_part, "9")


if __name__ == "__main__":
    main()

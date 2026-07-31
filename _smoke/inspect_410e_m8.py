import io
import json
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ZIP = Path(__file__).resolve().parents[1] / "omr-work-410e0c25.zip"


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def dump_measure(part: ET.Element, mnum: str, label: str) -> None:
    m = next(meas for meas in part.findall("{*}measure") if meas.get("number") == mnum)
    print(f"\n=== {label} MXL {mnum} ===")
    note_i = 0
    for child in m:
        loc = local(child.tag)
        if loc == "direction":
            st = child.find("{*}staff")
            print(f"  direction staff={st.text if st is not None else '?'}")
        elif loc == "backup":
            dur = child.find("{*}duration")
            print(f"  backup dur={dur.text if dur is not None else ''}")
        elif loc == "note":
            rest = child.find("{*}rest") is not None
            staff = child.find("{*}staff")
            st = staff.text if staff is not None else "1"
            typ = child.find("{*}type")
            t = typ.text if typ is not None else ""
            chord = child.find("{*}chord") is not None
            grace = child.find("{*}grace") is not None
            voice = child.find("{*}voice")
            v = voice.text if voice is not None else "?"
            pitch = child.find("{*}pitch")
            p = "rest" if rest else ""
            if pitch is not None:
                step = pitch.find("{*}step")
                octv = pitch.find("{*}octave")
                if step is not None and octv is not None:
                    p = f"{step.text}{octv.text}"
            dur = child.find("{*}duration")
            d = dur.text if dur is not None else ""
            beams = [b.text for b in child.findall("{*}beam") if b.text]
            print(
                f"  #{note_i} staff={st} v={v} {p} type={t} dur={d} chord={chord} grace={grace} "
                f"x={child.get('default-x', '')} beam={beams}"
            )
            note_i += 1


def load_mxl(z: zipfile.ZipFile, name: str) -> ET.Element:
    inner = zipfile.ZipFile(io.BytesIO(z.read(name)))
    return ET.fromstring(inner.read([n for n in inner.namelist() if n.endswith(".xml")][0]))


def main() -> None:
    with zipfile.ZipFile(ZIP) as z:
        fixes = json.loads(z.read("omr_hitl_fixes.json"))
        flist = fixes.get("fixes", fixes) if isinstance(fixes, dict) else fixes
        grace = [f for f in flist if isinstance(f, dict) and "race" in f.get("kind", "")]
        print("grace-related fixes:", len(grace))
        for f in grace:
            print(json.dumps(f, ensure_ascii=False))

        for mxl_name in ("review.mxl", "audiveris_raw.mxl", "omr_hitl_baseline.mxl"):
            if mxl_name not in z.namelist():
                continue
            root = load_mxl(z, mxl_name)
            part = root.find('.//{*}part[@id="P5"]')
            if part is None:
                continue
            print(f"\n######## {mxl_name} ########")
            for mnum in ("7", "8", "9"):
                dump_measure(part, mnum, mxl_name)


if __name__ == "__main__":
    main()

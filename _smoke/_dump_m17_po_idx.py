import io
import zipfile
import xml.etree.ElementTree as ET

z = zipfile.ZipFile("omr-work-0ea5ea52.zip")
data = z.read("review.mxl")
inner = zipfile.ZipFile(io.BytesIO(data))
xml_name = [n for n in inner.namelist() if n.endswith(".xml") and "META" not in n.upper()][0]
root = ET.fromstring(inner.read(xml_name))


def loc(t: str) -> str:
    return t.split("}")[-1] if "}" in t else t


for part in root.iter():
    if loc(part.tag) != "part" or part.get("id") != "P5":
        continue
    for m in part:
        if loc(m.tag) != "measure" or m.get("number") != "17":
            continue
        i = 0
        for c in m:
            if loc(c.tag) != "note":
                continue
            chord = c.find("{*}chord") is not None
            rest = c.find("{*}rest") is not None
            pitch = c.find("{*}pitch")
            voice = c.find("{*}voice")
            typ = c.find("{*}type")
            staff = c.find("{*}staff")
            po = c.get("data-hitl-play-order")
            if rest:
                lab = "rest"
            elif pitch is not None:
                step = pitch.find("{*}step").text
                oct_ = pitch.find("{*}octave").text
                alt = pitch.find("{*}alter")
                acc = "b" if alt is not None and alt.text == "-1" else ""
                lab = f"{step}{acc}{oct_}"
            else:
                lab = "?"
            v = voice.text if voice is not None else "?"
            st = staff.text if staff is not None else "?"
            ty = typ.text if typ is not None else "?"
            print(f"#{i} chord={chord} v={v} st={st} {lab} type={ty} po={po}")
            i += 1

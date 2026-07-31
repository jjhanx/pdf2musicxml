import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, "scripts")
from omr_hitl_lib import (  # noqa: E402
    apply_fix,
    apply_fixes_to_root,
    list_note_elements,
    rebuild_measure_timeline_clean,
    _note_beams,
    _note_voice_staff,
)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def load_mxl(z: zipfile.ZipFile, name: str) -> ET.Element:
    inner = zipfile.ZipFile(io.BytesIO(z.read(name)))
    return ET.fromstring(inner.read([n for n in inner.namelist() if n.endswith(".xml")][0]))


def dump_pl(m: ET.Element, label: str) -> None:
    print(label)
    for child in m:
        loc = _local(child.tag)
        if loc == "backup":
            print(f"  backup dur={child.find('{*}duration').text}")
        elif loc == "forward":
            print("  forward")
        elif loc == "note":
            v, st = _note_voice_staff(child, "")
            if st != "2":
                continue
            chord = child.find("{*}chord") is not None
            pitch = child.find("{*}pitch")
            p = "rest" if child.find("{*}rest") is not None else ""
            if pitch is not None:
                p = pitch.find("{*}step").text + pitch.find("{*}octave").text
            typ = child.find("{*}type")
            dur = child.find("{*}duration")
            print(
                f"  v={v} {p} {typ.text if typ is not None else ''} dur={dur.text if dur is not None else ''} "
                f"chord={chord} x={child.get('default-x','')}"
            )


def voice5_dur_sum(m: ET.Element) -> int:
    total = 0
    for n in list_note_elements(m, ""):
        v, st = _note_voice_staff(n, "")
        if st == "2" and v == "5" and n.find("{*}chord") is None:
            d = n.find("{*}duration")
            if d is not None and d.text:
                total += int(d.text)
    return total


ZIP = Path(__file__).resolve().parents[1] / "omr-work-410e0c25.zip"

# 1) raw m7 — rebuild must preserve multivoice
with zipfile.ZipFile(ZIP) as z:
    raw = load_mxl(z, "audiveris_raw.mxl")
part = raw.find('.//{*}part[@id="P5"]')
m7 = next(x for x in part.findall("{*}measure") if x.get("number") == "7")
rebuild_measure_timeline_clean(m7, "")
dump_pl(m7, "raw m7 after preserve rebuild:")
assert any(_local(c.tag) == "backup" for c in m7)
voices = { _note_voice_staff(n, "")[0] for n in list_note_elements(m7, "") if _note_voice_staff(n,"")[1]=="2" }
assert len(voices) >= 2, voices

# 2) flattened review m7 — repair should split same-x layers
with zipfile.ZipFile(ZIP) as z:
    rev = load_mxl(z, "review.mxl")
part2 = rev.find('.//{*}part[@id="P5"]')
m7b = next(x for x in part2.findall("{*}measure") if x.get("number") == "7")
before_sum = voice5_dur_sum(m7b)
assert before_sum > 48, before_sum
rebuild_measure_timeline_clean(m7b, "")
dump_pl(m7b, "review m7 after repair rebuild:")
after_voices = { _note_voice_staff(n, "")[0] for n in list_note_elements(m7b, "") if _note_voice_staff(n,"")[1]=="2" }
assert len(after_voices) >= 2, after_voices
assert voice5_dur_sum(m7b) <= 48, voice5_dur_sum(m7b)

# 3) grace on m8 PR — PL beam stays in m8
with zipfile.ZipFile(ZIP) as z:
    raw2 = load_mxl(z, "audiveris_raw.mxl")
part3 = raw2.find('.//{*}part[@id="P5"]')
fix = {
    "kind": "insertGraceNote",
    "partId": "P5",
    "measureMxl": "8",
    "beforeNoteIndex": 0,
    "pitchStep": "A",
    "pitchOctave": 4,
    "noteType": "eighth",
    "graceSlash": True,
}
assert apply_fix(raw2, "", fix)
apply_fixes_to_root(raw2, [fix])
m8 = next(x for x in part3.findall("{*}measure") if x.get("number") == "8")
pl8 = [n for n in list_note_elements(m8, "") if _note_voice_staff(n, "")[1] == "2"]
beam8 = [n for n in pl8 if _note_beams(n, "")]
assert len(beam8) >= 4
assert all(_note_voice_staff(n, "")[0] == "6" for n in beam8)

print("parallel voice rebuild ok")

"""Dump m6/m30 PR slur structure after fix."""
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from fix_audiveris_mxl import fix_mxl_file  # noqa: E402

mxl = ROOT / "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"
out = ROOT / "_smoke/_tmp_slur_check.mxl"
fix_mxl_file(mxl, out)

z = zipfile.ZipFile(out)
xml_name = [n for n in z.namelist() if n.endswith(".xml")][0]
root = ET.fromstring(z.read(xml_name))
if root.tag.startswith("{"):
    ns = root.tag[1 : root.tag.index("}")]
    q = lambda t: f"{{{ns}}}{t}"
else:
    ns = ""
    q = lambda t: t


def dump_measure(num: str) -> None:
    print(f"\n=== measure {num} (printed {int(num)+1}) ===")
    for part in root.findall(q("part")):
        if part.get("id") != "P5":
            continue
        for m in part.findall(q("measure")):
            if m.get("number") != num:
                continue
            gidx = 0
            chord: list[ET.Element] = []
            for note in m.findall(q("note")):
                st = note.find(q("staff"))
                if st is not None and st.text != "1":
                    continue
                is_chord = note.find(q("chord")) is not None
                if not is_chord:
                    if chord:
                        gidx += 1
                        chord = []
                    gidx += 1
                    chord = [note]
                else:
                    chord.append(note)
                pitch = note.find(q("pitch"))
                if pitch is None:
                    continue
                lab = pitch.find(q("step")).text + pitch.find(q("octave")).text
                stem = note.find(q("stem"))
                voice = note.find(q("voice"))
                beams = [b.text for b in note.findall(q("beam"))]
                slurs = []
                for n in note.findall(q("notations")):
                    for s in n.findall(q("slur")):
                        slurs.append(
                            (
                                s.get("number"),
                                s.get("type"),
                                s.get("placement"),
                                s.get("default-y"),
                            )
                        )
                print(
                    f"  g{gidx} {lab} voice={voice.text if voice is not None else '?'} "
                    f"stem={stem.text if stem is not None else '?'} beams={beams} slurs={slurs}"
                )


for n in ("6", "30"):
    dump_measure(n)

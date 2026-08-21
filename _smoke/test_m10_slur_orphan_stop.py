# -*- coding: utf-8 -*-
"""m10 PR: HITL slur #0 B3→#6 B3 must survive normalize (OMR orphan stop on A3).

omr-work-6dae7b7b: raw had B3→A3 slur stop left on #2 A3 while user added
start#4 on #0 and stop#4 on #6. Old normalize renumbered start→1 then matched
the orphan stop#1, dropping the real end.
"""
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, "scripts")
from omr_hitl_lib import (  # noqa: E402
    _ns,
    _q,
    list_note_elements,
    load_mxl_root,
    normalize_slurs_in_root,
)


def load_review_from_zip(zip_name: str) -> ET.Element:
    z = zipfile.ZipFile(zip_name)
    d = z.read("review.mxl")
    z2 = zipfile.ZipFile(io.BytesIO(d))
    c = z2.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    return ET.parse(io.BytesIO(z2.read(rf))).getroot()


def m10_staff1_slurs(root: ET.Element) -> list[tuple[int, str, dict]]:
    ns = _ns(root)
    out: list[tuple[int, str, dict]] = []
    for part in root.findall(_q(ns, "part")):
        if part.get("id") != "P5":
            continue
        for m in part.findall(_q(ns, "measure")):
            if m.get("number") != "10":
                continue
            notes = list_note_elements(m, ns)
            for i, note in enumerate(notes):
                if (note.findtext(_q(ns, "staff")) or "1") != "1":
                    continue
                pitch = note.find(_q(ns, "pitch"))
                if pitch is None:
                    continue
                lab = (pitch.findtext(_q(ns, "step")) or "?") + (
                    pitch.findtext(_q(ns, "octave")) or "?"
                )
                notations = note.find(_q(ns, "notations"))
                if notations is None:
                    continue
                for slur in notations.findall(_q(ns, "slur")):
                    out.append((i, lab, dict(slur.attrib)))
    return out


root = load_review_from_zip("omr-work-6dae7b7b.zip")
before = m10_staff1_slurs(root)
assert any(i == 0 and s.get("type") == "start" for i, _, s in before), before
assert any(i == 6 and s.get("type") == "stop" for i, _, s in before), before
assert any(i == 2 and s.get("type") == "stop" for i, _, s in before), before  # orphan

normalize_slurs_in_root(root)
after = m10_staff1_slurs(root)
starts = [(i, lab, s) for i, lab, s in after if s.get("type") == "start"]
stops = [(i, lab, s) for i, lab, s in after if s.get("type") == "stop"]
assert len(starts) == 1 and starts[0][0] == 0 and starts[0][1] == "B3", starts
assert len(stops) == 1 and stops[0][0] == 6 and stops[0][1] == "B3", stops
assert starts[0][2].get("number") == stops[0][2].get("number"), (starts, stops)
assert not any(i == 2 for i, _, _ in after), after
print("m10 PR long slur normalize ok", after)

# synthetic: addSlur-like state with orphan middle stop
xml = """<?xml version="1.0"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <note><pitch><step>B</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff>
        <notations><slur type="start" number="4" placement="below"/></notations></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>A</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff>
        <notations><slur type="stop" number="1"/></notations></note>
      <note><chord/><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>B</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>B</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff>
        <notations><slur type="stop" number="4" placement="below"/></notations></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>
"""
root2 = ET.fromstring(xml)
normalize_slurs_in_root(root2)
ns = _ns(root2)
notes = list_note_elements(root2.find(_q(ns, "part")).find(_q(ns, "measure")), ns)
flags = []
for i, n in enumerate(notes):
    notn = n.find(_q(ns, "notations"))
    if notn is None:
        continue
    for s in notn.findall(_q(ns, "slur")):
        flags.append((i, s.get("type"), s.get("number")))
assert flags[0][0] == 0 and flags[0][1] == "start", flags
assert flags[-1][0] == 6 and flags[-1][1] == "stop", flags
assert flags[0][2] == flags[-1][2], flags
assert not any(i == 2 for i, _, _ in flags), flags
print("synthetic m10-like ok", flags)

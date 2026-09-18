#!/usr/bin/env python3
"""Piano RH on a Voice staff must not be expanded onto S+A (overwriting rests).

Simulates Audiveris: Women(Voice)=RH-like treble, Men=rest, Piano=F-clef LH.
Labels S,A,T,B,P → restructure must leave S/A as rests (not duplicate RH).
Also repairs already-split files where S≡A identical copies sit above piano LH.
"""
from __future__ import annotations

import io
import json
import sys
import tempfile
import zipfile
from pathlib import Path

import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from restructure_mxl_parts import restructure_mxl  # noqa: E402


def _mxl_bytes(score_xml: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(
            "META-INF/container.xml",
            """<?xml version="1.0"?>
<container>
  <rootfiles>
    <rootfile full-path="score.xml"/>
  </rootfiles>
</container>
""",
        )
        z.writestr("score.xml", score_xml.encode("utf-8"))
    return buf.getvalue()


def _load_root(mxl: Path) -> ET.Element:
    with zipfile.ZipFile(mxl) as z:
        return ET.fromstring(z.read("score.xml"))


def _pitched(part: ET.Element, mnum: str) -> list[str]:
    m = next((x for x in part.findall("{*}measure") if x.get("number") == mnum), None)
    if m is None:
        return []
    out = []
    for n in m.findall("{*}note"):
        p = n.find("{*}pitch")
        if p is None:
            continue
        out.append(f"{p.findtext('{*}step')}{p.findtext('{*}octave')}")
    return out


SRC_3PART = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN"
  "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Voice</part-name></score-part>
    <score-part id="P2"><part-name>Voice</part-name></score-part>
    <score-part id="P3"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes><divisions>4</divisions>
        <clef><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><rest measure="yes"/><duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
  <part id="P3">
    <measure number="1">
      <attributes><divisions>4</divisions>
        <clef><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>
      <note><pitch><step>E</step><octave>2</octave></pitch><duration>8</duration><voice>2</voice><type>half</type></note>
    </measure>
  </part>
</score-partwise>
"""

# Already-split pollution: identical S/A (unison copy of RH), T/B rest, piano LH
SRC_ALREADY_SPLIT = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN"
  "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>S</part-name></score-part>
    <score-part id="P2"><part-name>A</part-name></score-part>
    <score-part id="P3"><part-name>T</part-name></score-part>
    <score-part id="P4"><part-name>B</part-name></score-part>
    <score-part id="P5"><part-name>P</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="3">
      <attributes><divisions>4</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="3">
      <attributes><divisions>4</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
    </measure>
  </part>
  <part id="P3">
    <measure number="3">
      <note><rest measure="yes"/><duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
  <part id="P4">
    <measure number="3">
      <note><rest measure="yes"/><duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
  <part id="P5">
    <measure number="3">
      <attributes><divisions>4</divisions><clef><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>
      <note><pitch><step>E</step><octave>2</octave></pitch><duration>8</duration><voice>2</voice><type>half</type></note>
    </measure>
  </part>
</score-partwise>
"""

# Already-split pollution on T/B (men heuristic chord-split), S/A rest, piano LH only
SRC_TB_POLLUTED = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN"
  "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>S</part-name></score-part>
    <score-part id="P2"><part-name>A</part-name></score-part>
    <score-part id="P3"><part-name>T</part-name></score-part>
    <score-part id="P4"><part-name>B</part-name></score-part>
    <score-part id="P5"><part-name>P</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="8">
      <note><rest measure="yes"/><duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="8">
      <note><rest measure="yes"/><duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
  <part id="P3">
    <measure number="8">
      <attributes><divisions>4</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>6</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>
      <note><pitch><step>C</step><octave>6</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
    </measure>
  </part>
  <part id="P4">
    <measure number="8">
      <attributes><divisions>4</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
    </measure>
  </part>
  <part id="P5">
    <measure number="8">
      <attributes><divisions>4</divisions><clef><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>
      <note><pitch><step>C</step><octave>2</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>
    </measure>
  </part>
</score-partwise>
"""

# 6 Voice: RH on P5, LH on P6 — must not land on T/B even with explicit men mapping
SRC_6VOICE_RH_LH = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN"
  "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Voice</part-name></score-part>
    <score-part id="P2"><part-name>Voice</part-name></score-part>
    <score-part id="P3"><part-name>Voice</part-name></score-part>
    <score-part id="P4"><part-name>Voice</part-name></score-part>
    <score-part id="P5"><part-name>Voice</part-name></score-part>
    <score-part id="P6"><part-name>Voice</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="8">
      <attributes><divisions>4</divisions></attributes>
      <note><rest measure="yes"/><duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="8">
      <note><rest measure="yes"/><duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
  <part id="P3">
    <measure number="8">
      <note><rest measure="yes"/><duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
  <part id="P4">
    <measure number="8">
      <note><rest measure="yes"/><duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
  <part id="P5">
    <measure number="8">
      <attributes><divisions>4</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>
      <note><chord/><pitch><step>C</step><octave>6</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>
      <note><chord/><pitch><step>C</step><octave>6</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>
    </measure>
  </part>
  <part id="P6">
    <measure number="8">
      <attributes><divisions>4</divisions><clef><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>
      <note><chord/><pitch><step>B</step><octave>3</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>
      <note><chord/><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>
      <note><pitch><step>C</step><octave>2</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>
      <note><chord/><pitch><step>C</step><octave>3</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>
    </measure>
  </part>
</score-partwise>
"""


def _pitched_on_staff(part: ET.Element, mnum: str, staff: str) -> list[str]:
    m = next((x for x in part.findall("{*}measure") if x.get("number") == mnum), None)
    if m is None:
        return []
    out = []
    for n in m.findall("{*}note"):
        if (n.findtext("{*}staff") or "1") != staff:
            continue
        p = n.find("{*}pitch")
        if p is None:
            continue
        out.append(f"{p.findtext('{*}step')}{p.findtext('{*}octave')}")
    return out


def _backup_durs(part: ET.Element, mnum: str) -> list[str]:
    m = next((x for x in part.findall("{*}measure") if x.get("number") == mnum), None)
    if m is None:
        return []
    return [el.findtext("{*}duration") or "" for el in m if el.tag.endswith("backup") or el.tag == "backup"]


def main() -> None:
    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        labels = td_path / "part_labels.json"
        labels.write_text(
            json.dumps({"version": 1, "labelsByIndex": ["S", "A", "T", "B", "P"]}),
            encoding="utf-8",
        )

        src = td_path / "src3.mxl"
        out = td_path / "out3.mxl"
        src.write_bytes(_mxl_bytes(SRC_3PART))
        restructure_mxl(src, out, labels)
        root = _load_root(out)
        parts = {p.get("id"): p for p in root.findall("part")}
        assert parts.keys() >= {"P1", "P2", "P3", "P4", "P5"}
        assert _pitched(parts["P1"], "1") == [], f"S should be rest, got {_pitched(parts['P1'], '1')}"
        assert _pitched(parts["P2"], "1") == [], f"A should be rest, got {_pitched(parts['P2'], '1')}"
        rh = _pitched_on_staff(parts["P5"], "1", "1")
        lh = _pitched_on_staff(parts["P5"], "1", "2")
        assert rh == ["A4", "C5", "A4"], f"RH must land on piano staff 1, got {rh}"
        assert lh == ["F3", "E2"], f"LH must stay on piano staff 2, got {lh}"
        # half+half at divisions=4 → backup must be 16; with half=8 style notes backup matches RH
        backs = _backup_durs(parts["P5"], "1")
        assert backs and int(backs[0]) >= 8, f"cross-staff backup must follow RH length, got {backs}"

        src2 = td_path / "split.mxl"
        out2 = td_path / "split_out.mxl"
        src2.write_bytes(_mxl_bytes(SRC_ALREADY_SPLIT))
        restructure_mxl(src2, out2, labels)
        root2 = _load_root(out2)
        parts2 = {p.get("id"): p for p in root2.findall("part")}
        assert _pitched(parts2["P1"], "3") == [], f"repaired S should be rest, got {_pitched(parts2['P1'], '3')}"
        assert _pitched(parts2["P2"], "3") == [], f"repaired A should be rest, got {_pitched(parts2['P2'], '3')}"
        rh2 = _pitched_on_staff(parts2["P5"], "3", "1")
        lh2 = _pitched_on_staff(parts2["P5"], "3", "2")
        assert rh2 == ["A4", "C5", "A4"], f"reclaimed RH on staff 1, got {rh2}"
        assert lh2 == ["F3", "E2"], f"LH on staff 2, got {lh2}"

        # T/B chord-split pollution → reclaim to piano, S/A/T/B rests
        src_tb = td_path / "tb.mxl"
        out_tb = td_path / "tb_out.mxl"
        src_tb.write_bytes(_mxl_bytes(SRC_TB_POLLUTED))
        restructure_mxl(src_tb, out_tb, labels)
        root_tb = _load_root(out_tb)
        parts_tb = {p.get("id"): p for p in root_tb.findall("part")}
        for pid in ("P1", "P2", "P3", "P4"):
            got = _pitched(parts_tb[pid], "8")
            assert got == [], f"{pid} m8 should be rest after T/B reclaim, got {got}"
        rh_tb = _pitched_on_staff(parts_tb["P5"], "8", "1")
        lh_tb = _pitched_on_staff(parts_tb["P5"], "8", "2")
        assert "C6" in rh_tb and "C5" in rh_tb, f"T/B RH must reclaim to staff 1, got {rh_tb}"
        assert lh_tb == ["G3", "C2"], f"LH on staff 2, got {lh_tb}"

        # 6-voice RH+LH with explicit T/B mapping must still reclaim (not invade T/B)
        labels_men = td_path / "labels_men.json"
        labels_men.write_text(
            json.dumps(
                {
                    "version": 1,
                    "labelsByIndex": ["S", "A", "T", "B", "P"],
                    "sectionMappings": [{"measures": "8", "target": ["T", "B"]}],
                }
            ),
            encoding="utf-8",
        )
        src6 = td_path / "six.mxl"
        out6 = td_path / "six_out.mxl"
        src6.write_bytes(_mxl_bytes(SRC_6VOICE_RH_LH))
        restructure_mxl(src6, out6, labels_men)
        root6 = _load_root(out6)
        parts6 = {p.get("id"): p for p in root6.findall("part")}
        for pid in ("P1", "P2", "P3", "P4"):
            got = _pitched(parts6[pid], "8")
            assert got == [], f"{pid} must not receive piano RH under T/B mapping, got {got}"
        rh6 = _pitched_on_staff(parts6["P5"], "8", "1")
        lh6 = _pitched_on_staff(parts6["P5"], "8", "2")
        assert "C5" in rh6 and "C6" in rh6, f"RH on piano staff 1, got {rh6}"
        assert "G3" in lh6 and "C2" in lh6, f"LH on piano staff 2, got {lh6}"
        backs6 = _backup_durs(parts6["P5"], "8")
        assert backs6 == ["16"], f"m8 backup must equal RH leaders 8+8=16, got {backs6}"

        # Real 5d832 pristine: note durs 24/12 with inherited div — backup must be 48 not 16
        zip_5d = ROOT / "omr-work-5d832ef7.zip"
        if zip_5d.is_file():
            import zipfile as zf

            with zf.ZipFile(zip_5d) as z:
                prist = z.read("audiveris_pristine.mxl")
            src_real = td_path / "5d832.mxl"
            out_real = td_path / "5d832_out.mxl"
            src_real.write_bytes(prist)
            restructure_mxl(src_real, out_real, labels)
            with zf.ZipFile(out_real) as mz:
                name = next(n for n in mz.namelist() if n.endswith((".xml", ".musicxml")) and "META" not in n)
                root_r = ET.fromstring(mz.read(name))
            parts_r = {p.get("id"): p for p in root_r.findall("{*}part")}
            for pid in ("P1", "P2", "P3", "P4"):
                assert _pitched(parts_r[pid], "8") == [], f"5d832 {pid} m8 must be rest"
            backs_r = _backup_durs(parts_r["P5"], "8")
            assert backs_r == ["48"], f"5d832 m8 backup must be RH timeline 48, got {backs_r}"
            print("5d832ef7 m8 backup=48 OK")

        # explicit T/B mapping must NOT chord-split lyric-less RH onto T/B
        src6b = td_path / "six_force.mxl"
        out6b = td_path / "six_force_out.mxl"
        src6b.write_bytes(_mxl_bytes(SRC_6VOICE_RH_LH))
        restructure_mxl(src6b, out6b, labels_men)
        root6b = _load_root(out6b)
        parts6b = {p.get("id"): p for p in root6b.findall("part")}
        assert _pitched(parts6b["P3"], "8") == []
        assert _pitched(parts6b["P4"], "8") == []

    # Real zip regression if present
    zip_mxl = ROOT / "_smoke" / "_52386d65" / "audiveris_raw.mxl"
    labels_zip = ROOT / "_smoke" / "_52386d65" / "part_labels.json"
    if zip_mxl.is_file() and labels_zip.is_file():
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "fixed.mxl"
            restructure_mxl(zip_mxl, out, labels_zip)
            with zipfile.ZipFile(out) as z:
                name = next(
                    n for n in z.namelist() if n.endswith((".xml", ".musicxml")) and "META" not in n
                )
                root = ET.fromstring(z.read(name))
            parts = {p.get("id"): p for p in root.findall("{*}part")}
            s3 = _pitched(parts["P1"], "3")
            a3 = _pitched(parts["P2"], "3")
            assert s3 == [], f"52386d65 m3 S should clear RH pollution, got {s3}"
            assert a3 == [], f"52386d65 m3 A should clear RH pollution, got {a3}"
            rh3 = _pitched_on_staff(parts["P5"], "3", "1")
            assert "A4" in rh3 and "C5" in rh3, f"52386d65 m3 RH must be on P staff 1, got {rh3}"
            print("52386d65 m3 S/A cleared, RH on piano OK")

    print("test_restructure_no_piano_rh_to_satb: OK")


if __name__ == "__main__":
    main()

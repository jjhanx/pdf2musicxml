#!/usr/bin/env python3
"""저장 MXL — 같은 연주순번(다른 voice) onset을 backup/forward·duration으로 맞춤.

대표: PL bass half(po=2)가 melody(po=2)보다 늦게 시작하는 경우.
Run: python _smoke/test_play_order_timeline_realign_persist.py
"""
from __future__ import annotations

import io
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import (  # noqa: E402
    PLAY_ORDER_ATTR,
    _ns,
    _note_duration,
    _note_voice_staff,
    _read_play_order,
    _voice_parallel_note_onsets,
    realign_measure_timeline_to_play_order_columns,
    realign_play_order_column_timelines_in_root,
)

# voice5 melody po=2@8 · voice6 half po=2@32 → 맞춤 후 둘 다 @8
SAMPLE = f"""<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P5"><part-name>Piano</part-name></score-part></part-list>
  <part id="P5">
    <measure number="24">
      <attributes><divisions>16</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>64</duration><type>whole</type><voice>1</voice><staff>1</staff></note>
      <backup><duration>64</duration></backup>
      <note {PLAY_ORDER_ATTR}="1"><rest/><duration>8</duration><type>eighth</type><voice>5</voice><staff>2</staff></note>
      <note {PLAY_ORDER_ATTR}="2"><pitch><step>E</step><octave>3</octave></pitch><duration>4</duration><type>16th</type><voice>5</voice><staff>2</staff></note>
      <note {PLAY_ORDER_ATTR}="3"><pitch><step>G</step><octave>3</octave></pitch><duration>4</duration><type>16th</type><voice>5</voice><staff>2</staff></note>
      <note {PLAY_ORDER_ATTR}="4"><pitch><step>A</step><octave>3</octave></pitch><duration>48</duration><type>half</type><dot/><voice>5</voice><staff>2</staff></note>
      <backup><duration>64</duration></backup>
      <note {PLAY_ORDER_ATTR}="1"><pitch><step>A</step><octave>2</octave></pitch><duration>32</duration><type>half</type><voice>6</voice><staff>2</staff></note>
      <note {PLAY_ORDER_ATTR}="2"><pitch><step>E</step><octave>2</octave></pitch><duration>32</duration><type>half</type><voice>6</voice><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>
"""


def _onset_for(measure: ET.Element, ns: str, voice: str, po: int) -> int | None:
    onsets = _voice_parallel_note_onsets(measure, ns)
    for note, onset in onsets.items():
        v, _st = _note_voice_staff(note, ns)
        if v == voice and _read_play_order(note) == po:
            return onset
    return None


def test_synthetic() -> None:
    root = ET.parse(io.BytesIO(SAMPLE.encode("utf-8"))).getroot()
    ns = _ns(root)
    measure = root.find(f".//{{{ns}}}measure") if ns else root.find(".//measure")
    assert measure is not None
    before5 = _onset_for(measure, ns, "5", 2)
    before6 = _onset_for(measure, ns, "6", 2)
    assert before5 == 8 and before6 == 32, (before5, before6)

    assert realign_measure_timeline_to_play_order_columns(measure, ns)
    after5 = _onset_for(measure, ns, "5", 2)
    after6 = _onset_for(measure, ns, "6", 2)
    assert after5 == after6 == 8, (after5, after6)

    # bass 첫 half가 8로 잘림
    for note in measure:
        if note.tag.split("}")[-1] != "note":
            continue
        v, _ = _note_voice_staff(note, ns)
        if v == "6" and _read_play_order(note) == 1:
            assert _note_duration(note, ns) == 8, _note_duration(note, ns)
            break
    else:
        raise AssertionError("v6 po1 not found")


# voice5 po=2@1 · voice6 po=2@0 → 앞 음 때문에 min(0) 불가 → max(1)로 forward 맞춤
SAMPLE_RESIDUAL = f"""<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P5"><part-name>Piano</part-name></score-part></part-list>
  <part id="P5">
    <measure number="53">
      <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>16</duration><type>whole</type><voice>1</voice><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note {PLAY_ORDER_ATTR}="1"><pitch><step>F</step><octave>3</octave></pitch><duration>1</duration><type>16th</type><voice>5</voice><staff>2</staff></note>
      <note {PLAY_ORDER_ATTR}="2"><pitch><step>C</step><octave>4</octave></pitch><duration>3</duration><type>eighth</type><dot/><voice>5</voice><staff>2</staff></note>
      <note {PLAY_ORDER_ATTR}="3"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><voice>5</voice><staff>2</staff></note>
      <note {PLAY_ORDER_ATTR}="4"><pitch><step>G</step><octave>3</octave></pitch><duration>8</duration><type>half</type><voice>5</voice><staff>2</staff></note>
      <backup><duration>16</duration></backup>
      <note {PLAY_ORDER_ATTR}="2"><pitch><step>G</step><octave>2</octave></pitch><duration>8</duration><type>half</type><voice>6</voice><staff>2</staff></note>
      <note><pitch><step>F</step><octave>2</octave></pitch><duration>8</duration><type>half</type><voice>6</voice><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>
"""


def test_residual_max_consensus() -> None:
    root = ET.parse(io.BytesIO(SAMPLE_RESIDUAL.encode("utf-8"))).getroot()
    ns = _ns(root)
    measure = root.find(f".//{{{ns}}}measure") if ns else root.find(".//measure")
    assert measure is not None
    assert _onset_for(measure, ns, "5", 2) == 1
    assert _onset_for(measure, ns, "6", 2) == 0
    assert realign_measure_timeline_to_play_order_columns(measure, ns)
    assert _onset_for(measure, ns, "5", 2) == _onset_for(measure, ns, "6", 2) == 1


def test_root_and_bf4e() -> None:
    root = ET.parse(io.BytesIO(SAMPLE.encode("utf-8"))).getroot()
    n = realign_play_order_column_timelines_in_root(root)
    assert n == 1

    review = ROOT / "_smoke" / "_bf4e_po" / "review.mxl"
    if not review.is_file():
        print("skip bf4e review.mxl (missing)")
        return
    from omr_hitl_lib import load_mxl_root  # noqa: E402

    _files, _rp, bf = load_mxl_root(review)
    ns = _ns(bf)
    # P5 m24 only
    changed = 0
    for part in bf:
        if part.tag.split("}")[-1] != "part" or part.get("id") != "P5":
            continue
        for m in part:
            if m.tag.split("}")[-1] != "measure" or m.get("number") != "24":
                continue
            if realign_measure_timeline_to_play_order_columns(m, ns):
                changed += 1
            a5 = _onset_for(m, ns, "5", 2)
            a6 = _onset_for(m, ns, "6", 2)
            assert a5 is not None and a6 is not None and a5 == a6, (a5, a6)
    assert changed == 1


if __name__ == "__main__":
    test_synthetic()
    test_residual_max_consensus()
    test_root_and_bf4e()
    print("play_order_timeline_realign_persist ok")

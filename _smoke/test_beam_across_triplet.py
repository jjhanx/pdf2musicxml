"""8분 + 세잇단 16분 4음을 한 빔으로 이을 때 tuplet repair가 빔을 지우지 않는지."""
from __future__ import annotations

import sys
import tempfile
import zipfile
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import omr_hitl_lib as h  # noqa: E402


def _beams(notes: list, ns: str, idxs: list[int]) -> list[tuple[int, str | None]]:
    out: list[tuple[int, str | None]] = []
    for i in idxs:
        out.append((i, h._note_beam_value(notes[i], ns)))
    return out


def main() -> None:
    z = ROOT / "omr-work-8d402993.zip"
    if not z.is_file():
        # CI 등 zip 없으면 최소 fixture로
        xml = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P5">
    <measure number="48">
      <attributes><divisions>4</divisions><staves>2</staves></attributes>
      <backup><duration>1</duration></backup>
      <note><pitch><step>F</step><octave>2</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><staff>2</staff></note>
      <note><chord/><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>F</step><octave>2</octave></pitch><duration>1</duration><voice>1</voice><type>16th</type><staff>2</staff>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes><normal-type>16th</normal-type></time-modification>
        <notations><tuplet type="start" bracket="yes"/></notations>
      </note>
      <note><chord/><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>16th</type><staff>2</staff>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
      </note>
      <note><pitch><step>F</step><octave>2</octave></pitch><duration>1</duration><voice>1</voice><type>16th</type><staff>2</staff>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
      </note>
      <note><chord/><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>16th</type><staff>2</staff>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
      </note>
      <note><pitch><step>F</step><octave>2</octave></pitch><duration>1</duration><voice>1</voice><type>16th</type><staff>2</staff>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
        <notations><tuplet type="stop"/></notations>
      </note>
      <note><chord/><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>16th</type><staff>2</staff>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
      </note>
    </measure>
  </part>
</score-partwise>"""
        td = Path(tempfile.mkdtemp())
        mxl = td / "t.mxl"
        files = {
            "META-INF/container.xml": (
                b'<?xml version="1.0"?><container><rootfiles>'
                b'<rootfile full-path="score.xml"/></rootfiles></container>'
            ),
            "score.xml": xml.encode("utf-8"),
        }
        import xml.etree.ElementTree as ET

        h.write_mxl_root(mxl, files, "score.xml", ET.fromstring(xml))
        from_i, to_i = 0, 6
    else:
        td = Path(tempfile.mkdtemp())
        with zipfile.ZipFile(z) as zf:
            zf.extractall(td)
        rev = next(td.rglob("review.mxl"))
        mxl = td / "work.mxl"
        shutil.copy(rev, mxl)
        from_i, to_i = 14, 20

    r = h.apply_fixes_file(
        mxl,
        [
            {
                "kind": "applyBeam",
                "partId": "P5",
                "measureMxl": "48",
                "fromNoteIndex": from_i,
                "toNoteIndex": to_i,
                "beamNumber": 1,
                "beamNoteCount": 4,
            }
        ],
        skip_octave_repair=True,
    )
    assert r.get("applied") == 1, r

    _, _, root = h.load_mxl_root(mxl)
    ns = h._ns(root)
    part = h.find_part(root, ns, "P5")
    measure = h.find_measure(part, ns, "48")
    assert measure is not None
    notes = h.list_note_elements(measure, ns)
    leaders = h._beam_leader_indices_in_range(notes, ns, from_i, to_i)
    assert len(leaders) >= 4, leaders
    vals = _beams(notes, ns, leaders[:4])
    assert vals[0][1] == "begin", vals
    assert vals[-1][1] == "end", vals
    assert all(v in ("begin", "continue", "end") for _, v in vals), vals

    # 두 번째 그룹 (#26–#32)도 zip 있을 때
    if z.is_file():
        r2 = h.apply_fixes_file(
            mxl,
            [
                {
                    "kind": "applyBeam",
                    "partId": "P5",
                    "measureMxl": "48",
                    "fromNoteIndex": 26,
                    "toNoteIndex": 32,
                    "beamNumber": 1,
                    "beamNoteCount": 4,
                }
            ],
            skip_octave_repair=True,
        )
        assert r2.get("applied") == 1, r2
        _, _, root = h.load_mxl_root(mxl)
        ns = h._ns(root)
        notes = h.list_note_elements(h.find_measure(h.find_part(root, ns, "P5"), ns, "48"), ns)
        vals2 = _beams(notes, ns, [26, 28, 30, 32])
        assert vals2[0][1] == "begin" and vals2[-1][1] == "end", vals2
        # 첫 그룹도 유지
        vals1 = _beams(notes, ns, [14, 16, 18, 20])
        assert vals1[0][1] == "begin" and vals1[-1][1] == "end", vals1

    print("OK eighth+triplet16 beamed across tuplet boundary")


if __name__ == "__main__":
    main()

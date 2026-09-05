"""m46에 mf만 달 때 m45 crescendo+stop을 건드리지 않는지 회귀."""
from __future__ import annotations

import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import (  # noqa: E402
    _local,
    _ns,
    _q,
    apply_fixes_file,
    load_mxl_root,
    normalize_wedges_in_root,
    write_mxl_root,
)

SCORE = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P5"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P5">
    <measure number="45">
      <attributes>
        <divisions>4</divisions>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <direction placement="below">
        <direction-type><wedge type="crescendo" number="1"/></direction-type>
        <staff>1</staff>
      </direction>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <direction placement="below">
        <direction-type><wedge type="stop" number="1"/></direction-type>
        <staff>1</staff>
      </direction>
      <backup><duration>16</duration></backup>
      <note><rest/><duration>16</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="46">
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><rest/><duration>16</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>
"""

# start staff=1, stop wrongly tagged staff=2 (OMR 흔한 어긋남) — number로 짝 유지
SCORE_CROSS_STAFF_STOP = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P5">
    <measure number="45">
      <attributes><divisions>4</divisions><staves>2</staves></attributes>
      <direction placement="below">
        <direction-type><wedge type="crescendo" number="1"/></direction-type>
        <staff>1</staff>
      </direction>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <direction placement="below">
        <direction-type><wedge type="stop" number="1"/></direction-type>
        <staff>2</staff>
      </direction>
      <note><rest/><duration>16</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="46">
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>
"""


def wedge_pairs(root: ET.Element) -> list[tuple[str, str, str]]:
    ns = _ns(root)
    out: list[tuple[str, str, str]] = []
    for part in root.findall(_q(ns, "part")):
        for m in part.findall(_q(ns, "measure")):
            mn = m.get("number") or ""
            for ch in m:
                if _local(ch) != "direction":
                    continue
                for dt in ch.findall(_q(ns, "direction-type")):
                    w = dt.find(_q(ns, "wedge"))
                    if w is None:
                        continue
                    st = ch.find(_q(ns, "staff"))
                    out.append((mn, w.get("type") or "?", st.text if st is not None else "-"))
    return out


def measure_xml(root: ET.Element, number: str) -> str:
    ns = _ns(root)
    for part in root.findall(_q(ns, "part")):
        for m in part.findall(_q(ns, "measure")):
            if m.get("number") == number:
                return ET.tostring(m, encoding="unicode")
    return ""


def write_score(td: Path, xml: str) -> Path:
    xml_name = "score.xml"
    files = {
        "META-INF/container.xml": (
            b'<?xml version="1.0"?><container><rootfiles>'
            b'<rootfile full-path="score.xml"/></rootfiles></container>'
        ),
        xml_name: xml.encode("utf-8"),
    }
    mxl = td / "t.mxl"
    write_mxl_root(mxl, files, xml_name, ET.fromstring(xml))
    return mxl


def main() -> None:
    td = Path(tempfile.mkdtemp())
    mxl = write_score(td, SCORE)
    _, _, root = load_mxl_root(mxl)
    before45 = measure_xml(root, "45")
    before_w = wedge_pairs(root)

    result = apply_fixes_file(
        mxl,
        [
            {
                "kind": "addNoteDirection",
                "partId": "P5",
                "measureMxl": "46",
                "noteIndex": 0,
                "directionType": "dynamics",
                "directionValue": "mf",
                "placement": "below",
            }
        ],
        skip_octave_repair=True,
    )
    assert result.get("applied") == 1, result
    assert result.get("wedgesNormalizedMeasures", 0) == 0, result

    _, _, root2 = load_mxl_root(mxl)
    after45 = measure_xml(root2, "45")
    after_w = wedge_pairs(root2)
    assert before45 == after45, f"m45 mutated:\n{before45}\n---\n{after45}"
    assert before_w == after_w, (before_w, after_w)
    assert ("45", "crescendo", "1") in after_w
    assert ("45", "stop", "1") in after_w

    # cross-staff stop must not be dropped as orphan
    root_cs = ET.fromstring(SCORE_CROSS_STAFF_STOP)
    before_cs = wedge_pairs(root_cs)
    normalize_wedges_in_root(root_cs)
    after_cs = wedge_pairs(root_cs)
    assert any(t == "stop" for _, t, _ in after_cs), (before_cs, after_cs)
    assert any(t == "crescendo" for _, t, _ in after_cs), after_cs

    print("OK m46 mf leaves m45 crescendo; cross-staff stop kept")


if __name__ == "__main__":
    main()

"""setMeasureClef: 이 마디만 적용·staff 매칭·마디 단위 필터 시 clef 주입."""
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fixes_to_root, _effective_clef_for_measure, find_part  # noqa: E402

xml = """<score-partwise version="3.1">
<part id="P1">
<measure number="1"><attributes><divisions>1</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note></measure>
<measure number="27"><attributes><divisions>1</divisions></attributes>
<note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note></measure>
</part></score-partwise>"""

root = ET.fromstring(xml)
apply_fixes_to_root(
    root,
    [
        {
            "kind": "setMeasureClef",
            "partId": "P1",
            "measureMxl": "27",
            "clefSign": "F",
            "clefLine": 4,
            "staff": 1,
            "removeSubsequentClefs": True,
        }
    ],
)
m27 = root.find(".//measure[@number='27']")
signs = [c.findtext("sign") for a in m27.findall("attributes") for c in a.findall("clef")]
assert "F" in signs, signs
part = find_part(root, "", "P1")
eff = _effective_clef_for_measure(part, "", "27", 1)
assert eff and eff.get("sign") == "F", eff

# piano staff2: staff1 G를 덮지 않음
xml_p = """<score-partwise version="3.1">
<part id="P5">
<measure number="1"><attributes><divisions>1</divisions>
<clef number="1"><sign>G</sign><line>2</line></clef>
<clef number="2"><sign>F</sign><line>4</line></clef>
</attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><staff>1</staff></note>
<note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type><staff>2</staff></note>
</measure></part></score-partwise>"""
root_p = ET.fromstring(xml_p)
apply_fixes_to_root(
    root_p,
    [
        {
            "kind": "setMeasureClef",
            "partId": "P5",
            "measureMxl": "1",
            "clefSign": "G",
            "clefLine": 2,
            "staff": 2,
            "removeSubsequentClefs": True,
        }
    ],
)
attrs = root_p.find(".//measure/attributes")
c1 = next(c for c in attrs.findall("clef") if c.get("number") == "1")
c2 = next(c for c in attrs.findall("clef") if c.get("number") == "2")
assert c1.findtext("sign") == "G", ET.tostring(attrs)
assert c2.findtext("sign") == "G", ET.tostring(attrs)

print("setMeasureClef scope/staff ok")

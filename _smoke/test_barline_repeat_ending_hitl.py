"""HITL barline — 도돌이표·1/2번 괄호 추가/삭제."""
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fix, measure_snapshot  # noqa: E402


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


root = ET.fromstring(
    """<score-partwise version="3.1">
<part-list>
  <score-part id="P1"><part-name>S</part-name></score-part>
  <score-part id="P2"><part-name>T</part-name></score-part>
</part-list>
<part id="P1"><measure number="42">
  <attributes><divisions>1</divisions></attributes>
  <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
</measure></part>
<part id="P2"><measure number="42">
  <attributes><divisions>1</divisions></attributes>
  <note><pitch><step>G</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note>
  <barline location="right">
    <bar-style>light-heavy</bar-style>
    <repeat direction="backward"/>
  </barline>
</measure></part>
</score-partwise>"""
)

snap_t = measure_snapshot(root, "", "P2", "42")
assert snap_t is not None
assert len(snap_t["barlines"]) == 1
assert snap_t["barlines"][0]["repeatDirection"] == "backward"
assert snap_t["barlines"][0]["location"] == "right"

# 현재 파트(T)만 도돌이 제거 — S에는 원래 없음
assert apply_fix(
    root,
    "",
    {
        "kind": "clearBarlineRepeat",
        "partId": "P2",
        "measureMxl": "42",
        "barlineLocation": "right",
    },
)
m_t = root.find("./part[@id='P2']/measure")
assert m_t.find(".//{*}repeat") is None
# bar-style만 남으면 barline 유지, style만 있으면 empty 아님
assert m_t.find("{*}barline") is not None

# barline 전체 삭제
assert apply_fix(
    root,
    "",
    {
        "kind": "clearBarline",
        "partId": "P2",
        "measureMxl": "42",
        "barlineLocation": "right",
    },
)
assert m_t.find("{*}barline") is None

# 닫힘 도돌이 다시 추가 (T만)
assert apply_fix(
    root,
    "",
    {
        "kind": "setBarlineRepeat",
        "partId": "P2",
        "measureMxl": "42",
        "barlineLocation": "right",
        "repeatDirection": "backward",
    },
)
rep = m_t.find(".//{*}repeat")
assert rep is not None and rep.get("direction") == "backward"
style = m_t.find(".//{*}bar-style")
assert style is not None and (style.text or "").strip() == "light-heavy"

# 전체 파트에 열림 도돌이
assert apply_fix(
    root,
    "",
    {
        "kind": "setBarlineRepeat",
        "partId": "P2",
        "measureMxl": "42",
        "barlineLocation": "left",
        "repeatDirection": "forward",
        "applyToAllParts": True,
    },
)
for pid in ("P1", "P2"):
    m = root.find(f"./part[@id='{pid}']/measure")
    left = None
    for bl in m.findall("{*}barline"):
        if (bl.get("location") or "").lower() == "left":
            left = bl
            break
    assert left is not None, pid
    assert left.find("{*}repeat").get("direction") == "forward"

# 1번 괄호 시작/끝
assert apply_fix(
    root,
    "",
    {
        "kind": "setBarlineEnding",
        "partId": "P1",
        "measureMxl": "42",
        "barlineLocation": "left",
        "endingNumber": "1",
        "endingType": "start",
        "applyToAllParts": True,
    },
)
assert apply_fix(
    root,
    "",
    {
        "kind": "setBarlineEnding",
        "partId": "P1",
        "measureMxl": "42",
        "barlineLocation": "right",
        "endingNumber": "1",
        "endingType": "stop",
        "applyToAllParts": True,
    },
)
snap1 = measure_snapshot(root, "", "P1", "42")
locs = {b["location"]: b for b in snap1["barlines"]}
assert any(e["number"] == "1" and e["type"] == "start" for e in locs["left"]["endings"])
assert any(e["number"] == "1" and e["type"] == "stop" for e in locs["right"]["endings"])

assert apply_fix(
    root,
    "",
    {
        "kind": "clearBarlineEnding",
        "partId": "P1",
        "measureMxl": "42",
        "barlineLocation": "right",
        "endingNumber": "1",
        "endingType": "stop",
        "applyToAllParts": True,
    },
)
snap2 = measure_snapshot(root, "", "P1", "42")
right = next((b for b in snap2["barlines"] if b["location"] == "right"), None)
# ending만 있던 right barline은 비면 제거됨
if right is not None:
    assert not any(e["type"] == "stop" and e["number"] == "1" for e in right.get("endings") or [])
else:
    assert not any(
        e.get("type") == "stop" and e.get("number") == "1"
        for b in snap2["barlines"]
        for e in b.get("endings") or []
    )

print("OK barline repeat/ending HITL")

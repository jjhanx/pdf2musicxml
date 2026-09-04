"""화음: 동일 피치 리더 2개에 각각 멤버 추가 + 순차 적용(인덱스 밀림)에도 몰리지 않음."""
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fixes_to_root, list_note_elements  # noqa: E402


def _rows(measure):
    out = []
    for n in list_note_elements(measure, ""):
        p = n.find("pitch")
        out.append(
            (
                (p.findtext("step") or "") + (p.findtext("octave") or ""),
                n.find("chord") is not None,
                (n.findtext("voice") or "1").strip(),
            )
        )
    return out


# 1) 다성부 동일 피치 — voice로 구분
xml_v = """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>2</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><staff>1</staff><voice>1</voice></note>
<backup><duration>2</duration></backup>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><staff>1</staff><voice>2</voice></note>
</measure></part></score-partwise>"""
root = ET.fromstring(xml_v)
stats = apply_fixes_to_root(
    root,
    [
        {
            "kind": "insertChordMember",
            "partId": "P1",
            "measureMxl": "1",
            "leaderNoteIndex": 0,
            "staff": 1,
            "leaderVoice": "1",
            "leaderPitchStep": "C",
            "leaderPitchOctave": 4,
            "leaderPitchAlter": 0,
            "chordMembers": [{"pitchStep": "E", "pitchOctave": 4}],
        },
        {
            "kind": "insertChordMember",
            "partId": "P1",
            "measureMxl": "1",
            "leaderNoteIndex": 1,
            "staff": 1,
            "leaderVoice": "2",
            "leaderPitchStep": "C",
            "leaderPitchOctave": 4,
            "leaderPitchAlter": 0,
            "chordMembers": [{"pitchStep": "G", "pitchOctave": 4}],
        },
    ],
)
assert stats.get("applied", 0) >= 2, stats
rows = _rows(root.find(".//measure"))
assert ("E4", True, "1") in rows and ("G4", True, "2") in rows, rows

# 2) 순차 적용: 첫 리더에 화음 넣은 뒤, 옛 index=1로 두 번째 리더 지정해도 몰리지 않음
xml_s = """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>2</divisions></attributes>
<note><pitch><step>A</step><octave>3</octave></pitch><duration>2</duration><type>quarter</type><staff>1</staff></note>
<note><pitch><step>A</step><octave>3</octave></pitch><duration>2</duration><type>quarter</type><staff>1</staff></note>
</measure></part></score-partwise>"""
root2 = ET.fromstring(xml_s)
apply_fixes_to_root(
    root2,
    [
        {
            "kind": "insertChordMember",
            "partId": "P1",
            "measureMxl": "1",
            "leaderNoteIndex": 0,
            "staff": 1,
            "leaderPitchStep": "A",
            "leaderPitchOctave": 3,
            "leaderPitchAlter": 0,
            "chordMembers": [{"pitchStep": "C", "pitchOctave": 4}],
        }
    ],
)
# 이제 notes: A3, C4(ch), A3 — stale index 1은 화음 멤버
stats2 = apply_fixes_to_root(
    root2,
    [
        {
            "kind": "insertChordMember",
            "partId": "P1",
            "measureMxl": "1",
            "leaderNoteIndex": 1,
            "staff": 1,
            "leaderPitchStep": "A",
            "leaderPitchOctave": 3,
            "leaderPitchAlter": 0,
            "chordMembers": [{"pitchStep": "E", "pitchOctave": 4}],
        }
    ],
)
assert stats2.get("applied", 0) >= 1, stats2
rows2 = _rows(root2.find(".//measure"))
# 두 리더 각각에 멤버
assert rows2.count(("A3", False, "1")) == 2, rows2
assert ("C4", True, "1") in rows2 and ("E4", True, "1") in rows2, rows2
# C와 E가 같은 리더에 몰리면 followers가 한 그룹에만 — 리더 사이 멤버 분포 확인
lead_idxs = [i for i, r in enumerate(rows2) if r[0] == "A3" and not r[1]]
assert len(lead_idxs) == 2, rows2
# first group members between lead0 and lead1; second after lead1
g1 = rows2[lead_idxs[0] + 1 : lead_idxs[1]]
g2 = rows2[lead_idxs[1] + 1 :]
assert any(r[0] == "C4" and r[1] for r in g1), (rows2, g1, g2)
assert any(r[0] == "E4" and r[1] for r in g2), (rows2, g1, g2)

print("same-pitch dual chord ok")

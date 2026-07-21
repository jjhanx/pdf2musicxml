import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fix, measure_snapshot  # noqa: E402


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


# dynamics p direction — snapshot에 dyn:p 표시
dyn_xml = """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>2</divisions></attributes>
<direction><direction-type><dynamics><p/></dynamics></direction-type><staff>1</staff></direction>
<note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><stem>up</stem></note>
</measure></part></score-partwise>"""
root = ET.fromstring(dyn_xml)
snap = measure_snapshot(root, "", "P1", "1")
assert snap["elements"][0].get("noteDirection") == {
    "directionType": "dynamics",
    "directionValue": "p",
    "placement": "above",
}, snap["elements"][0]

assert apply_fix(
    root,
    "",
    {"kind": "removeSpuriousDirection", "partId": "P1", "measureMxl": "1", "detail": "dyn:p"},
)
assert not root.findall(".//{*}direction")

root2 = ET.fromstring("""<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>2</divisions></attributes>
<note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note>
</measure></part></score-partwise>""")
assert apply_fix(
    root2,
    "",
    {
        "kind": "insertDirection",
        "partId": "P1",
        "measureMxl": "1",
        "afterNoteIndex": 0,
        "directionType": "dynamics",
        "directionValue": "mf",
        "staff": 1,
    },
)
part = root2.find(".//{*}part")
measure = part.find("{*}measure")
note = measure.find("{*}note")
assert note.find(".//{*}dynamics/{*}mf") is not None
dyn_el = note.find(".//{*}dynamics")
assert dyn_el is not None and dyn_el.get("placement") == "above", dyn_el.get("placement")
snap2 = measure_snapshot(root2, "", "P1", "1")
assert snap2["elements"][0].get("noteDirection") == {
    "directionType": "dynamics",
    "directionValue": "mf",
    "placement": "above",
}

# dynamics + 쉼표 index — 쉼표 위(앞 음 뒤)
root_rest = ET.fromstring("""<score-partwise version="3.1">
<part id="P5"><measure number="8">
<attributes><divisions>12</divisions></attributes>
<note><rest/><duration>36</duration><type>half</type><staff>1</staff></note>
<backup><duration>36</duration></backup>
<note><pitch><step>F</step><octave>3</octave></pitch><duration>36</duration><type>half</type><staff>2</staff></note>
<note><rest/><duration>12</duration><type>quarter</type><staff>2</staff></note>
</measure></part></score-partwise>""")
assert apply_fix(
    root_rest,
    "",
    {
        "kind": "insertDirection",
        "partId": "P5",
        "measureMxl": "8",
        "afterNoteIndex": 2,
        "directionType": "dynamics",
        "directionValue": "p",
        "staff": 2,
    },
)
part_rest = root_rest.find(".//{*}part")
measure_rest = part_rest.find("{*}measure")
children = [_local(c.tag) for c in measure_rest]
rest_idx = next(i for i, c in enumerate(measure_rest) if _local(c.tag) == "note" and c.find("{*}rest") is not None and c.find("{*}staff").text == "2")
rest_note = measure_rest[rest_idx]
assert rest_note.find(".//{*}dynamics/{*}p") is not None
assert "direction" not in children
snap_rest = measure_snapshot(root_rest, "", "P5", "8")
dirs_rest = [e for e in snap_rest["elements"] if e.get("noteDirection")]
assert dirs_rest and dirs_rest[0].get("noteDirection", {}).get("directionValue") == "p"

# 쉼표 뒤(명시 afterRest) — words 등
root_after_rest = ET.fromstring("""<score-partwise version="3.1">
<part id="P5"><measure number="8">
<attributes><divisions>12</divisions></attributes>
<note><rest/><duration>36</duration><type>half</type><staff>1</staff></note>
<backup><duration>36</duration></backup>
<note><pitch><step>F</step><octave>3</octave></pitch><duration>36</duration><type>half</type><staff>2</staff></note>
<note><rest/><duration>12</duration><type>quarter</type><staff>2</staff></note>
</measure></part></score-partwise>""")
assert apply_fix(
    root_after_rest,
    "",
    {
        "kind": "insertDirection",
        "partId": "P5",
        "measureMxl": "8",
        "afterNoteIndex": 2,
        "afterRest": True,
        "directionType": "words",
        "directionValue": "rit.",
        "staff": 2,
    },
)
measure_ar = root_after_rest.find(".//{*}measure")
rest_note = next(
    c for c in measure_ar if _local(c.tag) == "note" and c.find("{*}rest") is not None and c.find("{*}staff").text == "2"
)
children_ar = list(measure_ar)
rest_idx2 = children_ar.index(rest_note)
dir_idx2 = rest_idx2 - 1
assert _local(children_ar[dir_idx2].tag) == "direction"
assert children_ar[dir_idx2].find("{*}staff").text == "2"

root3 = ET.fromstring("""<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>2</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><stem>down</stem></note>
</measure></part></score-partwise>""")
assert apply_fix(
    root3,
    "",
    {"kind": "addArticulation", "partId": "P1", "measureMxl": "1", "noteIndex": 0, "articulation": "accent"},
)
note = root3.find(".//{*}note")
acc = note.find(".//{*}accent")
assert acc is not None
assert acc.get("placement") == "above"

root4 = ET.fromstring("""<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>2</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><stem>up</stem></note>
</measure></part></score-partwise>""")
assert apply_fix(
    root4,
    "",
    {"kind": "addArticulation", "partId": "P1", "measureMxl": "1", "noteIndex": 0, "articulation": "accent"},
)
acc_up = root4.find(".//{*}accent")
assert acc_up is not None and acc_up.get("placement") == "below"

# PL staff=2, after=-1 — PR 첫 음이 아닌 PL 첫 음 앞
root_pl = ET.fromstring("""<score-partwise version="3.1">
<part id="P5"><measure number="8">
<attributes><divisions>12</divisions></attributes>
<note><pitch><step>A</step><octave>3</octave></pitch><duration>36</duration><type>half</type><staff>1</staff></note>
<backup><duration>36</duration></backup>
<note><pitch><step>F</step><octave>3</octave></pitch><duration>36</duration><type>half</type><staff>2</staff></note>
<note><rest/><duration>12</duration><type>quarter</type><staff>2</staff></note>
</measure></part></score-partwise>""")
assert apply_fix(
    root_pl,
    "",
    {
        "kind": "insertDirection",
        "partId": "P5",
        "measureMxl": "8",
        "afterNoteIndex": -1,
        "directionType": "dynamics",
        "directionValue": "p",
        "staff": 2,
    },
)
measure_pl = root_pl.find(".//{*}measure")
children_pl = list(measure_pl)
f3_note = next(
    c
    for c in children_pl
    if _local(c.tag) == "note" and c.find("{*}staff") is not None and c.find("{*}staff").text == "2" and c.find("{*}rest") is None
)
assert f3_note.find(".//{*}dynamics/{*}p") is not None
assert not any(_local(c.tag) == "direction" for c in children_pl)

# 피아노 PR·PL 각각 마디 앞 mf — 2단 part는 음표 notations에 붙음
root_dual = ET.fromstring("""<score-partwise version="3.1">
<part id="P5"><measure number="11">
<attributes><divisions>4</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>G</step><octave>3</octave></pitch><duration>2</duration><type>eighth</type><staff>1</staff><voice>1</voice></note>
<backup><duration>2</duration></backup>
<note><pitch><step>G</step><octave>1</octave></pitch><duration>2</duration><type>eighth</type><staff>2</staff><voice>5</voice></note>
</measure></part></score-partwise>""")
from omr_hitl_lib import apply_fixes_to_root, rebuild_measure_timeline_clean  # noqa: E402

apply_fixes_to_root(
    root_dual,
    [
        {
            "kind": "insertDirection",
            "partId": "P5",
            "measureMxl": "11",
            "afterNoteIndex": -1,
            "directionType": "dynamics",
            "directionValue": "mf",
            "staff": 1,
        },
        {
            "kind": "insertDirection",
            "partId": "P5",
            "measureMxl": "11",
            "afterNoteIndex": -1,
            "directionType": "dynamics",
            "directionValue": "mf",
            "staff": 2,
        },
    ],
)
measure_dual = root_dual.find(".//{*}measure")
pr_note = next(
    c for c in measure_dual if _local(c.tag) == "note" and c.find("{*}staff") is not None and c.find("{*}staff").text == "1"
)
pl_note = next(
    c for c in measure_dual if _local(c.tag) == "note" and c.find("{*}staff") is not None and c.find("{*}staff").text == "2"
)
assert pr_note.find(".//{*}dynamics/{*}mf") is not None
assert pl_note.find(".//{*}dynamics/{*}mf") is not None
assert not any(_local(c.tag) == "direction" and c.find("{*}staff") is not None for c in measure_dual)

# 화음 리더 #n 뒤 direction — 화음 멤버(F4) 뒤가 아니라 리더(B) 직전(단일 줄 part)
root_chord = ET.fromstring("""<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>2</divisions></attributes>
<note default-x="10"><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch><duration>1</duration><type>eighth</type><stem>up</stem></note>
<note default-x="10"><chord/><pitch><step>D</step><alter>-1</alter><octave>4</octave></pitch><duration>1</duration><type>eighth</type><stem>up</stem></note>
<note default-x="10"><chord/><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><stem>up</stem></note>
<note default-x="40"><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><stem>up</stem></note>
</measure></part></score-partwise>""")
apply_fixes_to_root(
    root_chord,
    [
        {
            "kind": "insertDirection",
            "partId": "P1",
            "measureMxl": "1",
            "afterNoteIndex": 0,
            "directionType": "dynamics",
            "directionValue": "p",
            "staff": 1,
        }
    ],
)
measure_ch = root_chord.find(".//{*}measure")
leader = measure_ch.find("{*}note")
assert leader.find(".//{*}dynamics/{*}p") is not None

# PL 마디 앞 — backup 직후 staff 2
root_pl = ET.fromstring("""<score-partwise version="3.1">
<part id="P5"><measure number="1">
<attributes><divisions>4</divisions><staves>2</staves></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><staff>1</staff></note>
<backup><duration>4</duration></backup>
<note><pitch><step>G</step><octave>2</octave></pitch><duration>4</duration><type>quarter</type><staff>2</staff><voice>5</voice></note>
</measure></part></score-partwise>""")
apply_fixes_to_root(
    root_pl,
    [
        {
            "kind": "insertDirection",
            "partId": "P5",
            "measureMxl": "1",
            "afterNoteIndex": -1,
            "directionType": "words",
            "directionValue": "PL start",
            "staff": 2,
        }
    ],
)
measure_pl = root_pl.find(".//{*}measure")
children_pl = list(measure_pl)
backup_i = next(i for i, c in enumerate(children_pl) if _local(c.tag) == "backup")
dir_i = next(i for i, c in enumerate(children_pl) if _local(c.tag) == "direction")
g2_i = next(
    i
    for i, c in enumerate(children_pl)
    if _local(c.tag) == "note" and c.find("{*}staff") is not None and c.find("{*}staff").text == "2"
)
assert backup_i < dir_i < g2_i, [(backup_i, dir_i, g2_i), [_local(c.tag) for c in children_pl]]
pl_dir = next(c for c in children_pl if _local(c.tag) == "direction")
assert pl_dir.find("{*}staff").text == "2", "PL words direction must specify staff tag"
pl_voice = pl_dir.find("{*}voice")
pl_note = children_pl[g2_i]
assert pl_voice is not None and pl_voice.text == pl_note.find("{*}voice").text

# PL dynamics — 음표 notations에 붙임(staff direction 없음)
root_pl_dyn = ET.fromstring("""<score-partwise version="3.1">
<part id="P5"><measure number="1">
<attributes><divisions>4</divisions><staves>2</staves></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><staff>1</staff></note>
<backup><duration>4</duration></backup>
<note><pitch><step>G</step><octave>2</octave></pitch><duration>4</duration><type>quarter</type><staff>2</staff><voice>5</voice></note>
</measure></part></score-partwise>""")
apply_fixes_to_root(
    root_pl_dyn,
    [
        {
            "kind": "insertDirection",
            "partId": "P5",
            "measureMxl": "1",
            "afterNoteIndex": -1,
            "directionType": "dynamics",
            "directionValue": "mf",
            "staff": 2,
        }
    ],
)
measure_dyn = root_pl_dyn.find(".//{*}measure")
assert measure_dyn.find(".//{*}direction") is None
pl_note_dyn = next(
    c for c in measure_dyn if _local(c.tag) == "note" and c.find("{*}staff") is not None and c.find("{*}staff").text == "2"
)
assert pl_note_dyn.find(".//{*}dynamics/{*}mf") is not None

# setNoteDirection — PL 음표 #1에 words, migrate 후에도 backup 직후·PL 앞 유지
root_set = ET.fromstring("""<score-partwise version="3.1">
<part id="P5"><measure number="1">
<attributes><divisions>4</divisions><staves>2</staves></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><staff>1</staff></note>
<backup><duration>4</duration></backup>
<note><pitch><step>G</step><octave>2</octave></pitch><duration>4</duration><type>quarter</type><staff>2</staff><voice>5</voice></note>
</measure></part></score-partwise>""")
apply_fixes_to_root(
    root_set,
    [
        {
            "kind": "setNoteDirection",
            "partId": "P5",
            "measureMxl": "1",
            "noteIndex": 1,
            "directionType": "words",
            "directionValue": "PL label",
        }
    ],
)
measure_set = root_set.find(".//{*}measure")
children_set = list(measure_set)
backup_i2 = next(i for i, c in enumerate(children_set) if _local(c.tag) == "backup")
dir_i2 = next(i for i, c in enumerate(children_set) if _local(c.tag) == "direction")
g2_i2 = next(
    i
    for i, c in enumerate(children_set)
    if _local(c.tag) == "note" and c.find("{*}staff") is not None and c.find("{*}staff").text == "2"
)
assert backup_i2 < dir_i2 < g2_i2, [_local(c.tag) for c in children_set]
assert children_set[dir_i2].find("{*}staff").text == "2"

# setNoteDirection — fix의 staff 필드는 무시, noteIndex만 사용
root_staff = ET.fromstring("""<score-partwise version="3.1">
<part id="P5"><measure number="1">
<attributes><divisions>4</divisions><staves>2</staves></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><staff>1</staff></note>
<backup><duration>4</duration></backup>
<note><pitch><step>G</step><octave>2</octave></pitch><duration>4</duration><type>quarter</type><staff>2</staff></note>
</measure></part></score-partwise>""")
assert apply_fix(
    root_staff,
    "",
    {
        "kind": "setNoteDirection",
        "partId": "P5",
        "measureMxl": "1",
        "noteIndex": 0,
        "staff": 2,
        "directionType": "words",
        "directionValue": "on PR",
    },
)
measure_staff = root_staff.find(".//{*}measure")
children_staff = list(measure_staff)
pr_i = next(i for i, c in enumerate(children_staff) if _local(c.tag) == "note" and c.find("{*}staff").text == "1")
dir_i = next(i for i, c in enumerate(children_staff) if _local(c.tag) == "direction")
assert dir_i + 1 == pr_i, "direction must attach to note #0 (PR), staff in fix ignored"
assert children_staff[dir_i].find("{*}staff").text == "1"
assert children_staff[dir_i].find(".//{*}words").text == "on PR"

# words + dynamics on same note — both coexist
root_both = ET.fromstring("""<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>4</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
</measure></part></score-partwise>""")
assert apply_fix(
    root_both,
    "",
    {
        "kind": "addNoteDirection",
        "partId": "P1",
        "measureMxl": "1",
        "noteIndex": 0,
        "directionType": "words",
        "directionValue": "a tempo",
    },
)
assert apply_fix(
    root_both,
    "",
    {
        "kind": "addNoteDirection",
        "partId": "P1",
        "measureMxl": "1",
        "noteIndex": 0,
        "directionType": "dynamics",
        "directionValue": "ff",
    },
)
snap_both = measure_snapshot(root_both, "", "P1", "1")
el0 = snap_both["elements"][0]
assert el0.get("noteDirections") == [
    {"directionType": "words", "directionValue": "a tempo"},
    {"directionType": "dynamics", "directionValue": "ff", "placement": "above"},
], el0
m_both = root_both.find(".//{*}measure")
note_both = m_both.find("{*}note")
assert note_both.find(".//{*}dynamics/{*}ff") is not None
dirs_both = [c for c in m_both if _local(c.tag) == "direction"]
assert len(dirs_both) == 1
assert dirs_both[0].find(".//{*}words").text == "a tempo"

print("direction hitl ok")

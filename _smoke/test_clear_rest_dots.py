"""clearRestDots 회귀 테스트 — 온쉼표 옆 점(duration·<dot>) 제거 변형 케이스."""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import apply_fix  # noqa: E402


def make_root(measure3_notes_xml: str, beats: int = 4, beat_type: int = 4, divisions: int = 4) -> ET.Element:
    xml = f"""<score-partwise version='3.1'>
  <part-list><score-part id='P1'><part-name>S</part-name></score-part></part-list>
  <part id='P1'>
    <measure number='1'>
      <attributes>
        <divisions>{divisions}</divisions>
        <time><beats>{beats}</beats><beat-type>{beat_type}</beat-type></time>
      </attributes>
      <note><rest measure='yes'/><duration>{divisions * beats * 4 // beat_type}</duration></note>
    </measure>
    <measure number='2'>
      <note><rest measure='yes'/><duration>{divisions * beats * 4 // beat_type}</duration></note>
    </measure>
    <measure number='3'>
      {measure3_notes_xml}
    </measure>
  </part>
</score-partwise>"""
    return ET.fromstring(xml)


def note3(root: ET.Element, i: int = 0) -> ET.Element:
    return [n for n in root.find("part").findall("measure")[2] if n.tag == "note"][i]


def run(name: str, notes_xml: str, expect_applied: bool, expect_dur: int | None, **make_kw):
    root = make_root(notes_xml, **make_kw)
    fix = {"kind": "clearRestDots", "partId": "P1", "measureMxl": "3", "noteIndex": 0}
    applied = apply_fix(root, "", fix)
    note = note3(root)
    dur_el = note.find("duration")
    dur = int(dur_el.text) if dur_el is not None else None
    dots = len(note.findall("dot"))
    ok = applied == expect_applied and (expect_dur is None or dur == expect_dur) and dots == 0
    print(f"{'PASS' if ok else 'FAIL'} {name}: applied={applied} dur={dur} dots={dots} (기대 dur={expect_dur})")
    return ok


results = []
# 1) 사용자 케이스: type 없음, duration이 1.5×마디(점을 duration에만 반영) → 16으로
results.append(run("type없음 duration 24 (4/4, div=4)", "<note><rest/><duration>24</duration></note>", True, 16))
# 2) type=whole + <dot/> + duration 24 → dot 제거 + 16
results.append(run(
    "whole+<dot> duration 24",
    "<note><rest/><duration>24</duration><type>whole</type><dot/></note>",
    True, 16,
))
# 3) 3/4: whole rest duration 16(4박) → 마디 길이 12로
results.append(run(
    "3/4 whole rest duration 16",
    "<note><rest/><duration>16</duration><type>whole</type></note>",
    True, 12, beats=3,
))
# 4) measure='yes' type 없음 duration 24 → 16
results.append(run(
    "measure=yes duration 24",
    "<note><rest measure='yes'/><duration>24</duration></note>", True, 16,
))
# 5) 이미 정상(16) → 변화 없음(skipped)
results.append(run(
    "이미 정상 duration 16",
    "<note><rest measure='yes'/><duration>16</duration></note>", False, 16,
))
# 6) 점 있는 4분쉼표(type 없음, dur 6) → 4
results.append(run("type없음 점4분쉼표 dur 6", "<note><rest/><duration>6</duration></note>", True, 4))

# ---- normalize_rest_durations_root (변환 직후 자동 정규화) ----
from omr_hitl_lib import normalize_rest_durations_root  # noqa: E402

multi = ET.fromstring("""<score-partwise version='3.1'>
  <part-list>
    <score-part id='P1'/><score-part id='P2'/><score-part id='P3'/>
  </part-list>
  <part id='P1'>
    <measure number='1'>
      <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><rest/><duration>24</duration></note>
    </measure>
  </part>
  <part id='P2'>
    <measure number='1'>
      <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><rest/><duration>24</duration><type>whole</type></note>
    </measure>
  </part>
  <part id='P3'>
    <measure number='1'>
      <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>6</duration><type>quarter</type><dot/></note>
      <note><rest/><duration>10</duration></note>
    </measure>
  </part>
</score-partwise>""")
stats = normalize_rest_durations_root(multi)
p1_dur = multi.findall("part")[0].find("measure").find("note/duration").text
p2_dur = multi.findall("part")[1].find("measure").find("note/duration").text
p3_notes = [n for n in multi.findall("part")[2].find("measure") if n.tag == "note"]
p3_note_dur = p3_notes[0].find("duration").text  # 점음표(명시적 <dot>)는 보존
p3_rest_dur = p3_notes[1].find("duration").text
ok_n = (
    stats["restsFixed"] == 2
    and p1_dur == "16"
    and p2_dur == "16"
    and p3_note_dur == "6"
    and p3_rest_dur == "10"  # 점 의심 패턴(1.5×)이 아니고 줄이면 초과분과 안 맞아 보존
)
print(f"{'PASS' if ok_n else 'FAIL'} normalize 전체 성부: stats={stats} P1={p1_dur} P2={p2_dur} P3={p3_note_dur}/{p3_rest_dur}")
results.append(ok_n)

# 온쉼표 display-step/octave 힌트 제거 (쉼표가 엉뚱한 줄에 걸리는 문제)
disp = ET.fromstring("""<score-partwise version='3.1'>
  <part-list><score-part id='P4'/></part-list>
  <part id='P4'>
    <measure number='1'>
      <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><rest><display-step>D</display-step><display-octave>5</display-octave></rest><duration>16</duration></note>
    </measure>
    <measure number='2'>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><type>half</type></note>
      <note><rest><display-step>B</display-step><display-octave>4</display-octave></rest><duration>8</duration><type>half</type></note>
    </measure>
  </part>
</score-partwise>""")
stats3 = normalize_rest_durations_root(disp)
m1_rest = disp.find("part/measure[@number='1']/note/rest")
m2_rest = disp.findall("part/measure[@number='2']/note")[1].find("rest")
ok_d = (
    stats3["restDisplayCleared"] == 1
    and m1_rest.find("display-step") is None  # 마디 전체 쉼표 → 힌트 제거
    and m2_rest.find("display-step") is not None  # 음표와 섞인 half 쉼표 → 보존
)
print(f"{'PASS' if ok_d else 'FAIL'} display 힌트 제거: stats={stats3}")
results.append(ok_d)

# 잇단음표 빔 쪽 스타카토 제거 (Audiveris가 "3" 숫자를 점으로 오인)
tup = ET.fromstring("""<score-partwise version='3.1'>
  <part-list><score-part id='P5'/></part-list>
  <part id='P5'>
    <measure number='1'>
      <attributes><divisions>6</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>D</step><octave>2</octave></pitch><duration>2</duration><type>eighth</type>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
        <stem>up</stem>
        <notations><articulations><staccato placement='above'/></articulations></notations>
      </note>
      <note><pitch><step>E</step><octave>2</octave></pitch><duration>2</duration><type>eighth</type>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
        <stem>up</stem>
        <notations><articulations><staccato placement='below'/></articulations></notations>
      </note>
      <note><pitch><step>F</step><octave>2</octave></pitch><duration>2</duration><type>eighth</type>
        <stem>up</stem>
        <notations><articulations><staccato placement='above'/></articulations></notations>
      </note>
      <note><rest/><duration>18</duration><type>half</type><dot/></note>
    </measure>
  </part>
</score-partwise>""")
stats4 = normalize_rest_durations_root(tup)
ns_notes = tup.findall("part/measure/note")
ok_t = (
    stats4["tupletStaccatoRemoved"] == 1
    and ns_notes[0].find("notations") is None  # 잇단 + stem=up + above → 제거(빈 notations도 정리)
    and ns_notes[1].find("notations/articulations/staccato") is not None  # 머리 쪽(below) → 보존
    and ns_notes[2].find("notations/articulations/staccato") is not None  # 잇단 아님 → 보존
)
print(f"{'PASS' if ok_t else 'FAIL'} 잇단 빔쪽 스타카토 제거: stats={stats4}")
results.append(ok_t)

# removeArticulation 수동 보정
art_doc = ET.fromstring("""<score-partwise version='3.1'>
  <part-list><score-part id='P5'/></part-list>
  <part id='P5'>
    <measure number='7'>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><type>quarter</type>
        <notations><articulations><staccato placement='above'/><accent/></articulations></notations>
      </note>
    </measure>
  </part>
</score-partwise>""")
applied_art = apply_fix(art_doc, "", {"kind": "removeArticulation", "partId": "P5", "measureMxl": "7", "noteIndex": 0, "articulation": "staccato"})
note_a = art_doc.find("part/measure/note")
ok_a = (
    applied_art
    and note_a.find("notations/articulations/staccato") is None
    and note_a.find("notations/articulations/accent") is not None  # 지정한 것만 제거
)
print(f"{'PASS' if ok_a else 'FAIL'} removeArticulation: applied={applied_art}")
results.append(ok_a)

# 정상 마디(합이 정확)는 절대 건드리지 않음
clean = ET.fromstring("""<score-partwise version='3.1'>
  <part-list><score-part id='P1'/></part-list>
  <part id='P1'>
    <measure number='1'>
      <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><rest/><duration>8</duration><type>half</type></note>
      <note><rest/><duration>8</duration><type>half</type></note>
    </measure>
  </part>
</score-partwise>""")
stats2 = normalize_rest_durations_root(clean)
ok_c = stats2["restsFixed"] == 0
print(f"{'PASS' if ok_c else 'FAIL'} normalize 정상 마디 보존: stats={stats2}")
results.append(ok_c)

# ---- setNoteType + dotCount (3/8 점4분 등) ----
def run_set_note_type(name, notes_xml, note_type, dot_count, expect_dur, **make_kw):
    root = make_root(notes_xml, **make_kw)
    fix = {
        "kind": "setNoteType",
        "partId": "P1",
        "measureMxl": "3",
        "noteIndex": 0,
        "noteType": note_type,
        "dotCount": dot_count,
    }
    applied = apply_fix(root, "", fix)
    note = note3(root)
    dur = int(note.find("duration").text)
    dots = len(note.findall("dot"))
    typ = note.find("type").text
    ok = applied and typ == note_type and dots == dot_count and dur == expect_dur
    print(
        f"{'PASS' if ok else 'FAIL'} {name}: type={typ} dots={dots} dur={dur} (기대 dur={expect_dur})"
    )
    return ok

results.append(
    run_set_note_type(
        "8분→점4분 (3/8 div=9)",
        "<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>eighth</type></note>",
        "quarter",
        1,
        14,
        beats=3,
        beat_type=8,
        divisions=9,
    )
)

sys.exit(0 if all(results) else 1)

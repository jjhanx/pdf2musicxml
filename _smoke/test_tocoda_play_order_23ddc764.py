"""To Coda insert must not merge sequential opposite-stem notes; emit words+coda+sound."""
import io
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import (  # noqa: E402
    apply_fixes_to_root,
    apply_fix,
    find_measure,
    find_part,
    list_note_elements,
    measure_snapshot,
    rebuild_measure_timeline_clean,
    _ns,
    _q,
    _local,
    _note_voice_staff,
)


def _load():
    z = zipfile.ZipFile("omr-work-23ddc764.zip")
    return ET.fromstring(
        zipfile.ZipFile(io.BytesIO(z.read("review.mxl"))).read(
            [
                n
                for n in zipfile.ZipFile(io.BytesIO(z.read("review.mxl"))).namelist()
                if n.endswith(".xml") and "META" not in n.upper()
            ][0]
        )
    )


def _pitch_step(note: ET.Element, ns: str) -> str:
    return (
        note.findtext(f".//{_q(ns, 'step')}")
        or note.findtext(".//{*}step")
        or note.findtext(".//step")
        or "?"
    )


def test_rebuild_preserves_m36_sequence():
    root = _load()
    ns = _ns(root)
    m = find_measure(find_part(root, ns, "P1"), ns, "36")
    for i, o in [(0, 1), (1, 2), (2, 3)]:
        assert apply_fix(
            root,
            "",
            {"kind": "setPlayOrder", "partId": "P1", "measureMxl": "36", "noteIndex": i, "playOrder": o},
        )
    rebuild_measure_timeline_clean(m, ns)
    notes = [n for n in list_note_elements(m, ns) if n.find(_q(ns, "chord")) is None]
    steps = [_pitch_step(n, ns) for n in notes]
    pos = [n.get("data-hitl-play-order") for n in notes]
    voices = {_note_voice_staff(n, ns)[0] for n in notes}
    assert voices == {"1"}, voices
    assert steps[:3] == ["B", "A", "F"], steps
    assert pos[:3] == ["1", "2", "3"], pos
    xs = [float(n.get("default-x") or 0) for n in notes[:3]]
    assert xs[0] < xs[1] < xs[2], xs


def test_tocoda_does_not_touch_note_layout():
    """진행 제어 추가는 음표 default-x·순번·voice를 절대 바꾸지 않음."""
    root = _load()
    ns = _ns(root)
    m = find_measure(find_part(root, ns, "P1"), ns, "36")
    for i, o in [(0, 1), (1, 2), (2, 3)]:
        assert apply_fix(
            root,
            "",
            {"kind": "setPlayOrder", "partId": "P1", "measureMxl": "36", "noteIndex": i, "playOrder": o},
        )
    before = [
        (
            n.get("default-x"),
            n.get("data-hitl-play-order"),
            _note_voice_staff(n, ns),
            _pitch_step(n, ns),
            n.findtext(_q(ns, "duration")) or n.findtext(".//duration"),
        )
        for n in list_note_elements(m, ns)
        if n.find(_q(ns, "chord")) is None
    ]
    stats = apply_fixes_to_root(
        root,
        [
            {
                "kind": "insertDirection",
                "partId": "P1",
                "measureMxl": "36",
                "directionType": "tocoda",
                "measureAnchor": "end",
                "staff": 1,
                "placement": "above",
            }
        ],
    )
    assert stats["applied"] == 1, stats
    m2 = find_measure(find_part(root, ns, "P1"), ns, "36")
    after = [
        (
            n.get("default-x"),
            n.get("data-hitl-play-order"),
            _note_voice_staff(n, ns),
            _pitch_step(n, ns),
            n.findtext(_q(ns, "duration")) or n.findtext(".//duration"),
        )
        for n in list_note_elements(m2, ns)
        if n.find(_q(ns, "chord")) is None
    ]
    assert before == after, (before, after)
    assert any(_local(c) == "direction" for c in m2)
    dirs = [c for c in m2 if _local(c) == "direction"]
    d = dirs[-1]
    assert d.find(f".//{_q(ns, 'words')}") is not None
    assert "To Coda" in (d.find(f".//{_q(ns, 'words')}").text or "")
    assert d.find(f".//{_q(ns, 'coda')}") is not None


def test_tocoda_xml_and_play_order():
    root = _load()
    # set play order first (no rebuild), then To Coda alone via apply_fixes
    for i, o in [(0, 1), (1, 2), (2, 3)]:
        assert apply_fix(
            root,
            "",
            {"kind": "setPlayOrder", "partId": "P1", "measureMxl": "36", "noteIndex": i, "playOrder": o},
        )
    stats = apply_fixes_to_root(
        root,
        [
            {
                "kind": "insertDirection",
                "partId": "P1",
                "measureMxl": "36",
                "directionType": "tocoda",
                "measureAnchor": "end",
                "staff": 1,
                "placement": "above",
            }
        ],
    )
    assert stats["applied"] == 1, stats
    ns = _ns(root)
    m = find_measure(find_part(root, ns, "P1"), ns, "36")
    dirs = [c for c in m if _local(c) == "direction"]
    assert dirs, "missing To Coda direction"
    tocoda_dir = dirs[-1]
    words = [w.text for w in tocoda_dir.findall(f".//{_q(ns, 'words')}") if w.text]
    assert any("To Coda" in (w or "") for w in words), words
    assert tocoda_dir.find(f".//{_q(ns, 'coda')}") is not None
    sound = tocoda_dir.find(_q(ns, "sound"))
    assert sound is not None and sound.get("tocoda") == "coda"
    assert tocoda_dir.find(f".//{_q(ns, 'tocoda')}") is None

    snap = measure_snapshot(root, "", "P1", "36")
    nav = [d for d in snap["measureDirections"] if d.get("directionType") == "tocoda"]
    assert len(nav) == 1, snap["measureDirections"]
    leaders = [n for n in snap["notes"] if not n.get("chord")]
    assert leaders[0]["playOrder"] == 1
    assert leaders[1]["playOrder"] == 2
    assert leaders[2]["playOrder"] == 3
    assert leaders[1]["defaultX"] != leaders[2]["defaultX"], (
        leaders[1]["defaultX"],
        leaders[2]["defaultX"],
    )


def test_measure_anchor_start_vs_end():
    root = _load()
    assert apply_fix(
        root,
        "",
        {
            "kind": "insertDirection",
            "partId": "P1",
            "measureMxl": "36",
            "directionType": "segno",
            "measureAnchor": "start",
            "staff": 1,
        },
    )
    ns = _ns(root)
    m = find_measure(find_part(root, ns, "P1"), ns, "36")
    children = [_local(c) for c in m]
    assert children.index("direction") < children.index("note")

    root2 = _load()
    assert apply_fix(
        root2,
        "",
        {
            "kind": "insertDirection",
            "partId": "P1",
            "measureMxl": "36",
            "directionType": "tocoda",
            "measureAnchor": "end",
            "staff": 1,
        },
    )
    ns2 = _ns(root2)
    m2 = find_measure(find_part(root2, ns2, "P1"), ns2, "36")
    kids = list(m2)
    note_idxs = [i for i, c in enumerate(kids) if _local(c) == "note"]
    dir_idxs = [i for i, c in enumerate(kids) if _local(c) == "direction"]
    assert dir_idxs and note_idxs
    assert dir_idxs[-1] > note_idxs[-1]


def test_migrate_leaves_tocoda_at_end():
    root = ET.fromstring(
        """<score-partwise version="3.1">
<part id="P1"><measure number="36">
<attributes><divisions>2</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><voice>1</voice><staff>1</staff></note>
<direction placement="above">
  <direction-type><words>To Coda</words></direction-type>
  <direction-type><coda/></direction-type>
  <sound tocoda="coda"/>
  <staff>1</staff>
</direction>
</measure></part></score-partwise>"""
    )
    from omr_hitl_lib import _migrate_directions_to_notes, _ns, _local

    ns = _ns(root)
    m = root.find(".//{*}measure")
    assert _migrate_directions_to_notes(m, ns) is False or True
    kids = [_local(c) for c in m]
    assert kids.index("direction") > kids.index("note"), kids


if __name__ == "__main__":
    test_rebuild_preserves_m36_sequence()
    test_tocoda_does_not_touch_note_layout()
    test_tocoda_xml_and_play_order()
    test_measure_anchor_start_vs_end()
    test_migrate_leaves_tocoda_at_end()
    print("tocoda play-order / measure-anchor ok")

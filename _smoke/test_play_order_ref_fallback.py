import xml.etree.ElementTree as ET
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import omr_hitl_lib


def test_anchor_ref_without_explicit_anchor_po():
    """Verify that a '1-5' play-order ref resolves to the 5th note in voice 1,

    even when voice 1 does not have explicit data-hitl-play-order attributes.
    """
    m = ET.Element("measure", {"number": "14"})
    ns = ""

    # Voice 1: 5 notes (first note is dotted eighth, next 3 are 16th/8th, 5th is eighth at onset 24)
    # 1st note: C4 (dur=9, dx=32)
    n1 = ET.SubElement(m, "note")
    pitch1 = ET.SubElement(n1, "pitch")
    ET.SubElement(pitch1, "step").text = "C"
    ET.SubElement(pitch1, "octave").text = "4"
    ET.SubElement(n1, "duration").text = "9"
    ET.SubElement(n1, "voice").text = "1"
    ET.SubElement(n1, "staff").text = "1"
    n1.set("default-x", "32.00")

    # 2nd note: A3 (dur=3, dx=107) -> onset 9
    n2 = ET.SubElement(m, "note")
    pitch2 = ET.SubElement(n2, "pitch")
    ET.SubElement(pitch2, "step").text = "A"
    ET.SubElement(pitch2, "octave").text = "3"
    ET.SubElement(n2, "duration").text = "3"
    ET.SubElement(n2, "voice").text = "1"
    ET.SubElement(n2, "staff").text = "1"
    n2.set("default-x", "107.00")

    # 3rd note: A3 (dur=6, dx=132) -> onset 12
    n3 = ET.SubElement(m, "note")
    pitch3 = ET.SubElement(n3, "pitch")
    ET.SubElement(pitch3, "step").text = "A"
    ET.SubElement(pitch3, "octave").text = "3"
    ET.SubElement(n3, "duration").text = "6"
    ET.SubElement(n3, "voice").text = "1"
    ET.SubElement(n3, "staff").text = "1"
    n3.set("default-x", "132.00")

    # 4th note: C4 (dur=6, dx=182) -> onset 18
    n4 = ET.SubElement(m, "note")
    pitch4 = ET.SubElement(n4, "pitch")
    ET.SubElement(pitch4, "step").text = "C"
    ET.SubElement(pitch4, "octave").text = "4"
    ET.SubElement(n4, "duration").text = "6"
    ET.SubElement(n4, "voice").text = "1"
    ET.SubElement(n4, "staff").text = "1"
    n4.set("default-x", "182.00")

    # 5th note: F4 (dur=3, dx=232) -> onset 24
    n5 = ET.SubElement(m, "note")
    pitch5 = ET.SubElement(n5, "pitch")
    ET.SubElement(pitch5, "step").text = "F"
    ET.SubElement(pitch5, "octave").text = "4"
    ET.SubElement(n5, "duration").text = "3"
    ET.SubElement(n5, "voice").text = "1"
    ET.SubElement(n5, "staff").text = "1"
    n5.set("default-x", "232.00")

    # 6th note: E4 (dur=21, dx=257) -> to complete 48
    n6 = ET.SubElement(m, "note")
    pitch6 = ET.SubElement(n6, "pitch")
    ET.SubElement(pitch6, "step").text = "E"
    ET.SubElement(pitch6, "octave").text = "4"
    ET.SubElement(n6, "duration").text = "21"
    ET.SubElement(n6, "voice").text = "1"
    ET.SubElement(n6, "staff").text = "1"
    n6.set("default-x", "257.00")

    # backup 48
    bk = ET.SubElement(m, "backup")
    ET.SubElement(bk, "duration").text = "48"

    # Voice 2: forward 39 (misaligned), then C4 dur=9 with data-hitl-play-order="1-5"
    fwd = ET.SubElement(m, "forward")
    ET.SubElement(fwd, "duration").text = "39"
    ET.SubElement(fwd, "voice").text = "2"

    v2_n = ET.SubElement(m, "note")
    v2_p = ET.SubElement(v2_n, "pitch")
    ET.SubElement(v2_p, "step").text = "C"
    ET.SubElement(v2_p, "octave").text = "4"
    ET.SubElement(v2_n, "duration").text = "9"
    ET.SubElement(v2_n, "voice").text = "2"
    ET.SubElement(v2_n, "staff").text = "1"
    v2_n.set("default-x", "382.00")
    v2_n.set("data-hitl-play-order", "1-5")

    # Realign
    res = omr_hitl_lib._layout_onset_for_anchor_voice_order(m, ns, "1", 1, 5)
    assert res is not None, "Failed to resolve anchor onset for (1, 5)"
    target_onset, target_dx = res
    assert target_onset == 24, f"Expected anchor onset 24, got {target_onset}"
    assert target_dx == "232.00", f"Expected anchor dx '232.00', got {target_dx}"

    changed = omr_hitl_lib.realign_measure_timeline_to_play_order_columns(m, ns)
    assert changed, "Expected realign to return True"

    # Check forward duration after realign
    fwd_dur = fwd.findtext("duration")
    assert fwd_dur == "24", f"Expected forward duration 24, got {fwd_dur}"

    # Check note default-x
    assert v2_n.get("default-x") == "232.00", f"Expected v2 default-x 232.00, got {v2_n.get('default-x')}"

    # Check onsets
    onsets = omr_hitl_lib._voice_parallel_note_onsets(m, ns)
    assert onsets.get(v2_n) == 24, f"Expected v2 onset 24, got {onsets.get(v2_n)}"
    assert onsets.get(n5) == 24, f"Expected n5 onset 24, got {onsets.get(n5)}"

    print("test_anchor_ref_without_explicit_anchor_po PASSED!")


if __name__ == "__main__":
    test_anchor_ref_without_explicit_anchor_po()

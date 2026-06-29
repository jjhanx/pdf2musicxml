#!/usr/bin/env python3
"""Unit tests for AI OMR semantic decoder."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ai_engine.semantic_decoder import decode_tokens, merge_token_streams_to_graph
from ai_engine.voice_assigner import assign_voices
from ai_engine.musicxml_builder import write_mxl
from ai_engine.config import AiOmrConfig


def test_decode_note_tokens():
    nodes = decode_tokens(
        ["clef-G2", "timeSignature-4/4", "note-C5-quarter", "note-D5-eighth", "rest-quarter"],
        measure=1,
        staff=0,
    )
    notes = [n for n in nodes if n.kind in ("note", "rest")]
    assert len(notes) == 3
    assert notes[0].pitch == "C5"
    assert notes[0].duration_type == "quarter"
    assert notes[1].duration_type == "eighth"
    assert notes[2].rest is True


def test_pipeline_to_mxl(tmp_path=None):
    import tempfile

    out = Path(tempfile.mkdtemp())
    g = merge_token_streams_to_graph(
        [
            (["clef-G2", "timeSignature-4/4", "note-E4-quarter", "barline"], 1, 0, 1, 0),
            (["note-F4-quarter", "barline"], 2, 0, 1, 0),
        ]
    )
    assign_voices(g)
    cfg = AiOmrConfig(output_basename="test")
    mxl = write_mxl(g, cfg, out / "test.mxl")
    assert mxl.is_file()
    import zipfile

    with zipfile.ZipFile(mxl) as z:
        names = z.namelist()
        xml_name = next(n for n in names if n.endswith(".xml") and "META-INF" not in n and n != "container.xml")
        xml_text = z.read(xml_name).decode("utf-8")
        assert xml_text.lstrip().startswith("<?xml")
        assert "<score-partwise" in xml_text
        assert "score-partwise}" not in xml_text


def test_staff_prefix_tokens():
    nodes = decode_tokens(
        ["staff2-clef-G2", "staff2-timeSignature-4/4", "staff2-rest-whole"],
        measure=1,
        staff=0,
    )
    assert len(nodes) == 3
    assert all(n.staff == 2 for n in nodes)


if __name__ == "__main__":
    test_decode_note_tokens()
    test_pipeline_to_mxl()
    test_staff_prefix_tokens()
    print("OK: ai_engine tests")

"""Audiveris mvt1/mvt2 병합 — 파트 구성 변화로 나뉜 악장을 한 악보로 이어 붙인다."""
from __future__ import annotations

import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from merge_audiveris_movements import (  # noqa: E402
    group_movement_paths,
    match_parts,
    merge_mxl_files,
    merge_path_list,
)


def _write_mxl(path: Path, xml: str, inner: str = "score.xml") -> None:
    container = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<container>\n  <rootfiles>\n"
        f'    <rootfile full-path="{inner}" media-type="application/vnd.recordare.musicxml+xml"/>\n'
        "  </rootfiles>\n</container>\n"
    )
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("META-INF/container.xml", container)
        z.writestr(inner, xml)


def _read_max_measure(path: Path) -> tuple[int, int, list[str]]:
    with zipfile.ZipFile(path) as z:
        name = next(n for n in z.namelist() if n.lower().endswith(".xml") and "meta-inf" not in n.lower())
        root = ET.parse(io.BytesIO(z.read(name))).getroot()
    parts = [el for el in root if el.tag.rsplit("}", 1)[-1] == "part"]
    nums: list[int] = []
    names: list[str] = []
    for sp in root.iter():
        if sp.tag.rsplit("}", 1)[-1] == "part-name":
            names.append("".join(sp.itertext()).strip())
    for part in parts:
        for m in part:
            if m.tag.rsplit("}", 1)[-1] != "measure":
                continue
            try:
                nums.append(int(m.get("number") or "0"))
            except ValueError:
                pass
    return (max(nums) if nums else 0, len(parts), names)


def _score(parts: list[tuple[str, str]], measure_count: int, start: int = 1) -> str:
    part_list = []
    bodies = []
    for pid, name in parts:
        part_list.append(f'<score-part id="{pid}"><part-name>{name}</part-name></score-part>')
        measures = []
        for i in range(measure_count):
            n = start + i
            implicit = ' implicit="yes"' if i == 0 and start == 1 else ""
            measures.append(
                f'<measure number="{n}"{implicit}>'
                "<attributes><divisions>1</divisions>"
                "<time><beats>4</beats><beat-type>4</beat-type></time>"
                "</attributes>"
                f"<note><pitch><step>C</step><octave>4</octave></pitch>"
                f"<duration>4</duration><type>whole</type></note>"
                "</measure>"
            )
        bodies.append(f'<part id="{pid}">{"".join(measures)}</part>')
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<score-partwise version="4.0">'
        f'<part-list>{"".join(part_list)}</part-list>'
        f'{"".join(bodies)}'
        "</score-partwise>"
    )


def test_group_and_match() -> None:
    files = [
        Path("/tmp/clean_score_only.mvt2.mxl"),
        Path("/tmp/clean_score_only.mvt1.mxl"),
        Path("/tmp/other.mxl"),
    ]
    groups = group_movement_paths(files)
    assert len(groups) == 1
    assert [p.name for p in groups[0]] == ["clean_score_only.mvt1.mxl", "clean_score_only.mvt2.mxl"]

    dest = [
        {"id": "P1", "name": "A.", "piano": False},
        {"id": "P2", "name": "Voice", "piano": False},
        {"id": "P3", "name": "Pn'o.", "piano": True},
        {"id": "P4", "name": "Piano", "piano": True},
    ]
    src = [
        {"id": "P1", "name": "Voice", "piano": False},
        {"id": "P2", "name": "Voice", "piano": False},
        {"id": "P3", "name": "Piano", "piano": True},
    ]
    mapping, unmatched_src, unmatched_dest = match_parts(dest, src)
    assert mapping["P3"] == "P4"
    assert mapping["P1"] == "P1"
    assert mapping["P2"] == "P2"
    assert not unmatched_src
    assert [d["id"] for d in unmatched_dest] == ["P3"]


def test_merge_same_parts(tmp: Path) -> None:
    a = tmp / "piece.mvt1.mxl"
    b = tmp / "piece.mvt2.mxl"
    _write_mxl(a, _score([("P1", "S"), ("P2", "Piano")], 3))
    _write_mxl(b, _score([("P1", "S"), ("P2", "Piano")], 2))
    out = tmp / "piece.mxl"
    info = merge_mxl_files([a, b], out)
    mx, nparts, _ = _read_max_measure(out)
    assert info["maxMeasure"] == 5
    assert mx == 5
    assert nparts == 2
    with zipfile.ZipFile(out) as z:
        name = next(n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper())
        xml = z.read(name).decode("utf-8")
    assert xml.count('new-page="yes"') >= 1
    assert "implicit" not in xml.split('<measure number="4"', 1)[1].split("</measure>", 1)[0]


def test_merge_uneven_parts(tmp: Path) -> None:
    a = tmp / "satb.mvt1.mxl"
    b = tmp / "satb.mvt2.mxl"
    _write_mxl(a, _score([("P1", "Voice"), ("P2", "Voice"), ("P3", "Piano")], 2))
    _write_mxl(b, _score([("P1", "Voice"), ("P2", "Piano")], 3))
    out = tmp / "satb.mxl"
    merge_mxl_files([a, b], out)
    mx, nparts, _ = _read_max_measure(out)
    assert mx == 5
    assert nparts == 3
    root = ET.parse(io.BytesIO(_xml_bytes(out))).getroot()
    p1 = next(el for el in root if el.tag.rsplit("}", 1)[-1] == "part" and el.get("id") == "P1")
    p2 = next(el for el in root if el.tag.rsplit("}", 1)[-1] == "part" and el.get("id") == "P2")
    assert len([m for m in p1 if m.tag.rsplit("}", 1)[-1] == "measure"]) == 5
    assert len([m for m in p2 if m.tag.rsplit("}", 1)[-1] == "measure"]) == 5


def _xml_bytes(path: Path) -> bytes:
    with zipfile.ZipFile(path) as z:
        name = next(n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper())
        return z.read(name)


def test_path_list_replaces_mvt_with_merged(tmp: Path) -> None:
    a = tmp / "book.mvt1.mxl"
    b = tmp / "book.mvt2.mxl"
    extra = tmp / "unrelated.mxl"
    _write_mxl(a, _score([("P1", "Voice")], 4))
    _write_mxl(b, _score([("P1", "Voice")], 6))
    _write_mxl(extra, _score([("P1", "Solo")], 1))
    result = merge_path_list([a, b, extra])
    assert result["ok"] is True
    outs = [Path(p).name for p in result["outputs"]]
    assert "book.mxl" in outs
    assert "book.mvt1.mxl" not in outs
    assert "unrelated.mxl" in outs
    mx, _, _ = _read_max_measure(tmp / "book.mxl")
    assert mx == 10


def test_real_inyeon_mvt_files() -> None:
    src = Path(r"C:\Users\jjhan\AppData\Local\Temp\pdf2musicxml-inyeon-audiveris\out-all")
    m1 = src / "clean_score_only.mvt1.mxl"
    m2 = src / "clean_score_only.mvt2.mxl"
    if not m1.is_file() or not m2.is_file():
        print("skip real inyeon mvt files (not present)")
        return
    import tempfile

    td = Path(tempfile.mkdtemp(prefix="mvt-merge-"))
    a = td / "clean_score_only.mvt1.mxl"
    b = td / "clean_score_only.mvt2.mxl"
    a.write_bytes(m1.read_bytes())
    b.write_bytes(m2.read_bytes())
    info = merge_mxl_files([a, b], td / "clean_score_only.mxl")
    mx, nparts, _ = _read_max_measure(td / "clean_score_only.mxl")
    assert mx == 79, (mx, info)
    assert nparts >= 5
    print("real inyeon merge", info)


def main() -> int:
    import tempfile

    test_group_and_match()
    td = Path(tempfile.mkdtemp(prefix="mvt-unit-"))
    test_merge_same_parts(td)
    test_merge_uneven_parts(td)
    test_path_list_replaces_mvt_with_merged(td)
    test_real_inyeon_mvt_files()
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

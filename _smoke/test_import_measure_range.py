"""Measure range copy from import-work-equivalent prepared MXL."""
from __future__ import annotations

import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import (  # noqa: E402
    copy_measure_range_from_prepared_mxl,
    list_note_elements,
    load_mxl_root,
)

ZIP = ROOT / "omr-work-7646fc6e.zip"


def measure_xml(root: ET.Element, pid: str, mn: int) -> str:
    p = next(x for x in root.findall(".//{*}part") if x.get("id") == pid)
    m = next(x for x in p.findall("{*}measure") if int(x.get("number") or 0) == mn)
    return ET.tostring(m, encoding="unicode")


def main() -> None:
    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        with zipfile.ZipFile(ZIP) as z:
            raw_bytes = z.read("audiveris_raw.mxl")
            review_bytes = z.read("review.mxl")

        review_mxl = td_path / "review.mxl"
        review_mxl.write_bytes(review_bytes)
        dst = td_path / "dst.mxl"
        dst.write_bytes(raw_bytes)

        result = copy_measure_range_from_prepared_mxl(dst, review_mxl, 33, 35)
        assert result["sourceScore"] == "import-work-sync"
        assert result["measuresCopied"] >= 15, result

        _, _, review_root = load_mxl_root(review_mxl)
        _, _, dst_root = load_mxl_root(dst)
        for pid in ("P4", "P5"):
            assert measure_xml(review_root, pid, 33) == measure_xml(dst_root, pid, 33), pid

        p4 = next(x for x in dst_root.findall(".//{*}part") if x.get("id") == "P4")
        m33 = next(x for x in p4.findall("{*}measure") if x.get("number") == "33")
        assert len(list_note_elements(m33, "")) == 12
        print("OK prepared-source range copy", result)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Audit measure-numbering strip across omr-work-*.zip (general Audiveris export)."""
from __future__ import annotations

import io
import os
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
os.environ["AUDIVERIS_MXL_RHYTHM_FIX"] = "off"

from fix_audiveris_mxl import fix_score_xml  # noqa: E402


def _count_measure_numbering(xml: bytes) -> int:
    return xml.decode("utf-8", errors="replace").count("<measure-numbering>")


def _load_score_xml(zpath: Path) -> bytes | None:
    with zipfile.ZipFile(zpath) as zf:
        for member in ("audiveris_raw.mxl", "review.mxl", "omr_hitl_baseline.mxl"):
            if member not in zf.namelist():
                continue
            with zipfile.ZipFile(io.BytesIO(zf.read(member))) as inner:
                xml_name = next(
                    n for n in inner.namelist() if n.endswith(".xml") and "META" not in n.upper()
                )
                return inner.read(xml_name)
    return None


def main() -> None:
    zips = sorted(ROOT.glob("omr-work-*.zip"))
    if not zips:
        print("skip — no omr-work-*.zip in repo root")
        return

    rows: list[tuple[str, int, int]] = []
    for zp in zips:
        raw = _load_score_xml(zp)
        if raw is None:
            continue
        before = _count_measure_numbering(raw)
        if before == 0:
            continue
        fixed, stats = fix_score_xml(raw)
        after = _count_measure_numbering(fixed)
        removed = stats.get("measure_numbering_removed", 0)
        if after != 0 or removed != before:
            raise SystemExit(f"FAIL {zp.name}: before={before} after={after} removed={removed}")
        rows.append((zp.name, before, removed))

    print(f"ok - {len(zips)} zip(s), {len(rows)} with measure-numbering stripped")
    for name, before, removed in rows:
        print(f"  {name}: {before} -> 0")


if __name__ == "__main__":
    main()

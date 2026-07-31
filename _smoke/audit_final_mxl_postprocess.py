#!/usr/bin/env python3
"""Quick generality check: final-MXL postprocess across omr-work zips."""
from __future__ import annotations

import io
import os
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
os.environ["AUDIVERIS_MXL_RHYTHM_FIX"] = "off"

from fix_audiveris_mxl import fix_mxl_file, mxl_ns_uri  # noqa: E402
from omr_hitl_lib import normalize_rest_durations_file  # noqa: E402


def local(t: str) -> str:
    return t.split("}")[-1] if "}" in t else t


def load_root(data: bytes) -> ET.Element:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        name = next(n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper())
        return ET.fromstring(z.read(name))


def count_measure_rest_display_d(root: ET.Element) -> int:
    ns = mxl_ns_uri(root)
    q = lambda t: f"{{{ns}}}{t}" if ns else t
    n = 0
    for note in root.iter():
        if local(note.tag) != "note":
            continue
        rest = note.find(q("rest"))
        if rest is None or rest.get("measure") != "yes":
            continue
        ds = rest.find(q("display-step"))
        if ds is not None and (ds.text or "").strip().upper() == "D":
            n += 1
    return n


def count_f_clef_only_key_measures(root: ET.Element) -> int:
    parts = root.findall(".//{*}part")
    nums = {
        int(m.get("number") or 0)
        for p in parts
        for m in p
        if local(m.tag) == "measure"
    }
    bad = 0
    for mnum in nums:
        has_key_change = False
        for p in parts:
            meas = next((m for m in p if local(m.tag) == "measure" and int(m.get("number") or 0) == mnum), None)
            if meas is None:
                continue
            for attr in meas:
                if local(attr.tag) != "attributes":
                    continue
                if attr.find(".//{*}key") is not None:
                    has_key_change = True
        if not has_key_change:
            continue
        for p in parts:
            meas = next((m for m in p if local(m.tag) == "measure" and int(m.get("number") or 0) == mnum), None)
            if meas is None:
                continue
            pid = p.get("id") or "?"
            if pid.startswith("P") and len(pid) <= 3 and pid[1:].isdigit() and int(pid[1:]) >= 4:
                continue  # skip piano-ish part ids only when 2-staff check below
            staves = 1
            for attr in meas:
                if local(attr.tag) != "attributes":
                    continue
                st = attr.find(".//{*}staves")
                if st is not None and st.text and st.text.isdigit():
                    staves = int(st.text)
            if staves >= 2:
                continue
            f_only = False
            has_key = False
            for attr in meas:
                if local(attr.tag) != "attributes":
                    continue
                if attr.find(".//{*}key") is not None:
                    has_key = True
                for clef in attr:
                    if local(clef.tag) == "clef":
                        sign = clef.find(".//{*}sign")
                        if sign is not None and (sign.text or "").strip().upper() == "F":
                            f_only = True
            if f_only and not has_key:
                bad += 1
                break
    return bad


def process_zip(zpath: Path) -> dict:
    with zipfile.ZipFile(zpath) as z:
        raw_name = next(
            (n for n in ("audiveris_raw.mxl", "review.mxl", "omr_hitl_baseline.mxl") if n in z.namelist()),
            None,
        )
        if not raw_name:
            return {"skip": True}
        raw = z.read(raw_name)
    root = load_root(raw)
    before_d = count_measure_rest_display_d(root)
    before_fc = count_f_clef_only_key_measures(root)
    import tempfile

    fd, tmp = tempfile.mkstemp(suffix=".mxl")
    os.close(fd)
    try:
        Path(tmp).write_bytes(raw)
        normalize_rest_durations_file(Path(tmp))
        fix_mxl_file(Path(tmp), Path(tmp))
        fixed = load_root(Path(tmp).read_bytes())
    finally:
        os.unlink(tmp)
    after_d = count_measure_rest_display_d(fixed)
    after_fc = count_f_clef_only_key_measures(fixed)
    return {
        "skip": False,
        "raw": raw_name,
        "rest_d_before": before_d,
        "rest_d_after": after_d,
        "fclef_before": before_fc,
        "fclef_after": after_fc,
    }


def main() -> int:
    zips = sorted(ROOT.glob("omr-work-*.zip"))
    if not zips:
        print("no omr-work-*.zip")
        return 1
    print(f"{'zip':40} {'raw':18} {'D-rest':12} {'F-clef-only':12}")
    for zpath in zips:
        r = process_zip(zpath)
        if r.get("skip"):
            print(f"{zpath.name:40} (no mxl)")
            continue
        print(
            f"{zpath.name:40} {r['raw']:18} "
            f"{r['rest_d_before']:>3}->{r['rest_d_after']:<3} "
            f"{r['fclef_before']:>3}->{r['fclef_after']:<3}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

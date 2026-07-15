#!/usr/bin/env python3
"""Verify key-change / F-clef misread repair across omr-work zips."""
from __future__ import annotations

import io
import os
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
os.environ["AUDIVERIS_MXL_RHYTHM_FIX"] = "off"

from fix_audiveris_mxl import (  # noqa: E402
    fix_mxl_file,
    mxl_ns_uri,
    _median_pitch_on_staff_in_measure,
)


def local(t: str) -> str:
    return t.split("}")[-1] if "}" in t else t


def load_mxl_bytes(zpath: Path, member: str = "audiveris_raw.mxl") -> bytes:
    with zipfile.ZipFile(zpath) as z:
        for name in (member, "review.mxl", "omr_hitl_baseline.mxl"):
            if name in z.namelist():
                return z.read(name)
    raise KeyError(f"No MXL in {zpath}")


def load_root(data: bytes) -> ET.Element:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        name = next(n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper())
        return ET.fromstring(z.read(name))


def measure_attrs(root: ET.Element, mnum: int) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for part in root.findall(".//{*}part"):
        pid = part.get("id") or "?"
        meas = next(
            (m for m in part if local(m.tag) == "measure" and int(m.get("number") or 0) == mnum),
            None,
        )
        if meas is None:
            continue
        bits: list[str] = []
        for attr in meas:
            if local(attr.tag) != "attributes":
                continue
            for key in attr:
                if local(key.tag) == "key":
                    f = next((c for c in key if local(c.tag) == "fifths"), None)
                    num = key.get("number")
                    bits.append(f"key{f' n={num}' if num else ''}={f.text if f is not None else '?'}")
            for clef in attr:
                if local(clef.tag) == "clef":
                    s = next((c for c in clef if local(c.tag) == "sign"), None)
                    num = clef.get("number")
                    bits.append(f"clef{f' n={num}' if num else ''}={s.text if s is not None else '?'}")
        out[pid] = bits
    return out


def count_f_clef_only_at_key_change_measures(root: ET.Element) -> int:
    """Measures where any part declares key change but another has F clef without key."""
    parts = root.findall(".//{*}part")
    measure_nums = {
        int(m.get("number") or 0)
        for p in parts
        for m in p
        if local(m.tag) == "measure"
    }
    bad = 0
    for mnum in measure_nums:
        declared: list[int] = []
        f_only_parts: list[str] = []
        for part in parts:
            pid = part.get("id") or "?"
            meas = next(
                (m for m in part if local(m.tag) == "measure" and int(m.get("number") or 0) == mnum),
                None,
            )
            if meas is None:
                continue
            prev = 0
            for pm in part:
                if local(pm.tag) != "measure":
                    continue
                mn = int(pm.get("number") or 0)
                if mn >= mnum:
                    break
                for attr in pm:
                    if local(attr.tag) != "attributes":
                        continue
                    for key in attr:
                        if local(key.tag) == "key":
                            f = next((c for c in key if local(c.tag) == "fifths"), None)
                            if f is not None and (f.text or "").strip().lstrip("-").isdigit():
                                prev = int(f.text.strip())
            has_key_change = False
            has_f_only = False
            for attr in meas:
                if local(attr.tag) != "attributes":
                    continue
                has_key = any(local(k.tag) == "key" for k in attr)
                for key in attr:
                    if local(key.tag) == "key":
                        f = next((c for c in key if local(c.tag) == "fifths"), None)
                        if f is not None and (f.text or "").strip().lstrip("-").isdigit():
                            nf = int(f.text.strip())
                            if nf != prev:
                                declared.append(nf)
                                has_key_change = True
                for clef in attr:
                    if local(clef.tag) == "clef":
                        s = next((c for c in clef if local(c.tag) == "sign"), None)
                        if s is not None and (s.text or "").strip() == "F" and not has_key:
                            has_f_only = True
            if has_f_only and not has_key_change:
                f_only_parts.append(pid)
        if declared and f_only_parts:
            counter = Counter(declared)
            top = counter.most_common()
            if len(top) == 1 or (len(top) > 1 and top[0][1] > top[1][1]):
                bad += 1
    return bad


def assert_measure_profile(
    fix_root: ET.Element,
    mnum: int,
    *,
    zip_name: str,
    failures: list[str],
) -> None:
    """Known regression zips: m33 key-only, m34 no courtesy G on single-staff parts."""
    prof33 = measure_attrs(fix_root, 33)
    prof34 = measure_attrs(fix_root, 34)
    for pid in ("P1", "P2", "P3"):
        a33 = prof33.get(pid, [])
        if not any(a.startswith("key") and "=1" in a for a in a33):
            failures.append(f"{zip_name}: {pid} m33 missing key fifths=1: {a33}")
        if any("clef" in a and "F" in a for a in a33):
            failures.append(f"{zip_name}: {pid} m33 still has F clef: {a33}")
        a34 = prof34.get(pid, [])
        if any("clef" in a and "G" in a for a in a34):
            failures.append(f"{zip_name}: {pid} m34 still has courtesy G clef: {a34}")
    p4_33 = prof33.get("P4", [])
    if any("clef" in a and "F" in a for a in p4_33):
        failures.append(f"{zip_name}: P4 m33 still has F clef: {p4_33}")
    if not any(a.startswith("key") and "=1" in a for a in p4_33):
        failures.append(f"{zip_name}: P4 m33 missing key fifths=1: {p4_33}")
    p4_34 = prof34.get("P4", [])
    if any("clef" in a and "G" in a for a in p4_34):
        failures.append(f"{zip_name}: P4 m34 still has courtesy G clef: {p4_34}")

    fam_ns = mxl_ns_uri(fix_root)
    for pid, expect_min in (("P1", 60), ("P2", 60), ("P3", 60)):
        p = next(x for x in fix_root.findall(".//{*}part") if x.get("id") == pid)
        m33 = next(
            x for x in p if local(x.tag) == "measure" and int(x.get("number") or 0) == 33
        )
        med = _median_pitch_on_staff_in_measure(m33, fam_ns, "1")
        if med is not None and med < expect_min:
            failures.append(f"{zip_name}: {pid} m33 median midi {med} < {expect_min}")


def main() -> int:
    regression_zips = {
        "omr-work-1b1b34df.zip",
        "omr-work-a760c5c1.zip",
        "omr-work-6cbf1add.zip",
    }
    zips = sorted(set(ROOT.glob("omr-work-*.zip")) | set((ROOT / "너에게 난 나에게 넌").glob("omr-work-*.zip")))
    if not zips:
        print("No omr-work zips found")
        return 1

    failures: list[str] = []
    for zpath in zips:
        try:
            raw = load_mxl_bytes(zpath)
        except KeyError:
            continue
        fd, raw_tmp = tempfile.mkstemp(suffix=".mxl")
        os.close(fd)
        fd2, tmp = tempfile.mkstemp(suffix=".mxl")
        os.close(fd2)
        try:
            Path(raw_tmp).write_bytes(raw)
            stats = fix_mxl_file(raw_tmp, tmp)
            fixed = Path(tmp).read_bytes()
        finally:
            for p in (raw_tmp, tmp):
                if os.path.exists(p):
                    os.unlink(p)

        raw_root = load_root(raw)
        fix_root = load_root(fixed)
        raw_bad = count_f_clef_only_at_key_change_measures(raw_root)
        fix_bad = count_f_clef_only_at_key_change_measures(fix_root)
        repaired = stats.get("key_change_clef_misread_fixed", 0)

        status = "OK"
        if fix_bad > raw_bad:
            status = "REGRESSION"
            failures.append(f"{zpath.name}: fix_bad={fix_bad} > raw_bad={raw_bad}")
        elif zpath.name in regression_zips:
            assert_measure_profile(fix_root, 33, zip_name=zpath.name, failures=failures)
            if zpath.name == "omr-work-a760c5c1.zip" and repaired < 10:
                status = "FAIL"
                failures.append(f"{zpath.name}: expected repaired>=10, got {repaired}")
            elif zpath.name == "omr-work-1b1b34df.zip" and repaired < 10:
                status = "FAIL"
                failures.append(f"{zpath.name}: expected repaired>=10, got {repaired}")

        print(
            f"[{status}] {zpath.name}: raw_bad={raw_bad} fix_bad={fix_bad} "
            f"repaired={repaired}"
        )

    if failures:
        print("\nFailures:")
        for f in failures:
            print(" ", f)
        return 1
    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

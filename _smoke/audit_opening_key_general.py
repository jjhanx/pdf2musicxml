#!/usr/bin/env python3
"""Verify opening-key fix applies across omr-work zips with mid-piece key changes."""
from __future__ import annotations

import io
import os
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
os.environ["AUDIVERIS_MXL_RHYTHM_FIX"] = "off"

from fix_audiveris_mxl import fix_mxl_file  # noqa: E402


def local(t: str) -> str:
    return t.split("}")[-1] if "}" in t else t


def load_root(data: bytes) -> ET.Element:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        name = next(n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper())
        return ET.fromstring(z.read(name))


def part_key_profile(part: ET.Element) -> dict:
    pid = part.get("id") or "?"
    keys: list[tuple[int, int]] = []
    m1_f: int | None = None
    for meas in part:
        if local(meas.tag) != "measure":
            continue
        mn = int(meas.get("number") or 0)
        for attr in meas:
            if local(attr.tag) != "attributes":
                continue
            for key in attr:
                if local(key.tag) != "key":
                    continue
                f = next((c for c in key if local(c.tag) == "fifths"), None)
                if f is None or not (f.text or "").strip().lstrip("-").isdigit():
                    continue
                fv = int(f.text.strip())
                keys.append((mn, fv))
                if mn == 1:
                    m1_f = fv
    first_m = keys[0][0] if keys else None
    mid_no_m1 = first_m is not None and first_m > 1 and m1_f is None
    return {
        "pid": pid,
        "m1_fifths": m1_f,
        "first_key_m": first_m,
        "mid_change_no_m1": mid_no_m1,
        "keys": keys,
    }


def verify_fixed_part(raw: dict, fixed: dict) -> list[str]:
    errs: list[str] = []
    pid = raw["pid"]
    if not raw["mid_change_no_m1"]:
        return errs
    if fixed["m1_fifths"] != 0:
        errs.append(f"{pid}: expected m1 fifths=0, got {fixed['m1_fifths']}")
    # All raw keys at m>=2 must remain with same fifths
    raw_later = {(m, f) for m, f in raw["keys"] if m > 1}
    fixed_later = {(m, f) for m, f in fixed["keys"] if m > 1}
    if raw_later - fixed_later:
        errs.append(f"{pid}: lost keys {sorted(raw_later - fixed_later)[:5]}")
    if fixed_later - raw_later:
        errs.append(f"{pid}: added keys {sorted(fixed_later - raw_later)[:5]}")
    return errs


def main() -> int:
    zips = sorted(ROOT.glob("omr-work-*.zip"))
    mid_scores: list[str] = []
    all_ok = True

    for zpath in zips:
        with zipfile.ZipFile(zpath) as z:
            if "audiveris_raw.mxl" not in z.namelist():
                continue
            raw_bytes = z.read("audiveris_raw.mxl")

        td = Path(tempfile.mkdtemp())
        raw_p, fixed_p = td / "raw.mxl", td / "fixed.mxl"
        raw_p.write_bytes(raw_bytes)
        stats = fix_mxl_file(raw_p, fixed_p)

        raw_root = load_root(raw_bytes)
        fix_root = load_root(fixed_p.read_bytes())

        raw_parts = [part_key_profile(p) for p in raw_root if local(p.tag) == "part"]
        fix_parts = {part_key_profile(p)["pid"]: part_key_profile(p) for p in fix_root if local(p.tag) == "part"}

        mid_parts = [p for p in raw_parts if p["mid_change_no_m1"]]
        if not mid_parts:
            continue

        mid_scores.append(zpath.name)
        errs: list[str] = []
        for rp in mid_parts:
            fp = fix_parts.get(rp["pid"])
            if fp is None:
                errs.append(f"{rp['pid']}: missing in fixed")
                continue
            errs.extend(verify_fixed_part(rp, fp))

        n_mid = len(mid_parts)
        explicit = stats.get("opening_key_explicit", 0)
        status = "OK" if not errs else "FAIL"
        if errs:
            all_ok = False
        print(f"[{status}] {zpath.name}: mid-change parts={n_mid}, opening_key_explicit={explicit}")
        for rp in mid_parts[:4]:
            fp = fix_parts[rp["pid"]]
            print(
                f"  {rp['pid']}: first key m{rp['first_key_m']} fifths={rp['keys'][0][1] if rp['keys'] else '?'} "
                f"-> m1={fp['m1_fifths']}"
            )
        for e in errs[:6]:
            print(f"  ! {e}")
        print()

    # Synthetic edge cases
    print("=== synthetic cases ===")

    def synth_xml(m1_key: str | None, m5_key: str | None) -> bytes:
        m1_attr = "<attributes><divisions>4</divisions>"
        if m1_key is not None:
            m1_attr += f"<key><fifths>{m1_key}</fifths></key>"
        m1_attr += "<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>"
        m5 = ""
        if m5_key is not None:
            m5 = f'<measure number="5"><attributes><key><fifths>{m5_key}</fifths></key></attributes><note><rest measure="yes"/><duration>16</duration></note></measure>'
        xml = f"""<?xml version="1.0"?>
<score-partwise version="3.1"><part-list><score-part id="P1"><part-name>X</part-name></score-part></part-list>
<part id="P1"><measure number="1">{m1_attr}<note><rest measure="yes"/><duration>16</duration></note></measure>
{m5}</part></score-partwise>"""
        return xml.encode()

    def synth_pickup(m0_key: str) -> bytes:
        xml = f"""<?xml version="1.0"?>
<score-partwise version="3.1"><part-list><score-part id="P1"><part-name>X</part-name></score-part></part-list>
<part id="P1">
<measure number="0"><attributes><key><fifths>{m0_key}</fifths></key><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><rest measure="yes"/><duration>8</duration></note></measure>
<measure number="1"><attributes><divisions>4</divisions></attributes><note><rest measure="yes"/><duration>16</duration></note></measure>
<measure number="17"><attributes><key><fifths>4</fifths></key></attributes><note><rest measure="yes"/><duration>16</duration></note></measure>
</part></score-partwise>"""
        return xml.encode()

    cases = [
        ("no m1, mod m5 +2", synth_xml(None, "2"), True, 0),
        ("m1 already 0, mod m5", synth_xml("0", "2"), False, 0),
        ("m1 starts 3#, no add", synth_xml("3", "0"), False, None),
        ("pickup m0 1 sharp, mod m17 skip m1", synth_pickup("1"), False, None),
    ]
    for label, xml, expect_add, expect_m1 in cases:
        td = Path(tempfile.mkdtemp())
        # wrap as mxl
        mxl = td / "t.mxl"
        with zipfile.ZipFile(mxl, "w") as z:
            z.writestr(
                "META-INF/container.xml",
                '<?xml version="1.0"?><container><rootfiles><rootfile full-path="s.xml"/></rootfiles></container>',
            )
            z.writestr("s.xml", xml)
        out = td / "out.mxl"
        st = fix_mxl_file(mxl, out)
        prof = part_key_profile(next(p for p in load_root(out.read_bytes()) if local(p.tag) == "part"))
        ok = True
        if expect_add and st.get("opening_key_explicit", 0) != 1:
            ok = False
        if not expect_add and st.get("opening_key_explicit", 0) != 0:
            ok = False
        if expect_m1 is not None and prof["m1_fifths"] != expect_m1:
            ok = False
        if expect_m1 is None and prof["m1_fifths"] != 3 and "pickup" not in label:
            ok = False
        if "pickup" in label and prof["m1_fifths"] is not None:
            ok = False
        print(f"  [{'OK' if ok else 'FAIL'}] {label}: m1={prof['m1_fifths']} explicit={st.get('opening_key_explicit')}")
        all_ok = all_ok and ok

    print()
    print(f"Scores with mid-piece key change (raw m1 omitted): {len(mid_scores)}")
    for name in mid_scores:
        print(f"  - {name}")
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

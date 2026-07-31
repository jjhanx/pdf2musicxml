#!/usr/bin/env python3
"""Audit preview-only opening key fix (mirrors ensureExplicitOpeningKeySignaturesForOsmd)."""
from __future__ import annotations

import io
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def local(t: str) -> str:
    return t.split("}")[-1] if "}" in t else t


def q(ns: str, tag: str) -> str:
    return f"{{{ns}}}{tag}" if ns else tag


def load_root_from_mxl(data: bytes) -> ET.Element:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        name = next(n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper())
        return ET.fromstring(z.read(name))


def key_fifths_in_measure(measure: ET.Element, ns: str) -> int | None:
    for attr in measure.findall(q(ns, "attributes")):
        key = attr.find(q(ns, "key"))
        if key is None:
            continue
        f = key.find(q(ns, "fifths"))
        if f is None or not (f.text or "").strip().lstrip("-").isdigit():
            continue
        return int(f.text.strip())
    return None


def ensure_explicit_opening_key_preview(root: ET.Element) -> tuple[ET.Element, int]:
    """Python mirror of TS ensureExplicitOpeningKeySignaturesForOsmd."""
    ns = root.tag.split("}")[0].strip("{") if "}" in root.tag else ""
    added = 0
    for part in root.findall(q(ns, "part")):
        measures = [m for m in part.findall(q(ns, "measure"))]
        first_meas = next((m for m in measures if int(m.get("number") or 0) == 1), None)
        if first_meas is None:
            continue
        attrs = first_meas.find(q(ns, "attributes"))
        if attrs is not None and attrs.find(q(ns, "key")) is not None:
            continue

        def measure_num(m: ET.Element) -> int:
            return int(m.get("number") or 0)

        has_pickup_key = any(
            measure_num(m) < 1 and key_fifths_in_measure(m, ns) is not None for m in measures
        )
        if has_pickup_key:
            continue

        first_key_m: int | None = None
        for m in sorted(measures, key=measure_num):
            f = key_fifths_in_measure(m, ns)
            if f is not None:
                first_key_m = measure_num(m)
                break
        if first_key_m is None or first_key_m < 2:
            continue

        if attrs is None:
            attrs = ET.Element(q(ns, "attributes"))
            insert_idx = len(first_meas)
            for i, child in enumerate(list(first_meas)):
                if local(child.tag) in ("note", "backup", "forward", "direction"):
                    insert_idx = i
                    break
            first_meas.insert(insert_idx, attrs)
        key_el = ET.SubElement(attrs, q(ns, "key"))
        ET.SubElement(key_el, q(ns, "fifths")).text = "0"
        added += 1
    return root, added


def part_profile(part: ET.Element, ns: str) -> dict:
    pid = part.get("id") or "?"
    m1_f = None
    keys: list[tuple[int, int]] = []
    for meas in part.findall(q(ns, "measure")):
        mn = int(meas.get("number") or 0)
        f = key_fifths_in_measure(meas, ns)
        if f is not None:
            keys.append((mn, f))
            if mn == 1:
                m1_f = f
    first_m = keys[0][0] if keys else None
    return {
        "pid": pid,
        "m1_fifths": m1_f,
        "first_key_m": first_m,
        "needs_preview_fix": first_m is not None and first_m >= 2 and m1_f is None,
        "keys": keys,
    }


def main() -> int:
    zips = sorted(ROOT.glob("omr-work-*.zip"))
    if not zips:
        print("no zips")
        return 1

    all_ok = True
    print(f"{'zip':42} {'parts':6} {'inject':7} {'note'}")
    for zpath in zips:
        with zipfile.ZipFile(zpath) as z:
            if "audiveris_raw.mxl" not in z.namelist():
                continue
            raw = load_root_from_mxl(z.read("audiveris_raw.mxl"))
        ns = raw.tag.split("}")[0].strip("{") if "}" in raw.tag else ""
        raw_profiles = [part_profile(p, ns) for p in raw.findall(q(ns, "part"))]
        need = [p for p in raw_profiles if p["needs_preview_fix"]]

        import copy

        fixed = copy.deepcopy(raw)
        _, injected = ensure_explicit_opening_key_preview(fixed)
        fix_profiles = {part_profile(p, ns)["pid"]: part_profile(p, ns) for p in fixed.findall(q(ns, "part"))}

        errs: list[str] = []
        for rp in need:
            fp = fix_profiles.get(rp["pid"])
            if fp is None:
                errs.append(f"{rp['pid']} missing")
                continue
            if fp["m1_fifths"] != 0:
                errs.append(f"{rp['pid']} m1={fp['m1_fifths']} expected 0")
            raw_later = {(m, f) for m, f in rp["keys"] if m > 1}
            fix_later = {(m, f) for m, f in fp["keys"] if m > 1}
            if raw_later != fix_later:
                errs.append(f"{rp['pid']} later keys changed")

        # Parts that should NOT be touched
        for rp in raw_profiles:
            if rp["needs_preview_fix"]:
                continue
            fp = fix_profiles[rp["pid"]]
            if rp["m1_fifths"] != fp["m1_fifths"]:
                errs.append(f"{rp['pid']} should not change m1 {rp['m1_fifths']}->{fp['m1_fifths']}")

        status = "OK" if not errs and injected == len(need) else "FAIL"
        if errs:
            all_ok = False
        note = ""
        if need and not errs:
            first_ms = sorted({p["first_key_m"] for p in need})
            note = f"first key m{first_ms[0]}" + (f"+…" if len(first_ms) > 1 else "")
        print(f"[{status}] {zpath.name:42} {len(need):6} {injected:7} {note}")
        for e in errs[:4]:
            print(f"  ! {e}")

    print()
    print("Generality rules (preview-only, saved MXL unchanged):")
    print("  INJECT m1 fifths=0 when: m1 no key, no pickup key, first key at m>=2")
    print("  SKIP when: m1 has key, pickup m0 has key, or no later key change")
    print("  NEVER modify keys at m>=2")
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

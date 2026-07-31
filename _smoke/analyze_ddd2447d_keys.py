#!/usr/bin/env python3
"""Analyze key/accidental pattern in ddd2447d."""
import io
import os
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ZIP = ROOT / "omr-work-ddd2447d.zip"


def extract(data: bytes) -> bytes:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper()][0])


def local(tag: str) -> str:
    return tag.split("}")[-1] if "}" in tag else tag


def analyze(data: bytes, label: str) -> None:
    root = ET.fromstring(extract(data))
    fifths: list[int] = []
    alters = Counter()
    accs = Counter()
    key_events: list[tuple[str, str, int | None, dict]] = []
    for part in root:
        if local(part.tag) != "part":
            continue
        pid = part.get("id")
        for meas in part:
            if local(meas.tag) != "measure":
                continue
            mnum = meas.get("number")
            pr = meas.find("{*}print")
            pa = dict(pr.attrib) if pr is not None else {}
            for attr in meas:
                if local(attr.tag) != "attributes":
                    continue
                for key in attr:
                    if local(key.tag) != "key":
                        continue
                    f = next((c for c in key if local(c.tag) == "fifths"), None)
                    fv = int(f.text) if f is not None and f.text else None
                    if fv is not None:
                        fifths.append(fv)
                    key_events.append((pid, mnum, fv, pa))
            for n in meas.findall(".//{*}note"):
                p = n.find("{*}pitch")
                if p is None:
                    continue
                step = p.find("{*}step")
                alter = p.find("{*}alter")
                acc = n.find("{*}accidental")
                if alter is not None and alter.text:
                    alters[int(alter.text)] += 1
                if acc is not None and acc.text:
                    accs[acc.text.strip()] += 1
                if int(mnum or 0) >= 15 and int(mnum or 0) <= 22:
                    st = step.text if step is not None else "?"
                    alt = alter.text if alter is not None else ""
                    ac = acc.text if acc is not None else ""
                    if alt or ac:
                        print(f"  {label} {pid} m{mnum} {st} alter={alt} acc={ac}")

    print(f"=== {label} ===")
    print("fifths:", Counter(fifths))
    print("alter tags:", alters)
    print("accidental tags:", accs)
    print("key events (m15-40):")
    for ev in key_events:
        if ev[1] and int(ev[1]) >= 15 and int(ev[1]) <= 40:
            print(f"  {ev[0]} m{ev[1]} fifths={ev[2]} print={ev[3]}")


def main() -> int:
    sys.path.insert(0, str(ROOT / "scripts"))
    os.environ["AUDIVERIS_MXL_RHYTHM_FIX"] = "off"
    from fix_audiveris_mxl import fix_mxl_file  # noqa: E402
    import tempfile

    with zipfile.ZipFile(ZIP) as z:
        raw = z.read("audiveris_raw.mxl")
        review = z.read("review.mxl") if "review.mxl" in z.namelist() else None

    analyze(raw, "audiveris_raw")
    if review:
        analyze(review, "review")
    td = Path(tempfile.mkdtemp())
    raw_path = td / "raw.mxl"
    fixed_path = td / "fixed.mxl"
    raw_path.write_bytes(raw)
    stats = fix_mxl_file(raw_path, fixed_path)
    print("fix stats:", {k: v for k, v in stats.items() if v and ("key" in k or "natural" in k or "accidental" in k)})
    analyze(fixed_path.read_bytes(), "after_fix")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""omr-work-ddd2447d: keep m17 4-sharp key change; drop line-header 1-sharp."""
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

from fix_audiveris_mxl import fix_mxl_file  # noqa: E402

ZIP = ROOT / "omr-work-ddd2447d.zip"
if not ZIP.is_file():
    print("skip: omr-work-ddd2447d.zip not in repo root")
    raise SystemExit(0)


def extract_xml(data: bytes) -> bytes:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        name = next(n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper())
        return z.read(name)


def key_events(data: bytes) -> list[tuple[str, str, int]]:
    root = ET.fromstring(extract_xml(data))

    def local(tag: str) -> str:
        return tag.split("}")[-1] if "}" in tag else tag

    out: list[tuple[str, str, int]] = []
    for part in root:
        if local(part.tag) != "part":
            continue
        pid = part.get("id") or ""
        for meas in part:
            if local(meas.tag) != "measure":
                continue
            for attr in meas:
                if local(attr.tag) != "attributes":
                    continue
                for key in attr:
                    if local(key.tag) != "key":
                        continue
                    f = next((c for c in key if local(c.tag) == "fifths"), None)
                    if f is not None and f.text:
                        out.append((pid, meas.get("number") or "", int(f.text)))
    return out


td = Path(tempfile.mkdtemp())
raw = td / "raw.mxl"
fixed = td / "fixed.mxl"
with zipfile.ZipFile(ZIP) as z:
    raw.write_bytes(z.read("audiveris_raw.mxl"))

stats = fix_mxl_file(raw, fixed)
events = key_events(fixed.read_bytes())
fifths = Counter(f for _, _, f in events)

assert fifths == Counter({4: 4}), fifths
assert 1 not in fifths, fifths
assert all(m == "17" and f == 4 for _, m, f in events), events
assert stats.get("line_header_key_removed", 0) == 37, stats
assert stats.get("courtesy_key_removed", 0) == 16, stats
print("OK: m17 4-sharp key kept; fake 1-sharp and courtesy 4-sharp removed")

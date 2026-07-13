"""omr-work-831: same score — m17 4-sharp mod kept, line-header 1-sharp removed."""
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

ZIP = ROOT / "omr-work-8317959f.zip"
if not ZIP.is_file():
    print("skip: omr-work-8317959f.zip not in repo root")
    raise SystemExit(0)


def extract_xml(data: bytes) -> bytes:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        name = next(n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper())
        return z.read(name)


def fifths_counter(data: bytes) -> Counter[int]:
    root = ET.fromstring(extract_xml(data))

    def local(tag: str) -> str:
        return tag.split("}")[-1] if "}" in tag else tag

    out: list[int] = []
    for el in root.iter():
        if local(el.tag) != "key":
            continue
        f = next((c for c in el if local(c.tag) == "fifths"), None)
        if f is not None and f.text:
            out.append(int(f.text))
    return Counter(out)


td = Path(tempfile.mkdtemp())
raw = td / "raw.mxl"
fixed = td / "fixed.mxl"
with zipfile.ZipFile(ZIP) as z:
    raw.write_bytes(z.read("audiveris_raw.mxl"))

stats = fix_mxl_file(raw, fixed)
after = fifths_counter(fixed.read_bytes())

assert after == Counter({4: 4}), after
assert stats.get("line_header_key_removed", 0) == 37, stats
print("OK: m17 4-sharp kept; line-header 1-sharp removed")

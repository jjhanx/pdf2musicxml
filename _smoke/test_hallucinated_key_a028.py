"""omr-work-a028: Audiveris 4-sharp key hallucination strip."""
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

ZIP = ROOT / "omr-work-a028c3b5.zip"
if not ZIP.is_file():
    print("skip: omr-work-a028c3b5.zip not in repo root")
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

before = fifths_counter(raw.read_bytes())
stats = fix_mxl_file(raw, fixed)
after = fifths_counter(fixed.read_bytes())

assert before[4] == 20, before
assert 4 not in after, after
assert stats.get("hallucinated_key_removed", 0) == 20, stats
assert stats.get("spurious_natural_removed", 0) >= 1, stats
print("OK: removed spurious fifths=4 keys and some redundant naturals")

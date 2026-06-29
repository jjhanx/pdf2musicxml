"""Extract XML from test-out MXLs and probe the reported issues."""
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def extract(name: str) -> Path:
    z = zipfile.ZipFile(ROOT / "test-out" / f"{name}.mxl")
    c = z.read("META-INF/container.xml").decode()
    m = re.search(r'full-path="([^"]+)"', c)
    out = ROOT / "_smoke" / f"{name}.xml"
    out.write_bytes(z.read(m.group(1)))
    print(name, "->", out.name, z.namelist())
    return out


if __name__ == "__main__":
    for n in ["clean_score_only", "final_output"]:
        extract(n)

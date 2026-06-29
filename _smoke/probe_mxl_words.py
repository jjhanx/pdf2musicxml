"""Survey words/tuplet attrs in arbitrary MXL files."""
import collections
import io
import re
import sys
import xml.etree.ElementTree as ET
import zipfile


def load_root(path):
    z = zipfile.ZipFile(path)
    c = z.read("META-INF/container.xml").decode()
    m = re.search(r'full-path="([^"]+)"', c)
    root = ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()
    for el in root.iter():
        if el.tag.startswith("{"):
            el.tag = el.tag.split("}", 1)[1]
    return root


for p in sys.argv[1:]:
    root = load_root(p)
    words = collections.Counter((w.text or "").strip() for w in root.iter("words"))
    tup = collections.Counter((t.get("type"), t.get("show-number")) for t in root.iter("tuplet"))
    tmod = sum(1 for _ in root.iter("time-modification"))
    print(p)
    print("  words:", dict(words))
    print("  tuplets:", dict(tup), "time-modifications:", tmod)

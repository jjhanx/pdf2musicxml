#!/usr/bin/env python3
"""inject_ocr opening tempo must not precede <attributes> (OSMD ghost measure)."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")

from inject_ocr import ensure_opening_tempo, findall_ns, mxl_ns_uri  # noqa: E402


def local(tag: str) -> str:
    return tag.split("}")[-1] if "}" in tag else tag


XML = """<score-partwise version="3.1">
<part id="P1">
  <measure number="1">
    <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <note><rest/><duration>4</duration><type>whole</type></note>
  </measure>
</part>
</score-partwise>"""

root = ET.fromstring(XML)
ns = mxl_ns_uri(root)
parts = findall_ns(root, "part", ns)
ensure_opening_tempo(parts, ns, 75.0)

meas = parts[0].find(f".//{{{ns}}}measure" if ns else ".//measure")
tags = [local(c.tag) for c in meas]
print("order:", tags)
assert tags.index("attributes") < tags.index("direction"), tags
print("OK: inject opening tempo after attributes")

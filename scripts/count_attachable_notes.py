#!/usr/bin/env python3
"""
MusicXML(MXL)에서 가사 주입 대상 음표(쉼표/그레이스 제외)를 part/voice별로 카운트합니다.

출력: JSON
{
  "parts": [
    { "partIndex": 1, "id": "P1", "total": 123, "voices": { "1": 100, "2": 23 } },
    ...
  ]
}
"""

from __future__ import annotations

import io
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


def _mxl_root_bytes(mxl_path: str) -> bytes:
    p = Path(mxl_path)
    raw = p.read_bytes()
    # .mxl(압축)인 경우: container.xml로 rootfile 찾기
    if zipfile.is_zipfile(io.BytesIO(raw)):
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            try:
                container = z.read("META-INF/container.xml").decode("utf-8", errors="replace")
                m = re.search(r'full-path="([^"]+)"', container)
                if m:
                    return z.read(m.group(1))
            except KeyError:
                pass
            # fallback: 첫 .xml 파일
            for name in z.namelist():
                if name.lower().endswith(".xml"):
                    return z.read(name)
    return raw


def mxl_ns_uri(root):
    t = root.tag
    if t.startswith("{"):
        return t[1 : t.index("}")]
    return ""


def qname(ns, local):
    return f"{{{ns}}}{local}" if ns else local


def _note_voice(note, ns) -> str:
    v_el = note.find(qname(ns, "voice"))
    if v_el is not None and v_el.text and v_el.text.strip():
        return v_el.text.strip()
    return "1"


def _is_attachable_note(note, ns) -> bool:
    if note.find(qname(ns, "rest")) is not None:
        return False
    if note.find(qname(ns, "grace")) is not None:
        return False
    return True


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: count_attachable_notes.py <score.mxl|score.xml>", file=sys.stderr)
        return 2
    mxl_path = sys.argv[1]
    xml_bytes = _mxl_root_bytes(mxl_path)
    root = ET.parse(io.BytesIO(xml_bytes)).getroot()
    ns = mxl_ns_uri(root)
    parts = root.findall(qname(ns, "part"))
    out_parts = []
    for i, part in enumerate(parts, start=1):
        pid = part.get("id")
        voices: dict[str, int] = {}
        total = 0
        for meas in part.findall(qname(ns, "measure")):
            for note in meas.findall(qname(ns, "note")):
                if not _is_attachable_note(note, ns):
                    continue
                v = _note_voice(note, ns)
                voices[v] = voices.get(v, 0) + 1
                total += 1
        out_parts.append(
            {
                "partIndex": i,
                "id": pid,
                "total": total,
                "voices": voices,
            }
        )
    print(json.dumps({"parts": out_parts}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


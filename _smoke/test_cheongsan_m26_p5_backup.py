#!/usr/bin/env python3
"""Assert P5 m26 has backup after cheongsan patch (prevents m27 OSMD loss)."""
from __future__ import annotations

import re
import shutil
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from apply_score_patches_mxl import patch_mxl_file


def load_mxl(p: Path):
    with zipfile.ZipFile(p) as z:
        c = z.read("META-INF/container.xml").decode()
        rp = re.search(r'full-path="([^"]+)"', c).group(1)
        root = ET.fromstring(z.read(rp))
    ns = root.tag.split("}")[0][1:] if root.tag.startswith("{") else ""
    return root, ns


def q(ns: str, l: str) -> str:
    return f"{{{ns}}}{l}" if ns else l


def local(el: ET.Element) -> str:
    t = el.tag
    return t[t.index("}") + 1 :] if t.startswith("{") else t


def measure_duration(m: ET.Element, ns: str) -> int:
    cur = 0
    total = 0
    for child in m:
        loc = local(child)
        if loc == "forward":
            d = child.find(q(ns, "duration"))
            if d is not None and d.text:
                cur += int(d.text)
        elif loc == "backup":
            d = child.find(q(ns, "duration"))
            if d is not None and d.text:
                cur -= int(d.text)
        elif loc == "note" and child.find(q(ns, "chord")) is None:
            d = child.find(q(ns, "duration"))
            if d is not None and d.text:
                cur += int(d.text)
                total = max(total, cur)
    return max(total, cur)


def write_mxl_xml(mxl: Path, root: ET.Element, ns: str) -> None:
    with zipfile.ZipFile(mxl, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}
    container_xml = files["META-INF/container.xml"].decode()
    match = re.search(r'full-path="([^"]+)"', container_xml)
    root_path = match.group(1) if match else next(n for n in files if n.endswith(".xml"))
    files[root_path] = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    with zipfile.ZipFile(mxl, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, data in files.items():
            zout.writestr(name, data)


def main() -> None:
    src = Path("청산에 살리라 F/_inspect_0ea5/audiveris_raw.mxl")
    if not src.exists():
        print("skip: fixture missing")
        return
    with tempfile.TemporaryDirectory() as td:
        dst = Path(td) / "test.mxl"
        shutil.copy2(src, dst)
        applied = patch_mxl_file(dst)
        root, ns = load_mxl(dst)
        p5 = next(p for p in root.findall(q(ns, "part")) if p.get("id") == "P5")
        m26 = next(m for m in p5.findall(q(ns, "measure")) if m.get("number") == "26")
        dur = measure_duration(m26, ns)
        backups = [c for c in m26 if local(c) == "backup"]
        if dur != 16:
            raise SystemExit(f"P5 m26 duration={dur}, expected 16")
        if len(backups) != 1:
            raise SystemExit(f"P5 m26 backups={len(backups)}, expected 1")
        if applied < 5:
            raise SystemExit(f"too few patches applied: {applied}")

        # Idempotent repair: broken baseline (patched RH+LH without backup)
        broken = Path(td) / "broken.mxl"
        shutil.copy2(dst, broken)
        root_b, ns_b = load_mxl(broken)
        m26b = next(
            m for m in next(p for p in root_b.findall(q(ns_b, "part")) if p.get("id") == "P5").findall(q(ns_b, "measure"))
            if m.get("number") == "26"
        )
        for b in list(m26b):
            if local(b) == "backup":
                m26b.remove(b)
        write_mxl_xml(broken, root_b, ns_b)
        if measure_duration(m26b, ns_b) == 16:
            raise SystemExit("broken fixture should overflow")
        repair_applied = patch_mxl_file(broken)
        root2, ns2 = load_mxl(broken)
        m26fixed = next(
            m for m in next(p for p in root2.findall(q(ns2, "part")) if p.get("id") == "P5").findall(q(ns2, "measure"))
            if m.get("number") == "26"
        )
        if measure_duration(m26fixed, ns2) != 16:
            raise SystemExit("broken baseline repair failed")
        if repair_applied < 1:
            raise SystemExit(f"missing-backup repair not applied: {repair_applied}")
    print("cheongsan m26 P5 backup ok", {"applied": applied, "dur": dur})


if __name__ == "__main__":
    main()

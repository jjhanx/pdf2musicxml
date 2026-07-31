"""Simulate buildOsmdPreviewXml PL filter + relocate on omr-work zip."""
import io
import zipfile
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import apply_fixes_to_root, _local

ZIP = Path(__file__).resolve().parents[1] / "omr-work-20e53bc4.zip"


def load():
    with zipfile.ZipFile(ZIP) as z:
        inner = zipfile.ZipFile(io.BytesIO(z.read("review.mxl")))
        return inner.read([n for n in inner.namelist() if n.endswith(".xml")][0]).decode("utf-8")


def note_staff(n: ET.Element) -> int:
    st = n.find("{*}staff")
    if st is not None and st.text and st.text.strip().isdigit():
        return int(st.text.strip())
    return 1


def dir_staff(d: ET.Element) -> int | None:
    st = d.find("{*}staff")
    if st is not None and st.text and st.text.strip().isdigit():
        return int(st.text.strip())
    return None


def relocate_full(xml: str) -> str:
    root = ET.fromstring(xml)
    for part in root.findall(".//{*}part"):
        max_staves = 1
        for m in part.findall("{*}measure"):
            for st in m.findall(".//{*}staves"):
                if st.text and st.text.isdigit():
                    max_staves = max(max_staves, int(st.text))
            for st in m.findall(".//{*}note/{*}staff"):
                if st.text and st.text.isdigit():
                    max_staves = max(max_staves, int(st.text))
        if max_staves < 2:
            continue
        for m in part.findall("{*}measure"):
            children = list(m)
            to_move = []
            for i, c in enumerate(children):
                if _local(c) != "direction":
                    continue
                sn = dir_staff(c) or 1
                if sn < 2:
                    continue
                prior_same = any(
                    _local(x) == "note" and note_staff(x) == sn for x in children[:i]
                )
                if prior_same:
                    continue
                after_backup = any(_local(x) == "backup" for x in children[:i])
                prior_s1 = any(
                    _local(x) == "note" and note_staff(x) == 1 for x in children[:i]
                )
                if after_backup or prior_s1:
                    to_move.append(c)
            for d in to_move:
                sn = dir_staff(d) or 2
                idx = list(m).index(d)
                voice = None
                for x in list(m)[idx + 1 :]:
                    if _local(x) == "note" and note_staff(x) == sn:
                        ve = x.find("{*}voice")
                        if ve is not None and ve.text:
                            voice = ve.text.strip()
                        break
                m.remove(d)
                if voice and d.find("{*}voice") is None:
                    ET.SubElement(d, _q(d, "voice")).text = voice
                # strip staff for OSMD full score
                st_el = d.find("{*}staff")
                if st_el is not None and d.find("{*}voice") is not None:
                    d.remove(st_el)
                insert_at = 0
                for j, x in enumerate(m):
                    loc = _local(x)
                    if loc in ("attributes", "print"):
                        insert_at = j + 1
                    elif loc == "barline" and x.get("location") == "right":
                        continue
                    else:
                        insert_at = j
                        break
                m.insert(insert_at, d)
    return ET.tostring(root, encoding="unicode")


def _q(el, tag):
    ns = el.tag.split("}")[0].strip("{") if "}" in el.tag else ""
    return f"{{{ns}}}{tag}" if ns else tag


def pl_filter(xml: str, part_id: str = "P5") -> str:
    root = ET.fromstring(xml)
    pl = root.find(f'.//{{*}}part[@id="{part_id}"]')
    if pl is None:
        return xml
    for sp in root.findall(".//{*}score-part"):
        if sp.get("id") != part_id:
            sp.getparent().remove(sp) if hasattr(sp, "getparent") else None
    for p in list(root.findall(".//{*}part")):
        if p.get("id") != part_id:
            p.getparent().remove(p) if hasattr(p, "getparent") else None
    # manual part filter
    part_list = root.find(".//{*}part-list")
    if part_list is not None:
        for sp in list(part_list):
            if sp.get("id") != part_id:
                part_list.remove(sp)
    for p in list(root.findall("{*}part")):
        if p.get("id") != part_id:
            root.remove(p)
    pl = root.find(f'.//{{*}}part[@id="{part_id}"]')
    for m in pl.findall("{*}measure"):
        kept_dirs = []
        for c in list(m):
            loc = _local(c)
            if loc in ("backup", "forward"):
                m.remove(c)
            elif loc == "note" and note_staff(c) != 2:
                m.remove(c)
            elif loc == "direction":
                ds = dir_staff(c)
                if ds is not None and ds != 2:
                    m.remove(c)
                else:
                    kept_dirs.append(c)
                    m.remove(c)
        for n in m.findall(".//{*}note/{*}staff"):
            n.text = "1"
        staves = m.find(".//{*}attributes/{*}staves")
        if staves is not None:
            staves.text = "1"
        insert_at = 0
        for j, x in enumerate(m):
            loc = _local(x)
            if loc in ("attributes", "print"):
                insert_at = j + 1
            elif loc == "barline" and x.get("location") == "right":
                continue
            else:
                insert_at = j
                break
        for d in kept_dirs:
            st = d.find("{*}staff")
            if st is not None:
                st.text = "1"
            m.insert(insert_at, d)
            insert_at += 1
    return ET.tostring(root, encoding="unicode")


raw = load()
r = ET.fromstring(raw)
apply_fixes_to_root(
    r,
    [
        {
            "kind": "insertDirection",
            "partId": "P5",
            "measureMxl": "17",
            "afterNoteIndex": -1,
            "directionType": "words",
            "directionValue": "poco piu mosso",
            "staff": 2,
        }
    ],
)
xml = ET.tostring(r, encoding="unicode")

print("=== P5 m17 BEFORE relocate (direction snippet) ===")
m = r.find('.//{*}part[@id="P5"]/{*}measure[@number="17"]')
for i, c in enumerate(m):
    if _local(c) == "direction":
        print(
            i,
            "staff",
            dir_staff(c),
            "voice",
            (c.find("{*}voice").text if c.find("{*}voice") is not None else None),
            "text",
            c.find(".//{*}words").text,
        )

full = relocate_full(xml)
rf = ET.fromstring(full)
mf = rf.find('.//{*}part[@id="P5"]/{*}measure[@number="17"]')
print("\n=== P5 m17 AFTER relocate (full score preview sim) ===")
for i, c in enumerate(mf):
    if _local(c) == "direction":
        print(
            i,
            "staff",
            dir_staff(c),
            "voice",
            (c.find("{*}voice").text if c.find("{*}voice") is not None else None),
        )

pl = pl_filter(xml)
rp = ET.fromstring(pl)
mp = rp.find('.//{*}part[@id="P5"]/{*}measure[@number="17"]')
print("\n=== PL filter m17 ===")
for i, c in enumerate(mp):
    loc = _local(c)
    if loc in ("direction", "note"):
        print(i, loc, "staff", dir_staff(c) if loc == "direction" else note_staff(c))

print("\n=== P2 m17 directions (should be none) ===")
p2 = r.find('.//{*}part[@id="P2"]/{*}measure[@number="17"]')
for c in p2:
    if _local(c) == "direction":
        print("FOUND ON P2", c.find(".//{*}words").text)

# -*- coding: utf-8 -*-
"""B→T m51 copy must bring cross-measure slur stop (omr-work-6eca740c).

B m51 #1 B3 slur start → B m52 #0 stop. Copying only m51 left an orphan start on T;
T m50 already had open slur #1→m52, so normalize remapped the copied start and the
redrawn addSlur stop was stolen — slur never drew. Ties in-measure still worked.
"""
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, "scripts")
from omr_hitl_lib import (  # noqa: E402
    apply_fix,
    find_measure,
    find_part,
    list_note_elements,
    normalize_slurs_in_root,
)


def load_review(path: str) -> ET.Element:
    with zipfile.ZipFile(path) as z:
        root_name = next(n for n in z.namelist() if n.endswith(".xml") and "META-INF" not in n)
        return ET.fromstring(z.read(root_name))


def slurs(root: ET.Element, pid: str, mid: str) -> list[tuple[int, str, str]]:
    part = find_part(root, "", pid)
    m = find_measure(part, "", mid)
    out: list[tuple[int, str, str]] = []
    for i, n in enumerate(list_note_elements(m, "")):
        for s in n.findall("{*}notations/{*}slur"):
            out.append((i, (s.get("type") or ""), (s.get("number") or "1")))
    return out


def paired_cross(root: ET.Element, pid: str, start_m: str, start_i: int, stop_m: str, stop_i: int) -> bool:
    starts = {(i, n) for i, t, n in slurs(root, pid, start_m) if t == "start"}
    stops = {(i, n) for i, t, n in slurs(root, pid, stop_m) if t == "stop"}
    for i, n in starts:
        if i != start_i:
            continue
        if (stop_i, n) in stops:
            return True
    return False


zip_path = "omr-work-6eca740c.zip"
if not Path(zip_path).exists():
    zip_path = "_smoke/_6eca740c/review.mxl"
    root = load_review(zip_path) if zip_path.endswith(".mxl") else None
else:
    with zipfile.ZipFile(zip_path) as z:
        data = z.read("review.mxl")
    import io

    with zipfile.ZipFile(io.BytesIO(data)) as z2:
        root_name = next(n for n in z2.namelist() if n.endswith(".xml") and "META-INF" not in n)
        root = ET.fromstring(z2.read(root_name))

assert root is not None
assert paired_cross(root, "P4", "51", 1, "52", 0), slurs(root, "P4", "51")

assert apply_fix(
    root,
    "",
    {
        "kind": "copyMeasureContent",
        "partId": "P4",
        "fromPartId": "P4",
        "toPartId": "P3",
        "toPartIds": ["P3"],
        "measureMxl": "51",
        "splitVoices": False,
    },
)
normalize_slurs_in_root(root)
assert paired_cross(root, "P3", "51", 1, "52", 0), (
    "copy must pair T m51→m52 slur",
    slurs(root, "P3", "50"),
    slurs(root, "P3", "51"),
    slurs(root, "P3", "52"),
)
# T m50→m52 slur must still be paired
assert paired_cross(root, "P3", "50", 0, "52", 0), (
    "pre-existing T slur must survive",
    slurs(root, "P3", "50"),
    slurs(root, "P3", "52"),
)

# Fresh root: addSlur redraw when open slur already exists
if Path("omr-work-6eca740c.zip").exists():
    with zipfile.ZipFile("omr-work-6eca740c.zip") as z:
        data = z.read("review.mxl")
    with zipfile.ZipFile(io.BytesIO(data)) as z2:
        root_name = next(n for n in z2.namelist() if n.endswith(".xml") and "META-INF" not in n)
        root2 = ET.fromstring(z2.read(root_name))
else:
    root2 = load_review("_smoke/_6eca740c/review.mxl")

# Strip T m51 slur start to simulate failed copy remnant, keep m50 open
m51 = find_measure(find_part(root2, "", "P3"), "", "51")
for n in list_note_elements(m51, ""):
    nots = n.find("{*}notations")
    if nots is None:
        continue
    for s in list(nots.findall("{*}slur")):
        nots.remove(s)
    if not list(nots):
        n.remove(nots)

assert apply_fix(
    root2,
    "",
    {
        "kind": "addSlur",
        "partId": "P3",
        "measureMxl": "51",
        "toMeasureMxl": "52",
        "fromNoteIndex": 1,
        "toNoteIndex": 0,
        "placement": "above",
    },
)
normalize_slurs_in_root(root2)
assert paired_cross(root2, "P3", "51", 1, "52", 0), (
    "addSlur must pair despite open m50 slur",
    slurs(root2, "P3", "50"),
    slurs(root2, "P3", "51"),
    slurs(root2, "P3", "52"),
)
assert paired_cross(root2, "P3", "50", 0, "52", 0), (
    "addSlur must not steal m50 stop",
    slurs(root2, "P3", "50"),
    slurs(root2, "P3", "52"),
)

print("OK 6eca B→T m51 cross-measure slur copy/addSlur")

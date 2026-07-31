"""Per-part m26 timeline end."""
import xml.etree.ElementTree as ET

def local(tag: str) -> str:
    return tag.split("}")[-1] if "}" in tag else tag

def timeline_end(measure) -> int:
    pos = 0
    for child in measure:
        tag = local(child.tag)
        if tag == "backup":
            d = int(child.findtext("duration") or 0)
            pos = max(0, pos - d)
        elif tag == "forward":
            d = int(child.findtext("duration") or 0)
            pos += d
        elif tag == "note":
            if child.find("chord") is not None:
                continue
            if child.find("grace") is not None:
                continue
            pos += int(child.findtext("duration") or 0)
    return pos

def expected_len(measure, inherited):
    div, beats, bt = inherited
    for attr in measure.findall("attributes"):
        d = attr.findtext("divisions")
        if d:
            div = int(d)
        t = attr.find("time")
        if t is not None:
            b = t.findtext("beats")
            bt_el = t.findtext("beat-type")
            if b:
                beats = int(b)
            if bt_el:
                bt = int(bt_el)
    exp = max(1, round(div * beats * 4 / bt))
    return div, beats, bt, exp

root = ET.parse("_smoke/_cheongsan_review.xml").getroot()
timing = (4, 4, 4)
for part in root.findall("part"):
    pid = part.get("id")
    timing_part = timing
    for measure in part.findall("measure"):
        mn = measure.get("number")
        div, beats, bt, exp = expected_len(measure, timing_part)
        timing_part = (div, beats, bt)
        if mn != "26":
            continue
        end = timeline_end(measure)
        print(f"{pid} m26: timeline_end={end}/{exp}")

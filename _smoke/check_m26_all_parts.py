"""Check m26 underfull/overfull per part in cheongsan."""
import xml.etree.ElementTree as ET

def local(tag):
    return tag.split("}")[-1] if "}" in tag else tag

root = ET.parse("_smoke/_cheongsan_review.xml").getroot()
parts = [p for p in root if local(p.tag) == "part"]
for part in parts:
    pid = part.get("id")
    div, beats, bt = 4, 4, 4
    for meas in part:
        if local(meas.tag) != "measure":
            continue
        mnum = meas.get("number")
        for attr in meas.findall("{*}attributes"):
            d = attr.find("{*}divisions")
            if d is not None and d.text:
                div = int(d.text)
            t = attr.find("{*}time")
            if t is not None:
                b = t.find("{*}beats")
                x = t.find("{*}beat-type")
                if b is not None and b.text:
                    beats = int(b.text)
                if x is not None and x.text:
                    bt = int(x.text)
        if mnum != "26":
            continue
        expected = div * beats * 4 // bt
        by_voice = {}
        for note in meas.findall("{*}note"):
            if note.find("{*}grace") is not None:
                continue
            if note.find("{*}chord") is not None:
                continue
            v = (note.find("{*}voice").text or "1").strip() if note.find("{*}voice") is not None else "1"
            dur = int(note.find("{*}duration").text or 0)
            by_voice[v] = by_voice.get(v, 0) + dur
        flags = []
        for v, t in sorted(by_voice.items()):
            if t != expected:
                flags.append(f"v{v}={t}/{expected}")
        print(pid, "expected", expected, " ".join(flags) if flags else "OK", by_voice)

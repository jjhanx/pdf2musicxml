"""Dump notes of specific measures + tuplet/word survey."""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    tree = ET.parse(ROOT / "_smoke" / f"{name}.xml")
    root = tree.getroot()
    for el in root.iter():
        if el.tag.startswith("{"):
            el.tag = el.tag.split("}", 1)[1]
    return root


def t(el, name):
    c = el.find(name)
    return c.text.strip() if c is not None and c.text else None


def note_desc(n):
    if n.find("rest") is not None:
        p = "REST"
    else:
        pe = n.find("pitch")
        p = (t(pe, "step") or "?") + (t(pe, "alter") or "") + (t(pe, "octave") or "?") if pe is not None else "?"
    chord = "+" if n.find("chord") is not None else " "
    dur = t(n, "duration")
    typ = t(n, "type")
    stem = t(n, "stem")
    voice = t(n, "voice")
    staff = t(n, "staff")
    beams = [b.text for b in n.findall("beam")]
    dot = "." * len(n.findall("dot"))
    tm = n.find("time-modification")
    tmod = f" tm={t(tm,'actual-notes')}:{t(tm,'normal-notes')}" if tm is not None else ""
    ties = [x.get("type") for x in n.findall("tie")]
    notations = n.find("notations")
    nots = []
    if notations is not None:
        for c in notations:
            if c.tag == "tuplet":
                nots.append(f"tuplet({c.get('type')},show={c.get('show-number')})")
            elif c.tag in ("tied", "slur"):
                nots.append(f"{c.tag}({c.get('type')},n={c.get('number')})")
            else:
                nots.append(c.tag)
    dx = n.get("default-x")
    return f"{chord}{p:5} dur={dur:>3} {typ or '?':8}{dot:2} stem={stem or '-':5} v={voice} st={staff} x={dx:>6} beams={beams} tie={ties}{tmod} {' '.join(nots)}"


def dump_measure(root, pid, mnum):
    for part in root.findall("part"):
        if part.get("id") != pid:
            continue
        for measure in part.findall("measure"):
            if measure.get("number") != str(mnum):
                continue
            print(f"--- {pid} m{mnum} ---")
            for child in measure:
                if child.tag == "note":
                    print("  ", note_desc(child))
                elif child.tag == "backup":
                    print("   BACKUP", t(child, "duration"))
                elif child.tag == "forward":
                    print("   FORWARD", t(child, "duration"))
                elif child.tag == "direction":
                    words = [w.text for w in child.iter("words")]
                    others = {c.tag for dt in child.findall("direction-type") for c in dt}
                    print("   DIRECTION", words, others)


def survey_words(root, label):
    print(f"=== words survey: {label} ===")
    from collections import Counter
    c = Counter()
    for w in root.iter("words"):
        c[(w.text or "").strip()] += 1
    for k, v in sorted(c.items()):
        print(f"  {v:3} {k!r}")
    sn = Counter()
    for tup in root.iter("tuplet"):
        sn[(tup.get("type"), tup.get("show-number"))] += 1
    print("  tuplet attrs:", dict(sn))


if __name__ == "__main__":
    name = sys.argv[1]
    root = load(name)
    if len(sys.argv) > 2:
        for spec in sys.argv[2:]:
            pid, mnum = spec.split(":")
            dump_measure(root, pid, mnum)
    else:
        survey_words(root, name)

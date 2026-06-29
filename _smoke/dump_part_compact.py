"""Compact per-measure rhythm dump: python dump_part_compact.py <name> <pid> [m0 m1]"""
import sys

from probe_issues4 import load, t

root = load(sys.argv[1])
pid = sys.argv[2]
lo = int(sys.argv[3]) if len(sys.argv) > 3 else 0
hi = int(sys.argv[4]) if len(sys.argv) > 4 else 999
for part in root.findall("part"):
    if part.get("id") != pid:
        continue
    for measure in part.findall("measure"):
        n = int(measure.get("number"))
        if not (lo <= n <= hi):
            continue
        toks = []
        for c in measure:
            if c.tag == "note":
                if c.find("chord") is not None:
                    continue
                typ = t(c, "type") or "?"
                dots = "." * len(c.findall("dot"))
                rest = "R" if c.find("rest") is not None else ""
                pe = c.find("pitch")
                p = ""
                if pe is not None:
                    p = (t(pe, "step") or "") + (t(pe, "octave") or "")
                abbr = {"whole": "w", "half": "h", "quarter": "q", "eighth": "e", "16th": "s"}.get(typ, typ)
                toks.append(f"{rest}{p}{abbr}{dots}")
            elif c.tag == "backup":
                toks.append("|BK|")
        print(f"m{n}: " + " ".join(toks))

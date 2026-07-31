"""Quick check m25-m26 XML state after cleanup."""
import re
from pathlib import Path

xml = Path("_smoke/_cheongsan_review.xml").read_text(encoding="utf-8")

# run cleanup via node is heavy; grep raw for m25/m26 markers
for pid in ["P1", "P5"]:
    m = re.search(rf'<part id="{pid}">(.*?)</part>', xml, re.S)
    if not m:
        continue
    part = m.group(1)
    for mn in [25, 26]:
        mm = re.search(rf'<measure number="{mn}"[^>]*>(.*?)</measure>', part, re.S)
        if not mm:
            print(pid, mn, "MISSING")
            continue
        body = mm.group(1)
        prints = len(re.findall(r"<print", body))
        backups = len(re.findall(r"<backup", body))
        forwards = len(re.findall(r"<forward", body))
        notes = len(re.findall(r"<note", body))
        print(f"{pid} m{mn}: notes={notes} backup={backups} forward={forwards} print={prints}")
        if mn == 26 and pid == "P1":
            # first few note pitches
            for pitch in re.findall(r"<step>(\w)</step>\s*<octave>(\d)</octave>", body)[:5]:
                print("  pitch", pitch)

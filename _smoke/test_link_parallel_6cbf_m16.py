"""Real 6cbf PR m16: link #16 (E5 chord) + #17 (E4) must not reorder or corrupt PL."""
import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import omr_hitl_lib as lib

ZIP = ROOT / "omr-work-6cbf1add.zip"
PART = "P4"


def load():
    with zipfile.ZipFile(ZIP) as z:
        data = z.read("review.mxl")
    with zipfile.ZipFile(io.BytesIO(data)) as inner:
        xml = inner.read([n for n in inner.namelist() if n.endswith(".xml") and "META" not in n.upper()][0])
    return ET.fromstring(xml)


def pitch(n, ns):
    p = n.find(lib._q(ns, "pitch"))
    if p is None:
        return "rest"
    s = p.find(lib._q(ns, "step")).text
    o = p.find(lib._q(ns, "octave")).text
    a = p.find(lib._q(ns, "alter"))
    acc = { "-1": "b", "1": "#" }.get(a.text.strip(), "") if a is not None and a.text else ""
    return f"{s}{acc}{o}"


root = load()
ns = lib._ns(root)
m = lib.find_measure(lib.find_part(root, ns, PART), ns, "16")
before_pr = [pitch(n, ns) for n in lib.list_note_elements(m, ns) if lib._note_voice_staff(n, ns)[1] == "1"]

lib.apply_fixes_to_root(
    root,
    [{"kind": "linkParallelOnsets", "partId": PART, "measureMxl": "16", "staff": 1, "parallelNoteIndices": [16, 17]}],
)

notes = lib.list_note_elements(m, ns)
after_pr = [pitch(n, ns) for n in notes if lib._note_voice_staff(n, ns)[1] == "1"]
starts = dict(lib._staff_timed_leader_starts(m, ns, "1"))

# 마디 앞쪽(PR #0 A4…) 상대 순서 유지 — 특정 음 이름(G4 등)에 묶지 않음
assert after_pr[:10] == before_pr[:10], (before_pr[:10], after_pr[:10])
# E4가 마디 맨 앞·중간 빔 블록 앞으로 끼어들지 않음
e4_i = next(i for i, n in enumerate(notes) if pitch(n, ns) == "E4" and n.find(lib._q(ns, "chord")) is None)
assert e4_i >= 15, e4_i
# 동시 시작 = 화음 리더 A4(#15) 시각과 E4(#17) 일치
assert starts[15] == starts[e4_i], (starts.get(15), starts.get(e4_i))
# PL(staff 2) 오염 없음
pl = [(i, lib._note_voice_staff(n, ns)) for i, n in enumerate(notes) if lib._note_voice_staff(n, ns)[1] == "2"]
assert pl and all(st == "2" for _, (_, st) in pl), pl[:3]
assert all(v in ("5", "6") for _, (v, _) in pl), pl
print("6cbf m16 E5+E4 link ok")

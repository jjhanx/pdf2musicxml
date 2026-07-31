import re
import shutil
import zipfile
from collections import Counter
from pathlib import Path

zpath = Path("너에게 난 나에게 넌/omr-work-6cbf1add.zip")
tmp = Path("_smoke/_6cbf_q")
shutil.rmtree(tmp, ignore_errors=True)
tmp.mkdir(parents=True)
with zipfile.ZipFile(zpath) as z:
    z.extractall(tmp)


def load(mxl_name: str) -> str:
    p = tmp / mxl_name
    d = tmp / (mxl_name.replace(".", "_") + "_x")
    if d.exists():
        shutil.rmtree(d)
    d.mkdir(exist_ok=True)
    with zipfile.ZipFile(p) as z:
        z.extractall(d)
    cands = [x for x in d.rglob("*.xml") if "META-INF" not in str(x) and "container" not in x.name.lower()]
    score = next((x for x in cands if x.name.lower() not in ("metadata.xml",)), cands[0])
    return score.read_text("utf-8")


def piano_ids(text: str) -> list[str]:
    out = []
    for m in re.finditer(r'<score-part id="([^"]+)"[^>]*>.*?<part-name>([^<]*)</part-name>', text, re.S):
        name = m.group(2).strip()
        if "Piano" in name or name in ("P", "PR", "PL"):
            out.append(m.group(1))
    return out


def dump_measure(text: str, pid: str, mn: str):
    part = re.search(rf'<part id="{re.escape(pid)}".*?>(.*?)</part>', text, re.S)
    if not part:
        return
    meas = re.search(rf'<measure number="{mn}".*?>(.*?)</measure>', part.group(1), re.S)
    if not meas:
        return
    body = meas.group(1)
    attrs = re.findall(r"<attributes.*?</attributes>", body, re.S)
    notes = re.findall(r"<note.*?</note>", body, re.S)
    print(f"  {pid} m{mn}: attrs={len(attrs)} notes={len(notes)}")
    for a in attrs:
        print("   ATTR", re.sub(r"\s+", " ", a)[:160])
    t = 0
    for i, n in enumerate(notes):
        if "<backup" in n:
            d = int(re.search(r"<duration>(\d+)</duration>", n).group(1))
            t -= d
            continue
        if "<forward" in n:
            d = int(re.search(r"<duration>(\d+)</duration>", n).group(1))
            t += d
            continue
        rest = "<rest" in n
        typ_m = re.search(r"<type>([^<]+)</type>", n)
        typ = typ_m.group(1) if typ_m else "?"
        dur_m = re.search(r"<duration>(\d+)</duration>", n)
        dur = dur_m.group(1) if dur_m else "?"
        staff_m = re.search(r"<staff>(\d+)</staff>", n)
        staff = staff_m.group(1) if staff_m else "1"
        ds = re.search(r"<display-step>([^<]+)</display-step>", n)
        disp = f" disp={ds.group(1)}" if ds else ""
        print(f"   #{i} {'rest' if rest else 'note'} {typ} dur={dur} staff={staff} t={t}{disp}")
        if "<chord" not in n and dur_m:
            t += int(dur_m.group(1))
    print(f"   final t={t}")


for mxl in ["audiveris_raw.mxl", "review.mxl"]:
    text = load(mxl)
    print(f"\n======== {mxl} ========")
    pids = piano_ids(text)
    print("piano part ids:", pids)
    ds = re.findall(r"<display-step>([^<]+)</display-step>", text)
    print("display-step:", dict(Counter(ds)))
    high = len(re.findall(r"<type>whole</type>.*?<display-step>(C|D|E)</display-step>", text, re.S))
    print("whole+high display:", high)
    pid = pids[0] if pids else "P4"
    for mn in ["4", "18", "32", "33"]:
        dump_measure(text, pid, mn)
    for pid2 in ["P1", "P2", "P3"]:
        for mn in ["32", "33"]:
            dump_measure(text, pid2, mn)

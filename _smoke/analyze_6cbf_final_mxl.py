"""Analyze raw vs review MXL for omr-work-6cbf1add measures 4,18,32-33 and whole rests."""
import re
import shutil
import zipfile
from pathlib import Path

zpath = Path("너에게 난 나에게 넌/omr-work-6cbf1add.zip")
tmpdir = Path("_smoke/_6cbf_final")
if tmpdir.exists():
    shutil.rmtree(tmpdir)
tmpdir.mkdir(parents=True)
with zipfile.ZipFile(zpath) as z:
    z.extractall(tmpdir)

def load_xml_from_mxl(mxl_path: Path) -> str:
    d = tmpdir / mxl_path.stem
    d.mkdir(exist_ok=True)
    with zipfile.ZipFile(mxl_path) as z:
        z.extractall(d)
    xml = next(p for p in d.glob("*.xml") if "META" not in p.name.upper())
    return xml.read_text(encoding="utf-8")


def part_block(text: str, pid: str) -> str:
    m = re.search(rf'<part id="{re.escape(pid)}".*?>(.*?)</part>', text, re.S)
    return m.group(1) if m else ""


def measure_block(part: str, mn: str) -> str:
    m = re.search(rf'<measure number="{mn}".*?>(.*?)</measure>', part, re.S)
    return m.group(1) if m else ""


def dump_rests(label: str, text: str, pid: str, mn: str):
    meas = measure_block(part_block(text, pid), mn)
    if not meas:
        print(f"{label} {pid} m{mn}: (missing)")
        return
    notes = re.findall(r"<note.*?(?:</note>|/>)", meas, re.S)
    print(f"\n{label} {pid} m{mn} ({len(notes)} notes)")
    t = 0
    for i, n in enumerate(notes):
        if "<backup" in n:
            d = int(re.search(r"<duration>(\d+)</duration>", n).group(1))
            t -= d
            print(f"  backup dur={d} t={t}")
            continue
        if "<forward" in n:
            d = int(re.search(r"<duration>(\d+)</duration>", n).group(1))
            t += d
            print(f"  forward dur={d} t={t}")
            continue
        rest = "<rest" in n
        chord = "<chord" in n
        typ = re.search(r"<type>([^<]+)</type>", n)
        typ = typ.group(1) if typ else "?"
        dur = int(re.search(r"<duration>(\d+)</duration>", n).group(1))
        staff = re.search(r"<staff>(\d+)</staff>", n)
        staff = staff.group(1) if staff else "1"
        ds = re.search(r"<display-step>([^<]+)</display-step>", n)
        do = re.search(r"<display-octave>(\d+)</display-octave>", n)
        disp = f" disp={ds.group(1)}{do.group(1)}" if ds and do else ""
        pitch = ""
        if not rest:
            st = re.search(r"<step>([^<]+)</step>", n)
            oc = re.search(r"<octave>(\d+)</octave>", n)
            if st and oc:
                pitch = st.group(1) + oc.group(1)
        print(
            f"  #{i} {'rest' if rest else pitch} type={typ} dur={dur} staff={staff} t={t}{disp}"
            + (" CHORD" if chord else "")
        )
        if not chord:
            t += dur
    print(f"  final t={t}")


def count_whole_rest_display(text: str):
    bad = good = cleared = 0
    for m in re.finditer(
        r"<note[^>]*>.*?<rest[^>]*/>.*?<type>whole</type>.*?</note>",
        text,
        re.S,
    ):
        chunk = m.group(0)
        ds = re.search(r"<display-step>([^<]+)</display-step>", chunk)
        if not ds:
            cleared += 1
        elif ds.group(1) in ("C", "D", "E"):
            bad += 1
        elif ds.group(1) == "B":
            good += 1
        else:
            bad += 1
    print(f"\nWhole rests: bad_display(C/D/E/other)={bad} B={good} no_display={cleared}")


for name in ["audiveris_raw.mxl", "review.mxl", "omr_hitl_baseline.mxl"]:
    p = tmpdir / name
    if not p.exists():
        continue
    text = load_xml_from_mxl(p)
    print(f"\n======== {name} ========")
    count_whole_rest_display(text)
    for mn in ["4", "18", "32", "33"]:
        dump_rests(name, text, "P5", mn)
    for mn in ["32", "33"]:
        for pid in ["P1", "P2", "P3", "P4"]:
            dump_rests(name, text, pid, mn)

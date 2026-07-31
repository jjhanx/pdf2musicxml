"""Per-staff voice timeline for piano grand staff measures."""
import shutil
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


def q(tag: str) -> str:
    return f"{{*}}{tag}"


def local(el) -> str:
    return el.tag.split("}")[-1] if "}" in el.tag else el.tag


def load_root(mxl: Path):
    tmp = Path("_smoke/_staff_timeline")
    tmp.mkdir(exist_ok=True)
    d = tmp / mxl.stem
    if d.exists():
        shutil.rmtree(d)
    d.mkdir()
    with zipfile.ZipFile(mxl) as z:
        z.extractall(d)
    xml = next(p for p in d.rglob("*.xml") if "META-INF" not in str(p))
    return ET.parse(xml).getroot()


def analyze_part_measure(root, pid: str, mnum: str):
    part = root.find(f".//{q('part')}[@id='{pid}']")
    if part is None:
        print(f"part {pid} missing")
        return
    divisions = 4
    beats, beat_type = 4, 4
    for m in part.findall(q("measure")):
        mn = m.get("number")
        if mn != mnum:
            for attr in m.findall(q("attributes")):
                d = attr.find(q("divisions"))
                if d is not None and d.text:
                    divisions = int(d.text)
                time = attr.find(q("time"))
                if time is not None:
                    b = time.find(q("beats"))
                    bt = time.find(q("beat-type"))
                    if b is not None and b.text:
                        beats = int(b.text)
                    if bt is not None and bt.text:
                        beat_type = int(bt.text)
            continue
        meas = m
        for attr in m.findall(q("attributes")):
            d = attr.find(q("divisions"))
            if d is not None and d.text:
                divisions = int(d.text)
            time = attr.find(q("time"))
            if time is not None:
                b = time.find(q("beats"))
                bt = time.find(q("beat-type"))
                if b is not None and b.text:
                    beats = int(b.text)
                if bt is not None and bt.text:
                    beat_type = int(bt.text)
        break
    if meas is None:
        print(f"measure {mnum} missing")
        return
    measure_len = max(1, round(divisions * beats * 4 / beat_type))

    cursors: dict[tuple[str, str], int] = {}

    def note_vs_staff(note):
        v = note.find(q("voice"))
        s = note.find(q("staff"))
        voice = (v.text or "1").strip() if v is not None and v.text else "1"
        staff = (s.text or "1").strip() if s is not None and s.text else "1"
        return voice, staff

    print(f"\n=== {pid} m{mnum} len={measure_len} div={divisions} ===")
    for el in meas:
        tag = local(el)
        if tag == "note":
            if el.find(q("grace")) is not None:
                continue
            if el.find(q("chord")) is not None:
                continue
            voice, staff = note_vs_staff(el)
            key = (voice, staff)
            t = cursors.get(key, 0)
            dur_el = el.find(q("duration"))
            dur = int(dur_el.text) if dur_el is not None and dur_el.text else 0
            rest = el.find(q("rest")) is not None
            typ = el.find(q("type"))
            typ_v = typ.text if typ is not None else "?"
            print(f"  note v={voice} staff={staff} t={t} dur={dur} {'rest' if rest else 'pitch'} type={typ_v}")
            cursors[key] = t + dur
        elif tag == "backup":
            dur_el = el.find(q("duration"))
            dur = int(dur_el.text) if dur_el is not None and dur_el.text else 0
            print(f"  backup dur={dur} cursors={dict(cursors)}")
            for k in list(cursors):
                cursors[k] = max(0, cursors[k] - dur)
        elif tag == "forward":
            dur_el = el.find(q("duration"))
            dur = int(dur_el.text) if dur_el is not None and dur_el.text else 0
            v = el.find(q("voice"))
            s = el.find(q("staff"))
            voice = (v.text or "1").strip() if v is not None and v.text else "1"
            staff = (s.text or "1").strip() if s is not None and s.text else "1"
            key = (voice, staff)
            t = cursors.get(key, 0)
            print(f"  forward v={voice} staff={staff} dur={dur} t={t}->{t+dur}")
            cursors[key] = t + dur

    by_staff: dict[str, int] = {}
    for (_v, st), t in cursors.items():
        by_staff[st] = max(by_staff.get(st, 0), t)
    print(f"  staff totals: {by_staff} (expected {measure_len})")
    for st, total in sorted(by_staff.items()):
        gap = measure_len - total
        if gap > 0:
            print(f"  ** staff {st} UNDERFULL by {gap} (may render phantom rest)")
        elif gap < 0:
            print(f"  ** staff {st} OVERFULL by {-gap}")


tmp = Path("_smoke/_6cbf_q")
paths = [Path("_smoke/6cbf_fixed.mxl")] if Path("_smoke/6cbf_fixed.mxl").exists() else []
paths += [tmp / name for name in ["audiveris_raw.mxl", "review.mxl"] if (tmp / name).exists()]
for mxl_path in paths:
    if not mxl_path.exists():
        continue
    root = load_root(mxl_path)
    print(f"\n######## {mxl_path.name} ########")
    for mn in ["4", "18"]:
        analyze_part_measure(root, "P4", mn)

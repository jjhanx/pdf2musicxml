import os
import sys
import zipfile
import io
import json
import xml.etree.ElementTree as ET
import re
from pathlib import Path


def mxl_ns_uri(root):
    t = root.tag
    if t.startswith("{"):
        return t[1 : t.index("}")]
    return ""


def qname(ns, local):
    return f"{{{ns}}}{local}" if ns else local


def findall_ns(parent, local, ns):
    return parent.findall(qname(ns, local))


def has_rest(note, ns):
    return note.find(qname(ns, "rest")) is not None


def has_chord(note, ns):
    return note.find(qname(ns, "chord")) is not None


def has_grace(note, ns):
    return note.find(qname(ns, "grace")) is not None


def note_voice(note, ns):
    v_el = note.find(qname(ns, "voice"))
    if v_el is not None and v_el.text and v_el.text.strip():
        return v_el.text.strip()
    return "1"


def voices_match(a: str, b: str) -> bool:
    """Audiveris·편집기에 따라 '1'/'01' 등이 달라질 수 있어 비교 시 정규화."""
    if a == b:
        return True
    sa, sb = str(a).strip(), str(b).strip()
    if sa == sb:
        return True
    try:
        return int(sa) == int(sb)
    except (TypeError, ValueError):
        return False


# MusicXML: MIDI 60 = middle C; midi = (octave + 1) * 12 + pc + alter
_STEP_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_CHROMA = [
    ("C", 0),
    ("C", 1),
    ("D", 0),
    ("D", 1),
    ("E", 0),
    ("F", 0),
    ("F", 1),
    ("G", 0),
    ("G", 1),
    ("A", 0),
    ("A", 1),
    ("B", 0),
]


def _pitch_to_midi(step: str, alter: int, octave: int) -> int:
    pc = _STEP_PC.get(step, 0)
    return (octave + 1) * 12 + pc + alter


def _midi_to_pitch(m: int):
    m = max(0, min(127, int(round(m))))
    octave = m // 12 - 1
    sem = m % 12
    step, alter = _CHROMA[sem]
    return step, alter, octave


def transpose_pitch_element(pitch_el, ns, delta: int):
    if delta == 0:
        return
    step_el = pitch_el.find(qname(ns, "step"))
    if step_el is None or step_el.text is None:
        return
    step = step_el.text.strip()
    alter_el = pitch_el.find(qname(ns, "alter"))
    alter = 0
    if alter_el is not None and alter_el.text:
        try:
            alter = int(float(alter_el.text))
        except (TypeError, ValueError):
            alter = 0
    oct_el = pitch_el.find(qname(ns, "octave"))
    if oct_el is None or oct_el.text is None:
        return
    try:
        octave = int(oct_el.text)
    except (TypeError, ValueError):
        return
    midi = _pitch_to_midi(step, alter, octave) + delta
    n_step, n_alter, n_oct = _midi_to_pitch(midi)
    step_el.text = n_step
    if n_alter != 0:
        if alter_el is None:
            alter_el = ET.SubElement(pitch_el, qname(ns, "alter"))
        alter_el.text = str(n_alter)
    elif alter_el is not None:
        pitch_el.remove(alter_el)
    oct_el.text = str(n_oct)


def transpose_score_chromatic(root, ns, delta: int):
    """모든 파트의 음표 음높이를 반음만큼 이동(Audiveris 오인식 보정)."""
    if delta == 0:
        return
    for part_el in find_parts(root, ns):
        for measure in findall_ns(part_el, "measure", ns):
            for note in findall_ns(measure, "note", ns):
                if has_rest(note, ns):
                    continue
                pe = note.find(qname(ns, "pitch"))
                if pe is not None:
                    transpose_pitch_element(pe, ns, delta)


def list_attachable_notes(part_el, ns):
    """(measure, note, voice) in score order.

    Audiveris 등은 2성부 한 파트에서 둘째 줄 음에 `<chord/>`를 붙이는 경우가 많아,
    기존처럼 chord를 무조건 제외하면 해당 성부 음표가 통째로 빠져 가사가 전혀 붙지 않을 수 있다.
    같은 `<voice>`의 화음 덧붙임만 제외하고, 다른 voice와 겹치는 chord 음은 포함한다.
    """
    out = []
    for measure in findall_ns(part_el, "measure", ns):
        last_included_voice = None
        for note in findall_ns(measure, "note", ns):
            if has_rest(note, ns):
                continue
            if has_grace(note, ns):
                continue
            v = note_voice(note, ns)
            if has_chord(note, ns):
                if last_included_voice is not None and voices_match(v, last_included_voice):
                    continue
            last_included_voice = v
            out.append((measure, note, v))
    return out


def find_parts(root, ns):
    return findall_ns(root, "part", ns)


def _lyric_number_matches(el, target: int) -> bool:
    raw = el.get("number")
    if target == 1:
        return raw is None or raw == "1"
    return raw == str(target)


def add_lyric_to_note(note, ns, text_char, lyric_number=1):
    """같은 음표에 1절·2절 등 여러 가사 줄을 둘 때 `lyric_number`로 `<lyric number>` 를 구분한다."""
    lyric_tag = qname(ns, "lyric")
    for old in list(note.findall(lyric_tag)):
        if _lyric_number_matches(old, lyric_number):
            note.remove(old)
    lyric_el = ET.SubElement(note, lyric_tag)
    if lyric_number != 1:
        lyric_el.set("number", str(lyric_number))
    syllabic_el = ET.SubElement(lyric_el, qname(ns, "syllabic"))
    syllabic_el.text = "single"
    text_el = ET.SubElement(lyric_el, qname(ns, "text"))
    text_el.text = text_char


def fix_key_signatures_part(part_el, ns):
    """기존 조표 후처리 로직 (네임스페이스 대응)."""
    current_fifths = None
    for measure in findall_ns(part_el, "measure", ns):
        print_el = measure.find(qname(ns, "print"))
        is_new_system = print_el is not None and (
            print_el.attrib.get("new-system") == "yes"
            or print_el.attrib.get("new-page") == "yes"
        )
        attr = measure.find(qname(ns, "attributes"))
        if attr is not None:
            key = attr.find(qname(ns, "key"))
            if key is not None:
                fifths_el = key.find(qname(ns, "fifths"))
                if fifths_el is not None:
                    try:
                        fifths = int(fifths_el.text)
                    except (TypeError, ValueError):
                        continue
                    if (
                        is_new_system
                        and fifths == 0
                        and current_fifths is not None
                        and current_fifths != 0
                    ):
                        cancel_el = key.find(qname(ns, "cancel"))
                        if cancel_el is None:
                            fifths_el.text = str(current_fifths)
                    else:
                        current_fifths = fifths


def _normalize_lyric_voice(raw):
    v = str(raw or "1").strip() or "1"
    if v in ("*", "all", "any") or v.lower() in ("all", "any"):
        return "*"
    return v


def attachable_voice_counts(part_el, ns):
    notes = list_attachable_notes(part_el, ns)
    c = {}
    for _m, _n, v in notes:
        c[v] = c.get(v, 0) + 1
    return c


def count_matching_voice(c: dict, target: str) -> int:
    if target == "*":
        return sum(c.values())
    return sum(n for v, n in c.items() if voices_match(v, target))


def build_events_for_items(items_sorted, part_el=None, ns=None, melody_voice_override=None):
    """
    items_sorted: 해당 (파트·절·멜로디 줄) 스트림에 붙일 가사 블록들 (페이지·y·x 정렬됨).
    각 블록마다 lyricSkipNotes·(멜로디) voice·text 적용.
    melody_voice_override가 있으면 항목별 lyricVoice 대신 이 값만 쓴다(같은 스트림 강제).

    part_el/ns가 주어지면: 지정한 voice에 해당하는 멜로디 음이 하나도 없을 때
    자동으로 '*'(문서 순 전체)로 바꿔 가사가 통째로 빠지는 경우를 줄인다.
    """
    events = []
    for it in items_sorted:
        raw_src = melody_voice_override if melody_voice_override is not None else it.get("lyricVoice")
        voice = _normalize_lyric_voice(raw_src)
        if (
            part_el is not None
            and ns is not None
            and voice != "*"
        ):
            c = attachable_voice_counts(part_el, ns)
            if c and count_matching_voice(c, voice) == 0:
                print(
                    f"inject_ocr: 경고: lyricVoice={voice!r} 에 해당하는 가사 후보 음표가 없어 '전체 순서(*)'로 바꿉니다.",
                    file=sys.stderr,
                )
                voice = "*"
        try:
            skip = int(it.get("lyricSkipNotes", 0) or 0)
        except (TypeError, ValueError):
            skip = 0
        if skip > 0:
            events.append({"op": "skip_notes", "count": skip, "voice": voice})
        text = it.get("text", "") or ""
        for char in text.replace(" ", ""):
            events.append({"op": "syllable", "char": char, "voice": voice})
    return events


def apply_lyric_events(part_el, ns, events, lyric_number=1):
    notes = list_attachable_notes(part_el, ns)
    idx = 0
    for ev in events:
        if ev["op"] == "skip_notes":
            v_target = ev["voice"]
            need = ev["count"]
            if v_target == "*":
                idx = min(idx + need, len(notes))
            else:
                skipped = 0
                while idx < len(notes) and skipped < need:
                    if voices_match(notes[idx][2], v_target):
                        skipped += 1
                    idx += 1
        elif ev["op"] == "syllable":
            v_target = ev["voice"]
            char = ev["char"]
            if v_target == "*":
                if idx >= len(notes):
                    print(
                        "inject_ocr: 경고: 가사 syllable에 대응할 음표가 더 이상 없습니다.",
                        file=sys.stderr,
                    )
                    break
                _m, note, _v = notes[idx]
                idx += 1
            else:
                while idx < len(notes) and not voices_match(notes[idx][2], v_target):
                    idx += 1
                if idx >= len(notes):
                    print(
                        "inject_ocr: 경고: 가사 syllable에 대응할 같은 성부의 음표가 더 이상 없습니다.",
                        file=sys.stderr,
                    )
                    break
                _m, note, _v = notes[idx]
                idx += 1
            if char != "-":
                add_lyric_to_note(note, ns, char, lyric_number)


def is_tag(el, ns, local):
    tag = qname(ns, local)
    return el.tag == tag or el.tag.endswith("}" + local)


def parse_bpm_from_text(text: str):
    """인식된 문자열에서 BPM 후보 추출 (♩= 75, =75, 75 등)."""
    if not text or not str(text).strip():
        return None
    s = str(text).strip()
    m = re.search(r"=\s*(\d+(?:\.\d+)?)", s)
    if m:
        v = float(m.group(1))
        if 20 <= v <= 400:
            return v
    for n in re.findall(r"\d+(?:\.\d+)?", s):
        v = float(n)
        if 20 <= v <= 400:
            return v
    return None


def _skip_inject_meta_item(item):
    """ocr_data.json 에서 타입 이름이 '_' 로 시작하면 메타(마스킹 전용 등)로 취급."""
    t = item.get("type", "unknown")
    return isinstance(t, str) and t.startswith("_")


def collect_tempo_bpm(ocr_data):
    """type==tempo 항목 중 읽기 순으로 첫 번째 유효 BPM."""
    items = [it for it in ocr_data if it.get("type") == "tempo"]
    items.sort(key=lambda it: (it.get("page", 1), it.get("y", 0), it.get("x", 0)))
    for it in items:
        bpm = parse_bpm_from_text(it.get("text", ""))
        if bpm is not None:
            return bpm
    return None


def format_bpm_str(bpm: float) -> str:
    if bpm == int(bpm):
        return str(int(bpm))
    return str(bpm)


def first_measure_elem(parts, ns):
    if not parts:
        return None
    measures = findall_ns(parts[0], "measure", ns)
    return measures[0] if measures else None


def ensure_opening_tempo(parts, ns, bpm: float):
    """첫 파트 첫 마디의 sound tempo·metronome을 검토 BPM에 맞춘다. 없으면 direction을 추가한다."""
    bpm_str = format_bpm_str(bpm)
    measure = first_measure_elem(parts, ns)
    if measure is None:
        return

    has_sound_tempo = False
    first_metro_dir = None
    for direction in findall_ns(measure, "direction", ns):
        if direction.find(qname(ns, "metronome")) is not None and first_metro_dir is None:
            first_metro_dir = direction
        sound = direction.find(qname(ns, "sound"))
        if sound is not None and "tempo" in sound.attrib:
            sound.set("tempo", bpm_str)
            has_sound_tempo = True
        for el in direction.iter():
            if is_tag(el, ns, "per-minute"):
                el.text = bpm_str

    if has_sound_tempo:
        return
    if first_metro_dir is not None:
        sound_el = first_metro_dir.find(qname(ns, "sound"))
        if sound_el is None:
            sound_el = ET.SubElement(first_metro_dir, qname(ns, "sound"))
        sound_el.set("tempo", bpm_str)
        return

    # 첫 마디에 표준 템포 direction 삽입 (플레이어가 sound tempo를 읽도록)
    direction = ET.Element(qname(ns, "direction"))
    direction.set("placement", "above")
    dtype = ET.SubElement(direction, qname(ns, "direction-type"))
    metro = ET.SubElement(dtype, qname(ns, "metronome"))
    metro.set("parentheses", "no")
    beat = ET.SubElement(metro, qname(ns, "beat-unit"))
    beat.text = "quarter"
    pm = ET.SubElement(metro, qname(ns, "per-minute"))
    pm.text = bpm_str
    sound = ET.SubElement(direction, qname(ns, "sound"))
    sound.set("tempo", bpm_str)

    measure.insert(0, direction)


def collect_lyric_streams(ocr_data):
    """가사를 (파트, 가사 절, 멜로디 voice) 스트림으로 나눈다.

    - lyricVerseIndex: 1절·2절 등 → MusicXML `<lyric number>` (기본 1).
    - lyricVoice: 같은 시점에 겹치는 **서로 다른 멜로디 줄**(MusicXML `<voice>`), 1절/2절과 무관.
    """
    buckets = {}
    for item in ocr_data:
        if _skip_inject_meta_item(item):
            continue
        if item.get("type") != "lyrics":
            continue
        try:
            pi = int(item.get("lyricPartIndex", 1) or 1)
        except (TypeError, ValueError):
            pi = 1
        if pi < 1:
            pi = 1
        try:
            verse = int(item.get("lyricVerseIndex", 1) or 1)
        except (TypeError, ValueError):
            verse = 1
        if verse < 1:
            verse = 1
        if verse > 32:
            verse = 32
        mv = _normalize_lyric_voice(item.get("lyricVoice"))
        key = (pi, verse, mv)
        buckets.setdefault(key, []).append(item)

    by_part = {}
    for (pi, verse, mv), items in buckets.items():
        items.sort(key=lambda it: (it.get("page", 1), it.get("y", 0), it.get("x", 0)))
        by_part.setdefault(pi, []).append(
            {"verse": verse, "melody_voice": mv, "items": items}
        )
    for pi in by_part:
        by_part[pi].sort(key=lambda s: (s["verse"], s["melody_voice"]))
    return by_part


def load_ocr_items(json_in_path):
    """flat 배열 또는 v2/v3 manifest에서 inject 대상 항목 배열을 반환."""
    with open(json_in_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        v = data.get("v")
        if v in (2, 3) and isinstance(data.get("items"), list):
            rows = list(data["items"])
            manual = data.get("manualLyricRects") or []
            if manual:
                rows.append(
                    {
                        "id": "__manual_lyric_regions__",
                        "type": "_manual_lyric_mask",
                        "manualRects": manual,
                    }
                )
            return rows
    print(
        "inject_ocr: ocr_data는 항목 배열이거나 v2/v3 manifest { items: [...] } 여야 합니다.",
        file=sys.stderr,
    )
    return None


def _run_audiveris_mxl_fix(mxl_in_path, mxl_work_path):
    """Audiveris MXL → 잔여 P/2P direction·이중 staccato-natural 등 완화."""
    try:
        _scripts_dir = Path(__file__).resolve().parent
        if str(_scripts_dir) not in sys.path:
            sys.path.insert(0, str(_scripts_dir))
        from fix_audiveris_mxl import fix_mxl_file
    except ImportError as e:
        print(f"inject_ocr: fix_audiveris_mxl 임포트 실패: {e}", file=sys.stderr)
        return
    try:
        fix_mxl_file(mxl_in_path, mxl_work_path)
    except Exception as e:
        print(f"inject_ocr: fix_audiveris_mxl 경고: {e}", file=sys.stderr)


def _apply_part_labels_from_session(root, json_in_path):
    session_dir = Path(json_in_path).parent
    labels_path = session_dir / "part_labels.json"
    if not labels_path.is_file():
        preset_path = session_dir / "part_labels_preset.json"
        if preset_path.is_file():
            labels_path = preset_path
        else:
            return 0
    try:
        _scripts_dir = Path(__file__).resolve().parent
        if str(_scripts_dir) not in sys.path:
            sys.path.insert(0, str(_scripts_dir))
        from apply_part_labels import apply_part_labels_to_root, load_part_labels_json

        labels = load_part_labels_json(labels_path)
        if not labels:
            return 0
        n = apply_part_labels_to_root(root, labels)
        if n:
            print(
                f"inject_ocr: part-name {n}건 갱신 ({labels_path.name})",
                file=sys.stderr,
            )
        return n
    except Exception as e:
        print(f"inject_ocr: apply_part_labels 경고: {e}", file=sys.stderr)
        return 0


def inject_ocr(mxl_in_path, mxl_out_path, json_in_path):
    ocr_data = load_ocr_items(json_in_path)
    if ocr_data is None:
        print(
            "inject_ocr: OCR 항목 없음 — part-name 라벨만 적용합니다.",
            file=sys.stderr,
        )

    mxl_source = mxl_in_path
    mxl_tmp: str | None = None
    if os.environ.get("AUDIVERIS_MXL_FIX", "1").strip().lower() not in ("0", "false", "no"):
        import tempfile

        fd, mxl_tmp = tempfile.mkstemp(suffix=".mxl")
        os.close(fd)
        _run_audiveris_mxl_fix(mxl_in_path, mxl_tmp)
        mxl_source = mxl_tmp

    meta_path = Path(json_in_path).parent / "ocr_meta.json"
    transpose = 0
    if meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            transpose = int(meta.get("transposeSemitones", 0) or 0)
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            transpose = 0
    transpose = max(-24, min(24, transpose))

    with zipfile.ZipFile(mxl_source, "r") as z:
        files = {name: z.read(name) for name in z.namelist()}

    container_xml = files.get("META-INF/container.xml")
    if not container_xml:
        print("Invalid MXL")
        return

    container_str = container_xml.decode("utf-8")
    match = re.search(r'full-path="([^"]+)"', container_str)
    if match:
        root_file_path = match.group(1)
    else:
        print("Could not find rootfile in container.xml")
        return

    score_xml = files[root_file_path]
    tree = ET.parse(io.BytesIO(score_xml))
    root = tree.getroot()
    ns = mxl_ns_uri(root)

    parts = find_parts(root, ns)
    for part_el in parts:
        fix_key_signatures_part(part_el, ns)

    if transpose != 0:
        transpose_score_chromatic(root, ns, transpose)

    bpm_user = collect_tempo_bpm(ocr_data)
    if bpm_user is not None:
        ensure_opening_tempo(parts, ns, bpm_user)

    title_text = ""
    composer_text = ""
    lyricist_text = ""
    copyright_text = ""

    if ocr_data:
        for item in ocr_data:
            if _skip_inject_meta_item(item):
                continue
            t = item.get("type", "unknown")
            text = item.get("text", "")
            if t == "title":
                title_text += text + " "
            elif t == "composer":
                composer_text += text + " "
            elif t == "lyricist":
                lyricist_text += text + " "
            elif t == "copyright":
                copyright_text += text + " "

    if title_text:
        work = root.find(qname(ns, "work"))
        if work is None:
            work = ET.SubElement(root, qname(ns, "work"))
            root.insert(0, work)
        work_title = work.find(qname(ns, "work-title"))
        if work_title is None:
            work_title = ET.SubElement(work, qname(ns, "work-title"))
        work_title.text = title_text.strip()

    identification = root.find(qname(ns, "identification"))
    if identification is None and (composer_text or lyricist_text or copyright_text):
        identification = ET.SubElement(root, qname(ns, "identification"))
        idx_ins = 1 if root.find(qname(ns, "work")) is not None else 0
        root.insert(idx_ins, identification)

    if composer_text or lyricist_text:
        idf = root.find(qname(ns, "identification"))
        if idf is not None:
            for t_name, val in [
                ("composer", composer_text),
                ("lyricist", lyricist_text),
            ]:
                if val:
                    creator = ET.SubElement(idf, qname(ns, "creator"), type=t_name)
                    creator.text = val.strip()

    if copyright_text:
        idf = root.find(qname(ns, "identification"))
        if idf is not None:
            rights = idf.find(qname(ns, "rights"))
            if rights is None:
                rights = ET.SubElement(idf, qname(ns, "rights"))
            rights.text = copyright_text.strip()

    streams_by_part = collect_lyric_streams(ocr_data) if ocr_data else {}
    if streams_by_part and parts:
        for part_index in sorted(streams_by_part.keys()):
            stream_list = streams_by_part[part_index]
            p_idx0 = part_index - 1
            if p_idx0 < 0 or p_idx0 >= len(parts):
                print(
                    f"inject_ocr: 경고: lyricPartIndex={part_index} 인 파트가 없습니다(총 {len(parts)}개). 마지막 파트에 붙입니다.",
                    file=sys.stderr,
                )
                p_idx0 = len(parts) - 1
            part_el = parts[p_idx0]
            for stream in stream_list:
                verse_n = stream["verse"]
                mv = stream["melody_voice"]
                items = stream["items"]
                events = build_events_for_items(
                    items, part_el, ns, melody_voice_override=mv
                )
                apply_lyric_events(part_el, ns, events, lyric_number=verse_n)

    _apply_part_labels_from_session(root, json_in_path)

    out_xml_bytes = ET.tostring(root, encoding="UTF-8", xml_declaration=True)
    files[root_file_path] = out_xml_bytes

    try:
        with zipfile.ZipFile(mxl_out_path, "w", compression=zipfile.ZIP_DEFLATED) as z:
            for name, data in files.items():
                z.writestr(name, data)
    finally:
        if mxl_tmp and os.path.isfile(mxl_tmp):
            try:
                os.remove(mxl_tmp)
            except OSError:
                pass


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python inject_ocr.py <mxl_in_path> <mxl_out_path> <json_in_path>")
        sys.exit(1)
    inject_ocr(sys.argv[1], sys.argv[2], sys.argv[3])

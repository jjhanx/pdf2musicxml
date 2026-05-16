import sys
import zipfile
import io
import json
import xml.etree.ElementTree as ET
import re


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


def list_attachable_notes(part_el, ns):
    """(measure, note, voice) in score order."""
    out = []
    for measure in findall_ns(part_el, "measure", ns):
        for note in findall_ns(measure, "note", ns):
            if has_rest(note, ns):
                continue
            if has_chord(note, ns):
                continue
            if has_grace(note, ns):
                continue
            out.append((measure, note, note_voice(note, ns)))
    return out


def find_parts(root, ns):
    return findall_ns(root, "part", ns)


def add_lyric_to_note(note, ns, text_char):
    lyric_tag = qname(ns, "lyric")
    for old in list(note.findall(lyric_tag)):
        note.remove(old)
    lyric_el = ET.SubElement(note, lyric_tag)
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


def build_events_for_items(items_sorted):
    """
    items_sorted: 해당 파트에 붙일 가사 블록들 (페이지·y·x 정렬됨).
    각 블록마다 lyricSkipNotes·lyricVoice·text 적용.
    """
    events = []
    for it in items_sorted:
        voice = str(it.get("lyricVoice") or "1").strip() or "1"
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


def apply_lyric_events(part_el, ns, events):
    notes = list_attachable_notes(part_el, ns)
    idx = 0
    for ev in events:
        if ev["op"] == "skip_notes":
            v_target = ev["voice"]
            need = ev["count"]
            skipped = 0
            while idx < len(notes) and skipped < need:
                if notes[idx][2] == v_target:
                    skipped += 1
                idx += 1
        elif ev["op"] == "syllable":
            v_target = ev["voice"]
            char = ev["char"]
            while idx < len(notes) and notes[idx][2] != v_target:
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
                add_lyric_to_note(note, ns, char)


def collect_lyric_groups(ocr_data):
    """lyricPartIndex(1-based)별로 가사 항목을 모은 뒤, 각 그룹을 (page,y,x)로 정렬."""
    groups = {}
    for item in ocr_data:
        if item.get("type") != "lyrics":
            continue
        try:
            pi = int(item.get("lyricPartIndex", 1) or 1)
        except (TypeError, ValueError):
            pi = 1
        if pi < 1:
            pi = 1
        groups.setdefault(pi, []).append(item)
    for pi in groups:
        groups[pi].sort(
            key=lambda it: (it.get("page", 1), it.get("y", 0), it.get("x", 0))
        )
    return groups


def inject_ocr(mxl_in_path, mxl_out_path, json_in_path):
    with open(json_in_path, "r", encoding="utf-8") as f:
        ocr_data = json.load(f)

    with zipfile.ZipFile(mxl_in_path, "r") as z:
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

    title_text = ""
    composer_text = ""
    lyricist_text = ""
    copyright_text = ""

    for item in ocr_data:
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

    groups = collect_lyric_groups(ocr_data)
    if groups and parts:
        for part_index, items in sorted(groups.items()):
            p_idx0 = part_index - 1
            if p_idx0 < 0 or p_idx0 >= len(parts):
                print(
                    f"inject_ocr: 경고: lyricPartIndex={part_index} 인 파트가 없습니다(총 {len(parts)}개). 마지막 파트에 붙입니다.",
                    file=sys.stderr,
                )
                p_idx0 = len(parts) - 1
            part_el = parts[p_idx0]
            events = build_events_for_items(items)
            apply_lyric_events(part_el, ns, events)

    out_xml_bytes = ET.tostring(root, encoding="UTF-8", xml_declaration=True)
    files[root_file_path] = out_xml_bytes

    with zipfile.ZipFile(mxl_out_path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, data)


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python inject_ocr.py <mxl_in_path> <mxl_out_path> <json_in_path>")
        sys.exit(1)
    inject_ocr(sys.argv[1], sys.argv[2], sys.argv[3])

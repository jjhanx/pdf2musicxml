#!/usr/bin/env python3
import json
import sys
import zipfile
import io
import re
import copy
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

_PIANO_DISPLAY_LABELS = frozenset({"P", "PR", "PL", "PIANO"})

def _ns(root: ET.Element) -> str:
    t = root.tag
    return t[1 : t.index("}")] if t.startswith("{") else ""

def _q(ns: str, local: str) -> str:
    return f"{{{ns}}}{local}" if ns else local

def _local(el: ET.Element) -> str:
    t = el.tag
    return t[t.index("}") + 1 :] if t.startswith("{") else t

def _load_mxl_score_xml(mxl_path: Path) -> tuple[dict[str, bytes], str]:
    with zipfile.ZipFile(mxl_path, "r") as z:
        files = {name: z.read(name) for name in z.namelist()}
    container = files.get("META-INF/container.xml")
    if not container:
        raise ValueError("META-INF/container.xml 없음")
    m = re.search(rb'full-path="([^"]+)"', container)
    if not m:
        raise ValueError("container.xml에 rootfile 없음")
    root_path = m.group(1).decode("utf-8")
    if root_path not in files:
        raise ValueError(f"루트 MusicXML 없음: {root_path}")
    return files, root_path

def load_part_labels_json(path: Path | None) -> dict | None:
    if path is None or not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if isinstance(data, dict):
        return data
    return None

def parse_measure_spec(spec: str) -> set[int]:
    """Parses measure specs like '8-19', '20-26, 62-65', '10' into a set of integer measure numbers."""
    nums = set()
    for token in re.split(r'[,;\s]+', str(spec).strip()):
        if not token:
            continue
        if '-' in token:
            parts = token.split('-', 1)
            try:
                start, end = int(parts[0]), int(parts[1])
                nums.update(range(start, end + 1))
            except ValueError:
                pass
        else:
            try:
                nums.add(int(token))
            except ValueError:
                pass
    return nums

def get_pitch_value(note, ns=""):
    pitch = note.find(f"{ns}pitch")
    if pitch is None:
        return -1
    step = pitch.find(f"{ns}step")
    octave = pitch.find(f"{ns}octave")
    alter = pitch.find(f"{ns}alter")
    if step is None or octave is None or not step.text or not octave.text:
        return -1
    step_val = {"C": 0, "D": 1, "E": 2, "F": 3, "G": 4, "A": 5, "B": 6}.get(step.text, 0)
    alt_val = float(alter.text) * 0.1 if alter is not None and alter.text else 0.0
    return int(octave.text) * 7 + step_val + alt_val

def split_measure_elements(measure_children, target_count, ns=""):
    """
    Split elements of one staff into `target_count` parts (e.g. 2 for S and A, or T and B).
    """
    if target_count <= 1:
        return [[copy.deepcopy(child) for child in measure_children]]

    # 1. Check if multiple voices exist among pitched notes
    voices = set()
    for child in measure_children:
        if child.tag == f"{ns}note" and child.find(f"{ns}pitch") is not None:
            v = child.find(f"{ns}voice")
            if v is not None and v.text:
                voices.add(v.text)

    if len(voices) > 1:
        sorted_voices = sorted(list(voices))
        voice_to_target = {}
        for i, v in enumerate(sorted_voices):
            voice_to_target[v] = min(i, target_count - 1)

        out_children = [[] for _ in range(target_count)]
        for child in measure_children:
            if child.tag == f"{ns}note":
                if child.find(f"{ns}pitch") is not None:
                    v = child.find(f"{ns}voice")
                    v_text = v.text if v is not None and v.text else sorted_voices[0]
                    target_idx = voice_to_target.get(v_text, 0)
                    out_children[target_idx].append(copy.deepcopy(child))
                else:
                    for idx in range(target_count):
                        out_children[idx].append(copy.deepcopy(child))
            elif child.tag in (f"{ns}backup", f"{ns}forward"):
                pass
            else:
                for idx in range(target_count):
                    out_children[idx].append(copy.deepcopy(child))
        return out_children

    # 2. Single voice or chords
    out_children = [[] for _ in range(target_count)]
    current_chord = []

    def flush_chord():
        if not current_chord:
            return
        if len(current_chord) == 1:
            # Unison / single note: assign to all targets so both sing the line
            for idx in range(target_count):
                out_children[idx].append(copy.deepcopy(current_chord[0]))
        else:
            # Chord: higher pitch -> 1st target, lower pitch -> 2nd target
            sorted_chord = sorted(current_chord, key=lambda n: get_pitch_value(n, ns), reverse=True)
            for idx in range(target_count):
                note_idx = min(idx, len(sorted_chord) - 1)
                new_note = copy.deepcopy(sorted_chord[note_idx])
                chord_tag = new_note.find(f"{ns}chord")
                if chord_tag is not None:
                    new_note.remove(chord_tag)
                out_children[idx].append(new_note)
        current_chord.clear()

    for child in measure_children:
        if child.tag == f"{ns}note":
            if child.find(f"{ns}chord") is not None:
                current_chord.append(child)
            else:
                flush_chord()
                current_chord.append(child)
        elif child.tag in (f"{ns}backup", f"{ns}forward"):
            flush_chord()
            for idx in range(target_count):
                out_children[idx].append(copy.deepcopy(child))
        else:
            flush_chord()
            for idx in range(target_count):
                out_children[idx].append(copy.deepcopy(child))
    flush_chord()

    return out_children

def create_empty_rest_measure(measure_num: str, divisions: int, beats: int, beat_type: int, time_el: ET.Element | None, div_decl: bool, ns: str) -> ET.Element:
    m = ET.Element(_q(ns, "measure"), number=str(measure_num))
    if div_decl or time_el is not None:
        attr = ET.SubElement(m, _q(ns, "attributes"))
        if div_decl:
            d = ET.SubElement(attr, _q(ns, "divisions"))
            d.text = str(divisions)
        if time_el is not None:
            attr.append(copy.deepcopy(time_el))

    measure_len = max(1, round(divisions * beats * 4 / beat_type))
    note = ET.SubElement(m, _q(ns, "note"))
    ET.SubElement(note, _q(ns, "rest"), measure="yes")
    dur = ET.SubElement(note, _q(ns, "duration"))
    dur.text = str(measure_len)
    typ = ET.SubElement(note, _q(ns, "type"))
    typ.text = "whole"
    v = ET.SubElement(note, _q(ns, "voice"))
    v.text = "1"
    st = ET.SubElement(note, _q(ns, "staff"))
    st.text = "1"
    return m

def normalize_part_clefs(part: ET.Element, label: str, ns: str):
    """
    Ensures standard choral clefs:
    - S, A -> Always Treble clef (G2), never Bass clef (F4)
    - B -> Default Bass clef (F4)
    """
    label_upper = label.upper()
    first_m = part.find(f'./{_q(ns, "measure")}')
    if first_m is None:
        return

    attrs = first_m.find(_q(ns, "attributes"))
    if attrs is None:
        attrs = ET.Element(_q(ns, "attributes"))
        first_m.insert(0, attrs)

    if label_upper in ("S", "A", "SOPRANO", "ALTO", "W", "WOMEN"):
        # 1. Ensure measure 1 has G2
        clefs = attrs.findall(_q(ns, "clef"))
        if clefs:
            for c in clefs:
                sign = c.find(_q(ns, "sign"))
                line = c.find(_q(ns, "line"))
                if sign is not None:
                    sign.text = "G"
                if line is not None:
                    line.text = "2"
        else:
            c = ET.SubElement(attrs, _q(ns, "clef"))
            ET.SubElement(c, _q(ns, "sign")).text = "G"
            ET.SubElement(c, _q(ns, "line")).text = "2"

        # 2. Strip any spurious mid-score F-clefs in Soprano/Alto
        for m in part.findall(_q(ns, "measure")):
            for a in m.findall(_q(ns, "attributes")):
                for c in list(a.findall(_q(ns, "clef"))):
                    sign = c.findtext(_q(ns, "sign"))
                    if sign == "F":
                        a.remove(c)

    elif label_upper in ("B", "BASS", "MEN_B"):
        clefs = attrs.findall(_q(ns, "clef"))
        if clefs:
            for c in clefs:
                sign = c.find(_q(ns, "sign"))
                line = c.find(_q(ns, "line"))
                if sign is not None:
                    sign.text = "F"
                if line is not None:
                    line.text = "4"
        else:
            c = ET.SubElement(attrs, _q(ns, "clef"))
            ET.SubElement(c, _q(ns, "sign")).text = "F"
            ET.SubElement(c, _q(ns, "line")).text = "4"

def restructure_mxl(mxl_in: Path, mxl_out: Path, labels_path: Path):
    labels_data = load_part_labels_json(labels_path)
    if not labels_data:
        if mxl_in.resolve() != mxl_out.resolve():
            mxl_out.write_bytes(mxl_in.read_bytes())
        return

    labels = [str(x).strip() for x in labels_data.get("labelsByIndex", []) if str(x).strip()]
    if not labels:
        if mxl_in.resolve() != mxl_out.resolve():
            mxl_out.write_bytes(mxl_in.read_bytes())
        return

    # Check explicit section / measure range mappings from JSON
    section_mappings = []
    for entry in labels_data.get("sectionMappings", []) or labels_data.get("measureRangeMapping", []):
        if isinstance(entry, dict) and ("measures" in entry or "range" in entry):
            spec = entry.get("measures") or entry.get("range")
            target = entry.get("target") or entry.get("targetLabels") or []
            if isinstance(target, str):
                target = [target]
            m_set = parse_measure_spec(spec)
            if m_set and target:
                section_mappings.append((m_set, [str(t).strip().upper() for t in target]))

    try:
        files, root_path = _load_mxl_score_xml(mxl_in)
        root = ET.parse(io.BytesIO(files[root_path])).getroot()
        ns = _ns(root)

        part_list = root.find(_q(ns, "part-list"))
        if part_list is None:
            raise ValueError("No part-list found")

        new_part_list = ET.Element(_q(ns, "part-list"))
        for i, label in enumerate(labels):
            pid = f"P{i+1}"
            sp = ET.SubElement(new_part_list, _q(ns, "score-part"), id=pid)
            pn = ET.SubElement(sp, _q(ns, "part-name"))
            pn.text = label

        part_list_parent = None
        for parent in root.iter():
            for child in parent:
                if child == part_list:
                    part_list_parent = parent
                    break
            if part_list_parent is not None:
                break

        if part_list_parent is not None:
            idx = list(part_list_parent).index(part_list)
            part_list_parent.remove(part_list)
            part_list_parent.insert(idx, new_part_list)

        parts_by_id = {p.get("id"): p for p in root.findall(_q(ns, "part"))}
        new_parts = {f"P{i+1}": ET.Element(_q(ns, "part"), id=f"P{i+1}") for i in range(len(labels))}

        all_measure_nums = []
        for part in root.findall(_q(ns, "part")):
            for measure in part.findall(_q(ns, "measure")):
                num = measure.get("number")
                if num is not None and num not in all_measure_nums:
                    all_measure_nums.append(num)

        measure_nums = sorted(
            all_measure_nums,
            key=lambda x: int(re.sub(r"[^0-9]", "", x)) if re.sub(r"[^0-9]", "", x) else 0,
        )

        # Identify Piano part in source and target
        piano_src_pid = None
        for pid, p in reversed(list(parts_by_id.items())):
            has_multi_staff = False
            for m in p.findall(_q(ns, "measure")):
                for n in m.findall(_q(ns, "note")):
                    st = n.find(_q(ns, "staff"))
                    if st is not None and st.text == "2":
                        has_multi_staff = True
                        break
                if has_multi_staff:
                    break
            if has_multi_staff:
                piano_src_pid = pid
                break

        if not piano_src_pid and len(parts_by_id) >= 5:
            piano_src_pid = list(parts_by_id.keys())[-1]

        vocal_src_pids = [pid for pid in parts_by_id if pid != piano_src_pid]

        # Target vocal part IDs: P1, P2, P3, P4
        target_vocal_pids = [f"P{i+1}" for i, l in enumerate(labels) if l.upper() not in _PIANO_DISPLAY_LABELS]
        target_piano_pid = next((f"P{i+1}" for i, l in enumerate(labels) if l.upper() in _PIANO_DISPLAY_LABELS), None)
        if not target_vocal_pids and len(labels) >= 1:
            target_vocal_pids = [f"P{i+1}" for i in range(min(4, len(labels)))]

        label_to_pid = {l.upper(): f"P{i+1}" for i, l in enumerate(labels)}

        # Form contiguous blocks of single-vocal measures to determine phrase-level register
        single_vocal_blocks = []
        current_block = []

        for num in measure_nums:
            active_m_list = []
            for pid in vocal_src_pids:
                p = parts_by_id[pid]
                m = p.find(f'./{_q(ns, "measure")}[@number="{num}"]')
                if m is not None:
                    pitched = [n for n in m.findall(_q(ns, "note")) if n.find(_q(ns, "pitch")) is not None]
                    if pitched:
                        active_m_list.append((pid, m, pitched))
            if len(active_m_list) == 1:
                current_block.append((num, active_m_list[0]))
            else:
                if current_block:
                    single_vocal_blocks.append(current_block)
                    current_block = []
        if current_block:
            single_vocal_blocks.append(current_block)

        measure_reg_cache = {}
        for block in single_vocal_blocks:
            all_pitches = []
            has_f_clef = False
            for num, (pid, m, pitched) in block:
                clef = m.find(f'.//{_q(ns, "clef")}')
                if clef is not None and clef.findtext(_q(ns, "sign")) == "F":
                    has_f_clef = True
                for n in pitched:
                    pv = get_pitch_value(n, ns=_q(ns, ""))
                    if pv > 0:
                        all_pitches.append(pv)
            avg_p = sum(all_pitches) / len(all_pitches) if all_pitches else 30.0
            min_p = min(all_pitches) if all_pitches else 30.0
            block_reg = "men" if (has_f_clef or min_p <= 22 or avg_p < 27.5) else "women"
            for num, _ in block:
                measure_reg_cache[num] = block_reg

        for num in measure_nums:
            m_int = int(re.sub(r"[^0-9]", "", num)) if re.sub(r"[^0-9]", "", num) else 0
            # Explicit section mapping overrides any automatic heuristic
            for m_set, tgt in section_mappings:
                if m_int in m_set:
                    measure_reg_cache[num] = "explicit:" + ",".join(tgt)
                    break

        curr_divisions = 24
        curr_beats = 4
        curr_beat_type = 4

        for num in measure_nums:
            active_vocal = []
            first_vocal_measure = None
            time_node = None
            new_div = False

            for pid in parts_by_id:
                p = parts_by_id[pid]
                m = p.find(f'./{_q(ns, "measure")}[@number="{num}"]')
                if m is not None:
                    if first_vocal_measure is None and pid in vocal_src_pids:
                        first_vocal_measure = m
                    d = m.find(f'{_q(ns, "attributes")}/{_q(ns, "divisions")}')
                    if d is not None and d.text:
                        try:
                            curr_divisions = int(d.text.strip())
                            new_div = True
                        except Exception:
                            pass
                    t_el = m.find(f'{_q(ns, "attributes")}/{_q(ns, "time")}')
                    if t_el is not None:
                        time_node = t_el
                        b = t_el.findtext(_q(ns, 'beats'))
                        bt = t_el.findtext(_q(ns, 'beat-type'))
                        if b and bt:
                            try:
                                curr_beats = int(b.strip())
                                curr_beat_type = int(bt.strip())
                            except Exception:
                                pass
                    if pid in vocal_src_pids:
                        pitched = [n for n in m.findall(_q(ns, "note")) if n.find(_q(ns, "pitch")) is not None]
                        if pitched:
                            active_vocal.append((pid, m))

            vocal_out_measures = {t_pid: ET.Element(_q(ns, "measure"), number=str(num)) for t_pid in target_vocal_pids}

            # Distribute vocal notes
            if len(active_vocal) == 0:
                # All vocal parts silent (Piano Intro / Interlude)
                for t_pid in target_vocal_pids:
                    src_m = parts_by_id.get(t_pid, first_vocal_measure).find(f'./{_q(ns, "measure")}[@number="{num}"]') if t_pid in parts_by_id else first_vocal_measure
                    if src_m is not None:
                        vocal_out_measures[t_pid] = copy.deepcopy(src_m)
                    else:
                        vocal_out_measures[t_pid] = create_empty_rest_measure(num, curr_divisions, curr_beats, curr_beat_type, time_node, new_div, ns)

            elif len(active_vocal) == 1:
                # 1 vocal staff active (e.g. Women m8~19 S&A, or Men m20~26 T&B)
                src_pid, src_m = active_vocal[0]
                elements = list(src_m)
                reg_info = measure_reg_cache.get(num, "women")

                assigned_pids = []
                if reg_info.startswith("explicit:"):
                    raw_tgts = reg_info[9:].split(",")
                    for t in raw_tgts:
                        p_mapped = label_to_pid.get(t.upper())
                        if p_mapped and p_mapped in target_vocal_pids:
                            assigned_pids.append(p_mapped)
                elif reg_info == "men" and len(target_vocal_pids) >= 4:
                    # Men unison/duet -> T (P3) and B (P4)
                    assigned_pids = target_vocal_pids[2:4]
                elif len(target_vocal_pids) >= 2:
                    # Women unison/duet -> S (P1) and A (P2)
                    assigned_pids = target_vocal_pids[:2]
                else:
                    assigned_pids = target_vocal_pids[:1]

                if not assigned_pids:
                    assigned_pids = target_vocal_pids[:2] if len(target_vocal_pids) >= 2 else target_vocal_pids[:1]

                split_res = split_measure_elements(elements, len(assigned_pids), ns=_q(ns, ""))
                for t_idx, t_pid in enumerate(assigned_pids):
                    for el in split_res[t_idx]:
                        vocal_out_measures[t_pid].append(copy.deepcopy(el))

                # Non-assigned vocal parts receive full-measure rests
                for t_pid in target_vocal_pids:
                    if t_pid not in assigned_pids:
                        vocal_out_measures[t_pid] = create_empty_rest_measure(num, curr_divisions, curr_beats, curr_beat_type, time_node, new_div, ns)

            elif len(active_vocal) == 2:
                # 2 vocal staves active (Staff 1: S&A, Staff 2: T&B)
                st1_pid, st1_m = active_vocal[0]
                st2_pid, st2_m = active_vocal[1]

                if len(target_vocal_pids) >= 4:
                    split_sa = split_measure_elements(list(st1_m), 2, ns=_q(ns, ""))
                    split_tb = split_measure_elements(list(st2_m), 2, ns=_q(ns, ""))

                    for el in split_sa[0]:
                        vocal_out_measures[target_vocal_pids[0]].append(copy.deepcopy(el))
                    for el in split_sa[1]:
                        vocal_out_measures[target_vocal_pids[1]].append(copy.deepcopy(el))
                    for el in split_tb[0]:
                        vocal_out_measures[target_vocal_pids[2]].append(copy.deepcopy(el))
                    for el in split_tb[1]:
                        vocal_out_measures[target_vocal_pids[3]].append(copy.deepcopy(el))
                else:
                    vocal_out_measures[target_vocal_pids[0]] = copy.deepcopy(st1_m)
                    if len(target_vocal_pids) > 1:
                        vocal_out_measures[target_vocal_pids[1]] = copy.deepcopy(st2_m)

            elif len(active_vocal) == 3 and len(target_vocal_pids) >= 4:
                st1_pid, st1_m = active_vocal[0]
                st2_pid, st2_m = active_vocal[1]
                st3_pid, st3_m = active_vocal[2]

                vocal_out_measures[target_vocal_pids[0]] = copy.deepcopy(st1_m)
                vocal_out_measures[target_vocal_pids[1]] = copy.deepcopy(st2_m)
                split_tb = split_measure_elements(list(st3_m), 2, ns=_q(ns, ""))
                for el in split_tb[0]:
                    vocal_out_measures[target_vocal_pids[2]].append(copy.deepcopy(el))
                for el in split_tb[1]:
                    vocal_out_measures[target_vocal_pids[3]].append(copy.deepcopy(el))

            else:
                # 4 or more active vocal staves: 1-to-1 mapping
                for idx, t_pid in enumerate(target_vocal_pids):
                    src_idx = min(idx, len(active_vocal) - 1)
                    src_pid, src_m = active_vocal[src_idx]
                    vocal_out_measures[t_pid] = copy.deepcopy(src_m)

            for t_pid in target_vocal_pids:
                if t_pid in new_parts:
                    new_parts[t_pid].append(vocal_out_measures[t_pid])

            # Process Piano part
            if target_piano_pid and target_piano_pid in new_parts:
                if piano_src_pid and piano_src_pid in parts_by_id:
                    p_m = parts_by_id[piano_src_pid].find(f'./{_q(ns, "measure")}[@number="{num}"]')
                    if p_m is not None:
                        new_parts[target_piano_pid].append(copy.deepcopy(p_m))
                    else:
                        new_parts[target_piano_pid].append(create_empty_rest_measure(num, curr_divisions, curr_beats, curr_beat_type, time_node, new_div, ns))
                else:
                    new_parts[target_piano_pid].append(create_empty_rest_measure(num, curr_divisions, curr_beats, curr_beat_type, time_node, new_div, ns))

        # Normalize clefs for all vocal parts (ensure S/A are Treble, B is Bass)
        for i, label in enumerate(labels):
            pid = f"P{i+1}"
            if pid in new_parts:
                normalize_part_clefs(new_parts[pid], label, ns)

        for old_part in root.findall(_q(ns, "part")):
            root.remove(old_part)

        for np_id in new_parts:
            root.append(new_parts[np_id])

        mxl_out.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(mxl_out, "w", zipfile.ZIP_DEFLATED) as z:
            for name, data in files.items():
                if name == root_path:
                    z.writestr(name, ET.tostring(root, encoding="UTF-8", xml_declaration=True))
                else:
                    z.writestr(name, data)

        print(f"restructure_mxl successfully completed: {mxl_out}")

    except Exception as e:
        import traceback
        traceback.print_exc()
        try:
            Path("restructure_crash.txt").write_text(traceback.format_exc(), encoding="utf-8")
        except Exception:
            pass
        if mxl_in.resolve() != mxl_out.resolve():
            mxl_out.write_bytes(mxl_in.read_bytes())

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: restructure_mxl_parts.py <in.mxl> <out.mxl> <labels.json>")
        sys.exit(1)
    restructure_mxl(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))

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

def load_part_labels_json(path: Path | None) -> list[str] | None:
    if path is None or not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if isinstance(data, dict) and isinstance(data.get("labelsByIndex"), list):
        labels = [str(x).strip() for x in data["labelsByIndex"]]
        if labels and all(labels):
            return labels
    return None

def determine_mapping_advanced(staves, labels):
    target_logical_staves = []
    for i, label in enumerate(labels):
        pid = f"P{i+1}"
        if label.upper() in _PIANO_DISPLAY_LABELS:
            target_logical_staves.append((pid, "1", label))
            target_logical_staves.append((pid, "2", label))
        else:
            target_logical_staves.append((pid, "1", label))
            
    num_source = len(staves)
    num_target = len(target_logical_staves)
    
    mapping = defaultdict(list)
    
    if num_source == num_target:
        for s, t in zip(staves, target_logical_staves):
            mapping[s].append((t[0], t[1]))
    elif num_source < num_target:
        if len(staves) >= 2 and target_logical_staves[-1][2].upper() in _PIANO_DISPLAY_LABELS:
            mapping[staves[-1]].append((target_logical_staves[-1][0], target_logical_staves[-1][1]))
            mapping[staves[-2]].append((target_logical_staves[-2][0], target_logical_staves[-2][1]))
            
            rem_source = staves[:-2]
            rem_target = target_logical_staves[:-2]
            
            if not rem_source:
                pass
            elif len(rem_source) == 2 and len(rem_target) == 4:
                mapping[rem_source[0]] = [(rem_target[0][0], rem_target[0][1]), (rem_target[1][0], rem_target[1][1])]
                mapping[rem_source[1]] = [(rem_target[2][0], rem_target[2][1]), (rem_target[3][0], rem_target[3][1])]
            else:
                idx = 0
                for t in rem_target:
                    mapping[rem_source[min(idx, len(rem_source)-1)]].append((t[0], t[1]))
                    idx += 1
        else:
            for i, t in enumerate(target_logical_staves):
                mapping[staves[min(i, num_source-1)]].append((t[0], t[1]))
    else:
        for i, t in enumerate(target_logical_staves):
            mapping[staves[-num_target + i]].append((t[0], t[1]))
            
    return mapping

def get_pitch_value(note, ns=""):
    pitch = note.find(f"{ns}pitch")
    if pitch is None:
        return -1
    step = pitch.find(f"{ns}step")
    octave = pitch.find(f"{ns}octave")
    if step is None or octave is None:
        return -1
    step_val = {"C":0, "D":1, "E":2, "F":3, "G":4, "A":5, "B":6}.get(step.text, 0)
    return int(octave.text) * 7 + step_val

def split_measure_elements(measure_children, target_count, ns=""):
    voices = set()
    for child in measure_children:
        if child.tag == f"{ns}note":
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
                v = child.find(f"{ns}voice")
                v_text = v.text if v is not None else sorted_voices[0]
                target_idx = voice_to_target.get(v_text, 0)
                out_children[target_idx].append(copy.deepcopy(child))
            elif child.tag in (f"{ns}backup", f"{ns}forward"):
                pass
            else:
                for idx in range(target_count):
                    out_children[idx].append(copy.deepcopy(child))
        return out_children
        
    else:
        out_children = [[] for _ in range(target_count)]
        current_chord = []
        
        def flush_chord():
            if not current_chord: return
            if len(current_chord) == 1:
                for idx in range(target_count):
                    out_children[idx].append(copy.deepcopy(current_chord[0]))
            else:
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

def restructure_mxl(mxl_in: Path, mxl_out: Path, labels_path: Path):
    labels = load_part_labels_json(labels_path)
    print("LABELS:", labels)
    if not labels:
        if mxl_in.resolve() != mxl_out.resolve():
            mxl_out.write_bytes(mxl_in.read_bytes())
        return

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
            if part_list_parent is not None: break
        
        if part_list_parent is not None:
            idx = list(part_list_parent).index(part_list)
            part_list_parent.remove(part_list)
            part_list_parent.insert(idx, new_part_list)

        measures_by_num = defaultdict(list)
        for part in root.findall(_q(ns, "part")):
            for measure in part.findall(_q(ns, "measure")):
                num = measure.get("number")
                if num is not None:
                    measures_by_num[num].append((part, measure))

        new_parts = {f"P{i+1}": ET.Element(_q(ns, "part"), id=f"P{i+1}") for i in range(len(labels))}
        
        measure_nums = sorted(list(measures_by_num.keys()), key=lambda x: int(re.sub(r'[^0-9]', '', x)) if re.sub(r'[^0-9]', '', x) else 0)

        for num in measure_nums:
            measure_nodes = measures_by_num[num]
            staves = set()
            for part, measure in measure_nodes:
                pid = part.get("id")
                for note in measure.findall(_q(ns, "note")):
                    staff = note.find(_q(ns, "staff"))
                    s_num = staff.text if staff is not None else "1"
                    staves.add((pid, s_num))
            
            sorted_staves = sorted(list(staves))
            mapping = determine_mapping_advanced(sorted_staves, labels)
            
            new_measures = defaultdict(lambda: ET.Element(_q(ns, "measure"), number=num))
            for i in range(len(labels)):
                _ = new_measures[f"P{i+1}"]
            
            for part, measure in measure_nodes:
                pid = part.get("id")
                
                elements_by_staff = defaultdict(list)
                current_staff = "1"
                
                for child in measure:
                    tag = _local(child)
                    if tag in ("note", "direction"):
                        st_el = child.find(_q(ns, "staff"))
                        if st_el is not None and st_el.text:
                            current_staff = st_el.text
                    elements_by_staff[current_staff].append(child)
                    
                for s_num, elements in elements_by_staff.items():
                    while elements and _local(elements[-1]) in ("backup", "forward"):
                        elements.pop()
                        
                    targets = mapping.get((pid, s_num))
                    if not targets: continue
                    
                    target_count = len(targets)
                    split_res = split_measure_elements(elements, target_count, _q(ns, ""))
                    
                    for target_idx, (new_p, new_s) in enumerate(targets):
                        for el in split_res[target_idx]:
                            el_copy = copy.deepcopy(el)
                            st_el = el_copy.find(_q(ns, "staff"))
                            if st_el is None and _local(el_copy) == "note":
                                st_el = ET.SubElement(el_copy, _q(ns, "staff"))
                            if st_el is not None:
                                st_el.text = new_s
                            new_measures[new_p].append(el_copy)

            for np_id in new_parts:
                new_parts[np_id].append(new_measures[np_id])
                
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
                    
    except Exception as e:
        import traceback
        traceback.print_exc()
        try:
            Path('restructure_crash.txt').write_text(traceback.format_exc(), encoding='utf-8')
        except:
            pass
        if mxl_in.resolve() != mxl_out.resolve():
            mxl_out.write_bytes(mxl_in.read_bytes())

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: restructure_mxl_parts.py <in.mxl> <out.mxl> <labels.json>")
        sys.exit(1)
    restructure_mxl(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))

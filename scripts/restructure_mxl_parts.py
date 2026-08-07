#!/usr/bin/env python3
import json
import sys
import zipfile
import io
import re
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

_PIANO_DISPLAY_LABELS = frozenset({"P", "PR", "PL", "PIANO"})

def _ns(root: ET.Element) -> str:
    t = root.tag
    return t[1 : t.index("}")] if t.startswith("{") else ""

def _q(ns: str, local: str) -> str:
    return f"{{{ns}}}{local}" if ns else local

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

def determine_mapping(k: int, labels: list[str]) -> list[tuple[str, str]]:
    target_parts = []
    for i, label in enumerate(labels):
        pid = f"P{i+1}"
        if label.upper() in _PIANO_DISPLAY_LABELS:
            target_parts.append((pid, "1"))
            target_parts.append((pid, "2"))
        else:
            target_parts.append((pid, "1"))
            
    if k >= len(target_parts):
        return target_parts[:k]
    
    # Generic heuristic for typical scores: piano at bottom
    if len(labels) == 3 and labels[-1].upper() in _PIANO_DISPLAY_LABELS:
        if k == 2:
            return [("P3", "1"), ("P3", "2")]
        if k == 3:
            # Fallback SA + Piano
            return [("P1", "1"), ("P3", "1"), ("P3", "2")]
    
    return target_parts[-k:]

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

        # Create new part-list based on labels
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
            if part_list_parent: break
        
        if part_list_parent is not None:
            idx = list(part_list_parent).index(part_list)
            part_list_parent.remove(part_list)
            part_list_parent.insert(idx, new_part_list)

        # Re-assign measures
        measures_by_num = defaultdict(list)
        for part in root.findall(_q(ns, "part")):
            for measure in part.findall(_q(ns, "measure")):
                num = measure.get("number")
                if num is not None:
                    measures_by_num[num].append((part, measure))

        new_parts = {f"P{i+1}": ET.Element(_q(ns, "part"), id=f"P{i+1}") for i in range(len(labels))}
        
        # Sort measure numbers to process in order (basic sort, assuming numbers are sequential or logical)
        measure_nums = sorted(list(measures_by_num.keys()), key=lambda x: int(re.sub(r'[^0-9]', '', x)) if re.sub(r'[^0-9]', '', x) else 0)

        for num in measure_nums:
            measure_nodes = measures_by_num[num]
            staves = set()
            for part, measure in measure_nodes:
                pid = part.get("id")
                # find all staff elements in notes
                for note in measure.findall(_q(ns, "note")):
                    staff = note.find(_q(ns, "staff"))
                    s_num = staff.text if staff is not None else "1"
                    staves.add((pid, s_num))
            
            # Sort staves (P1-1, P1-2, P2-1...)
            sorted_staves = sorted(list(staves))
            mapping = determine_mapping(len(sorted_staves), labels)
            
            # map: (old_pid, old_snum) -> (new_pid, new_snum)
            staff_map = {old: new for old, new in zip(sorted_staves, mapping)}
            
            # Create a combined measure for each new part
            new_measures = defaultdict(lambda: ET.Element(_q(ns, "measure"), number=num))
            for i in range(len(labels)):
                _ = new_measures[f"P{i+1}"]
            
            # Merge attributes from first available measure
            attrs_copied = False
            for part, measure in measure_nodes:
                # Copy everything but attributes and notes first
                for child in measure:
                    tag = _local(child) if hasattr(child, 'tag') else child.tag
                    if tag == "attributes":
                        if not attrs_copied:
                            for np_id, nm in new_measures.items():
                                nm.append(ET.fromstring(ET.tostring(child)))
                            attrs_copied = True
                    elif tag == "note" or tag == "backup" or tag == "forward":
                        pass
                    else:
                        # Append other elements to the first part to avoid duplication
                        if len(labels) > 0:
                            new_measures[f"P1"].append(ET.fromstring(ET.tostring(child)))
            
            # Now distribute notes/backups
            for part, measure in measure_nodes:
                pid = part.get("id")
                for child in measure:
                    tag = _local(child) if hasattr(child, 'tag') else child.tag
                    if tag in ["note", "backup", "forward"]:
                        staff = child.find(_q(ns, "staff"))
                        s_num = staff.text if staff is not None else "1"
                        new_p, new_s = staff_map.get((pid, s_num), (f"P1", "1"))
                        
                        child_copy = ET.fromstring(ET.tostring(child))
                        staff_el = child_copy.find(_q(ns, "staff"))
                        if staff_el is None and tag == "note":
                            staff_el = ET.SubElement(child_copy, _q(ns, "staff"))
                        if staff_el is not None:
                            staff_el.text = new_s
                            
                        new_measures[new_p].append(child_copy)

            # Append new measures to parts
            for np_id in new_parts:
                new_parts[np_id].append(new_measures[np_id])
                
        # Remove old parts and add new
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
        if mxl_in.resolve() != mxl_out.resolve():
            mxl_out.write_bytes(mxl_in.read_bytes())

def _local(el: ET.Element) -> str:
    t = el.tag
    return t[t.index("}") + 1 :] if t.startswith("{") else t

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: restructure_mxl_parts.py <in.mxl> <out.mxl> <labels.json>")
        sys.exit(1)
    restructure_mxl(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))

import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]

def _renumber_tuplets_in_measure(measure: ET.Element, ns: str) -> int:
    fixed = 0
    tuplet_count = 0
    current_mapping = {}
    
    for note in measure.findall(f"{ns}note"):
        notations = note.find(f"{ns}notations")
        if notations is not None:
            for tuplet in notations.findall(f"{ns}tuplet"):
                old_num = tuplet.get("number") or "1"
                typ = tuplet.get("type")
                if typ == "start":
                    tuplet_count = (tuplet_count % 6) + 1
                    current_mapping[old_num] = str(tuplet_count)
                    if tuplet.get("number") != str(tuplet_count):
                        tuplet.set("number", str(tuplet_count))
                        fixed += 1
                elif typ == "stop":
                    new_num = current_mapping.get(old_num, "1")
                    if tuplet.get("number") != new_num:
                        tuplet.set("number", new_num)
                        fixed += 1
                    if old_num in current_mapping:
                        del current_mapping[old_num]
    return fixed

tree = ET.parse('test-out2.xml')
strip_ns(tree)
meas = tree.find('.//part[@id="P5"]/measure[@number="45"]')
_renumber_tuplets_in_measure(meas, '')

for n in meas.findall('note'):
    st = n.find('staff').text if n.find('staff') is not None else '?'
    if st == '2':
        notations = n.find('notations')
        if notations is not None:
            for tup in notations.findall('tuplet'):
                print(f"{tup.get('type')} number={tup.get('number')}")

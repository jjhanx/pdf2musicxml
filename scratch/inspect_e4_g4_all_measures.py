import xml.etree.ElementTree as ET

def main():
    tree = ET.parse('noon.xml')
    root = tree.getroot()
    
    # Strip namespaces
    for el in root.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
            
    part = root.find('.//part[@id="P5"]')
    if part is None:
        part = root.find('.//part')
        
    measure = part.find('.//measure[@number="44"]')
    if measure is None:
        print("Measure 44 not found")
        return
        
    print("=== Measure 44 ===")
    for idx, note in enumerate(measure.findall('note')):
        pitch = note.find('pitch')
        step = pitch.find('step').text + pitch.find('octave').text if pitch is not None else 'Rest'
        chord = 'Chord' if note.find('chord') is not None else 'Lead'
        staff = note.find('staff').text if note.find('staff') is not None else '1'
        slurs = [s.get('type') for s in note.findall('.//slur')]
        print(f"[{idx:2d}] S{staff} {chord:5s} {step} slurs: {slurs}")

if __name__ == '__main__':
    main()

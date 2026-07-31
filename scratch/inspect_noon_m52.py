import xml.etree.ElementTree as ET
import sys

def inspect_m52(filepath):
    print(f"Inspecting {filepath} measure 52...")
    tree = ET.parse(filepath)
    root = tree.getroot()
    
    # Strip namespace
    for el in root.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
            
    part = root.find('.//part[@id="P5"]')
    if part is None:
        part = root.find('.//part')
    measure = part.find(f".//measure[@number='52']")
    if measure is None:
        print("Measure 52 not found")
        return
        
    for idx, note in enumerate(measure.findall('note')):
        staff = note.find('staff').text if note.find('staff') is not None else '1'
        voice = note.find('voice').text if note.find('voice') is not None else '1'
        chord = "Chord" if note.find('chord') is not None else "     "
        pitch_el = note.find('pitch')
        step = pitch_el.find('step').text if pitch_el is not None else 'Rest'
        octave = pitch_el.find('octave').text if pitch_el is not None else ''
        beam_els = note.findall('beam')
        beams = [b.text for b in beam_els]
        slurs = []
        notations = note.find('notations')
        if notations is not None:
            for s in notations.findall('slur'):
                slurs.append(f"{s.get('type')}({s.get('number')})")
        print(f"[{idx:2d}] Staff {staff} Voice {voice} {chord} {step}{octave} Beams: {beams} Slurs: {slurs}")

if __name__ == '__main__':
    inspect_m52('noon.xml')

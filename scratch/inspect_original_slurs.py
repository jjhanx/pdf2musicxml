import zipfile
import xml.etree.ElementTree as ET
import re

def main():
    filename = '눈\xa0김효근\xa04부\xa010쪽.mxl'
    safe_name = filename.encode('ascii', errors='replace').decode('ascii')
    print(f"Reading {safe_name}...")
    with zipfile.ZipFile(filename) as z:
        c = z.read("META-INF/container.xml").decode("utf-8")
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        root = ET.fromstring(z.read(rf))
        
    ns = re.match(r"\{(.*)\}", root.tag).group(1) if re.match(r"\{(.*)\}", root.tag) else ""
    def q(t):
        return f"{{{ns}}}{t}" if ns else t
        
    part = root.find(f".//{q('part')}[@id='P5']")
    if part is None:
        print("P5 not found")
        return
        
    for mn in ('6', '30', '52'):
        m = part.find(f".//{q('measure')}[@number='{mn}']")
        if m is None:
            print(f"Measure {mn} not found")
            continue
        print(f"=== Measure {mn}")
        found = False
        for idx, n in enumerate(m.findall(q('note'))):
            st = n.find(q('staff'))
            st_val = st.text if st is not None else '1'
            if st_val != '1':
                continue
            pitch = n.find(q('pitch'))
            if pitch is None:
                continue
            step = pitch.find(q('step')).text + pitch.find(q('octave')).text
            slurs = n.findall(f".//{q('slur')}")
            if slurs:
                slur_types = [s.get('type') for s in slurs]
                print(f"  idx {idx} {step} slurs: {slur_types}")
                found = True
        if not found:
            print("  No slurs found")

if __name__ == '__main__':
    main()

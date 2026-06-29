#!/usr/bin/env python3
import io,re,sys,zipfile
import xml.etree.ElementTree as ET
sys.path.insert(0,"scripts")
import fix_audiveris_mxl as fix

def load(p):
    with zipfile.ZipFile(p) as z:
        c=z.read("META-INF/container.xml").decode()
        m=re.search(r'full-path="([^"]+)"',c)
        return ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()

def accs(root, mxl):
    ns=fix.mxl_ns_uri(root)
    part=root.findall(".//"+fix.qname(ns,"part"))[4]
    for measure,_,_ in fix._iter_measures_with_timing(part,ns):
        if measure.get("number")!=str(mxl): continue
        print("mxl", mxl)
        for g in fix._iter_chord_groups(measure,ns):
            if g[2]!="1": continue
            for n in g[1]:
                acc=n.find(fix.qname(ns,"accidental"))
                p=fix._pitch_label(n,ns)
                a = acc.text if acc is not None else "-"
                print(" ", p, "acc=" + str(a))

for tag, path in [("RAW","_smoke/omr-work-dda9b3f0/audiveris_raw.mxl"),("FIX","_smoke/dda9_verify.mxl"),("REV","_smoke/omr-work-dda9b3f0/review.mxl")]:
    print("\n", tag)
    accs(load(path), 12)

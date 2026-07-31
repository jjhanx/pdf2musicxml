import io
import zipfile
import xml.etree.ElementTree as ET

Z = "omr-work-4b7162d2.zip"
for name in ["audiveris_raw.mxl", "review.mxl"]:
    with zipfile.ZipFile(Z) as z:
        inner = zipfile.ZipFile(io.BytesIO(z.read(name)))
        root = ET.fromstring(inner.read([n for n in inner.namelist() if n.endswith(".xml")][0]))
    part = root.find('.//{*}part[@id="P5"]')
    m = next(x for x in part.findall("{*}measure") if x.get("number") == "8")
    print("===", name, "===")
    for c in m:
        tag = c.tag.split("}")[-1]
        if tag == "note":
            st = c.find("{*}staff")
            if st is not None and st.text == "2" and c.find("{*}rest") is not None:
                rest = c.find("{*}rest")
                ds = rest.find("{*}display-step") if rest is not None else None
                do = rest.find("{*}display-octave") if rest is not None else None
                print(
                    "PL rest:",
                    "display-step", ds.text if ds is not None else None,
                    "display-octave", do.text if do is not None else None,
                    "default-x", c.get("default-x"),
                    "default-y", c.get("default-y"),
                )

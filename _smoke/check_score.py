import xml.etree.ElementTree as ET
import sys
try:
    tree = ET.parse(sys.argv[1])
    root = tree.getroot()
    print('XML is well-formed.')
    for part in root.findall('part'):
        print(f'Part {part.get("id")}: {len(part.findall("measure"))} measures')
except Exception as e:
    print('XML parsing error:', e)

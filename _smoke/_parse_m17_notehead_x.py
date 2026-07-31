import re
from pathlib import Path

def notehead_xs(html: str, stave_id: str) -> list[float]:
    m = re.search(rf'id="{re.escape(stave_id)}"[\s\S]*?(?=id="vf-auto|<g class="vf-stem")', html)
    if not m:
        return []
    block = m.group(0)
    return [float(x) for x in re.findall(r'class="vf-notehead"[\s\S]*?d="M\s*([0-9.]+)', block)]


for label in ('default', 'vspace0'):
    p = Path('_smoke') / f'_m17_svg_{label}.html'
    if not p.exists():
        continue
    html = p.read_text(encoding='utf8')
    print('===', label, '===')
    for sid in ('vf-auto1003', 'vf-auto1011', 'vf-auto1021', 'vf-auto1037'):
        xs = notehead_xs(html, sid)
        print(sid, xs)

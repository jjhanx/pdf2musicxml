/**
 * Preview path: orphan chord stop completion + duration coerce + flat-slur inflate.
 * Fixture: omr-work-014f2b6c P5 m50/53/55.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { JSDOM } from 'jsdom';

const OUT = join('_smoke', '_two_slur_m');
mkdirSync(OUT, { recursive: true });

const domBootstrap = new JSDOM(
  '<!DOCTYPE html><html><body><div id="h" style="width:1600px;height:800px"></div></body></html>',
  { pretendToBeVisual: true },
);
Object.assign(globalThis, {
  window: domBootstrap.window,
  document: domBootstrap.window.document,
  DOMParser: domBootstrap.window.DOMParser,
  XMLSerializer: domBootstrap.window.XMLSerializer,
  HTMLElement: domBootstrap.window.HTMLElement,
  SVGElement: domBootstrap.window.SVGElement,
  Element: domBootstrap.window.Element,
  Node: domBootstrap.window.Node,
});

const { repairTimelineForOsmdPreview } = await import('../shared/musicXmlTimelineCleanup');
const { prepareGraphicalSlursForOsmdPreview } = await import('../src/osmdChordSlurFix');

const py = `
import io, zipfile, sys
from pathlib import Path
sys.path.insert(0, "scripts")
from omr_hitl_lib import _ns, _q
import xml.etree.ElementTree as ET
OUT = Path(r"${OUT.replace(/\\/g, '/')}")
with zipfile.ZipFile("omr-work-014f2b6c.zip") as z:
    raw = z.read("review.mxl")
with zipfile.ZipFile(io.BytesIO(raw)) as mz:
    name = next(n for n in mz.namelist() if n.endswith(".xml") and "META" not in n.upper())
    root = ET.fromstring(mz.read(name))
ns = _ns(root)
# divisions는 앞 마디에만 있음 — 추출 시 첫 유지 마디에 심음
divs = 4
for part in list(root.findall(_q(ns, "part"))):
    if part.get("id") != "P5":
        continue
    for m in part.findall(_q(ns, "measure")):
        for a in m.findall(_q(ns, "attributes")):
            d = a.find(_q(ns, "divisions"))
            if d is not None and (d.text or "").strip().isdigit():
                divs = int(d.text.strip())
for part in list(root.findall(_q(ns, "part"))):
    if part.get("id") != "P5":
        root.remove(part)
        continue
    kept = False
    for m in list(part.findall(_q(ns, "measure"))):
        if m.get("number") not in ("50", "53", "54", "55"):
            part.remove(m)
            continue
        if not kept:
            attrs = m.find(_q(ns, "attributes"))
            if attrs is None:
                attrs = ET.Element(_q(ns, "attributes"))
                m.insert(0, attrs)
            div_el = attrs.find(_q(ns, "divisions"))
            if div_el is None:
                div_el = ET.SubElement(attrs, _q(ns, "divisions"))
            div_el.text = str(divs)
            kept = True
sp = root.find(_q(ns, "part-list"))
if sp is not None:
    for el in list(sp):
        if el.tag.endswith("score-part") and el.get("id") != "P5":
            sp.remove(el)
ET.ElementTree(root).write(OUT / "preview_src.xml", encoding="utf-8", xml_declaration=True)
print("ok")
`;
writeFileSync(join(OUT, '_ex_preview.py'), py);
const pr = spawnSync('venv/Scripts/python.exe', [join(OUT, '_ex_preview.py')], {
  encoding: 'utf-8',
});
if (pr.status !== 0) {
  console.error(pr.stderr || pr.stdout);
  process.exit(1);
}

const raw = readFileSync(join(OUT, 'preview_src.xml'), 'utf8');
const repaired = repairTimelineForOsmdPreview(raw, { faithfulEditorLayout: true });
writeFileSync(join(OUT, 'preview_repaired.xml'), repaired);

// m55 must have completed n2 stop after TS normalize
const domParse = new JSDOM('').window.DOMParser;
const doc = new domParse().parseFromString(repaired, 'text/xml');
const part = [...doc.getElementsByTagName('part')].find((p) => p.getAttribute('id') === 'P5')!;
const m55 = [...part.getElementsByTagName('measure')].find((m) => m.getAttribute('number') === '55')!;
const slurTexts: string[] = [];
for (const note of [...m55.getElementsByTagName('note')]) {
  const staff = note.getElementsByTagName('staff')[0]?.textContent?.trim() || '1';
  if (staff !== '1') continue;
  for (const slur of [...note.getElementsByTagName('slur')]) {
    slurTexts.push(`${slur.getAttribute('type')}n${slur.getAttribute('number')}`);
  }
}
const hasN2Stop = slurTexts.includes('stopn2');
const hasN2Start = slurTexts.includes('startn2');
if (!hasN2Start || !hasN2Stop) {
  console.error('m55 orphan stop not completed in preview normalize', slurTexts);
  process.exit(1);
}

// m50 voice6 half duration coerced
const m50 = [...part.getElementsByTagName('measure')].find((m) => m.getAttribute('number') === '50')!;
let halfDur: string | null = null;
for (const note of [...m50.getElementsByTagName('note')]) {
  const voice = note.getElementsByTagName('voice')[0]?.textContent?.trim();
  const typ = note.getElementsByTagName('type')[0]?.textContent?.trim();
  if (voice === '6' && typ === 'half') {
    halfDur = note.getElementsByTagName('duration')[0]?.textContent?.trim() || null;
    break;
  }
}
if (halfDur !== '8') {
  console.error('m50 voice6 half duration not coerced', halfDur);
  process.exit(1);
}

// m53 PR: sequential same-staff slurs get staggered default-y (flat-curve visibility)
const m53 = [...part.getElementsByTagName('measure')].find((m) => m.getAttribute('number') === '53')!;
const m53Ys: string[] = [];
for (const note of [...m53.getElementsByTagName('note')]) {
  const staff = note.getElementsByTagName('staff')[0]?.textContent?.trim() || '1';
  if (staff !== '1') continue;
  for (const slur of [...note.getElementsByTagName('slur')]) {
    if ((slur.getAttribute('type') || '') !== 'start') continue;
    m53Ys.push(slur.getAttribute('default-y') || '');
  }
}
if (m53Ys.length < 2 || !m53Ys.every((y) => y !== '')) {
  console.error('m53 sequential slur default-y missing', m53Ys);
  process.exit(1);
}
if (m53Ys[0] === m53Ys[1]) {
  console.error('m53 sequential slur default-y not staggered', m53Ys);
  process.exit(1);
}

// inflateFlatGraphicalSlurs: synthetic flat bezier should grow
const host = document.getElementById('h')!;
const fakeOsmd = {
  GraphicSheet: {
    MusicPages: [
      {
        MusicSystems: [
          {
            StaffLines: [
              {
                GraphicalSlurs: [
                  {
                    placement: 0,
                    slur: { PlacementXml: 0 },
                    bezierStartPt: { x: 0, y: -2 },
                    bezierStartControlPt: { x: 1, y: -2.4 },
                    bezierEndControlPt: { x: 2, y: -2.4 },
                    bezierEndPt: { x: 3, y: -2 },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
} as any;
prepareGraphicalSlursForOsmdPreview(fakeOsmd);
const g = fakeOsmd.GraphicSheet.MusicPages[0].MusicSystems[0].StaffLines[0].GraphicalSlurs[0];
const ys = [
  g.bezierStartPt.y,
  g.bezierStartControlPt.y,
  g.bezierEndControlPt.y,
  g.bezierEndPt.y,
];
const ySpan = Math.max(...ys) - Math.min(...ys);
if (ySpan < 1.2) {
  console.error('inflateFlatGraphicalSlurs did not boost ySpan', ySpan, ys);
  process.exit(1);
}

console.log('preview two-slur path ok', { slurTexts, halfDur, m53Ys, ySpan });

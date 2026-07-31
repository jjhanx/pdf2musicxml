import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, { document: dom.window.document, DOMParser: dom.window.DOMParser });
const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function pitch(n: Element): string {
  const step = n.querySelector('step,*|step')?.textContent ?? '?';
  const oct = n.querySelector('octave,*|octave')?.textContent ?? '?';
  const alter = n.querySelector('alter,*|alter')?.textContent ?? '';
  return `${step}${alter === '-1' ? 'b' : ''}${oct}`;
}

function dumpMeasure(raw: string, num: string, label: string): void {
  const xml = repairTimelineForOsmdPreview(raw);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
  const m = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === num)!;
  console.log(`\n${label} m${num}:`);
  let t = 0;
  const vc = new Map<string, number>();
  for (const el of [...m.children]) {
    const tag = local(el);
    if (tag === 'forward' || tag === 'backup') {
      const v = el.querySelector('voice,*|voice')?.textContent ?? '1';
      const d = Number(el.querySelector('duration,*|duration')?.textContent ?? 0);
      if (tag === 'forward') vc.set(v, (vc.get(v) ?? 0) + d);
      else vc.set(v, Math.max(0, (vc.get(v) ?? 0) - d));
      console.log(`  ${tag} v=${v} d=${d}`);
      continue;
    }
    if (tag !== 'note' || el.querySelector('chord,*|chord')) continue;
    const v = el.querySelector('voice,*|voice')?.textContent ?? '1';
    const start = vc.get(v) ?? 0;
    const beam = el.querySelector('beam,*|beam')?.textContent ?? '';
    console.log(`  t=${start} ${pitch(el)} v=${v} x=${el.getAttribute('default-x')} type=${el.querySelector('type,*|type')?.textContent} beam=${beam}`);
    vc.set(v, start + Number(el.querySelector('duration,*|duration')?.textContent ?? 0));
  }
}

const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const out = join(tmpdir(), '0ea5_review.xml');
execSync(`python -c "import io,zipfile;z=zipfile.ZipFile('omr-work-0ea5ea52.zip');d=z.read('review.mxl');inner=zipfile.ZipFile(io.BytesIO(d));x=[n for n in inner.namelist() if n.endswith('.xml') and 'META' not in n.upper()][0];open(r'${out.replace(/\\/g, '\\\\')}', 'wb').write(inner.read(x))"`, { cwd: process.cwd(), stdio: 'pipe' });
const review = fs.readFileSync(out, 'utf8');
dumpMeasure(review, '16', 'review');
const m17fix = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });
dumpMeasure(m17fix, '17', 'm17 linkParallel');

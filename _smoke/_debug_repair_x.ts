import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, { document: dom.window.document, DOMParser: dom.window.DOMParser });
const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const out = join(tmpdir(), '0ea5_review.xml');
execSync(`python -c "import io,zipfile;z=zipfile.ZipFile('omr-work-0ea5ea52.zip');d=z.read('review.mxl');inner=zipfile.ZipFile(io.BytesIO(d));x=[n for n in inner.namelist() if n.endswith('.xml') and 'META' not in n.upper()][0];open(r'${out.replace(/\\/g, '\\\\')}', 'wb').write(inner.read(x))"`, { cwd: process.cwd(), stdio: 'pipe' });
const raw = fs.readFileSync(out, 'utf8');
console.log('unrepaired E5 x:', raw.match(/<step>E<\/step>\s*<alter[^>]*>-1<\/alter>\s*<octave>5<\/octave>/) ? 'found' : 'n/a');
const xml = repairTimelineForOsmdPreview(raw);
const doc = new DOMParser().parseFromString(xml, 'text/xml');
const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
const m16 = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '16')!;
console.log('after repair all leaders:');
for (const c of [...m16.children]) {
  if (local(c) !== 'note' || c.querySelector('chord,*|chord')) continue;
  const step = c.querySelector('step,*|step')?.textContent;
  const oct = c.querySelector('octave,*|octave')?.textContent;
  console.log(`  ${step}${oct} st=${c.querySelector('staff,*|staff')?.textContent} x=${c.getAttribute('default-x')}`);
}

import { readFileSync } from 'fs';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { parseMusicXmlDocument } from '../shared/musicXmlParse.ts';

const raw = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
const clean = repairTimelineForOsmdPreview(raw);
console.log('global prints', (clean.match(/<print[\s>]/gi) ?? []).length);
console.log('global measure width', (clean.match(/<measure[^>]*\swidth=/gi) ?? []).length);
console.log('global default-x', (clean.match(/default-x=/gi) ?? []).length);

const doc = parseMusicXmlDocument(clean);
const p1 = doc?.querySelector('part[id="P1"], *|part[id="P1"]');
if (p1) {
  for (const m of [23, 24, 25, 26, 27, 28]) {
    const meas = [...p1.children].find(
      (c) => c.localName?.toLowerCase() === 'measure' && c.getAttribute('number') === String(m),
    );
    if (!meas) continue;
    const hasPrint = [...meas.children].some((c) => c.localName?.toLowerCase() === 'print');
    console.log('P1 m' + m, 'print', hasPrint, 'width', meas.hasAttribute('width'), 'default-x', meas.outerHTML.includes('default-x'));
  }
}

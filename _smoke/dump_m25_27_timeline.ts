import { readFileSync } from 'fs';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairUnderfullMeasuresForOsmdPreview, measureTimelineEndDivisions } from '../shared/musicXmlUnderfullMeasureForOsmd.ts';
import { parseMusicXmlDocument } from '../shared/musicXmlParse.ts';

const local = (el: Element) => el.localName?.toLowerCase() ?? String(el.tagName).toLowerCase();

function pitch(n: Element): string {
  if (n.querySelector('rest, *|rest')) return 'rest';
  const s = n.querySelector('pitch step, *|pitch *|step')?.textContent ?? '?';
  const o = n.querySelector('pitch octave, *|pitch *|octave')?.textContent ?? '?';
  return `${s}${o}`;
}

function summarizePart(xml: string, pid: string, ms: number[]): void {
  const doc = parseMusicXmlDocument(xml);
  if (!doc) return;
  const part = [...doc.querySelectorAll('part, *|part')].find((p) => p.getAttribute('id') === pid);
  if (!part) {
    console.log(pid, 'NO_PART');
    return;
  }
  for (const m of ms) {
    const meas = [...part.children].find(
      (c) => local(c) === 'measure' && c.getAttribute('number') === String(m),
    ) as Element | undefined;
    if (!meas) {
      console.log(pid, `m${m}`, 'MISSING');
      continue;
    }
    const end = measureTimelineEndDivisions(meas);
    const tags = [...meas.children]
      .map((c) => {
        const t = local(c);
        if (t === 'note') {
          return `N:${pitch(c)} d=${c.querySelector('duration, *|duration')?.textContent} v=${c.querySelector('voice, *|voice')?.textContent ?? '1'}`;
        }
        if (t === 'backup' || t === 'forward') {
          return `${t}(${c.querySelector('duration, *|duration')?.textContent})`;
        }
        if (t === 'print') return 'print';
        return t;
      })
      .join(' | ');
    console.log(pid, `m${m}`, `end=${end}`, '|', tags);
  }
}

const raw = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
console.log('=== RAW ===');
for (const pid of ['P1', 'P2', 'P3', 'P4', 'P5']) summarizePart(raw, pid, [25, 26, 27]);

let xml = repairTimelineForOsmdPreview(raw);
console.log('\n=== after repairTimeline ===');
for (const pid of ['P1', 'P2', 'P3', 'P4', 'P5']) summarizePart(xml, pid, [25, 26, 27]);

xml = repairUnderfullMeasuresForOsmdPreview(xml);
console.log('\n=== after underfull ===');
for (const pid of ['P1', 'P2', 'P3', 'P4', 'P5']) summarizePart(xml, pid, [25, 26, 27]);

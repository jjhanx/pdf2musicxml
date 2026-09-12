/**
 * HITL 미리보기 — 마디 박자 over/under full 탐지(저장 MXL 변경 없음).
 */
import { parseMusicXmlDocument } from './musicXmlParse';
import { measureTimelineEndUnits, measureLengthUnits } from './musicXmlPreviewOnsetLayout';

const xmlLocalName = (el: Element) =>
  typeof el.localName === 'string' ? el.localName.toLowerCase() : String(el.tagName).toLowerCase();

function findXmlParts(doc: Document): Element[] {
  const out: Element[] = [];
  const root = doc.documentElement;
  if (!root) return out;
  if (xmlLocalName(root) === 'part') out.push(root);
  for (const el of [...root.children]) {
    if (xmlLocalName(el) === 'part') out.push(el);
  }
  return out;
}

export type MeasureTimingIssueKind = 'overfull' | 'underfull';

export type MeasureTimingIssue = {
  partId: string;
  measureNumber: number;
  expected: number;
  actual: number;
  kind: MeasureTimingIssueKind;
};

/** voice별 최대 cursor 끝 — overfull 판정용 */
function measureMaxVoiceEndUnits(measure: Element): number {
  const voiceCursor = new Map<string, number>();
  let lastVoice = '1';
  let maxEnd = 0;
  for (const el of [...measure.children]) {
    const tag = xmlLocalName(el);
    if (tag === 'backup') {
      const durEl = el.querySelector(':scope > duration, :scope > *|duration');
      const n = parseInt(durEl?.textContent?.trim() ?? '0', 10);
      const v = el.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim() || lastVoice;
      voiceCursor.set(v, Math.max(0, (voiceCursor.get(v) ?? 0) - (Number.isFinite(n) ? n : 0)));
      for (const end of voiceCursor.values()) maxEnd = Math.max(maxEnd, end);
    } else if (tag === 'forward') {
      const durEl = el.querySelector(':scope > duration, :scope > *|duration');
      const n = parseInt(durEl?.textContent?.trim() ?? '0', 10);
      const v = el.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim() || lastVoice;
      voiceCursor.set(v, (voiceCursor.get(v) ?? 0) + (Number.isFinite(n) ? n : 0));
      for (const end of voiceCursor.values()) maxEnd = Math.max(maxEnd, end);
    } else if (tag === 'note') {
      if (el.querySelector('chord, *|chord') !== null) continue;
      if (el.querySelector('grace, *|grace') !== null) continue;
      const voice = el.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim() || '1';
      lastVoice = voice;
      const durEl = el.querySelector(':scope > duration, :scope > *|duration');
      const dur = parseInt(durEl?.textContent?.trim() ?? '0', 10);
      const start = voiceCursor.get(voice) ?? 0;
      const end = start + (Number.isFinite(dur) ? dur : 0);
      voiceCursor.set(voice, end);
      maxEnd = Math.max(maxEnd, end);
    }
  }
  return maxEnd;
}

export function collectMeasureTimingIssuesFromXml(xml: string): MeasureTimingIssue[] {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return [];
    const out: MeasureTimingIssue[] = [];
    for (const part of findXmlParts(doc)) {
      const partId = part.getAttribute('id')?.trim() ?? '';
      for (const measure of [...part.children]) {
        if (xmlLocalName(measure) !== 'measure') continue;
        if (measure.getAttribute('implicit') === 'yes') continue;
        const measureNumber = parseInt(measure.getAttribute('number') ?? '0', 10);
        if (!Number.isFinite(measureNumber) || measureNumber <= 0) continue;
        const expected = measureLengthUnits(measure);
        const timelineEnd = measureTimelineEndUnits(measure);
        const voiceMax = measureMaxVoiceEndUnits(measure);
        const actual = Math.max(timelineEnd, voiceMax);
        if (actual > expected) {
          out.push({ partId, measureNumber, expected, actual, kind: 'overfull' });
        } else if (actual < expected) {
          out.push({ partId, measureNumber, expected, actual, kind: 'underfull' });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

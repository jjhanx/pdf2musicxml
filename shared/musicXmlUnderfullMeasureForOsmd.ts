import { parseMusicXmlDocument, serializeMusicXmlDocument } from './musicXmlParse';

const xmlLocalName = (el: Element) =>
  typeof el.localName === 'string' ? el.localName.toLowerCase() : String(el.tagName).toLowerCase();

function findXmlParts(doc: Document): Element[] {
  const out: Element[] = [];
  const root = doc.documentElement;
  if (!root) return out;
  const walk = (el: Element) => {
    if (xmlLocalName(el) === 'part') out.push(el);
    for (const c of [...el.children]) walk(c);
  };
  walk(root);
  return out;
}

function readDuration(el: Element): number {
  const durEl = el.querySelector(':scope > duration, :scope > *|duration');
  const n = parseInt(durEl?.textContent?.trim() ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** MusicXML 마디 내 순차 타임라인 끝 위치(division). backup/forward·grace·chord 반영. */
export function measureTimelineEndDivisions(measure: Element): number {
  let pos = 0;
  for (const child of [...measure.children]) {
    const tag = xmlLocalName(child);
    if (tag === 'backup') {
      pos = Math.max(0, pos - readDuration(child));
    } else if (tag === 'forward') {
      pos += readDuration(child);
    } else if (tag === 'note') {
      if (child.querySelector(':scope > chord, :scope > *|chord')) continue;
      if (child.querySelector(':scope > grace, :scope > *|grace')) continue;
      pos += readDuration(child);
    }
  }
  return pos;
}

type MeasureTiming = {
  divisions: number;
  beats: number;
  beatType: number;
  expected: number;
};

function readMeasureTiming(measure: Element, inherited: MeasureTiming): MeasureTiming {
  let { divisions, beats, beatType } = inherited;
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) !== 'attributes') continue;
    const divEl = child.querySelector('divisions, *|divisions');
    const parsed = parseInt(divEl?.textContent?.trim() ?? '', 10);
    if (Number.isFinite(parsed) && parsed > 0) divisions = parsed;
    const timeEl = child.querySelector('time, *|time');
    if (timeEl) {
      const bEl = timeEl.querySelector('beats, *|beats');
      const btEl = timeEl.querySelector('beat-type, *|beat-type');
      const b = parseInt(bEl?.textContent?.trim() ?? '', 10);
      const bt = parseInt(btEl?.textContent?.trim() ?? '', 10);
      if (Number.isFinite(b) && b > 0) beats = b;
      if (Number.isFinite(bt) && bt > 0) beatType = bt;
    }
  }
  const expected = Math.max(1, Math.round((divisions * beats * 4) / beatType));
  return { divisions, beats, beatType, expected };
}

function appendForwardAtMeasureEnd(measure: Element, duration: number): void {
  if (duration <= 0) return;
  const doc = measure.ownerDocument;
  if (!doc) return;
  const forward = doc.createElementNS(measure.namespaceURI, 'forward');
  const dur = doc.createElementNS(measure.namespaceURI, 'duration');
  dur.textContent = String(duration);
  forward.appendChild(dur);
  measure.appendChild(forward);
}

/**
 * OSMD/HITL 미리보기 전용 — 마디 타임라인이 박자보다 짧을 때 끝에 invisible `<forward>`만 추가.
 * 앞머리 쉼·음표는 건드리지 않고 있는 그대로 그리되, OSMD가 0·음수 폭으로 마디를 통째로
 * 건너뛰지 않게 한다. 저장 MXL에는 적용하지 않음.
 */
export function repairUnderfullMeasuresForOsmdPreview(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    const inherited: MeasureTiming = { divisions: 1, beats: 4, beatType: 4, expected: 4 };
    for (const part of findXmlParts(doc)) {
      let timing = { ...inherited };
      for (const measure of [...part.children]) {
        if (xmlLocalName(measure) !== 'measure') continue;
        if (measure.getAttribute('implicit') === 'yes') continue;
        timing = readMeasureTiming(measure, timing);
        const end = measureTimelineEndDivisions(measure);
        const gap = timing.expected - end;
        if (gap > 0) appendForwardAtMeasureEnd(measure, gap);
      }
    }
    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
  }
}

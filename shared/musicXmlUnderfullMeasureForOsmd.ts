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

function appendForwardAfterVoice(measure: Element, voice: string, duration: number): void {
  if (duration <= 0) return;
  const doc = measure.ownerDocument;
  if (!doc) return;

  let insertAfter: Element | null = null;
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) !== 'note') continue;
    const vEl = child.querySelector(':scope > voice, :scope > *|voice');
    const v = (vEl?.textContent ?? '1').trim() || '1';
    if (v === voice) insertAfter = child;
  }

  const forward = doc.createElementNS(measure.namespaceURI, 'forward');
  const dur = doc.createElementNS(measure.namespaceURI, 'duration');
  dur.textContent = String(duration);
  forward.appendChild(dur);
  const voiceEl = doc.createElementNS(measure.namespaceURI, 'voice');
  voiceEl.textContent = voice;
  forward.appendChild(voiceEl);

  if (insertAfter) {
    insertAfter.parentNode?.insertBefore(forward, insertAfter.nextSibling);
  } else {
    measure.appendChild(forward);
  }
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

function measureHasBackup(measure: Element): boolean {
  return [...measure.children].some((c) => xmlLocalName(c) === 'backup');
}

function voiceDurationSums(measure: Element): Map<string, number> {
  const byVoice = new Map<string, number>();
  let lastVoice = '1';
  for (const child of [...measure.children]) {
    const tag = xmlLocalName(child);
    if (tag === 'forward') {
      const vEl = child.querySelector(':scope > voice, :scope > *|voice');
      const voice = (vEl?.textContent ?? lastVoice).trim() || lastVoice;
      byVoice.set(voice, (byVoice.get(voice) ?? 0) + readDuration(child));
      continue;
    }
    if (tag !== 'note') continue;
    if (child.querySelector(':scope > chord, :scope > *|chord')) continue;
    if (child.querySelector(':scope > grace, :scope > *|grace')) continue;
    const vEl = child.querySelector(':scope > voice, :scope > *|voice');
    const voice = (vEl?.textContent ?? '1').trim() || '1';
    lastVoice = voice;
    byVoice.set(voice, (byVoice.get(voice) ?? 0) + readDuration(child));
  }
  return byVoice;
}

/**
 * 단일 레이어(backup 없음)에서만 voice duration 합이 박자보다 짧으면 해당 voice 마지막 note 뒤에
 * invisible `<forward>`를 넣는다.
 *
 * backup이 있는 다성부(Audiveris: voice1 일부 → backup → voice2…)에서는 voice1 note 합이
 * 박자보다 짧아 보여도 **정상**이다. 여기에 forward를 끼우면 part cursor가 어긋나
 * `sanitizeConflictingPlayOrders`가 같은 연주순번을 지우고 OSMD 열이 틀어진다.
 */
function repairUnderfullVoicesInMeasure(measure: Element, expected: number): void {
  if (measureHasBackup(measure)) return;
  const byVoice = voiceDurationSums(measure);
  if (!byVoice.size) return;
  for (const [voice, total] of byVoice) {
    const gap = expected - total;
    if (gap > 0) appendForwardAfterVoice(measure, voice, gap);
  }
}

/**
 * OSMD/HITL 미리보기 전용 — 마디 타임라인이 박자보다 짧을 때 invisible `<forward>`로 맞춤.
 * 앞머리 쉼·음표는 건드리지 않고, OSMD가 0·음수 폭으로 마디를 skip하지 않게 한다(저장 MXL 불변).
 *
 * - backup 없는 단일 레이어: voice별 부족분 → 해당 voice note 직후 forward
 * - backup 있는 다성부: voice별 pad **금지**(타임라인 역전). part cursor 끝만 부족하면 마디 끝 forward
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
        repairUnderfullVoicesInMeasure(measure, timing.expected);
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

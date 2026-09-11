import {
  articulationDefaultYFromStaffSpaces,
  articulationStaffSpacesFromHint,
  HITL_DIR_DISTANCE_ATTR,
} from './musicXmlArticulationDistance';
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

/** Leading `<print>` / `<attributes>` / `<direction>` 블록 직후 삽입 인덱스. */
export function measureHeaderInsertIndex(meas: Element): number {
  let idx = 0;
  for (const child of [...meas.children]) {
    const name = xmlLocalName(child);
    if (name === 'print' || name === 'attributes' || name === 'direction') idx += 1;
    else break;
  }
  return idx;
}

export function directionHasTempo(dir: Element): boolean {
  for (const dt of [...dir.children].filter((c) => xmlLocalName(c) === 'direction-type')) {
    if ([...dt.children].some((c) => xmlLocalName(c) === 'metronome')) return true;
  }
  return dir.querySelector(':scope > sound[tempo], :scope > *|sound[tempo]') != null;
}

function repositionMeasureDirectionsBeforeAttributes(meas: Element, tempoOnly: boolean): void {
  const children = [...meas.children];
  const firstAttr = children.findIndex((c) => xmlLocalName(c) === 'attributes');
  if (firstAttr < 0) return;
  for (let i = 0; i < firstAttr; i++) {
    const child = children[i]!;
    if (xmlLocalName(child) !== 'direction') continue;
    if (tempoOnly && !directionHasTempo(child)) continue;
    child.remove();
    const insertAt = measureHeaderInsertIndex(meas);
    if (insertAt >= meas.childElementCount) meas.appendChild(child);
    else meas.insertBefore(child, meas.children[insertAt] ?? null);
  }
}

/**
 * OSMD는 `<direction-type>` 없이 `<sound tempo>`만 있으면 길이 0 pickup 마디를 만들고
 * 그 파트(또는 정렬된 전체 악보)의 첫 마디 음표를 버린다. 미리보기에서 metronome을 보충한다.
 */
export function ensureMetronomeOnSoundTempoDirectionsForOsmdPreview(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    const ns = doc.documentElement.namespaceURI;
    const mk = (local: string) => (ns ? doc.createElementNS(ns, local) : doc.createElement(local));
    for (const part of findXmlParts(doc)) {
      for (const meas of [...part.children]) {
        if (xmlLocalName(meas) !== 'measure') continue;
        for (const dir of [...meas.children].filter((c) => xmlLocalName(c) === 'direction')) {
          const sound = [...dir.children].find(
            (c) => xmlLocalName(c) === 'sound' && c.getAttribute('tempo'),
          );
          if (!sound) continue;
          let hasMetro = false;
          for (const dt of [...dir.children].filter((c) => xmlLocalName(c) === 'direction-type')) {
            if ([...dt.children].some((c) => xmlLocalName(c) === 'metronome')) {
              hasMetro = true;
              break;
            }
          }
          if (hasMetro) continue;
          const bpm = sound.getAttribute('tempo')?.trim() || '120';
          const dtype = mk('direction-type');
          const metro = mk('metronome');
          metro.setAttribute('parentheses', 'no');
          const beat = mk('beat-unit');
          beat.textContent = 'quarter';
          const pm = mk('per-minute');
          pm.textContent = bpm;
          metro.appendChild(beat);
          metro.appendChild(pm);
          dtype.appendChild(metro);
          dir.insertBefore(dtype, dir.firstChild);
          if (!dir.getAttribute('print-object')) dir.setAttribute('print-object', 'no');
        }
      }
    }
    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
  }
}

/**
 * OSMD는 마디 첫 `<attributes>` 이전의 `<direction>`을 픽업(빈 마디)으로 해석한다.
 * HITL·inject·Audiveris 산출물을 미리보기 load 전에 `<attributes>` 뒤로 옮긴다(저장 MXL 불변).
 */
export function repositionDirectionsBeforeAttributesForOsmdPreview(
  xml: string,
  options?: { tempoOnly?: boolean },
): string {
  const tempoOnly = options?.tempoOnly ?? false;
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    for (const part of findXmlParts(doc)) {
      for (const meas of [...part.children]) {
        if (xmlLocalName(meas) !== 'measure') continue;
        repositionMeasureDirectionsBeforeAttributes(meas, tempoOnly);
      }
    }
    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
  }
}

const DYNAMICS_TAG_NAMES = new Set([
  'p', 'pp', 'ppp', 'pppp', 'ppppp', 'pppppp',
  'f', 'ff', 'fff', 'ffff', 'fffff', 'ffffff',
  'mp', 'mf', 'sf', 'sfp', 'sfpp', 'fp', 'rf', 'rfz', 'sfz', 'sffz', 'fz', 'n', 'pf'
]);

/**
 * OSMD 미리보기 전용:
 * 1. note/notations 안의 dynamics를 독립 <direction>으로 마이그레이션하여
 *    동일 onset에서 wedge가 누락되는 OSMD 충돌 버그 방지.
 * 2. dynamics 및 wedge에 default-y 여백 — `data-hitl-dir-distance`/default-y 기준(기본 1칸=±10 tenths).
 * 3. 동일 onset에서 dynamics가 wedge start보다 앞에 오도록 순서 정돈 (p > 순서).
 */
function wedgeStaffSpacesFromDirection(dir: Element, wedgeEl: Element | null): number {
  const dist =
    dir.getAttribute(HITL_DIR_DISTANCE_ATTR) ||
    wedgeEl?.getAttribute(HITL_DIR_DISTANCE_ATTR) ||
    null;
  const dyRaw =
    dir.getAttribute('default-y') ||
    wedgeEl?.getAttribute('default-y') ||
    '';
  const dy = parseInt(dyRaw, 10);
  return articulationStaffSpacesFromHint(dist, Number.isFinite(dy) ? dy : null);
}

function resolveDynamicsPlacement(
  dir: Element,
  dynEl: Element,
  defaultPlacement: 'above' | 'below' = 'above',
): 'above' | 'below' {
  const inner = (dynEl.getAttribute('placement') || '').trim().toLowerCase();
  if (inner === 'above' || inner === 'below') return inner;
  const outer = (dir.getAttribute('placement') || '').trim().toLowerCase();
  if (outer === 'above' || outer === 'below') return outer;
  return defaultPlacement;
}

function syncDynamicsDirectionLayout(
  dir: Element,
  dynEl: Element,
  pl: 'above' | 'below',
): void {
  dir.setAttribute('placement', pl);
  dynEl.setAttribute('placement', pl);
  const distRaw =
    dynEl.getAttribute(HITL_DIR_DISTANCE_ATTR) || dir.getAttribute(HITL_DIR_DISTANCE_ATTR);
  const dyNum = parseInt(
    dynEl.getAttribute('default-y') || dir.getAttribute('default-y') || '',
    10,
  );
  const spaces = articulationStaffSpacesFromHint(
    distRaw,
    Number.isFinite(dyNum) ? dyNum : null,
  );
  const dy = String(articulationDefaultYFromStaffSpaces(pl, spaces));
  dir.setAttribute('default-y', dy);
  dynEl.setAttribute('default-y', dy);
  const dist = distRaw?.trim();
  if (dist && dist.toLowerCase() !== 'auto') {
    dir.setAttribute(HITL_DIR_DISTANCE_ATTR, dist);
    dynEl.setAttribute(HITL_DIR_DISTANCE_ATTR, dist);
  } else {
    dir.removeAttribute(HITL_DIR_DISTANCE_ATTR);
    dynEl.removeAttribute(HITL_DIR_DISTANCE_ATTR);
  }
}

/** OSMD 미리보기 SVG shift — HITL `data-hitl-dir-distance` / default-y(10 tenths×N). */
export type DynamicsPreviewHint = {
  partId: string;
  measureMxl: string;
  staff: number;
  tag: string;
  placement: 'above' | 'below';
  staffSpaces: number;
  distance: string | null;
  defaultY: number | null;
  /** HITL 마디 끝 앵커 — 마지막 음 위가 아니라 마디 오른쪽 */
  measureEnd?: boolean;
};

export function collectDynamicsPreviewHintsFromXml(xml: string): DynamicsPreviewHint[] {
  const out: DynamicsPreviewHint[] = [];
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return out;
    for (const part of findXmlParts(doc)) {
      const partId = part.getAttribute('id')?.trim() || '';
      for (const meas of [...part.children].filter((c) => xmlLocalName(c) === 'measure')) {
        const measureMxl = meas.getAttribute('number')?.trim() || '';
        for (const dir of [...meas.children].filter((c) => xmlLocalName(c) === 'direction')) {
          const measureEnd =
            (dir.getAttribute('data-hitl-measure-anchor') || '').trim().toLowerCase() === 'end';
          for (const dt of [...dir.children].filter((c) => xmlLocalName(c) === 'direction-type')) {
            for (const dyn of [...dt.children].filter((c) => xmlLocalName(c) === 'dynamics')) {
              const tags = [...dyn.children]
                .map((c) => xmlLocalName(c))
                .filter((t) => DYNAMICS_TAG_NAMES.has(t));
              if (!tags.length) continue;
              const staff = parseInt(dir.querySelector('staff, *|staff')?.textContent?.trim() || '1', 10) || 1;
              const defaultPl =
                (dyn.getAttribute('placement') || dir.getAttribute('placement') || 'above').trim().toLowerCase() ===
                'below'
                  ? 'below'
                  : 'above';
              const pl = resolveDynamicsPlacement(dir, dyn, defaultPl);
              const dist =
                dyn.getAttribute(HITL_DIR_DISTANCE_ATTR) || dir.getAttribute(HITL_DIR_DISTANCE_ATTR);
              const dyRaw = dyn.getAttribute('default-y') || dir.getAttribute('default-y') || '';
              const dyNum = parseInt(dyRaw, 10);
              const defaultY = Number.isFinite(dyNum) ? dyNum : null;
              const staffSpaces = articulationStaffSpacesFromHint(dist, defaultY);
              for (const tag of tags) {
                out.push({
                  partId,
                  measureMxl,
                  staff,
                  tag,
                  placement: pl,
                  staffSpaces,
                  distance: dist?.trim() || null,
                  defaultY,
                  measureEnd,
                });
              }
            }
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

export function dynamicsHintNeedsOsmdPreviewShift(h: {
  staffSpaces: number;
  distance?: string | null;
  defaultY?: number | null;
}): boolean {
  const d = (h.distance || '').trim().toLowerCase();
  if (d && d !== 'auto') return true;
  const mag = Math.abs(h.defaultY ?? 0);
  return mag >= 10 && mag <= 100 && mag % 10 === 0;
}

/** OSMD EngravingRules — XML wedge distance 힌트(없으면 1칸). */
export function applyWedgeEngravingRulesFromXml(
  rules: { WedgePlacementBelowY?: number; WedgePlacementAboveY?: number },
  xml: string,
): void {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return;
    let belowSpaces = 1;
    let aboveSpaces = 1;
    let sawBelow = false;
    let sawAbove = false;
    for (const part of findXmlParts(doc)) {
      for (const meas of [...part.children].filter((c) => xmlLocalName(c) === 'measure')) {
        for (const dir of [...meas.children].filter((c) => xmlLocalName(c) === 'direction')) {
          const wedgeEl = dir.querySelector('wedge, *|wedge');
          if (!wedgeEl) continue;
          const pl = (dir.getAttribute('placement') || 'below').trim().toLowerCase();
          const spaces = wedgeStaffSpacesFromDirection(dir, wedgeEl);
          if (pl === 'above') {
            aboveSpaces = spaces;
            sawAbove = true;
          } else {
            belowSpaces = spaces;
            sawBelow = true;
          }
        }
      }
    }
    if (typeof rules.WedgePlacementBelowY === 'number' && sawBelow) {
      rules.WedgePlacementBelowY = belowSpaces;
    }
    if (typeof rules.WedgePlacementAboveY === 'number' && sawAbove) {
      rules.WedgePlacementAboveY = -aboveSpaces;
    }
  } catch {
    /* keep defaults */
  }
}

export function normalizeDynamicsAndWedgesForOsmdPreview(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    const ns = doc.documentElement.namespaceURI;
    const mk = (local: string) => (ns ? doc.createElementNS(ns, local) : doc.createElement(local));

    for (const part of findXmlParts(doc)) {
      for (const meas of [...part.children]) {
        if (xmlLocalName(meas) !== 'measure') continue;

        // 1. 음표의 notations/dynamics를 <direction>으로 변환 (promote 미경로 fallback)
        for (const note of [...meas.children].filter((c) => xmlLocalName(c) === 'note')) {
          const notations = [...note.children].find((c) => xmlLocalName(c) === 'notations');
          if (!notations) continue;
          for (const dyn of [...notations.children].filter((c) => xmlLocalName(c) === 'dynamics')) {
            const dynChildren = [...dyn.children].filter((c) => DYNAMICS_TAG_NAMES.has(xmlLocalName(c)));
            if (!dynChildren.length) continue;
            const staffEl = [...note.children].find((c) => xmlLocalName(c) === 'staff');
            const staffNum = staffEl?.textContent?.trim() || '1';
            const defaultPl =
              (dyn.getAttribute('placement') || 'above').trim().toLowerCase() === 'below'
                ? 'below'
                : 'above';

            const dir = mk('direction');
            const dt = mk('direction-type');
            const dynNew = mk('dynamics');
            for (const dc of dynChildren) {
              dynNew.appendChild(mk(xmlLocalName(dc)));
            }
            const dist = dyn.getAttribute(HITL_DIR_DISTANCE_ATTR);
            if (dist) {
              dir.setAttribute(HITL_DIR_DISTANCE_ATTR, dist);
              dynNew.setAttribute(HITL_DIR_DISTANCE_ATTR, dist);
            }
            const dyRaw = dyn.getAttribute('default-y');
            if (dyRaw) {
              dir.setAttribute('default-y', dyRaw);
              dynNew.setAttribute('default-y', dyRaw);
            }
            dt.appendChild(dynNew);
            dir.appendChild(dt);

            const stNew = mk('staff');
            stNew.textContent = staffNum;
            dir.appendChild(stNew);

            const pl = resolveDynamicsPlacement(dir, dynNew, defaultPl);
            syncDynamicsDirectionLayout(dir, dynNew, pl);
            meas.insertBefore(dir, note);
            dyn.remove();
          }
          if (notations.childElementCount === 0) {
            notations.remove();
          }
        }

        // 2. wedge/dynamics default-y — wedge는 distance(기본 1칸), dynamics는 placement·부호 일치 보장
        for (const dir of [...meas.children].filter((c) => xmlLocalName(c) === 'direction')) {
          const wedgePlRaw = (dir.getAttribute('placement') || 'above').trim().toLowerCase();
          const wedgePl = (wedgePlRaw === 'above' ? 'above' : 'below') as 'above' | 'below';
          for (const dt of [...dir.children].filter((c) => xmlLocalName(c) === 'direction-type')) {
            for (const child of [...dt.children]) {
              const cName = xmlLocalName(child);
              if (cName === 'wedge') {
                const childPl =
                  (child.getAttribute('placement') || '').trim().toLowerCase() === 'above'
                    ? 'above'
                    : wedgePl;
                const spaces = wedgeStaffSpacesFromDirection(dir, child);
                const dy = String(articulationDefaultYFromStaffSpaces(childPl, spaces));
                dir.setAttribute('default-y', dy);
                child.setAttribute('default-y', dy);
              } else if (cName === 'dynamics') {
                const pl = resolveDynamicsPlacement(dir, child, 'above');
                syncDynamicsDirectionLayout(dir, child, pl);
              }
            }
          }
        }

        // 3. 동일 onset에서 dynamics가 wedge start보다 앞에 오도록 순서 정돈 (p > 순서)
        const children = [...meas.children];
        for (let i = 0; i < children.length - 1; i++) {
          const c1 = children[i]!;
          const c2 = children[i + 1]!;
          if (xmlLocalName(c1) === 'direction' && xmlLocalName(c2) === 'direction') {
            const hasWedgeStart = [...c1.querySelectorAll('wedge')].some((w) =>
              ['crescendo', 'diminuendo'].includes(w.getAttribute('type') || '')
            );
            const hasDyn = c2.querySelector('dynamics') !== null;
            if (hasWedgeStart && hasDyn) {
              meas.insertBefore(c2, c1);
            }
          }
        }
      }
    }
    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
  }
}


import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import {
  articulationPreviewShiftPx,
  articulationStaffSpacesFromHint,
  HITL_ART_DISTANCE_ATTR,
  parseArticulationStaffSpaces,
  pitchLabelFromArticulationFix,
  pitchLabelsMatch,
  previewPartIdsMatch,
  type ArticulationPreviewFix,
} from '../shared/musicXmlArticulationDistance';
import { OSMD_LAYOUT_X_ATTR } from '../shared/musicXmlPreviewOnsetLayout';
import { parseMusicXmlDocument } from '../shared/musicXmlParse';
import { getOsmdPreviewXml } from './osmdOnsetColumnAlignFix';
import { forEachGraphicalMeasure, measureMxlFromGraphic, partIdFromGraphic } from './osmdMeasureClick';

/** sanitize 전 filteredXml — pending articulation attr·noteIndex 기준 */
const articulationPreviewXmlByOsmd = new WeakMap<OpenSheetMusicDisplay, string>();

export function registerOsmdPreviewXmlForArticulation(osmd: OpenSheetMusicDisplay, xml: string): void {
  articulationPreviewXmlByOsmd.set(osmd, xml);
}

const articulationFixesByOsmd = new WeakMap<OpenSheetMusicDisplay, ArticulationPreviewFix[]>();

export function registerOsmdArticulationFixes(
  osmd: OpenSheetMusicDisplay,
  fixes: ReadonlyArray<ArticulationPreviewFix>,
): void {
  articulationFixesByOsmd.set(
    osmd,
    fixes.filter(
      (f) =>
        (f.kind === 'setArticulationPlacement' || f.kind === 'addArticulation') &&
        Boolean(f.articulation),
    ),
  );
}

function resolveArticulationPreviewXml(osmd: OpenSheetMusicDisplay): string | null {
  return articulationPreviewXmlByOsmd.get(osmd) ?? getOsmdPreviewXml(osmd) ?? null;
}

export type ArticulationShiftStats = {
  shifted: number;
  modifierCount: number;
  hintCount: number;
  staffSpacePx: number;
};

type ArticulationShiftHint = {
  defaultY: number;
  distance: string | null;
  placement: 'above' | 'below';
  staffSpaces: number;
  tag: string;
  pitch: string | null;
  layoutX: number;
  staff: number;
};

type OrderedHint = ArticulationShiftHint;

const hintsCacheByXml = new Map<string, Map<string, OrderedHint[]>>();

function xmlLocalName(el: Element): string {
  return typeof el.localName === 'string' ? el.localName.toLowerCase() : String(el.tagName).toLowerCase();
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

export function resetOsmdArticulationOffsets(host: HTMLElement): void {
  for (const el of host.querySelectorAll('[data-art-base-transform]')) {
    el.setAttribute('transform', el.getAttribute('data-art-base-transform') ?? '');
    el.removeAttribute('data-art-shift-y');
  }
}

export function applyArticulationShiftY(el: Element, deltaY: number): void {
  if (!el.hasAttribute('data-art-base-transform')) {
    el.setAttribute('data-art-base-transform', el.getAttribute('transform') ?? '');
  }
  const base = el.getAttribute('data-art-base-transform') ?? '';
  const m = /translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/.exec(base);
  const ox = m ? parseFloat(m[1]!) : 0;
  const oy = m ? parseFloat(m[2] ?? '0') : 0;
  const rest = base.replace(/translate\(\s*[-\d.]+\s*(?:,\s*[-\d.]+)?\s*\)/, '').trim();
  const prefix = `translate(${ox}, ${oy + deltaY})`;
  el.setAttribute('transform', rest ? `${prefix} ${rest}` : prefix);
  el.setAttribute('data-art-shift-y', String(deltaY));

  // 부모 .vf-modifiers에도 호환용 속성 설정
  const parentMod = el.closest('.vf-modifiers');
  if (parentMod && parentMod !== el) {
    parentMod.setAttribute('data-art-shift-y', String(deltaY));
  }
}

function defaultArticulationPlacement(note: Element): 'above' | 'below' {
  const stem = note.querySelector(':scope > stem, :scope > *|stem')?.textContent?.trim().toLowerCase();
  if (stem === 'up') return 'below';
  if (stem === 'down') return 'above';
  return 'below';
}

function noteLayoutX(note: Element): number {
  const lx = note.getAttribute(OSMD_LAYOUT_X_ATTR)?.trim();
  if (lx) {
    const n = parseFloat(lx);
    if (Number.isFinite(n)) return n;
  }
  const dx = note.getAttribute('default-x')?.trim();
  if (dx) {
    const n = parseFloat(dx);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function notePitchLabel(note: Element): string | null {
  const pitch = note.querySelector(':scope > pitch, :scope > *|pitch');
  if (!pitch) return null;
  const step = pitch.querySelector('step, *|step')?.textContent?.trim()?.toUpperCase();
  const oct = pitch.querySelector('octave, *|octave')?.textContent?.trim();
  if (!step || !oct) return null;
  const alterRaw = pitch.querySelector('alter, *|alter')?.textContent?.trim();
  const alter = alterRaw ? parseInt(alterRaw, 10) : 0;
  const acc =
    alter === 1 ? '#' : alter === -1 ? 'b' : alter === 2 ? '##' : alter === -2 ? 'bb' : '';
  return `${step}${acc}${oct}`;
}

function articulationHintOnEl(el: Element, note: Element, staff: number): OrderedHint {
  const distance = el.getAttribute(HITL_ART_DISTANCE_ATTR);
  const raw = el.getAttribute('default-y')?.trim();
  const dy = raw ? parseInt(raw, 10) : 0;
  let placement = (el.getAttribute('placement') || '').trim().toLowerCase();
  if (placement !== 'above' && placement !== 'below') placement = defaultArticulationPlacement(note);
  const defaultY = Number.isFinite(dy) ? dy : 0;
  return {
    defaultY,
    distance,
    placement: placement as 'above' | 'below',
    staffSpaces: articulationStaffSpacesFromHint(distance, defaultY),
    tag: xmlLocalName(el).replace(/_/g, '-'),
    pitch: notePitchLabel(note),
    layoutX: noteLayoutX(note),
    staff,
  };
}

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

function noteStaffNumber(note: Element): number {
  const st = note.querySelector(':scope > staff, :scope > *|staff')?.textContent?.trim();
  return st && /^\d+$/.test(st) ? parseInt(st, 10) : 1;
}

export function orderedHintsByMeasureFromXml(xml: string): Map<string, OrderedHint[]> {
  const cached = hintsCacheByXml.get(xml);
  if (cached) return cached;

  const map = new Map<string, OrderedHint[]>();
  const doc = parseMusicXmlDocument(xml);
  if (!doc) return map;
  for (const part of findXmlParts(doc)) {
    const partId = part.getAttribute('id')?.trim() || '';
    for (const measure of [...part.children].filter((c) => xmlLocalName(c) === 'measure')) {
      const measureMxl = measure.getAttribute('number')?.trim() || '';
      for (const note of [...measure.children].filter((c) => xmlLocalName(c) === 'note')) {
        if (note.querySelector('rest, *|rest')) continue;
        for (const nots of [...note.children].filter((c) => xmlLocalName(c) === 'notations')) {
          for (const arts of [...nots.children].filter((c) => xmlLocalName(c) === 'articulations')) {
            for (const el of [...arts.children]) {
              if (xmlLocalName(el) === 'articulations') continue;
              const staff = noteStaffNumber(note);
              const key = `${partId}|${measureMxl}|${staff}`;
              const list = map.get(key) ?? [];
              list.push(articulationHintOnEl(el, note, staff));
              map.set(key, list);
            }
          }
        }
      }
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.layoutX - b.layoutX);
  }
  if (hintsCacheByXml.size > 20) hintsCacheByXml.clear();
  hintsCacheByXml.set(xml, map);
  return map;
}

function cloneHintsByMeasure(src: Map<string, OrderedHint[]>): Map<string, OrderedHint[]> {
  const out = new Map<string, OrderedHint[]>();
  for (const [key, list] of src) {
    out.set(
      key,
      list.map((h) => ({ ...h })),
    );
  }
  return out;
}

function noteHasArticulation(note: Element, articulation: string): boolean {
  const artName = articulation.split('(')[0]!.trim().toLowerCase().replace(/_/g, '-');
  for (const nots of [...note.children].filter((c) => xmlLocalName(c) === 'notations')) {
    for (const arts of [...nots.children].filter((c) => xmlLocalName(c) === 'articulations')) {
      for (const el of [...arts.children]) {
        if (xmlLocalName(el).replace(/_/g, '-') === artName) return true;
      }
    }
  }
  return false;
}

function pitchLabelFromFix(fix: ArticulationPreviewFix): string | null {
  const step = fix.pitchStep?.trim().toUpperCase();
  if (!step || fix.pitchOctave == null) return null;
  const alter = fix.pitchAlter ?? 0;
  const acc = alter === 1 ? '#' : alter === -1 ? 'b' : alter === 2 ? '##' : alter === -2 ? 'bb' : '';
  return `${step}${acc}${fix.pitchOctave}`;
}

function overlayFixesOnHints(
  xml: string,
  hintsByMeasure: Map<string, OrderedHint[]>,
  fixes: ArticulationPreviewFix[],
): void {
  if (!fixes.length) return;
  const doc = parseMusicXmlDocument(xml);
  const xmlParts = doc ? findXmlParts(doc) : [];

  for (const fix of fixes) {
    const artName = (fix.articulation ?? '').split('(')[0]!.trim().toLowerCase().replace(/_/g, '-');
    if (!artName) continue;
    const spaces =
      parseArticulationStaffSpaces(
        fix.distance === 'auto' || !fix.distance ? 'auto' : String(fix.distance),
      ) ?? 1;
    let pitch = pitchLabelFromArticulationFix(fix);
    if (!pitch && doc) {
      for (const part of xmlParts) {
        const pid = part.getAttribute('id')?.trim() ?? '';
        if (fix.partId && pid && !previewPartIdsMatch(pid, fix.partId)) continue;
        for (const measure of [...part.children].filter((c) => xmlLocalName(c) === 'measure')) {
          if ((measure.getAttribute('number') ?? '') !== String(fix.measureMxl)) continue;
          const notes = [...measure.children].filter((c) => xmlLocalName(c) === 'note');
          const byIndex = fix.noteIndex != null ? notes[fix.noteIndex] : undefined;
          const note =
            byIndex && (!artName || noteHasArticulation(byIndex, artName))
              ? byIndex
              : notes.find((n) => noteHasArticulation(n, artName)) ?? null;
          if (note) pitch = notePitchLabel(note);
          break;
        }
      }
    }
    for (const [key, list] of hintsByMeasure) {
      const [p, m, s] = key.split('|');
      if (m !== String(fix.measureMxl)) continue;
      if (p && fix.partId && !previewPartIdsMatch(p, fix.partId) && !partIdsMatch(p, fix.partId)) continue;
      const staffW = fix.staffWithinPart ?? fix.staff;
      if (staffW != null && s && s !== String(staffW)) continue;
      for (const h of list) {
        if (h.tag.replace(/_/g, '-') !== artName) continue;
        if (pitch && h.pitch && !pitchLabelsMatch(pitch, h.pitch)) continue;
        h.staffSpaces = spaces;
        h.distance = fix.distance ?? h.distance;
        if (fix.placement === 'above' || fix.placement === 'below') h.placement = fix.placement;
      }
    }
  }
}

function partIdsMatch(graphicPartId: string, targetPartId: string): boolean {
  const base = targetPartId.replace(/__PR$|__PL$/, '');
  const gBase = graphicPartId.replace(/__PR$|__PL$/, '');
  return (
    graphicPartId === targetPartId ||
    graphicPartId === base ||
    graphicPartId === `${base}__PR` ||
    graphicPartId === `${base}__PL` ||
    gBase === base
  );
}

/** MusicXML `<staff>` — 파트 내 줄 번호 (OSMD staffline index 아님). */
function staffWithinPartFromPartId(partId: string): number | null {
  if (partId.endsWith('__PR')) return 1;
  if (partId.endsWith('__PL')) return 2;
  return null;
}

function staffWithinPartFromGraphic(
  osmd: OpenSheetMusicDisplay,
  gm: Parameters<typeof measureMxlFromGraphic>[0],
  staffIndex: number,
): number {
  const fromPartId = staffWithinPartFromPartId(partIdFromGraphic(gm) ?? '');
  if (fromPartId != null) return fromPartId;

  const measureMxl = measureMxlFromGraphic(gm);
  const partId = partIdFromGraphic(gm) ?? '';
  if (measureMxl == null || !partId) return 1;

  const rowIndexes: number[] = [];
  forEachGraphicalMeasure(osmd, (g, si) => {
    if (measureMxlFromGraphic(g) !== measureMxl) return;
    if (!partIdsMatch(partIdFromGraphic(g) ?? '', partId)) return;
    rowIndexes.push(si);
  });
  rowIndexes.sort((a, b) => a - b);
  const idx = rowIndexes.indexOf(staffIndex);
  return idx >= 0 ? idx + 1 : 1;
}

function lookupHints(
  hintsByMeasure: Map<string, OrderedHint[]>,
  partId: string,
  measureMxl: string | number,
  staffWithinPart?: number,
): OrderedHint[] | undefined {
  if (staffWithinPart != null) {
    const key = `${partId}|${measureMxl}|${staffWithinPart}`;
    const direct = hintsByMeasure.get(key);
    if (direct?.length) return direct;
  }

  const merged: OrderedHint[] = [];
  for (const [k, hints] of hintsByMeasure) {
    const [p, m, s] = k.split('|');
    if (m !== String(measureMxl)) continue;
    if (staffWithinPart != null && s !== String(staffWithinPart)) continue;
    if (partIdsMatch(partId, p ?? '')) merged.push(...hints);
  }
  if (merged.length) {
    merged.sort((a, b) => a.layoutX - b.layoutX);
    return merged;
  }

  for (const [k, hints] of hintsByMeasure) {
    const [, m, s] = k.split('|');
    if (m === String(measureMxl) && (staffWithinPart == null || s === String(staffWithinPart))) return hints;
  }
  return undefined;
}

/** OSMD staff line — horizontal path M x y L x y 에서 y 간격(px). */
export function staffLineYsFromSvg(root: ParentNode): number[] {
  const ys: number[] = [];
  for (const path of root.querySelectorAll('.staffline path, .vf-stave path, .vf-measure > path')) {
    const d = path.getAttribute('d') ?? '';
    const m = /M\s*[-\d.eE+]+\s+([-\d.eE+]+)\s*L\s*[-\d.eE+]+\s+([-\d.eE+]+)/i.exec(d);
    if (!m) continue;
    const y1 = parseFloat(m[1]!);
    const y2 = parseFloat(m[2]!);
    if (Number.isFinite(y1) && Number.isFinite(y2) && Math.abs(y1 - y2) < 0.01) ys.push(y1);
  }
  return ys;
}

export function staffLineGapPxFromYs(ys: number[]): number | null {
  if (ys.length < 2) return null;
  const sorted = [...ys].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const g = Math.abs(sorted[i]! - sorted[i - 1]!);
    if (g > 2) gaps.push(g);
  }
  if (!gaps.length) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)]!;
}

/** OSMD SVG — 오선 1칸(staff space) px. */
export function staffSpacePxFromHost(host: HTMLElement, osmd: OpenSheetMusicDisplay): number {
  const fromPaths = staffLineGapPxFromYs(staffLineYsFromSvg(host));
  if (fromPaths != null && fromPaths > 2) return fromPaths;

  const rules = osmd?.EngravingRules as { SpacingBetweenLines?: number; StaffHeight?: number } | undefined;
  const spacing = rules?.SpacingBetweenLines ?? (rules?.StaffHeight != null ? rules.StaffHeight / 4 : 10);
  return spacing * (osmd?.zoom || 1);
}

function coordNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const r = asRecord(v);
  if (!r) return null;
  if (typeof r.realValue === 'number' && Number.isFinite(r.realValue)) return r.realValue;
  if (typeof r.RealValue === 'number' && Number.isFinite(r.RealValue)) return r.RealValue;
  return null;
}

const STEP_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

function pitchLabelFromHalfTone(ht: number): string {
  const midi = Math.round(ht);
  const pcNames = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${pcNames[pc]}${octave}`;
}

function pitchFromVfPitch(vfpitch: unknown): string | null {
  if (Array.isArray(vfpitch)) {
    const base = typeof vfpitch[0] === 'string' ? vfpitch[0] : null;
    if (!base) return null;
    const m = /^([a-g])(b?)n\/(\d+)$/i.exec(base.trim());
    if (!m) return null;
    const step = m[1]!.toUpperCase();
    let acc = m[2] === 'b' ? 'b' : '';
    const accTok = vfpitch[1];
    if (typeof accTok === 'string') {
      const t = accTok.trim().toLowerCase();
      if (t === '#' || t === '##' || t === 'sharp' || t === 'dblsharp') acc = t.startsWith('##') || t === 'dblsharp' ? '##' : '#';
      if (t === 'b' || t === 'bb' || t === 'flat' || t === 'dblflat') acc = t.startsWith('bb') || t === 'dblflat' ? 'bb' : 'b';
    }
    return `${step}${acc}${m[3]}`;
  }
  if (typeof vfpitch !== 'string') return null;
  const m = /^([a-g])([#b]*)n\/(\d+)$/i.exec(vfpitch.trim());
  if (!m) return null;
  return `${m[1]!.toUpperCase()}${m[2] ?? ''}${m[3]}`;
}

function pitchFromGraphicNote(gn: Record<string, unknown>): string | null {
  const fromVf = pitchFromVfPitch(gn.vfpitch ?? gn.vfPitch);
  if (fromVf) return fromVf;
  const src = asRecord(gn.sourceNote ?? gn.SourceNote);
  if (!src) return null;
  const ht = coordNum(src.halfTone ?? src.HalfTone);
  if (ht != null) return pitchLabelFromHalfTone(ht);
  const pitch = asRecord(src.Pitch ?? src.pitch);
  if (!pitch) return null;
  const fn = coordNum(pitch.FundamentalNote ?? pitch.fundamentalNote);
  const oct = coordNum(pitch.Octave ?? pitch.octave);
  if (fn == null || oct == null || fn < 0 || fn > 6) return null;
  /** OSMD AccidentalEnum: NONE=0 SHARP=1 FLAT=2 DOUBLESHARP=4 DOUBLEFLAT=5 */
  const accRaw = coordNum(pitch.Accidental ?? pitch.accidental);
  const acc =
    accRaw === 1 ? '#' : accRaw === 2 ? 'b' : accRaw === 4 ? '##' : accRaw === 5 ? 'bb' : '';
  return `${STEP_NAMES[fn] ?? 'C'}${acc}${oct}`;
}

/** StaveNote SVG 내부에서 실제 Articulation Glyph (path, text, use) 요소 추출 (덧줄·타이·그레이스노트·임시표 제외). */
export function findArticulationElementsInStavenote(stavenote: Element): Element[] {
  const out: Element[] = [];
  const mods = stavenote.querySelectorAll('.vf-modifiers');
  for (const mod of mods) {
    const paths = [...mod.querySelectorAll('path')].filter((p) => {
      // 자식 stavenote(그레이스노트), 음표머리, 타이, 덧줄, 임시표 내부의 path는 무조건 제외
      if (p.closest('.vf-note, .vf-notehead, .vf-ledgers, .vf-stavetie, .vf-beam, .vf-accidental')) return false;
      const parentStavenote = p.closest('.vf-stavenote');
      if (parentStavenote && parentStavenote !== stavenote) return false;
      const d = p.getAttribute('d') ?? '';
      // 덧줄(단순 가로 직선 L x y) 제외
      if (/L\s*[-\d.eE+]+\s+[-\d.eE+]+\s*$/i.test(d) && !/[CQcqs]/.test(d) && (d.match(/M/g) ?? []).length < 2) {
        return false;
      }
      return true;
    });
    const curved = paths.filter((p) => /[CQcqsA]/.test(p.getAttribute('d') ?? ''));
    if (curved.length > 0) {
      out.push(...curved);
    } else if (paths.length > 0) {
      out.push(...paths);
    } else if (mod.querySelector('text, use')) {
      out.push(mod);
    }
  }
  return out;
}

function articulationModTypeMatchesHint(artModType: string | undefined, hintTag: string): boolean {
  if (!artModType) return true;
  const t = artModType.toLowerCase();
  const h = hintTag.toLowerCase().replace(/_/g, '-');
  if (h.includes('accent')) return t.includes('a>') || t.includes('accent') || t.includes('a^');
  if (h.includes('staccato')) return t.includes('a.') || t.includes('staccato');
  if (h.includes('tenuto')) return t.includes('a-') || t.includes('tenuto');
  if (h.includes('marcato') || h.includes('strong')) return t.includes('a^') || t.includes('marcato');
  return true;
}

function countHints(map: Map<string, OrderedHint[]>): number {
  let n = 0;
  for (const v of map.values()) n += v.length;
  return n;
}

function countModifiers(host: HTMLElement): number {
  let n = 0;
  for (const mod of host.querySelectorAll('.vf-modifiers')) {
    if (mod.querySelector('path, text, use')) n += 1;
  }
  return n;
}

/**
 * OSMD 미리보기 — XML articulation을 OSMD StaveNote 및 Modifier에 매칭 후 SVG glyph 이동.
 */
export function applyOsmdArticulationOffsets(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
): number {
  return applyOsmdArticulationOffsetsDetailed(host, osmd).shifted;
}

function vexStaveNoteFromGve(gve: Record<string, unknown>): {
  modifiers?: unknown;
  attrs?: { el?: Element };
  getAttribute?: (k: string) => unknown;
  getStave?: () => unknown;
  stave?: unknown;
  getYs?: () => number[];
  getStem?: () => unknown;
  stem?: unknown;
  getStemExtents?: () => { topY?: number; baseY?: number };
} | null {
  const raw =
    gve.mVexFlowStaveNote ??
    gve.vfStaveNote ??
    gve.vexflowStaffNote ??
    gve.staveNote;
  return raw && typeof raw === 'object' ? (raw as ReturnType<typeof vexStaveNoteFromGve>) : null;
}

function stavenoteSvgFromGraphic(
  osmd: OpenSheetMusicDisplay,
  gNotes: Array<Record<string, unknown>>,
  vf: { attrs?: { el?: Element }; getAttribute?: (k: string) => unknown } | null,
): Element | null {
  const fromVf =
    vf?.attrs?.el ??
    (typeof vf?.getAttribute === 'function' ? (vf.getAttribute('el') as Element | null) : null);
  if (fromVf) {
    const sn = fromVf.closest?.('.vf-stavenote, .vf-staveNote') ?? fromVf;
    if (sn) return sn;
  }
  const rules = (osmd as unknown as { EngravingRules?: { GNote?: (n: unknown) => unknown } }).EngravingRules;
  for (const gn of gNotes) {
    const src = gn.sourceNote ?? gn.SourceNote;
    const candidates: unknown[] = [];
    if (rules?.GNote && src) {
      try {
        candidates.push(rules.GNote(src));
      } catch {
        /* */
      }
    }
    candidates.push(gn);
    for (const cand of candidates) {
      const rec = asRecord(cand);
      const el = rec && typeof rec.getSVGGElement === 'function' ? (rec.getSVGGElement as () => Element | null)() : null;
      if (!el) continue;
      const sn = (el as Element).closest?.('.vf-stavenote, .vf-staveNote') ?? el;
      if (sn) return sn;
    }
  }
  return null;
}

export function applyOsmdArticulationOffsetsDetailed(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
): ArticulationShiftStats {
  const empty = { shifted: 0, modifierCount: 0, hintCount: 0, staffSpacePx: 0 };
  if (!host?.querySelector('svg')) return empty;

  resetOsmdArticulationOffsets(host);

  const xml = resolveArticulationPreviewXml(osmd);
  if (!xml?.trim()) return empty;

  const hintsByMeasure = cloneHintsByMeasure(orderedHintsByMeasureFromXml(xml));
  overlayFixesOnHints(xml, hintsByMeasure, articulationFixesByOsmd.get(osmd) ?? []);
  const totalHints = countHints(hintsByMeasure);
  if (totalHints === 0) return { ...empty, modifierCount: countModifiers(host) };

  const staffSpacePx = staffSpacePxFromHost(host, osmd);

  let shiftedCount = 0;
  const usedElements = new Set<Element>();
  const usedHints = new Set<OrderedHint>();

  try {
    forEachGraphicalMeasure(osmd, (gm, staffIndex) => {
      const measureMxl = measureMxlFromGraphic(gm);
      if (measureMxl == null) return;
      const partId = partIdFromGraphic(gm) ?? '';
      const staffWithinPart = staffWithinPartFromGraphic(osmd, gm, staffIndex);
      const hints =
        lookupHints(hintsByMeasure, partId, measureMxl, staffWithinPart) ??
        lookupHints(hintsByMeasure, partId, measureMxl) ??
        [];
      if (!hints.length) return;

      const staffEntries = (gm.staffEntries ?? gm.StaffEntries ?? []) as unknown[];
      for (const seRaw of staffEntries) {
        const se = asRecord(seRaw);
        if (!se) continue;
        const gves = (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as unknown[];
        for (const gveRaw of gves) {
          const gve = asRecord(gveRaw);
          if (!gve) continue;
          const staveNote = vexStaveNoteFromGve(gve);
          const rawMods = staveNote?.modifiers as unknown;
          const mods = (Array.isArray(rawMods)
            ? rawMods
            : rawMods && typeof rawMods === 'object' && Array.isArray((rawMods as { list?: unknown }).list)
              ? (rawMods as { list: unknown[] }).list
              : []) as Array<{
            getCategory?: () => string;
            category?: string;
            getPosition?: () => number;
            type?: string;
          }>;
          const artMods = mods.filter((m) => {
            const cat = String(m.getCategory?.() ?? m.category ?? '').toLowerCase();
            const t = String(m.type ?? '').toLowerCase();
            return (
              cat.includes('articulation') ||
              t.includes('accent') ||
              t.includes('staccato') ||
              t.includes('tenuto') ||
              t.includes('marcato') ||
              /^a[>.\-^@+]/.test(t)
            );
          });

          const gNotes = (gve.notes ?? gve.Notes ?? []) as Array<Record<string, unknown>>;
          const notePitches = gNotes.map((gn) => pitchFromGraphicNote(gn)).filter(Boolean) as string[];

          const staveNoteSvg = stavenoteSvgFromGraphic(osmd, gNotes, staveNote);
          if (!staveNoteSvg) continue;
          const artEls = findArticulationElementsInStavenote(staveNoteSvg);
          if (!artEls.length) continue;

          const modsOrFake =
            artMods.length > 0 ? artMods : [{ type: undefined as string | undefined, getPosition: () => 0 }];

          for (let i = 0; i < Math.max(modsOrFake.length, 1); i++) {
            const artMod = modsOrFake[i] ?? modsOrFake[0];
            const artEl = artEls[i] ?? artEls[0];
            if (!artEl || usedElements.has(artEl)) continue;

            const candidateHints = hints.filter((h) => {
              if (usedHints.has(h)) return false;
              if (artMod?.type && !articulationModTypeMatchesHint(artMod.type, h.tag)) return false;
              if (h.pitch && notePitches.length && !notePitches.some((p) => pitchLabelsMatch(p, h.pitch!))) {
                return false;
              }
              return true;
            });
            const matchedHint = candidateHints[0];
            if (!matchedHint) continue;

            const isAbove = artMod?.getPosition?.() === 3 || matchedHint.placement === 'above';
            const dir = isAbove ? -1 : 1;
            const stave =
              staveNote?.getStave?.() ??
              staveNote?.stave ??
              (gm as { getVFStave?: (n?: number) => unknown; stave?: unknown }).getVFStave?.(staffWithinPart) ??
              (gm as { stave?: unknown }).stave;
            const lineSpacing =
              (typeof (stave as { getSpacingBetweenLines?: () => number })?.getSpacingBetweenLines === 'function'
                ? (stave as { getSpacingBetweenLines: () => number }).getSpacingBetweenLines()
                : null) ||
              staffSpacePx ||
              10;

            const shiftPx = articulationPreviewShiftPx(matchedHint.staffSpaces, lineSpacing);
            applyArticulationShiftY(artEl, dir * shiftPx);
            shiftedCount += 1;
            usedElements.add(artEl);
            usedHints.add(matchedHint);
          }
        }
      }
    });
  } catch (err) {
    console.warn('[osmdArticulationOffsetFix] error applying offsets:', err);
  }

  return {
    shifted: shiftedCount,
    modifierCount: countModifiers(host),
    hintCount: totalHints,
    staffSpacePx,
  };
}

/** @deprecated */
export function articulationShiftMultiplierFromDefaultY(defaultY: number, distance?: string | null): number {
  return articulationStaffSpacesFromHint(distance, defaultY);
}

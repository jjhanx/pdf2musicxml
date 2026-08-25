import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import {
  articulationStaffSpacesFromHint,
  extraLiftedArticulationStaffSpaces,
  HITL_ART_DISTANCE_ATTR,
  HITL_LIFTED_ART_ATTR,
  isLiftedArticulationGlyph,
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

/**
 * VexFlow Articulation.draw()는 path를 절대 좌표로 그리며 `this.y_shift`만 반영한다.
 * OSMD는 slur 시작음에만 setYShift하고 MusicXML default-y는 무시한다.
 * 거리 드롭다운 → 이 값 → draw() 중 y에 더함 (CSS/transform 우회 없음).
 */
let hitlArticulationExtraYPx = 0;
let articulationDrawPatched = false;

export function setHitlArticulationExtraYPx(y: number): void {
  hitlArticulationExtraYPx = Number.isFinite(y) ? y : 0;
}

export function getHitlArticulationExtraYPx(): number {
  return hitlArticulationExtraYPx;
}

type VfArticulationLike = {
  type?: string;
  y_shift?: number;
  setYShift?: (n: number) => unknown;
  getCategory?: () => string;
  category?: string;
  draw?: (...a: unknown[]) => unknown;
  constructor?: { prototype: { draw: (...a: unknown[]) => unknown }; __hitlArtDrawPatched?: boolean };
};

function isVfArticulationMod(m: VfArticulationLike | null | undefined): boolean {
  if (!m) return false;
  const cat = String(m.getCategory?.() ?? m.category ?? '').toLowerCase();
  if (cat.includes('articulation')) return true;
  const t = String(m.type ?? '').toLowerCase();
  // VexFlow articulation codes: a> a- a. a^ a@a abr am …
  return /^a[>.\-^@|,]/.test(t) || t === 'av' || t === 'ao' || t === 'ah' || t === 'abr' || t === 'am';
}

/** VexFlow Articulation.prototype.draw에 HITL extraY를 주입. 한 번만. */
export function ensureArticulationDrawPatch(osmd: OpenSheetMusicDisplay): boolean {
  if (articulationDrawPatched) return true;
  let ctor: VfArticulationLike['constructor'] | null = null;
  forEachGraphicalMeasure(osmd, (gm) => {
    if (ctor) return;
    const staffEntries = (gm.staffEntries ?? gm.StaffEntries ?? []) as unknown[];
    for (const seRaw of staffEntries) {
      if (ctor) break;
      const se = asRecord(seRaw);
      if (!se) continue;
      const gves = (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as unknown[];
      for (const gveRaw of gves) {
        if (ctor) break;
        const gve = asRecord(gveRaw);
        if (!gve) continue;
        const staveNote = vexStaveNoteFromGve(gve);
        const rawMods = staveNote?.modifiers as unknown;
        const mods = (Array.isArray(rawMods)
          ? rawMods
          : rawMods && typeof rawMods === 'object' && Array.isArray((rawMods as { list?: unknown }).list)
            ? (rawMods as { list: unknown[] }).list
            : []) as VfArticulationLike[];
        for (const m of mods) {
          if (isVfArticulationMod(m) && m.constructor?.prototype?.draw) {
            ctor = m.constructor;
            break;
          }
        }
      }
    }
  });
  if (!ctor?.prototype?.draw || ctor.__hitlArtDrawPatched) {
    if (ctor?.__hitlArtDrawPatched) articulationDrawPatched = true;
    return articulationDrawPatched;
  }
  const orig = ctor.prototype.draw;
  ctor.prototype.draw = function hitlArticulationDraw(this: VfArticulationLike, ...args: unknown[]) {
    const saved = this.y_shift;
    const extra = hitlArticulationExtraYPx;
    (ctor as { __hitlDrawCount?: number }).__hitlDrawCount =
      ((ctor as { __hitlDrawCount?: number }).__hitlDrawCount ?? 0) + 1;
    if (extra) this.y_shift = (typeof saved === 'number' && Number.isFinite(saved) ? saved : 0) + extra;
    try {
      return orig.apply(this, args);
    } finally {
      this.y_shift = saved;
    }
  };
  ctor.__hitlArtDrawPatched = true;
  articulationDrawPatched = true;
  return true;
}

/** 테스트용 — 패치된 Articulation.draw 호출 횟수 */
export function getArticulationDrawPatchHitCount(osmd: OpenSheetMusicDisplay): number {
  let count = 0;
  forEachGraphicalMeasure(osmd, (gm) => {
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
            : []) as VfArticulationLike[];
        for (const m of mods) {
          if (isVfArticulationMod(m) && m.constructor) {
            count = Math.max(count, (m.constructor as { __hitlDrawCount?: number }).__hitlDrawCount ?? 0);
          }
        }
      }
    }
  });
  return count;
}

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
  for (const wrap of [...host.querySelectorAll('g[data-hitl-art-wrap]')]) {
    const g = wrap.parentElement;
    if (!g) {
      wrap.remove();
      continue;
    }
    while (wrap.firstChild) g.insertBefore(wrap.firstChild, wrap);
    wrap.remove();
  }
  for (const el of host.querySelectorAll('[data-hitl-base-tf]')) {
    const base = el.getAttribute('data-hitl-base-tf') ?? '';
    if (base) el.setAttribute('transform', base);
    else el.removeAttribute('transform');
    el.removeAttribute('data-hitl-base-tf');
    el.removeAttribute('data-art-shift-y');
  }
  for (const el of host.querySelectorAll('[data-art-base-transform]')) {
    el.setAttribute('transform', el.getAttribute('data-art-base-transform') ?? '');
    el.removeAttribute('data-art-shift-y');
    const sty = (el as SVGElement & { style?: CSSStyleDeclaration }).style;
    if (sty?.removeProperty) sty.removeProperty('translate');
  }
  for (const el of host.querySelectorAll('[data-art-shift-y]')) {
    el.removeAttribute('data-art-shift-y');
    const sty = (el as SVGElement & { style?: CSSStyleDeclaration }).style;
    if (sty?.removeProperty) sty.removeProperty('translate');
  }
  host.removeAttribute('data-hitl-art-shifted');
}

export function applyArticulationShiftY(el: Element, deltaY: number): void {
  // 글리프(path/use) 자체를 옮김. 부모 .vf-modifiers는 VexFlow가 매 레이아웃마다 transform을 덮어씀.
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
  // SVG transform 속성과 별개 — OSMD가 attribute를 덮어써도 CSS translate는 남음
  const sty = (el as SVGElement & { style?: CSSStyleDeclaration }).style;
  if (sty?.setProperty) sty.setProperty('translate', `0px ${deltaY}px`);
  const parentMod = typeof el.closest === 'function' ? el.closest('.vf-modifiers') : null;
  if (parentMod && parentMod !== el) {
    parentMod.setAttribute('data-art-shift-y', String(deltaY));
    const psty = (parentMod as SVGElement & { style?: CSSStyleDeclaration }).style;
    if (psty?.setProperty) psty.setProperty('translate', `0px ${deltaY}px`);
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
      for (const h of list) {
        if (h.tag.replace(/_/g, '-') !== artName) continue;
        if (pitch && h.pitch && !pitchLabelsMatch(pitch, h.pitch) && !pitchLetterOctaveMatch(pitch, h.pitch)) continue;
        // 피치가 맞으면 staff 키 불일치여도 덮어씀 (PR/PL 분할 후 staff 번호 재배치)
        if (!pitch && staffW != null && s && s !== String(staffW)) continue;
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

/**
 * OSMD 음표 피치. 조표 안의 F♯는 VexFlow `vfpitch`가 `fn/4`(F4)만 주어
 * HITL `F#4`와 불일치하므로 halfTone / source Pitch를 vfpitch보다 우선한다.
 */
export function graphicNotePitchLabel(gn: Record<string, unknown>): string | null {
  return pitchFromGraphicNote(gn);
}

function pitchFromGraphicNote(gn: Record<string, unknown>): string | null {
  const src = asRecord(gn.sourceNote ?? gn.SourceNote);
  if (src) {
    const ht = coordNum(src.halfTone ?? src.HalfTone);
    if (ht != null) return pitchLabelFromHalfTone(ht);
    const pitch = asRecord(src.Pitch ?? src.pitch);
    if (pitch) {
      const fn = coordNum(pitch.FundamentalNote ?? pitch.fundamentalNote);
      const oct = coordNum(pitch.Octave ?? pitch.octave);
      if (fn != null && oct != null && fn >= 0 && fn <= 6) {
        /** OSMD AccidentalEnum: NONE=0 SHARP=1 FLAT=2 DOUBLESHARP=4 DOUBLEFLAT=5 */
        const accRaw = coordNum(pitch.Accidental ?? pitch.accidental);
        const acc =
          accRaw === 1 ? '#' : accRaw === 2 ? 'b' : accRaw === 4 ? '##' : accRaw === 5 ? 'bb' : '';
        return `${STEP_NAMES[fn] ?? 'C'}${acc}${oct}`;
      }
    }
  }
  return pitchFromVfPitch(gn.vfpitch ?? gn.vfPitch);
}

/** F#4 vs F4 — 조표로 VexFlow가 임시표를 생략한 경우 */
function pitchLetterOctaveMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().toUpperCase().replace(/♯/g, '#').replace(/♭/g, 'B');
  const pa = /^([A-G])[#B]*(\d+)$/.exec(norm(a));
  const pb = /^([A-G])[#B]*(\d+)$/.exec(norm(b));
  return Boolean(pa && pb && pa[1] === pb[1] && pa[2] === pb[2]);
}

function graphicPitchesMatchFix(notePitches: string[], fixPitch: string): boolean {
  if (notePitches.some((p) => pitchLabelsMatch(p, fixPitch))) return true;
  return notePitches.some((p) => pitchLetterOctaveMatch(p, fixPitch));
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
/**
 * OSMD 미리보기 — XML articulation을 OSMD StaveNote 및 Modifier에 매칭 후 SVG glyph 이동.
 */
export function applyOsmdArticulationOffsets(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
): number {
  return applyOsmdArticulationOffsetsDetailed(host, osmd).shifted;
}

/**
 * Accent 글리프 이동 — `.vf-modifiers` 자식을 `g[data-hitl-art-wrap]`로 감싸
 * `transform=translate(0,dy)` (VexFlow path의 transform 속성·CSS 무시 문제 회피).
 */
export function applyDyToVfModifiersAttr(host: HTMLElement, dy: number): number {
  if (!dy) {
    resetOsmdArticulationOffsets(host);
    applyHitlArticulationHostCss(host, 0);
    host.setAttribute('data-hitl-art-shifted', '0');
    host.title = '[HITL Accent] dy=0';
    return 0;
  }
  const n = applySvgDyToVfModifiers(host, dy);
  applyHitlArticulationHostCss(host, dy);
  host.setAttribute('data-hitl-art-shifted', String(n));
  host.title = `[HITL Accent] dy=${dy}px, wraps=${n}`;
  return n;
}

/**
 * 거리 드롭다운용 — 인자 fixes만 사용(WeakMap 빈 배열에 가로채이지 않음).
 */
export function applyPendingArticulationOffsetsOnly(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay | null | undefined,
  fixes: ReadonlyArray<ArticulationPreviewFix>,
): number {
  if (!host) return 0;
  const pending = fixes.filter(
    (f) =>
      (f.kind === 'setArticulationPlacement' || f.kind === 'addArticulation') &&
      Boolean(f.articulation),
  );
  if (osmd) registerOsmdArticulationFixes(osmd, pending);
  const staffSpacePx =
    host.querySelector('svg') && osmd?.IsReadyToRender?.()
      ? staffSpacePxFromHost(host, osmd) || 10
      : 10;
  const y = extraYPxFromArticulationFixes(pending, staffSpacePx);
  setHitlArticulationExtraYPx(y);
  return applyDyToVfModifiersAttr(host, y);
}

/**
 * OSMD 미리보기 Accent 거리 — 호스트 `--hitl-art-dy` + index.css `transform:translateY`.
 * SVG는 CSS `translate` 개별 속성을 무시하지만 `transform`은 적용되며,
 * 스타일시트라 OSMD가 .vf-modifiers를 교체해도 다시 먹는다.
 */

export function normalizeSvgTransform(raw: string): string {
  return (raw ?? '')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function composeSvgTranslateY(base: string, dy: number): string {
  const raw = (base ?? '').trim();
  if (!dy) return raw;
  const m = /translate\(\s*([-\d.eE]+)(?:[\s,]+([-\d.eE]+))?\s*\)/.exec(raw);
  if (m) {
    const x = parseFloat(m[1]!);
    const y = parseFloat(m[2] ?? '0');
    const rest = raw.replace(m[0], '').trim();
    const t = `translate(${x}, ${y + dy})`;
    return rest ? `${t} ${rest}` : t;
  }
  return raw ? `translate(0, ${dy}) ${raw}` : `translate(0, ${dy})`;
}

/** Accent 등 VexFlow articulation — .vf-modifiers 자식을 래퍼 g로 감싸 translate(0,dy) 적용 */
export function applySvgDyToModifier(modifierEl: Element, dy: number): void {
  const doc = modifierEl.ownerDocument;
  let wrap = modifierEl.querySelector(':scope > g[data-hitl-art-wrap]') as SVGGElement | null;
  if (!wrap) {
    wrap = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
    wrap.setAttribute('data-hitl-art-wrap', '1');
    while (modifierEl.firstChild) wrap.appendChild(modifierEl.firstChild);
    modifierEl.appendChild(wrap);
  }
  if (dy) wrap.setAttribute('transform', `translate(0, ${dy})`);
  else wrap.removeAttribute('transform');
  modifierEl.setAttribute('data-art-shift-y', String(dy));
}

/** @deprecated 테스트·레거시 — 프로덕션은 applySvgDyToModifier(타깃) 사용 */
export function applySvgDyToVfModifiers(host: HTMLElement, dy: number): number {
  let n = 0;
  for (const g of host.querySelectorAll('.vf-modifiers')) {
    applySvgDyToModifier(g, dy);
    n += 1;
  }
  return n;
}

function applyArticulationOffsetToTarget(el: Element, dy: number): void {
  const modGroup = el.classList.contains('vf-modifiers') ? el : el.closest('.vf-modifiers');
  if (modGroup) applySvgDyToModifier(modGroup, dy);
  else applyArticulationShiftY(el, dy);
}

export function extraYPxFromArticulationFixes(
  fixes: ReadonlyArray<ArticulationPreviewFix>,
  lineSpacing: number,
): number {
  let extra = 0;
  for (const f of fixes) {
    if (f.kind !== 'setArticulationPlacement' && f.kind !== 'addArticulation') continue;
    const spaces =
      parseArticulationStaffSpaces(
        f.distance === 'auto' || !f.distance ? 'auto' : String(f.distance),
      ) ?? 1;
    const y = extraArticulationYPx(spaces, lineSpacing > 2 ? lineSpacing : 10, f.placement === 'above');
    if (Math.abs(y) >= Math.abs(extra)) extra = y;
  }
  return extra;
}

/** 호스트 CSS 변수(디버그·회귀). 실제 이동은 applyOsmdArticulationOffsetsDetailed의 노드별 래퍼 transform. */
export function applyHitlArticulationHostCss(host: HTMLElement, extraY: number): void {
  host.style.setProperty('--hitl-art-dy', `${extraY}px`);
  host.setAttribute('data-hitl-art-dy', String(extraY));
}

function isDomElement(v: unknown): v is Element {
  return !!v && typeof v === 'object' && (v as { nodeType?: number }).nodeType === 1;
}

function vexModifierSvg(mod: {
  attrs?: { el?: Element };
  el?: Element;
  getAttribute?: (k: string) => unknown;
} | null | undefined): Element | null {
  if (!mod) return null;
  if (isDomElement(mod.attrs?.el)) return mod.attrs.el;
  if (isDomElement(mod.el)) return mod.el;
  if (typeof mod.getAttribute === 'function') {
    const e = mod.getAttribute('el');
    if (isDomElement(e)) return e;
  }
  return null;
}

function getStaveNoteExtentsY(staveNote: {
  getYs?: () => number[];
  getStem?: () => { getExtents?: () => { topY?: number; baseY?: number } };
  stem?: { getExtents?: () => { topY?: number; baseY?: number } };
  getStemExtents?: () => { topY?: number; baseY?: number };
} | null): { topY: number | null; bottomY: number | null } {
  if (!staveNote) return { topY: null, bottomY: null };
  const ys = typeof staveNote.getYs === 'function' ? staveNote.getYs() : [];
  if (!ys.length) return { topY: null, bottomY: null };
  let minNoteY = Math.min(...ys) - 5;
  let maxNoteY = Math.max(...ys) + 5;
  const stem = typeof staveNote.getStem === 'function' ? staveNote.getStem() : staveNote.stem;
  const ext =
    stem && typeof stem.getExtents === 'function'
      ? stem.getExtents()
      : typeof staveNote.getStemExtents === 'function'
        ? staveNote.getStemExtents()
        : null;
  if (ext && typeof ext.topY === 'number' && typeof ext.baseY === 'number') {
    minNoteY = Math.min(minNoteY, ext.topY, ext.baseY);
    maxNoteY = Math.max(maxNoteY, ext.topY, ext.baseY);
  }
  return { topY: minNoteY, bottomY: maxNoteY };
}

function getSvgElementBaseY(el: Element): number | null {
  try {
    if (typeof (el as SVGGraphicsElement).getBBox === 'function') {
      const b = (el as SVGGraphicsElement).getBBox();
      if (Number.isFinite(b.y) && (b.width > 0 || b.height > 0)) return b.y + b.height / 2;
    }
  } catch {
    /* jsdom */
  }
  const d = el.getAttribute('d') ?? '';
  const m = /^[Mm]\s*[-\d.eE+]+\s+([-\d.eE+]+)/.exec(d);
  if (m) {
    const y = parseFloat(m[1]!);
    if (Number.isFinite(y)) return y;
  }
  const yAttr = el.getAttribute('y');
  if (yAttr) {
    const y = parseFloat(yAttr);
    if (Number.isFinite(y)) return y;
  }
  return null;
}

const HITL_Y_SHIFT_PATCH = '__hitlArtYShiftPatch';

function measureSvgFromGraphic(gm: unknown): Element | null {
  const rec = asRecord(gm);
  if (!rec) return null;
  if (typeof rec.getSVGGElement === 'function') {
    const el = (rec.getSVGGElement as () => Element | null)();
    if (el) return (typeof el.closest === 'function' ? el.closest('.vf-measure') : null) ?? el;
  }
  const stave = asRecord(rec.stave ?? rec.Stave ?? rec.vfStave);
  if (stave && typeof stave.getSVGElement === 'function') {
    const el = (stave.getSVGElement as () => Element | null)();
    if (el) return (typeof el.closest === 'function' ? el.closest('.vf-measure') : null) ?? el;
  }
  const staffEntries = (rec.staffEntries ?? rec.StaffEntries ?? []) as unknown[];
  for (const seRaw of staffEntries) {
    const se = asRecord(seRaw);
    const gves = (se?.graphicalVoiceEntries ?? se?.GraphicalVoiceEntries ?? []) as unknown[];
    for (const gveRaw of gves) {
      const gve = asRecord(gveRaw);
      const notes = (gve?.notes ?? gve?.Notes ?? []) as unknown[];
      for (const gnRaw of notes) {
        const gn = asRecord(gnRaw);
        if (gn && typeof gn.getSVGGElement === 'function') {
          const el = (gn.getSVGGElement as () => Element | null)();
          if (el) return (typeof el.closest === 'function' ? el.closest('.vf-measure') : null) ?? el;
        }
      }
    }
  }
  return rec.svg && isDomElement(rec.svg) ? rec.svg : null;
}

function extraArticulationYPx(staffSpaces: number, lineSpacing: number, isAbove: boolean): number {
  const extraLines = Math.max(0, staffSpaces - 1);
  const dir = isAbove ? -1 : 1;
  return dir * extraLines * lineSpacing;
}

/** OSMD Direction(words) Accent — 1칸은 오선 쪽, 4칸≈mf, 그 이상은 mf보다 밖. */
function extraLiftedDirectionYPx(staffSpaces: number, lineSpacing: number, isAbove: boolean): number {
  const dir = isAbove ? -1 : 1;
  return dir * extraLiftedArticulationStaffSpaces(staffSpaces) * lineSpacing;
}

function artNameFromFix(fix: ArticulationPreviewFix): string {
  return (fix.articulation ?? '').split('(')[0]!.trim().toLowerCase().replace(/_/g, '-');
}

/** pending 거리 — 해당 마디·파트·피치(또는 staff)에 맞는 articulation만 이동 */
function applyPendingDistanceDirect(
  osmd: OpenSheetMusicDisplay,
  pendingFixes: ArticulationPreviewFix[],
  staffSpacePx: number,
  usedElements: Set<Element>,
): number {
  if (!pendingFixes.length) return 0;
  const measureKeys = new Set(pendingFixes.map((f) => String(f.measureMxl)));
  let shifted = 0;
  forEachGraphicalMeasure(osmd, (gm, staffIndex) => {
    const measureMxl = measureMxlFromGraphic(gm);
    if (measureMxl == null) return;
    if (!measureKeys.has(String(measureMxl))) return;
    const partId = partIdFromGraphic(gm) ?? '';
    const staffWithinPart = staffWithinPartFromGraphic(osmd, gm, staffIndex);

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
          attrs?: { el?: Element };
          el?: Element;
          getAttribute?: (k: string) => unknown;
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
        const artEls = staveNoteSvg ? findArticulationElementsInStavenote(staveNoteSvg) : [];
        const modGroups = staveNoteSvg
          ? ([...staveNoteSvg.querySelectorAll('.vf-modifiers')] as Element[])
          : [];
        if (!artMods.length && !artEls.length && !modGroups.length) continue;

        const stave =
          staveNote?.getStave?.() ??
          staveNote?.stave ??
          (gm as { getVFStave?: (n?: number) => unknown }).getVFStave?.(staffWithinPart) ??
          (gm as { stave?: unknown }).stave;
        const lineSpacing =
          (typeof (stave as { getSpacingBetweenLines?: () => number })?.getSpacingBetweenLines === 'function'
            ? (stave as { getSpacingBetweenLines: () => number }).getSpacingBetweenLines()
            : null) ||
          staffSpacePx ||
          10;

        for (let i = 0; i < Math.max(artMods.length, artEls.length, modGroups.length, 1); i++) {
          const artMod = artMods[i] ?? artMods[0];
          // artTag는 fix 쪽 이름 기준 (Vex type "a>" → ">"로 잘못 줄어 accent 매칭 실패 방지)
          const pending = staffSpacesFromPendingFix(pendingFixes, {
            partId,
            measureMxl,
            pitches: notePitches,
            artTag: undefined,
            staffWithinPart,
          });
          if (!pending) continue;

          const artName = artNameFromFix(
            pendingFixes.find((f) => String(f.measureMxl) === String(measureMxl)) ?? pendingFixes[0]!,
          );
          const typeOk =
            !artMod?.type ||
            !artName ||
            articulationModTypeMatchesHint(artMod.type, artName) ||
            articulationModTypeMatchesHint(artMod.type, 'accent');
          if (artMod && artMods.length && !typeOk) continue;

          const isAbove = artMod?.getPosition?.() === 3 || pending.placement === 'above';
          const extraY = extraArticulationYPx(pending.staffSpaces, lineSpacing, isAbove);
          const targets: Element[] = [];
          const modEl = vexModifierSvg(artMod);
          if (modEl && !usedElements.has(modEl)) targets.push(modEl);
          const artEl = artEls[i] ?? artEls[0];
          if (artEl && !usedElements.has(artEl)) targets.push(artEl);
          for (const g of modGroups) {
            if (!usedElements.has(g)) targets.push(g);
          }
          for (const t of targets) {
            applyArticulationOffsetToTarget(t, extraY);
            usedElements.add(t);
            shifted += 1;
          }
        }
      }
    }
  });
  return shifted;
}

function staffSpacesFromPendingFix(
  fixes: ArticulationPreviewFix[],
  opts: {
    partId: string;
    measureMxl: string | number;
    pitches: string[];
    artTag?: string;
    staffWithinPart?: number;
  },
): { staffSpaces: number; placement?: 'above' | 'below' } | null {
  let found: { staffSpaces: number; placement?: 'above' | 'below' } | null = null;
  for (const fix of fixes) {
    if (String(fix.measureMxl) !== String(opts.measureMxl)) continue;
    if (fix.partId && opts.partId && !previewPartIdsMatch(opts.partId, fix.partId) && !partIdsMatch(opts.partId, fix.partId)) {
      continue;
    }
    const artName = (fix.articulation ?? '').split('(')[0]!.trim().toLowerCase().replace(/_/g, '-');
    if (opts.artTag && artName && opts.artTag.replace(/_/g, '-') !== artName) continue;
    const fpitch = pitchLabelFromArticulationFix(fix);
    if (fpitch) {
      if (opts.pitches.length && !graphicPitchesMatchFix(opts.pitches, fpitch)) continue;
    } else {
      const staffW = fix.staffWithinPart ?? fix.staff;
      if (staffW != null && opts.staffWithinPart != null && staffW !== opts.staffWithinPart) continue;
    }
    const spaces =
      parseArticulationStaffSpaces(
        fix.distance === 'auto' || !fix.distance ? 'auto' : String(fix.distance),
      ) ?? 1;
    found = {
      staffSpaces: spaces,
      placement: fix.placement === 'above' || fix.placement === 'below' ? fix.placement : undefined,
    };
  }
  return found;
}

function ensureArticulationDrawUsesYShift(mod: { constructor?: { prototype?: Record<string, unknown> } }): void {
  const proto = mod.constructor?.prototype;
  if (!proto || typeof proto.draw !== 'function' || proto[HITL_Y_SHIFT_PATCH]) return;
  const orig = proto.draw as (this: { glyph?: { render?: Function }; y_shift?: number }) => unknown;
  proto.draw = function (this: { glyph?: { render?: (ctx: unknown, x: number, y: number) => void }; y_shift?: number }) {
    const extra = Number(this.y_shift) || 0;
    const glyph = this.glyph;
    if (!extra || typeof glyph?.render !== 'function') return orig.apply(this, arguments as unknown as []);
    const origRender = glyph.render.bind(glyph);
    glyph.render = (ctx: unknown, x: number, y: number) => origRender(ctx, x, y + extra);
    try {
      return orig.apply(this, arguments as unknown as []);
    } finally {
      glyph.render = origRender;
    }
  };
  proto[HITL_Y_SHIFT_PATCH] = true;
}

/** 다음 전체 render용 y_shift만 설정. 즉시 화면 반영은 SVG transform이 담당. */
function rememberArticulationYShift(
  mod: {
    setYShift?: (y: number) => void;
    y_shift?: number;
    constructor?: { prototype?: Record<string, unknown> };
  },
  extraY: number,
): void {
  ensureArticulationDrawUsesYShift(mod);
  if (typeof mod.setYShift === 'function') mod.setYShift(extraY);
  else mod.y_shift = extraY;
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

function labelTextFromExpression(expr: Record<string, unknown>): string {
  const label = asRecord(expr.Label ?? expr.label);
  if (label) {
    const inner = asRecord(label.Label ?? label.label);
    const t =
      (typeof label.text === 'string' && label.text) ||
      (typeof label.Text === 'string' && label.Text) ||
      (typeof inner?.text === 'string' && inner.text) ||
      (typeof inner?.Text === 'string' && inner.Text) ||
      '';
    if (t) return t.trim();
  }
  const multi = asRecord(expr.sourceMultiExpression ?? expr.SourceMultiExpression);
  const unknown = (multi?.UnknownList ?? multi?.unknownList ?? []) as Array<Record<string, unknown>>;
  const first = unknown[0];
  const lab = first && (first.Label ?? first.label);
  return typeof lab === 'string' ? lab.trim() : '';
}

function labelSvgFromExpression(expr: Record<string, unknown>): Element | null {
  const label = asRecord(expr.Label ?? expr.label);
  const node = label?.SVGNode ?? label?.svgNode;
  if (isDomElement(node)) return node;
  if (node && typeof node === 'object' && isDomElement((node as { parentElement?: unknown }).parentElement)) {
    return (node as { parentElement: Element }).parentElement;
  }
  return null;
}

function defaultYXmlFromExpression(expr: Record<string, unknown>): number | null {
  const direct = coordNum(expr.defaultYXml ?? expr.DefaultYXml);
  if (direct != null) return direct;
  const multi = asRecord(expr.sourceMultiExpression ?? expr.SourceMultiExpression);
  const unknown = (multi?.UnknownList ?? multi?.unknownList ?? []) as Array<Record<string, unknown>>;
  const first = unknown[0];
  return first ? coordNum(first.defaultYXml ?? first.DefaultYXml) : null;
}

function placementAboveFromExpression(expr: Record<string, unknown>, defaultY: number | null): boolean {
  const p = expr.Placement ?? expr.placement;
  // OSMD PlacementEnum: Above=0 Below=1 Left=2 Right=3 NotYetDefined=4
  if (p === 0 || p === 'above' || p === 'Above') return true;
  if (p === 1 || p === 'below' || p === 'Below') return false;
  return (defaultY ?? 0) > 0;
}

function staffSpaceFromStaffLine(sl: Record<string, unknown> | null, fallback: number): number {
  const stave = asRecord(sl?.stave ?? sl?.Stave ?? sl?.vfStave);
  const gap =
    typeof stave?.getSpacingBetweenLines === 'function'
      ? Number((stave.getSpacingBetweenLines as () => number)())
      : NaN;
  return Number.isFinite(gap) && gap > 2 ? gap : fallback;
}

function shiftLiftedOsmdExpressions(osmd: OpenSheetMusicDisplay, staffSpacePx: number): number {
  const rec = osmd as unknown as Record<string, unknown>;
  const sheet = asRecord(rec.GraphicSheet ?? rec.graphicSheet ?? rec.graphic);
  if (!sheet) return 0;
  const pages = (sheet.MusicPages ?? sheet.musicPages ?? []) as unknown[];
  let shifted = 0;
  for (const pageRaw of pages) {
    const page = asRecord(pageRaw);
    const systems = (page?.MusicSystems ?? page?.musicSystems ?? []) as unknown[];
    for (const sysRaw of systems) {
      const sys = asRecord(sysRaw);
      const lines = (sys?.StaffLines ?? sys?.staffLines ?? []) as unknown[];
      for (const slRaw of lines) {
        const sl = asRecord(slRaw);
        const exprs = (sl?.AbstractExpressions ?? sl?.abstractExpressions ?? []) as unknown[];
        const linePx = staffSpaceFromStaffLine(sl, staffSpacePx);
        for (const exprRaw of exprs) {
          const expr = asRecord(exprRaw);
          if (!expr) continue;
          const text = labelTextFromExpression(expr);
          if (!isLiftedArticulationGlyph(text)) continue;
          const dy = defaultYXmlFromExpression(expr);
          const spaces = dy != null ? Math.abs(dy) / 10 : 1;
          const extraY = extraLiftedDirectionYPx(spaces, linePx, placementAboveFromExpression(expr, dy));
          const svg = labelSvgFromExpression(expr);
          if (!svg) continue;
          applyArticulationShiftY(svg, extraY);
          shifted += 1;
        }
      }
    }
  }
  return shifted;
}

function shiftLiftedDirectionTexts(host: HTMLElement, xml: string, staffSpacePx: number): number {
  const doc = parseMusicXmlDocument(xml);
  if (!doc) return 0;
  const dirs = [...doc.querySelectorAll('direction')].filter((d) => d.getAttribute(HITL_LIFTED_ART_ATTR));
  if (!dirs.length) return 0;
  const texts = [...host.querySelectorAll('text')].filter((t) => isLiftedArticulationGlyph(t.textContent));
  let shifted = 0;
  if (dirs.length === 1) {
    const dir = dirs[0]!;
    const dy = parseInt(dir.getAttribute('default-y') ?? dir.querySelector('words')?.getAttribute('default-y') ?? '', 10);
    const spaces = Number.isFinite(dy) && dy !== 0 ? Math.abs(dy) / 10 : 1;
    const above = (dir.getAttribute('placement') || '').toLowerCase() === 'above' || dy > 0;
    const extraY = extraLiftedDirectionYPx(spaces, staffSpacePx || 10, above);
    for (const el of texts) {
      if (el.textContent?.trim() !== (dir.querySelector('words')?.textContent?.trim() ?? '>')) continue;
      applyArticulationShiftY(el, extraY);
      shifted += 1;
    }
    return shifted;
  }
  const glyphs = dirs.map((d) => d.querySelector('words')?.textContent?.trim() ?? '>');
  const n = Math.min(dirs.length, texts.length);
  for (let i = 0; i < n; i++) {
    const dir = dirs[i]!;
    const el = texts[i]!;
    if (el.textContent?.trim() !== glyphs[i]) continue;
    const dy = parseInt(dir.getAttribute('default-y') ?? dir.querySelector('words')?.getAttribute('default-y') ?? '', 10);
    const spaces = Number.isFinite(dy) && dy !== 0 ? Math.abs(dy) / 10 : 1;
    const above = (dir.getAttribute('placement') || '').toLowerCase() === 'above' || dy > 0;
    applyArticulationShiftY(el, extraLiftedDirectionYPx(spaces, staffSpacePx || 10, above));
    shifted += 1;
  }
  return shifted;
}

let articulationApplyDepth = 0;

export function applyOsmdArticulationOffsetsDetailed(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
): ArticulationShiftStats {
  const empty = { shifted: 0, modifierCount: 0, hintCount: 0, staffSpacePx: 0 };
  // render → apply → SVG 크기 변화 → autoResize/render 재진입 방지
  if (articulationApplyDepth > 0) return empty;
  articulationApplyDepth += 1;
  try {
    return applyOsmdArticulationOffsetsDetailedInner(host, osmd, empty);
  } finally {
    articulationApplyDepth -= 1;
  }
}

function applyOsmdArticulationOffsetsDetailedInner(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  empty: ArticulationShiftStats,
): ArticulationShiftStats {
  const pendingFixes = articulationFixesByOsmd.get(osmd) ?? [];
  const staffSpacePx = host?.querySelector('svg') ? staffSpacePxFromHost(host, osmd) : 10;

  if (!host?.querySelector('svg')) return { ...empty, staffSpacePx };

  // pending 거리 미리보기: CSS는 VexFlow transform 속성에 막힘 → 래퍼 SVG만
  if (pendingFixes.length > 0) {
    return {
      shifted: applyPendingArticulationOffsetsOnly(host, osmd, pendingFixes),
      modifierCount: countModifiers(host),
      hintCount: pendingFixes.length,
      staffSpacePx,
    };
  }

  setHitlArticulationExtraYPx(0);
  applyHitlArticulationHostCss(host, 0);
  resetOsmdArticulationOffsets(host);

  const usedElements = new Set<Element>();
  const fromDirect = applyPendingDistanceDirect(osmd, pendingFixes, staffSpacePx, usedElements);

  const xml = resolveArticulationPreviewXml(osmd);

  if (!xml?.trim()) {
    return { shifted: fromDirect, modifierCount: countModifiers(host), hintCount: 0, staffSpacePx };
  }

  const hintsByMeasure = cloneHintsByMeasure(orderedHintsByMeasureFromXml(xml));
  overlayFixesOnHints(xml, hintsByMeasure, pendingFixes);
  const totalHints = countHints(hintsByMeasure);
  if (totalHints === 0 && pendingFixes.length === 0) {
    return { shifted: fromDirect, modifierCount: countModifiers(host), hintCount: 0, staffSpacePx };
  }

  let shiftedCount = fromDirect;
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
      // pending이 있어도 힌트 없는 마디는 건너뜀 (예전: pending만으로 전 악보 순회 → 멈춤)
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
            attrs?: { el?: Element };
            el?: Element;
            getAttribute?: (k: string) => unknown;
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
          const artEls = staveNoteSvg ? findArticulationElementsInStavenote(staveNoteSvg) : [];
          const modsOrFake =
            artMods.length > 0 ? artMods : [{ type: undefined as string | undefined, getPosition: () => 0 }];

          for (let i = 0; i < Math.max(modsOrFake.length, artEls.length, 1); i++) {
            const artMod = modsOrFake[i] ?? modsOrFake[0];
            const artEl = vexModifierSvg(artMod) ?? artEls[i] ?? artEls[0] ?? null;

            const candidateHints = hints.filter((h) => {
              if (usedHints.has(h)) return false;
              if (artMod?.type && !articulationModTypeMatchesHint(artMod.type, h.tag)) return false;
              if (h.pitch && !notePitches.length) return false;
              if (
                h.pitch &&
                notePitches.length &&
                !graphicPitchesMatchFix(notePitches, h.pitch)
              ) {
                return false;
              }
              return true;
            });
            const matchedHint = candidateHints[0];
            const pending = staffSpacesFromPendingFix(pendingFixes, {
              partId,
              measureMxl,
              pitches: notePitches,
              artTag: matchedHint?.tag ?? (artMod?.type?.includes('a>') ? 'accent' : undefined),
              staffWithinPart,
            });
            const staffSpaces = pending?.staffSpaces ?? matchedHint?.staffSpaces;
            if (staffSpaces == null) continue;

            const isAbove =
              artMod?.getPosition?.() === 3 ||
              pending?.placement === 'above' ||
              matchedHint?.placement === 'above';
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
            const extraY = extraArticulationYPx(staffSpaces, lineSpacing, isAbove);
            const paintTargets: Element[] = [];
            for (const t of [artEl, ...artEls]) {
              if (t && !paintTargets.includes(t) && !usedElements.has(t)) paintTargets.push(t);
            }
            if (!paintTargets.length && staveNoteSvg) {
              for (const g of staveNoteSvg.querySelectorAll('.vf-modifiers')) {
                if (!usedElements.has(g)) paintTargets.push(g);
              }
            }
            if (!paintTargets.length) continue;
            for (const t of paintTargets) {
              applyArticulationOffsetToTarget(t, extraY);
              usedElements.add(t);
            }
            shiftedCount += 1;
            if (matchedHint) usedHints.add(matchedHint);
          }
        }
      }

      const measureSvg = measureSvgFromGraphic(gm);
      if (measureSvg) {
        const pendingHere = staffSpacesFromPendingFix(pendingFixes, {
          partId,
          measureMxl,
          pitches: [],
          staffWithinPart,
        });
        if (pendingHere) {
          const extraY = extraArticulationYPx(
            pendingHere.staffSpaces,
            staffSpacePx || 10,
            pendingHere.placement === 'above',
          );
          for (const g of measureSvg.querySelectorAll('.vf-modifiers')) {
            if (usedElements.has(g) || g.hasAttribute('data-art-shift-y')) continue;
            if (!g.querySelector('path, text, use')) continue;
            applyArticulationOffsetToTarget(g, extraY);
            usedElements.add(g);
            shiftedCount += 1;
          }
        }
      }
    });
  } catch (err) {
    console.warn('[osmdArticulationOffsetFix] error applying offsets:', err);
  }

  if (shiftedCount === 0 && pendingFixes.length) {
    const measureCount = host.querySelectorAll('.vf-measure').length;
    if (measureCount <= 2) {
      let spaces = 1;
      let above = false;
      for (const f of pendingFixes) {
        spaces =
          parseArticulationStaffSpaces(
            f.distance === 'auto' || !f.distance ? 'auto' : String(f.distance),
          ) ?? 1;
        above = f.placement === 'above';
      }
      const extraY = extraArticulationYPx(spaces, staffSpacePx || 10, above);
      for (const g of host.querySelectorAll('.vf-modifiers')) {
        if (!g.querySelector('path, text, use')) continue;
        applyArticulationOffsetToTarget(g, extraY);
        shiftedCount += 1;
      }
    }
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

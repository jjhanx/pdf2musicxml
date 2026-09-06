import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import {
  ARTICULATION_STAFF_GAP_BASE,
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
import {
  clearHitlArticulationOverlays,
  hideNativeArticulationGlyphs,
  HITL_ART_OVERLAY_GLYPH,
  overlayArticulationY,
  paintHitlArticulationOverlayTexts,
  pathStartXY,
  resolveNoteHeadX,
  resolveNoteHeadY,
  stackOverlayArtSpaces,
  type HitlArtOverlaySpec,
} from './osmdArticulationOverlay';
import {
  resolveOsmdGraphicMeasureMxl,
  type MxlMeasureRange,
} from '../shared/musicXmlMeasureRange';

/** sanitize 전 filteredXml — pending articulation attr·noteIndex 기준 */
const articulationPreviewXmlByOsmd = new WeakMap<OpenSheetMusicDisplay, string>();
const articulationPreviewRangeByOsmd = new WeakMap<OpenSheetMusicDisplay, MxlMeasureRange>();

export function registerOsmdPreviewXmlForArticulation(osmd: OpenSheetMusicDisplay, xml: string): void {
  articulationPreviewXmlByOsmd.set(osmd, xml);
}

export function registerOsmdPreviewMeasureRangeForArticulation(
  osmd: OpenSheetMusicDisplay,
  range: MxlMeasureRange | null | undefined,
): void {
  if (range && Number.isFinite(range.start) && range.start >= 1) {
    articulationPreviewRangeByOsmd.set(osmd, { start: range.start, end: Math.max(range.start, range.end) });
  } else {
    articulationPreviewRangeByOsmd.delete(osmd);
  }
}

/** OSMD 로컬 마디(0/1…) → HITL/XML 전곡 measure@number */
function inferMeasureRangeFromPreviewXml(xml: string): MxlMeasureRange | null {
  const doc = parseMusicXmlDocument(xml);
  if (!doc) return null;
  const nums: number[] = [];
  for (const part of findXmlParts(doc)) {
    for (const measure of [...part.children].filter((c) => xmlLocalName(c) === 'measure')) {
      const n = parseInt(measure.getAttribute('number') ?? '', 10);
      if (Number.isFinite(n)) nums.push(n);
    }
    if (nums.length) break; // 첫 파트 기준(미리보기 구간과 동일)
  }
  if (!nums.length) return null;
  return { start: Math.min(...nums), end: Math.max(...nums) };
}

function graphicMeasureMxlForArticulation(
  osmd: OpenSheetMusicDisplay,
  gm: Parameters<typeof measureMxlFromGraphic>[0],
): number | null {
  const raw = measureMxlFromGraphic(gm);
  let range = articulationPreviewRangeByOsmd.get(osmd);
  if (!range) {
    const xml = resolveArticulationPreviewXml(osmd);
    if (xml?.trim()) {
      const inferred = inferMeasureRangeFromPreviewXml(xml);
      if (inferred) range = inferred;
    }
  }
  return resolveOsmdGraphicMeasureMxl(raw, range);
}

const articulationFixesByOsmd = new WeakMap<OpenSheetMusicDisplay, ArticulationPreviewFix[]>();

/**
 * VexFlow Articulation.draw()는 y_shift를 쓰지 않는다.
 * 위치는 text_line으로 계산: below → bottomY + (textLine + initialOffset)×staffSpace.
 * MusicXML default-y는 OSMD가 무시하므로, HITL 칸 수 → text_line 으로 그린다.
 */
const articulationModStaffSpaces = new WeakMap<object, number>();
const osmdArtRerendering = new WeakSet<OpenSheetMusicDisplay>();
let articulationDrawPatched = false;

/** @deprecated 이름 유지 — staffSpaces를 WeakMap에 저장 */
export function setArticulationModExtraY(mod: object, y: number): void {
  if (!Number.isFinite(y) || y <= 0) articulationModStaffSpaces.delete(mod);
  else articulationModStaffSpaces.set(mod, y);
}

export function setArticulationModStaffSpaces(mod: object, spaces: number): void {
  if (!Number.isFinite(spaces) || spaces <= 0) articulationModStaffSpaces.delete(mod);
  else articulationModStaffSpaces.set(mod, spaces);
}

export function clearArticulationModExtraYs(): void {
  /* WeakMap — 새 render 후 modifier 객체가 바뀌면 자연 소멸. no-op helper for tests. */
}

/** @deprecated 전역 max Δ — 복수 표에 쓰면 같이 움직임. 배너 표시용으로만 유지. */
let hitlArticulationExtraYPx = 0;

export function setHitlArticulationExtraYPx(y: number): void {
  hitlArticulationExtraYPx = Number.isFinite(y) ? y : 0;
}

export function getHitlArticulationExtraYPx(): number {
  return hitlArticulationExtraYPx;
}

type VfArticulationLike = {
  type?: string;
  y_shift?: number;
  text_line?: number;
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

/** VexFlow Articulation.prototype.draw — HITL staffSpaces → text_line. 한 번만. */
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
    const spaces = articulationModStaffSpaces.get(this);
    const savedLine = this.text_line;
    (ctor as { __hitlDrawCount?: number }).__hitlDrawCount =
      ((ctor as { __hitlDrawCount?: number }).__hitlDrawCount ?? 0) + 1;
    // below: y = bottomY + (textLine + ~1)×gap → staffSpaces N ⇒ textLine ≈ N−1
    if (spaces != null && Number.isFinite(spaces) && spaces > 0) {
      this.text_line = Math.max(0, spaces - 1);
    }
    try {
      return orig.apply(this, args);
    } finally {
      this.text_line = savedLine;
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
  clearHitlArticulationOverlays(host);
  for (const wrap of [...host.querySelectorAll('g[data-hitl-art-wrap]')]) {
    const g = wrap.parentElement;
    if (!g) {
      wrap.remove();
      continue;
    }
    while (wrap.firstChild) g.insertBefore(wrap.firstChild, wrap);
    wrap.remove();
  }
  for (const el of host.querySelectorAll('[data-art-base-d]')) {
    const base = el.getAttribute('data-art-base-d') ?? '';
    if (base) el.setAttribute('d', base);
    el.removeAttribute('data-art-base-d');
  }
  for (const el of host.querySelectorAll('[data-hitl-base-tf]')) {
    const base = el.getAttribute('data-hitl-base-tf') ?? '';
    if (base) el.setAttribute('transform', base);
    else el.removeAttribute('transform');
    el.removeAttribute('data-hitl-base-tf');
    el.removeAttribute('data-art-shift-y');
    const sty = (el as SVGElement & { style?: CSSStyleDeclaration }).style;
    if (sty?.removeProperty) sty.removeProperty('transform');
  }
  for (const el of host.querySelectorAll('[data-art-base-transform]')) {
    const base = el.getAttribute('data-art-base-transform') ?? '';
    if (base) el.setAttribute('transform', base);
    else el.removeAttribute('transform');
    el.removeAttribute('data-art-base-transform');
    el.removeAttribute('data-art-shift-y');
    el.removeAttribute('data-art-spaces');
    el.removeAttribute('data-hitl-art-tag');
    const sty = (el as SVGElement & { style?: CSSStyleDeclaration }).style;
    if (sty?.removeProperty) {
      sty.removeProperty('transform');
      sty.removeProperty('translate');
    }
  }
  for (const el of host.querySelectorAll('[data-art-shift-y]')) {
    el.removeAttribute('data-art-shift-y');
    el.removeAttribute('data-art-spaces');
    el.removeAttribute('data-hitl-art-tag');
    const sty = (el as SVGElement & { style?: CSSStyleDeclaration }).style;
    if (sty?.removeProperty) {
      sty.removeProperty('transform');
      sty.removeProperty('translate');
    }
  }
  host.removeAttribute('data-hitl-art-shifted');
  host.removeAttribute('data-hitl-art-debug');
}

/**
 * SVG path `d`의 절대 Y 좌표를 deltaY만큼 이동.
 * VexFlow articulation 글리프는 주로 절대 M/C 좌표를 씀.
 */
export function shiftSvgPathAbsoluteYs(d: string, deltaY: number): string {
  if (!d || !Number.isFinite(deltaY) || Math.abs(deltaY) < 1e-9) return d;
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!tokens?.length) return d;
  let cmd = '';
  const out: string[] = [];
  let i = 0;
  const num = (): number => {
    const t = tokens[i++];
    return t != null ? parseFloat(t) : NaN;
  };
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (/^[a-zA-Z]$/.test(t)) {
      cmd = t;
      out.push(t);
      i += 1;
      continue;
    }
    const c = cmd;
    if (c === 'M' || c === 'L' || c === 'T') {
      const x = num();
      const y = num();
      out.push(String(x), String(y + deltaY));
      if (c === 'M') cmd = 'L';
    } else if (c === 'm' || c === 'l' || c === 't') {
      out.push(String(num()), String(num()));
    } else if (c === 'C') {
      out.push(
        String(num()),
        String(num() + deltaY),
        String(num()),
        String(num() + deltaY),
        String(num()),
        String(num() + deltaY),
      );
    } else if (c === 'c') {
      out.push(String(num()), String(num()), String(num()), String(num()), String(num()), String(num()));
    } else if (c === 'Q' || c === 'S') {
      out.push(String(num()), String(num() + deltaY), String(num()), String(num() + deltaY));
    } else if (c === 'q' || c === 's') {
      out.push(String(num()), String(num()), String(num()), String(num()));
    } else if (c === 'H' || c === 'h') {
      out.push(String(num()));
    } else if (c === 'V') {
      out.push(String(num() + deltaY));
    } else if (c === 'v') {
      out.push(String(num()));
    } else if (c === 'A') {
      out.push(
        String(num()),
        String(num()),
        String(num()),
        String(num()),
        String(num()),
        String(num()),
        String(num() + deltaY),
      );
    } else if (c === 'a') {
      out.push(
        String(num()),
        String(num()),
        String(num()),
        String(num()),
        String(num()),
        String(num()),
        String(num()),
      );
    } else {
      out.push(t);
      i += 1;
    }
  }
  return out.join(' ');
}

export function applyArticulationShiftY(el: Element, deltaY: number): void {
  // path `d`에 Y를 구움 — OSMD가 transform을 지워도 거리 유지
  const d = el.getAttribute('d');
  if (d && Math.abs(deltaY) > 0.01) {
    if (!el.hasAttribute('data-art-base-d')) {
      el.setAttribute('data-art-base-d', d);
    }
    const baseD = el.getAttribute('data-art-base-d') || d;
    el.setAttribute('d', shiftSvgPathAbsoluteYs(baseD, deltaY));
    el.setAttribute('data-art-shift-y', String(deltaY));
    if (!el.hasAttribute('data-art-base-transform')) {
      el.setAttribute('data-art-base-transform', el.getAttribute('transform') ?? '');
    }
    const baseTf = el.getAttribute('data-art-base-transform') ?? '';
    if (baseTf) el.setAttribute('transform', baseTf);
    else el.removeAttribute('transform');
    const sty = (el as SVGElement & { style?: CSSStyleDeclaration }).style;
    if (sty?.removeProperty) {
      sty.removeProperty('transform');
      sty.removeProperty('translate');
    }
    return;
  }

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
  const sty = (el as SVGElement & { style?: CSSStyleDeclaration }).style;
  if (sty?.removeProperty) {
    sty.removeProperty('transform');
    sty.removeProperty('translate');
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

/**
 * OSMD 미리보기 SVG 추가 이동이 필요한 HITL 거리인지.
 * Audiveris 절대 default-y(-78 등)는 |dy|/10으로 칸 수가 커져도 미리보기 Δ로 쓰지 않음.
 * HITL은 data-hitl-art-distance 또는 default-y = ±(N×10) (N=2..10).
 */
export function hintNeedsOsmdPreviewShift(h: {
  staffSpaces: number;
  distance?: string | null;
  defaultY?: number;
}): boolean {
  if (!(h.staffSpaces > 1.01)) return false;
  if (h.distance != null && String(h.distance).trim() !== '' && String(h.distance).trim().toLowerCase() !== 'auto') {
    return true;
  }
  const mag = Math.abs(h.defaultY ?? 0);
  return mag >= 20 && mag <= 100 && mag % ARTICULATION_STAFF_GAP_BASE === 0;
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
    if (!artName || !HITL_ART_OVERLAY_GLYPH[artName]) continue;
    const spaces =
      parseArticulationStaffSpaces(
        fix.distance === 'auto' || !fix.distance ? 'auto' : String(fix.distance),
      ) ?? 1;
    const placement: 'above' | 'below' =
      fix.placement === 'above' || fix.placement === 'below' ? fix.placement : 'below';
    let pitch = pitchLabelFromArticulationFix(fix);
    let staffW = fix.staffWithinPart ?? fix.staff ?? null;
    if (!pitch && doc) {
      for (const part of xmlParts) {
        const pid = part.getAttribute('id')?.trim() ?? '';
        if (fix.partId && pid && !previewPartIdsMatch(pid, fix.partId)) continue;
        for (const measure of [...part.children].filter((c) => xmlLocalName(c) === 'measure')) {
          if ((measure.getAttribute('number') ?? '') !== String(fix.measureMxl)) continue;
          const notes = [...measure.children].filter((c) => xmlLocalName(c) === 'note');
          const byIndex = fix.noteIndex != null ? notes[fix.noteIndex] : undefined;
          const note =
            byIndex && (!artName || noteHasArticulation(byIndex, artName) || fix.kind === 'addArticulation')
              ? byIndex
              : notes.find((n) => noteHasArticulation(n, artName)) ?? null;
          if (note) {
            pitch = notePitchLabel(note);
            if (staffW == null) staffW = noteStaffNumber(note);
          }
          break;
        }
      }
    }

    let updated = false;
    for (const [key, list] of hintsByMeasure) {
      const [p, m, s] = key.split('|');
      if (m !== String(fix.measureMxl)) continue;
      if (p && fix.partId && !previewPartIdsMatch(p, fix.partId) && !partIdsMatch(p, fix.partId)) continue;
      for (const h of list) {
        if (h.tag.replace(/_/g, '-') !== artName) continue;
        if (pitch && h.pitch && !pitchLabelsMatch(pitch, h.pitch) && !pitchLetterOctaveMatch(pitch, h.pitch)) continue;
        // 피치가 맞으면 staff 키 불일치여도 덮어씀 (PR/PL 분할 후 staff 번호 재배치)
        if (!pitch && staffW != null && s && s !== String(staffW)) continue;
        h.staffSpaces = spaces;
        h.distance = fix.distance ?? h.distance;
        h.placement = placement;
        updated = true;
      }
    }

    // addArticulation: XML에 아직 표가 없으면 힌트를 새로 넣어 overlay가 m.49처럼 동작하게 함
    if (!updated && (fix.kind === 'addArticulation' || fix.kind === 'setArticulationPlacement')) {
      const staff = staffW ?? 1;
      const partKey = fix.partId || '';
      const key = `${partKey}|${fix.measureMxl}|${staff}`;
      const list = hintsByMeasure.get(key) ?? [];
      list.push({
        defaultY: placement === 'below' ? -spaces * 10 : spaces * 10,
        distance: fix.distance ?? String(spaces),
        placement,
        staffSpaces: spaces,
        tag: artName,
        pitch,
        layoutX: fix.noteIndex != null ? Number(fix.noteIndex) : 0,
        staff,
      });
      hintsByMeasure.set(key, list);
    }
  }
}

/** 같은 음(피치+쪽)에 표가 2개 이상인지 — pending뿐 아니라 XML 힌트도 포함 */
function hintsHaveMultiArtOnSameNote(hintsByMeasure: Map<string, OrderedHint[]>): boolean {
  for (const list of hintsByMeasure.values()) {
    const counts = new Map<string, number>();
    for (const h of list) {
      if (!HITL_ART_OVERLAY_GLYPH[h.tag]) continue;
      const k = `${h.pitch ?? '?'}|${h.placement}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    if ([...counts.values()].some((n) => n >= 2)) return true;
  }
  return false;
}

function pendingHaveMultiArtOnSameNote(fixes: ArticulationPreviewFix[]): boolean {
  const artsPerNote = new Map<string, number>();
  for (const f of fixes) {
    if (f.kind !== 'setArticulationPlacement' && f.kind !== 'addArticulation') continue;
    if (!f.articulation) continue;
    const pitch = pitchLabelFromArticulationFix(f) ?? '';
    const k = `${f.partId}|${f.measureMxl}|${f.noteIndex ?? ''}|${pitch}|${f.placement ?? ''}`;
    artsPerNote.set(k, (artsPerNote.get(k) ?? 0) + 1);
  }
  return [...artsPerNote.values()].some((n) => n >= 2);
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
  const mxlCandidates = [String(measureMxl)];
  if (String(measureMxl) === '0') mxlCandidates.push('1');
  if (String(measureMxl) === '1') mxlCandidates.push('0');

  if (staffWithinPart != null) {
    for (const m of mxlCandidates) {
      const key = `${partId}|${m}|${staffWithinPart}`;
      const direct = hintsByMeasure.get(key);
      if (direct?.length) return direct;
    }
  }

  const merged: OrderedHint[] = [];
  for (const [k, hints] of hintsByMeasure) {
    const [p, m, s] = k.split('|');
    if (!mxlCandidates.includes(m ?? '')) continue;
    if (staffWithinPart != null && s !== String(staffWithinPart)) continue;
    if (partIdsMatch(partId, p ?? '')) merged.push(...hints);
  }
  if (merged.length) {
    merged.sort((a, b) => a.layoutX - b.layoutX);
    return merged;
  }

  for (const [k, hints] of hintsByMeasure) {
    const [, m, s] = k.split('|');
    if (mxlCandidates.includes(m ?? '') && (staffWithinPart == null || s === String(staffWithinPart))) return hints;
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
  const vf = pitchFromVfPitch(gn.vfpitch ?? gn.vfPitch);
  // 임시표가 vfpitch에 있으면 표기 우선
  if (vf && /[#b♯♭]/.test(vf)) return vf;

  const src = asRecord(gn.sourceNote ?? gn.SourceNote);
  if (src) {
    const pitch = asRecord(src.Pitch ?? src.pitch);
    const freq = coordNum(
      pitch?.frequency ?? pitch?.Frequency ?? src.frequency ?? src.Frequency,
    );
    if (freq != null && freq > 20) {
      const midi = Math.round(69 + 12 * Math.log2(freq / 440));
      if (Number.isFinite(midi)) return pitchLabelFromHalfTone(midi);
    }
    const ht = coordNum(src.halfTone ?? src.HalfTone);
    // OSMD halfTone ≈ MIDI−12 (C4=48). 단위 테스트 등 MIDI 값을 넣는 경우는 60+도 허용.
    if (ht != null) {
      const asOsmd = pitchLabelFromHalfTone(ht + 12);
      const asMidi = pitchLabelFromHalfTone(ht);
      // 옥타브 4 근처를 선호
      if (asOsmd && /[3-5]$/.test(asOsmd)) return asOsmd;
      if (asMidi && /[3-5]$/.test(asMidi)) return asMidi;
      return asOsmd ?? asMidi;
    }
  }
  return vf;
}

/** F#4 vs F4 — 조표로 VexFlow가 임시표를 생략한 경우 */
function pitchLetterOctaveMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().toUpperCase().replace(/♯/g, '#').replace(/♭/g, 'B');
  const pa = /^([A-G])[#B]*(\d+)$/.exec(norm(a));
  const pb = /^([A-G])[#B]*(\d+)$/.exec(norm(b));
  return Boolean(pa && pb && pa[1] === pb[1] && pa[2] === pb[2]);
}

/** F#4 ↔ Gb4 (halfTone 표기가 플랫 쪽일 때 HITL F#과 불일치 방지) */
function pitchLabelToMidi(label: string): number | null {
  const s = label.trim().replace(/♯/g, '#').replace(/♭/g, 'b');
  const m = /^([A-Ga-g])([#b]*)(\d+)$/.exec(s);
  if (!m) return null;
  const step = m[1]!.toUpperCase();
  const accRaw = (m[2] ?? '').toLowerCase();
  let alter = 0;
  if (accRaw.startsWith('##')) alter = 2;
  else if (accRaw.startsWith('#')) alter = 1;
  else if (accRaw.startsWith('bb')) alter = -2;
  else if (accRaw.startsWith('b')) alter = -1;
  const stepSemitone: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const base = stepSemitone[step];
  if (base == null) return null;
  const oct = parseInt(m[3]!, 10);
  if (!Number.isFinite(oct)) return null;
  return (oct + 1) * 12 + base + alter;
}

function graphicPitchesMatchFix(notePitches: string[], fixPitch: string): boolean {
  if (notePitches.some((p) => pitchLabelsMatch(p, fixPitch))) return true;
  if (notePitches.some((p) => pitchLetterOctaveMatch(p, fixPitch))) return true;
  const fixMidi = pitchLabelToMidi(fixPitch);
  if (fixMidi == null) return false;
  return notePitches.some((p) => pitchLabelToMidi(p) === fixMidi);
}

function graphicNoteIsRest(gn: Record<string, unknown>): boolean {
  const src = asRecord(gn.sourceNote ?? gn.SourceNote);
  const raw = src ? (src.isRest ?? src.IsRest) : (gn.isRest ?? gn.IsRest);
  if (typeof raw === 'function') {
    try {
      return Boolean((raw as (this: unknown) => boolean).call(src ?? gn));
    } catch {
      return false;
    }
  }
  return raw === true;
}

function graphicNotesAreRest(gNotes: Array<Record<string, unknown>>): boolean {
  if (!gNotes.length) return true;
  return gNotes.every((gn) => graphicNoteIsRest(gn));
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
      // 덧줄(단순 가로 직선 L x y) 제외 — tenuto(짧은 막대)는 곡선이 없어도 포함해야 함
      const isLedgerLike =
        /L\s*[-\d.eE+]+\s+[-\d.eE+]+\s*$/i.test(d) &&
        !/[CQcqs]/.test(d) &&
        (d.match(/M/g) ?? []).length < 2 &&
        // tenuto 막대는 보통 짧고 두껍게 fill됨 — 오선 덧줄보다 path 토큰이 적음이 아니라
        // 가로 길이가 오선 간격보다 훨씬 길 때 덧줄로 본다(대략 |Δx|>40).
        (() => {
          const m = /M\s*([-\d.eE]+)[\s,]+([-\d.eE]+).*?L\s*([-\d.eE]+)[\s,]+([-\d.eE]+)/i.exec(d);
          if (!m) return true;
          return Math.abs(parseFloat(m[3]!) - parseFloat(m[1]!)) > 40;
        })();
      if (isLedgerLike) return false;
      return true;
    });
    // accent(곡선) + tenuto(직선)가 같은 그룹에 있어도 둘 다 포함 (곡선만 남기면 tenuto 거리 불가)
    if (paths.length > 0) {
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
  if (h.includes('accent') && !h.includes('strong')) {
    return t.includes('a>') || (t.includes('accent') && !t.includes('strong'));
  }
  if (h.includes('staccato')) return t.includes('a.') || t.includes('staccato');
  if (h.includes('tenuto')) return t.includes('a-') || t.includes('tenuto');
  if (h.includes('marcato') || h.includes('strong')) return t.includes('a^') || t.includes('marcato');
  return true;
}

/** VexFlow Articulation.type → MusicXML art tag (힌트·pending 매칭용). */
function artTagFromVexModType(artModType: string | undefined): string | null {
  const t = (artModType ?? '').toLowerCase();
  if (!t) return null;
  if (t.includes('a>') || (t.includes('accent') && !t.includes('strong'))) return 'accent';
  if (t.includes('a-') || t.includes('tenuto')) return 'tenuto';
  if (t.includes('a.') || t.includes('staccato')) return 'staccato';
  if (t.includes('a^') || t.includes('marcato') || t.includes('strong')) return 'strong-accent';
  if (t.includes('a@') || t.includes('breath')) return 'breath-mark';
  return null;
}

/** 한 표의 글리프만 — `.vf-modifiers` 전체·형제 path에 같은 Δ를 쓰지 않음(tenuto+accent 포개짐 방지). */
function paintTargetsForOneArticulation(
  artMod: { attrs?: { el?: Element }; el?: Element; getAttribute?: (k: string) => unknown } | null | undefined,
  artEls: Element[],
  index: number,
  usedElements: Set<Element>,
): Element[] {
  const targets: Element[] = [];
  const push = (el: Element | null | undefined) => {
    if (!el || usedElements.has(el) || targets.includes(el)) return;
    // 공유 그룹이면 개별 path만 (그룹 이동은 같은 음의 다른 표까지 같이 움직임)
    if (el.classList?.contains?.('vf-modifiers')) {
      const glyphs = articulationGlyphsInModifierGroup(el);
      const preferred = artEls[index];
      if (preferred && glyphs.includes(preferred)) {
        targets.push(preferred);
        return;
      }
      const unused = glyphs.find((g) => !usedElements.has(g));
      if (unused) targets.push(unused);
      return;
    }
    targets.push(el);
  };
  push(artEls[index]);
  push(vexModifierSvg(artMod));
  return targets;
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
 * Accent 글리프만 이동 — `.vf-modifiers` 전체 래핑/전역 CSS 금지
 * (꾸밈음 머리·이음줄 등이 같은 트리에 있으면 깨짐).
 */
export function applyDyToVfModifiersAttr(host: HTMLElement, dy: number): number {
  // 레거시 이름 유지 — 전역 일괄 이동은 하지 않음. detailed/ pending-direct 경로 사용.
  applyHitlArticulationHostCss(host, dy);
  host.setAttribute('data-hitl-art-shifted', dy ? '1' : '0');
  host.title = dy ? `[HITL Accent] host-dy=${dy}px (glyph-targeted)` : '[HITL Accent] dy=0';
  return dy ? 1 : 0;
}

/**
 * 거리 드롭다운·render 후 공통 진입점.
 * pending이 비어도 XML default-y / data-hitl-art-distance 힌트로 이동 (MXL 반영 후).
 * pending이 비었을 때 dy=0으로 reset 하면 반영 직후 Accent가 제자리로 돌아가는 버그가 난다.
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
  const yHost = extraYPxFromArticulationFixes(pending, 10);
  // pending이 있을 때만 즉시 호스트 dy. 없으면 detailed가 XML 힌트로 설정 (여기서 0으로 지우면
  // MXL 반영 직후·render 전에 Accent가 한 프레임 원위치로 돌아감).
  if (pending.length) {
    applyHitlArticulationHostCss(host, yHost);
    setHitlArticulationExtraYPx(yHost);
  }
  if (!osmd?.IsReadyToRender?.()) return pending.length ? 1 : 0;
  return applyOsmdArticulationOffsetsDetailed(host, osmd).shifted;
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

/** Accent 등 — 해당 `.vf-modifiers` 안의 articulation 글리프만 이동 (그룹 전체 래핑 금지). */
export function applySvgDyToModifier(modifierEl: Element, dy: number): void {
  const glyphs = articulationGlyphsInModifierGroup(modifierEl);
  if (glyphs.length) {
    for (const g of glyphs) applyArticulationShiftY(g, dy);
  } else {
    // path가 그룹 자체에 붙은 경우
    applyArticulationShiftY(modifierEl, dy);
  }
  modifierEl.setAttribute('data-art-shift-y', String(dy));
}

function articulationGlyphsInModifierGroup(mod: Element): Element[] {
  const out: Element[] = [];
  for (const p of mod.querySelectorAll(':scope > path, :scope > text, :scope > use')) {
    if (p.closest('.vf-note, .vf-notehead, .vf-ledgers, .vf-stavetie, .vf-beam, .vf-accidental')) continue;
    const parentSn = p.closest('.vf-stavenote');
    const modSn = mod.closest('.vf-stavenote');
    if (parentSn && modSn && parentSn !== modSn) continue;
    const d = p.getAttribute('d') ?? '';
    if (p.tagName.toLowerCase() === 'path') {
      // 단순 가로선(덧줄) 제외
      if (/L\s*[-\d.eE+]+\s+[-\d.eE+]+\s*$/i.test(d) && !/[CQcqs]/.test(d) && (d.match(/M/g) ?? []).length < 2) {
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

/** @deprecated 전역 일괄 이동 — 꾸밈음 손상 위험. 테스트 호환용으로만 유지. */
export function applySvgDyToVfModifiers(host: HTMLElement, dy: number): number {
  let n = 0;
  for (const g of host.querySelectorAll('.vf-modifiers')) {
    applySvgDyToModifier(g, dy);
    n += 1;
  }
  return n;
}

function applyArticulationOffsetToTarget(el: Element, dy: number): void {
  // 글리프만 이동. 부모 .vf-modifiers 전체를 감싸면 꾸밈음·임시표 기하가 깨질 수 있음.
  // 그룹에 data-art-shift-y를 남기지 않음 — 마지막 표의 Δ가 그룹에 남아 오인됨.
  if (el.classList?.contains?.('vf-modifiers')) {
    applySvgDyToModifier(el, dy);
    return;
  }
  const modGroup = typeof el.closest === 'function' ? el.closest('.vf-modifiers') : null;
  if (modGroup && el !== modGroup) {
    applyArticulationShiftY(el, dy);
    return;
  }
  applyArticulationShiftY(el, dy);
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

function pendingMeasureKeysMatch(graphicMxl: number | null | undefined, pendingKeys: Set<string>): boolean {
  if (graphicMxl == null) return false;
  if (pendingKeys.has(String(graphicMxl))) return true;
  // OSMD MeasureNumberXML=0 ↔ MusicXML/HITL 1
  if (graphicMxl === 0 && pendingKeys.has('1')) return true;
  if (graphicMxl === 1 && pendingKeys.has('0')) return true;
  return false;
}

function artNameFromFix(fix: ArticulationPreviewFix): string {
  return (fix.articulation ?? '').split('(')[0]!.trim().toLowerCase().replace(/_/g, '-');
}

/**
 * 에디터 noteIndex(쉼표·코드 구성음 포함 document order) → OSMD noteOrd(비쉼·코드헤드만).
 * 쉼표가 앞에 있으면 #1이 OSMD 0이 되어 claimed=none 이 났음.
 */
function editorNoteIndexToOsmdOrd(
  xml: string,
  partId: string,
  measureMxl: string | number,
  noteIndex: number,
): { ord: number; pitch: string | null } | null {
  if (!xml?.trim() || noteIndex == null || !Number.isFinite(Number(noteIndex))) return null;
  const doc = parseMusicXmlDocument(xml);
  if (!doc) return null;
  const wantM = String(measureMxl);
  let measure: Element | null = null;
  for (const part of findXmlParts(doc)) {
    const pid = part.getAttribute('id')?.trim() || '';
    if (partId && pid && !previewPartIdsMatch(pid, partId) && !partIdsMatch(pid, partId)) continue;
    for (const m of [...part.children].filter((c) => xmlLocalName(c) === 'measure')) {
      if ((m.getAttribute('number') || '').trim() === wantM) {
        measure = m;
        break;
      }
    }
    if (measure) break;
  }
  if (!measure) return null;
  const notes = [...measure.children].filter((c) => xmlLocalName(c) === 'note');
  const idx = Math.floor(Number(noteIndex));
  if (idx < 0 || idx >= notes.length) return null;
  let leaderIdx = idx;
  while (leaderIdx > 0 && notes[leaderIdx]?.querySelector(':scope > chord, :scope > *|chord')) {
    leaderIdx -= 1;
  }
  const leader = notes[leaderIdx]!;
  if (leader.querySelector(':scope > rest, :scope > *|rest')) return null;
  let ord = 0;
  for (let i = 0; i < leaderIdx; i += 1) {
    const n = notes[i]!;
    if (n.querySelector(':scope > rest, :scope > *|rest')) continue;
    if (n.querySelector(':scope > chord, :scope > *|chord')) continue;
    ord += 1;
  }
  const pitchEl = leader.querySelector(':scope > pitch, :scope > *|pitch');
  let pitch: string | null = null;
  if (pitchEl) {
    const step = pitchEl.querySelector('step, *|step')?.textContent?.trim()?.toUpperCase();
    const oct = pitchEl.querySelector('octave, *|octave')?.textContent?.trim();
    if (step && oct) {
      const alterRaw = pitchEl.querySelector('alter, *|alter')?.textContent?.trim();
      const alter = alterRaw ? parseInt(alterRaw, 10) : 0;
      const acc = alter === 1 ? '#' : alter === -1 ? 'b' : alter === 2 ? '##' : alter === -2 ? 'bb' : '';
      pitch = `${step}${acc}${oct}`;
    }
  }
  return { ord, pitch };
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
    const measureMxl = graphicMeasureMxlForArticulation(osmd, gm);
    if (measureMxl == null) return;
    if (!pendingMeasureKeysMatch(measureMxl, measureKeys)) return;
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
        if (!artMods.length && !artEls.length) continue;

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

        for (let i = 0; i < Math.max(artMods.length, artEls.length); i++) {
          const artMod = artMods[i] ?? artMods[0];
          const artTag = artTagFromVexModType(artMod?.type) ?? undefined;
          const pending = staffSpacesFromPendingFix(pendingFixes, {
            partId,
            measureMxl,
            pitches: notePitches,
            artTag,
            staffWithinPart,
          });
          if (!pending) continue;

          if (artMod?.type && artTag) {
            const typeOk = articulationModTypeMatchesHint(artMod.type, artTag);
            if (!typeOk) continue;
          }

          const isAbove = artMod?.getPosition?.() === 3 || pending.placement === 'above';
          const extraY = extraArticulationYPx(pending.staffSpaces, lineSpacing, isAbove);
          if (!extraY) continue;
          if (artMod) {
            setArticulationModExtraY(artMod, extraY);
            rememberArticulationYShift(artMod, extraY);
          }
          const targets = paintTargetsForOneArticulation(artMod, artEls, i, usedElements);
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
    const g = Number(opts.measureMxl);
    const f = Number(fix.measureMxl);
    const measureOk =
      String(fix.measureMxl) === String(opts.measureMxl) ||
      (g === 0 && f === 1) ||
      (g === 1 && f === 0);
    if (!measureOk) continue;
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
  const vfNotes = gve.vfNotes ?? gve.VFNotes;
  const raw =
    gve.mVexFlowStaveNote ??
    gve.vfStaveNote ??
    gve.vexflowStaffNote ??
    gve.staveNote ??
    (Array.isArray(vfNotes) ? vfNotes[0] : null);
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
      if (!rec) continue;
      let el: Element | null = null;
      if (typeof rec.getSVGGElement === 'function') {
        el = (rec.getSVGGElement as () => Element | null)();
      } else if (typeof rec.getSVGElement === 'function') {
        el = (rec.getSVGElement as () => Element | null)();
      }
      if (!el) continue;
      const sn = el.closest?.('.vf-stavenote, .vf-staveNote') ?? el;
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
  if (!texts.length) return 0;
  const used = new Set<Element>();
  let shifted = 0;
  for (const dir of dirs) {
    const glyph = dir.querySelector('words')?.textContent?.trim() ?? '>';
    const el = texts.find((t) => t.textContent?.trim() === glyph && !used.has(t));
    if (!el) continue;
    used.add(el);
    const dist = dir.getAttribute(HITL_ART_DISTANCE_ATTR);
    const dy = parseInt(dir.getAttribute('default-y') ?? dir.querySelector('words')?.getAttribute('default-y') ?? '', 10);
    const spaces =
      parseArticulationStaffSpaces(dist) ??
      (Number.isFinite(dy) && dy !== 0 ? Math.abs(dy) / 10 : 1);
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

/**
 * HITL 거리를 네이티브 articulation path에 절대 Y로 적용.
 * osmd.render() 재호출 금지 — re-render가 modifier/SVG를 새로 만들면 WeakMap·transform이 사라짐.
 * VexFlow text_line도 같이 세팅(다음 자연 render에 대비)하되, 즉시 보이는 보정은 path transform.
 */
function applyAbsoluteArticulationDistances(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  pendingFixes: ArticulationPreviewFix[],
  hintsByMeasure: Map<string, OrderedHint[]>,
  staffSpacePx: number,
): { shifted: number; debug: string } {
  const gap = staffSpacePx > 2 ? staffSpacePx : 10;
  const pendingArt = pendingFixes.filter(
    (f) =>
      (f.kind === 'setArticulationPlacement' || f.kind === 'addArticulation') && Boolean(f.articulation),
  );
  let shifted = 0;
  const debugParts: string[] = [];
  const missParts: string[] = [];
  /** 에디터 noteIndex = 파트×마디 document order (스태프별 gm마다 0부터 세면 피아노 등에서 어긋남) */
  const noteOrdByPartMeasure = new Map<string, number>();
  /** noteIndex로 이미 적용한 pending — 피치 폴백이 다른 음에 중복 적용하지 않게 */
  const pendingClaimed = new Set<string>();
  const svgRoot = host.querySelector('svg');
  const isSvgRoot = (el: Element | null): el is SVGSVGElement =>
    !!el && el.tagName.toLowerCase() === 'svg';
  const pendingKey = (f: ArticulationPreviewFix) =>
    `${f.partId || ''}|${f.measureMxl}|${artNameFromFix(f)}|${f.noteIndex ?? ''}`;

  const previewXml = resolveArticulationPreviewXml(osmd) || '';
  /** 에디터 noteIndex → OSMD ord (쉼표 보정) */
  const pendingOsmdOrd = new Map<string, { ord: number; pitch: string | null }>();
  for (const f of pendingArt) {
    if (f.noteIndex == null) continue;
    const mapped = editorNoteIndexToOsmdOrd(previewXml, f.partId || '', f.measureMxl, Number(f.noteIndex));
    if (mapped) pendingOsmdOrd.set(pendingKey(f), mapped);
  }
  const seenOrds: string[] = [];

  forEachGraphicalMeasure(osmd, (gm, staffIndex) => {
    const measureMxl = graphicMeasureMxlForArticulation(osmd, gm);
    if (measureMxl == null) return;
    const partId = partIdFromGraphic(gm) ?? '';
    const staffWithinPart = staffWithinPartFromGraphic(osmd, gm, staffIndex);
    const hints =
      lookupHints(hintsByMeasure, partId, measureMxl, staffWithinPart) ??
      lookupHints(hintsByMeasure, partId, measureMxl) ??
      [];
    const ordKey = `${partId}|${measureMxl}`;

    const staffEntries = (gm.staffEntries ?? gm.StaffEntries ?? []) as unknown[];
    for (const seRaw of staffEntries) {
      const se = asRecord(seRaw);
      if (!se) continue;
      const gves = (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as unknown[];
      for (const gveRaw of gves) {
        const gve = asRecord(gveRaw);
        if (!gve) continue;
        const staveNote = vexStaveNoteFromGve(gve);
        const gNotes = (gve.notes ?? gve.Notes ?? []) as Array<Record<string, unknown>>;
        if (!gNotes.length || graphicNotesAreRest(gNotes)) continue;
        const thisNoteIndex = noteOrdByPartMeasure.get(ordKey) ?? 0;
        noteOrdByPartMeasure.set(ordKey, thisNoteIndex + 1);
        if (seenOrds.length < 24) seenOrds.push(`${partId}m${measureMxl}#${thisNoteIndex}`);
        const notePitches = gNotes.map((gn) => pitchFromGraphicNote(gn)).filter(Boolean) as string[];
        const staveNoteSvg = stavenoteSvgFromGraphic(osmd, gNotes, staveNote);
        // SVG를 못 찾아도 pending 매칭은 시도(아래 miss 디버그). path/overlay는 svg 필요.
        const artEls = staveNoteSvg ? findArticulationElementsInStavenote(staveNoteSvg) : [];

        const rawMods = staveNote?.modifiers as unknown;
        const mods = (Array.isArray(rawMods)
          ? rawMods
          : rawMods && typeof rawMods === 'object' && Array.isArray((rawMods as { list?: unknown }).list)
            ? (rawMods as { list: unknown[] }).list
            : []) as VfArticulationLike[];
        const artMods = mods.filter((m) => isVfArticulationMod(m));

        type Spec = {
          tag: string;
          placement: 'above' | 'below';
          staffSpaces: number;
          mod?: VfArticulationLike;
          fromPending?: boolean;
        };
        const byTag = new Map<string, Spec>();

        const consider = (
          tag: string,
          spaces: number,
          placement: 'above' | 'below',
          mod?: VfArticulationLike,
          fromPending?: boolean,
        ) => {
          if (!tag || !Number.isFinite(spaces) || spaces <= 0) return;
          byTag.set(tag, { tag, staffSpaces: spaces, placement, mod, fromPending });
        };

        // 1) pending — 에디터 noteIndex를 OSMD ord로 변환해 매칭 (쉼표 보정)
        for (const f of pendingArt) {
          if (!pendingMeasureKeysMatch(measureMxl, new Set([String(f.measureMxl)]))) continue;
          if (f.partId && partId && !previewPartIdsMatch(partId, f.partId) && !partIdsMatch(partId, f.partId)) {
            continue;
          }
          const pk = pendingKey(f);
          const mapped = pendingOsmdOrd.get(pk);
          let indexOk = false;
          if (f.noteIndex != null) {
            const wantOrd = mapped?.ord ?? Number(f.noteIndex);
            indexOk = wantOrd === thisNoteIndex;
            // XML 매핑 실패 시에만 피치 보조 (매핑된 ord가 있으면 엄격히 그 슬롯만)
            if (!indexOk && !mapped) {
              const fp = pitchLabelFromArticulationFix(f);
              if (fp && notePitches.length && graphicPitchesMatchFix(notePitches, fp)) indexOk = true;
            }
          } else {
            const fp = pitchLabelFromArticulationFix(f);
            indexOk = Boolean(fp && notePitches.length && graphicPitchesMatchFix(notePitches, fp));
          }
          if (!indexOk) continue;
          const tag = artNameFromFix(f);
          const spaces =
            parseArticulationStaffSpaces(
              f.distance === 'auto' || !f.distance ? 'auto' : String(f.distance),
            ) ?? 1;
          const placement: 'above' | 'below' =
            f.placement === 'above' || f.placement === 'below' ? f.placement : 'below';
          const mod = artMods.find((m) => articulationModTypeMatchesHint(m.type, tag));
          consider(tag, spaces, placement, mod, true);
          pendingClaimed.add(pk);
        }

        const hasPendingOnNote = [...byTag.values()].some((s) => s.fromPending);

        // 2) XML 힌트 — 이 staveNote에 해당 표 modifier가 있을 때만 (같은 피치 다른 음에 유령 표 방지)
        for (const h of hints) {
          const tag = h.tag.replace(/_/g, '-');
          if (byTag.has(tag)) continue;
          if (h.pitch && notePitches.length && !graphicPitchesMatchFix(notePitches, h.pitch)) continue;
          const mod = artMods.find((m) => articulationModTypeMatchesHint(m.type, tag));
          if (!mod) continue;
          if (!h.distance && !hintNeedsOsmdPreviewShift(h) && !hasPendingOnNote) continue;
          const spaces =
            !h.distance && !hintNeedsOsmdPreviewShift(h) && hasPendingOnNote ? 1 : h.staffSpaces;
          consider(tag, spaces, h.placement, mod, false);
        }

        // 3) pending 음: Vex에만 있는 형제 표 보강 (XML 힌트 누락·1칸 tenuto)
        if (hasPendingOnNote) {
          const side = [...byTag.values()][0]?.placement ?? 'below';
          for (const mod of artMods) {
            const tag = artTagFromVexModType(mod.type);
            if (!tag || byTag.has(tag)) continue;
            consider(tag, 1, side, mod, false);
          }
        }

        // noteIndex 없는 pending만 피치 폴백 (레거시)
        if (pendingArt.length) {
          for (const f of pendingArt) {
            if (f.noteIndex != null) continue;
            if (pendingClaimed.has(pendingKey(f))) continue;
            if (!pendingMeasureKeysMatch(measureMxl, new Set([String(f.measureMxl)]))) continue;
            if (f.partId && partId && !previewPartIdsMatch(partId, f.partId) && !partIdsMatch(partId, f.partId)) {
              continue;
            }
            const tag = artNameFromFix(f);
            if (byTag.has(tag)) continue;
            const fp = pitchLabelFromArticulationFix(f);
            if (!fp || !notePitches.length || !graphicPitchesMatchFix(notePitches, fp)) continue;
            const mod = artMods.find((m) => articulationModTypeMatchesHint(m.type, tag));
            if (!mod && artEls.length === 0) continue;
            const spaces =
              parseArticulationStaffSpaces(
                f.distance === 'auto' || !f.distance ? 'auto' : String(f.distance),
              ) ?? 1;
            const placement: 'above' | 'below' =
              f.placement === 'above' || f.placement === 'below' ? f.placement : 'below';
            consider(tag, spaces, placement, mod, true);
            pendingClaimed.add(pendingKey(f));
          }
        }

        if (!byTag.size) continue;

        if (!staveNoteSvg) {
          missParts.push(`m${measureMxl}#${thisNoteIndex}:noSvg`);
          continue;
        }

        const stacked = stackOverlayArtSpaces(
          [...byTag.values()].map((s) => ({
            tag: s.tag,
            placement: s.placement,
            staffSpaces: s.staffSpaces,
            glyph: HITL_ART_OVERLAY_GLYPH[s.tag] || '·',
          })),
        );
        const placement = stacked[0]!.placement;
        const noteHeadY = resolveNoteHeadY(staveNote, staveNoteSvg, artEls, placement, gap);
        const noteHeadX = resolveNoteHeadX(staveNoteSvg, artEls);

        const noteDebug: string[] = [];
        const hasPending = [...byTag.values()].some((s) => s.fromPending);

        // path ↔ tag: 타입 매칭만 (남은 path에 탐욕 할당 금지 — tenuto path를 accent로 밀면 유령·겹침)
        const unused = [...artEls];
        const assignedEl = new Map<string, Element>();
        for (const spec of stacked) {
          const mod = byTag.get(spec.tag)?.mod;
          if (mod) {
            const mi = artMods.indexOf(mod);
            if (mi >= 0 && artEls[mi] && unused.includes(artEls[mi]!)) {
              assignedEl.set(spec.tag, artEls[mi]!);
              unused.splice(unused.indexOf(artEls[mi]!), 1);
              continue;
            }
          }
          for (let j = 0; j < artMods.length; j++) {
            if (!articulationModTypeMatchesHint(artMods[j]?.type, spec.tag)) continue;
            const el = artEls[j];
            if (el && unused.includes(el)) {
              assignedEl.set(spec.tag, el);
              unused.splice(unused.indexOf(el), 1);
              break;
            }
          }
        }

        // pending이 있는 음: 형제 표까지 모두 overlay로 배치 (네이티브 스택·오할당 제거)
        if (hasPending && isSvgRoot(svgRoot)) {
          hideNativeArticulationGlyphs(staveNoteSvg);
          const n = paintHitlArticulationOverlayTexts(
            svgRoot,
            stacked.map((spec) => ({
              tag: spec.tag,
              placement: spec.placement,
              staffSpaces: spec.staffSpaces,
              glyph: HITL_ART_OVERLAY_GLYPH[spec.tag] || '·',
              x: noteHeadX || resolveNoteHeadX(staveNoteSvg, artEls),
              noteHeadY: noteHeadY || 40,
            })),
            gap,
          );
          if (n > 0) {
            shifted += n;
            debugParts.push(
              `m${measureMxl}#${thisNoteIndex}:${stacked.map((s) => `${s.tag}@${s.staffSpaces}/ov`).join(',')}`,
            );
          } else {
            missParts.push(`m${measureMxl}#${thisNoteIndex}:ovFail`);
          }
          continue;
        }

        let pathOk = 0;
        for (const spec of stacked) {
          const el = assignedEl.get(spec.tag);
          if (!el) continue;
          const cur = pathStartXY(el);
          const targetY = overlayArticulationY(noteHeadY, spec.staffSpaces, spec.placement, gap);
          if (cur && Number.isFinite(cur.y)) {
            applyArticulationShiftY(el, targetY - cur.y);
          } else {
            const extra = (Math.max(1, spec.staffSpaces) - 1) * gap;
            applyArticulationShiftY(el, (spec.placement === 'above' ? -1 : 1) * extra);
          }
          el.setAttribute('data-art-spaces', String(spec.staffSpaces));
          el.setAttribute('data-hitl-art-tag', spec.tag);
          const mod = byTag.get(spec.tag)?.mod;
          if (mod) {
            setArticulationModStaffSpaces(mod, spec.staffSpaces);
            (mod as { text_line?: number }).text_line = Math.max(0, spec.staffSpaces - 1);
          }
          pathOk += 1;
          noteDebug.push(`${spec.tag}@${spec.staffSpaces}`);
        }

        if (pathOk < stacked.length && isSvgRoot(svgRoot)) {
          hideNativeArticulationGlyphs(staveNoteSvg);
          const n = paintHitlArticulationOverlayTexts(
            svgRoot,
            stacked.map((spec) => ({
              tag: spec.tag,
              placement: spec.placement,
              staffSpaces: spec.staffSpaces,
              glyph: HITL_ART_OVERLAY_GLYPH[spec.tag] || '·',
              x: noteHeadX || resolveNoteHeadX(staveNoteSvg, artEls),
              noteHeadY: noteHeadY || 40,
            })),
            gap,
          );
          if (n > 0) {
            shifted += n;
            debugParts.push(
              `m${measureMxl}#${thisNoteIndex}:${stacked.map((s) => `${s.tag}@${s.staffSpaces}/ov`).join(',')}`,
            );
          } else if (!pathOk) {
            missParts.push(`m${measureMxl}#${thisNoteIndex}:ovFail`);
          }
        } else if (pathOk) {
          shifted += pathOk;
          debugParts.push(`m${measureMxl}#${thisNoteIndex}:${noteDebug.join(',')}`);
        } else {
          missParts.push(`m${measureMxl}#${thisNoteIndex}:noEl(arts=${artEls.length})`);
        }
      }
    }
  });

  if (!shifted && pendingArt.length) {
    const pend = pendingArt
      .slice(0, 4)
      .map((f) => {
        const pk = pendingKey(f);
        const m = pendingOsmdOrd.get(pk);
        return `${f.partId || '?'}m${f.measureMxl}#${f.noteIndex ?? '?'}${m ? `→ord${m.ord}` : '→?ord'}:${artNameFromFix(f)}@${f.distance || 'auto'}`;
      })
      .join(',');
    const claimed = [...pendingClaimed].join(',') || 'none';
    debugParts.push(
      `miss pending=${pend} claimed=${claimed} seen=${seenOrds.slice(0, 12).join(',') || 'none'}${missParts.length ? ` | ${missParts.slice(0, 4).join(';')}` : ''}`,
    );
  } else if (missParts.length && !debugParts.length) {
    debugParts.push(missParts.slice(0, 6).join(';'));
  }

  return { shifted, debug: debugParts.slice(0, 12).join(' | ') };
}

function applyOsmdArticulationOffsetsDetailedInner(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  empty: ArticulationShiftStats,
): ArticulationShiftStats {
  const pendingFixes = articulationFixesByOsmd.get(osmd) ?? [];
  const staffSpacePx = host?.querySelector('svg') ? staffSpacePxFromHost(host, osmd) : 10;

  if (!host?.querySelector('svg')) return { ...empty, staffSpacePx };

  ensureArticulationDrawPatch(osmd);
  resetOsmdArticulationOffsets(host);
  clearHitlArticulationOverlays(host);

  const xml = resolveArticulationPreviewXml(osmd);
  const hintsByMeasure = xml?.trim()
    ? cloneHintsByMeasure(orderedHintsByMeasureFromXml(xml))
    : new Map<string, OrderedHint[]>();
  if (xml?.trim()) overlayFixesOnHints(xml, hintsByMeasure, pendingFixes);
  const totalHints = countHints(hintsByMeasure);

  // 절대 path Y — re-render 없이 즉시 반영 (거리 조절의 유일한 확실한 경로)
  const { shifted, debug } = applyAbsoluteArticulationDistances(
    host,
    osmd,
    pendingFixes,
    hintsByMeasure,
    staffSpacePx || 10,
  );

  const fromLiftedExpr = shiftLiftedOsmdExpressions(osmd, staffSpacePx || 10);
  const fromLiftedDom = xml?.trim()
    ? shiftLiftedDirectionTexts(host, xml, staffSpacePx || 10)
    : 0;
  const shiftedCount = shifted + fromLiftedExpr + fromLiftedDom;

  const hostDy = extraYPxFromArticulationFixes(pendingFixes, staffSpacePx || 10);
  const appliedDy = shiftedCount > 0 ? hostDy : 0;
  applyHitlArticulationHostCss(host, appliedDy);
  setHitlArticulationExtraYPx(appliedDy);
  host.setAttribute('data-hitl-art-shifted', String(shiftedCount));
  if (debug) host.setAttribute('data-hitl-art-debug', debug);
  else host.removeAttribute('data-hitl-art-debug');
  host.title = appliedDy
    ? `[HITL Accent] dy=${appliedDy}px, shifted=${shiftedCount}, absY ${debug}`
    : '[HITL Accent] dy=0';

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

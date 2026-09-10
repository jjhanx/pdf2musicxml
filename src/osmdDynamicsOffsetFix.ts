/**
 * OSMD 미리보기 — HITL 셈여림 거리(칸) 반영.
 * OSMD는 direction default-y를 수직 위치에 거의 쓰지 않고 고정 offset(+2.5 below)만 적용하므로 SVG shift.
 */
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import {
  articulationDefaultYFromStaffSpaces,
  articulationStaffSpacesFromHint,
  hitlPreviewPartIdsMatch,
  parseArticulationStaffSpaces,
  type ArticulationPreviewFix,
} from '../shared/musicXmlArticulationDistance';
import {
  collectDynamicsPreviewHintsFromXml,
  dynamicsHintNeedsOsmdPreviewShift,
  type DynamicsPreviewHint,
} from '../shared/musicXmlDirectionPlacement';
import { HITL_DYNAMICS_TAG_NAMES } from '../shared/musicXmlDynamics';
import { measureMxlFromGraphic, partIdFromGraphic } from './osmdMeasureClick';
import { applyArticulationShiftY } from './osmdArticulationOffsetFix';

/** patch_osmd_navigation_labels — below dynamics 기본 여백(staff-space). */
const OSMD_DYNAMICS_BASELINE_BELOW_SPACES = 2.5;
/** patch — above dynamics 기본 여백(staff-space). */
const OSMD_DYNAMICS_BASELINE_ABOVE_SPACES = 3.8;

const previewXmlByOsmd = new WeakMap<OpenSheetMusicDisplay, string>();

export function registerOsmdPreviewXmlForDynamics(osmd: OpenSheetMusicDisplay, xml: string): void {
  previewXmlByOsmd.set(osmd, xml);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function isDomElement(v: unknown): v is Element {
  return v instanceof Element;
}

function labelTextFromExpression(expr: Record<string, unknown>): string {
  const label = asRecord(expr.Label ?? expr.label);
  const text = label?.text ?? label?.Text ?? label?.Label;
  if (typeof text === 'string') return text.trim();
  const lab = label?.label ?? label?.Label;
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

function staffSpaceFromStaffLine(sl: Record<string, unknown> | null, fallback: number): number {
  const stave = asRecord(sl?.stave ?? sl?.Stave ?? sl?.vfStave);
  const gap =
    typeof stave?.getSpacingBetweenLines === 'function'
      ? Number((stave.getSpacingBetweenLines as () => number)())
      : NaN;
  return Number.isFinite(gap) && gap > 2 ? gap : fallback;
}

function staffWithinPartFromPartId(partId: string): number | null {
  if (partId.endsWith('__PR')) return 1;
  if (partId.endsWith('__PL')) return 2;
  return null;
}

function partIdsMatch(a: string, b: string): boolean {
  const baseA = a.replace(/__PR$|__PL$/, '');
  const baseB = b.replace(/__PR$|__PL$/, '');
  return a === b || a === baseB || a === `${baseB}__PR` || a === `${baseB}__PL` || baseA === baseB;
}

function normalizeDynText(raw: string): string {
  return raw.replace(/\s+/g, '').toLowerCase();
}

function isDynamicsGlyph(text: string): boolean {
  const t = normalizeDynText(text);
  return t.length > 0 && HITL_DYNAMICS_TAG_NAMES.has(t);
}

function extraDynamicsPx(
  staffSpaces: number,
  placement: 'above' | 'below',
  staffSpacePx: number,
): number {
  const baseline =
    placement === 'below' ? OSMD_DYNAMICS_BASELINE_BELOW_SPACES : OSMD_DYNAMICS_BASELINE_ABOVE_SPACES;
  const delta = staffSpaces - baseline;
  return placement === 'below' ? delta * staffSpacePx : -delta * staffSpacePx;
}

function hintForExpression(
  hints: DynamicsPreviewHint[],
  partId: string,
  measureMxl: string,
  staffWithinPart: number,
  tag: string,
): DynamicsPreviewHint | null {
  const want = normalizeDynText(tag);
  for (const h of hints) {
    if (!partIdsMatch(h.partId, partId)) continue;
    if (h.measureMxl !== measureMxl) continue;
    if (h.staff !== staffWithinPart) continue;
    if (normalizeDynText(h.tag) !== want) continue;
    return h;
  }
  return null;
}

function isDynamicsPreviewFix(f: ArticulationPreviewFix): boolean {
  const kind = (f.kind || '').trim();
  if (kind !== 'setNoteDirectionPlacement' && kind !== 'addNoteDirection') return false;
  return (f.directionType || '').trim().toLowerCase() === 'dynamics';
}

function overlayDynamicsFixesOnHints(
  hints: DynamicsPreviewHint[],
  fixes: ReadonlyArray<ArticulationPreviewFix>,
): void {
  const removed = new Set(
    fixes
      .filter(
        (f) =>
          (f.kind === 'removeNoteDirection' || f.kind === 'clearNoteDirection') &&
          ((f.directionType || '').trim().toLowerCase() === 'dynamics' ||
            f.kind === 'clearNoteDirection'),
      )
      .map((f) => `${f.partId}|${f.measureMxl}|${(f.directionValue || '').trim().toLowerCase()}`),
  );
  for (const fix of fixes) {
    if (!isDynamicsPreviewFix(fix)) continue;
    const tag = (fix.directionValue || '').trim().toLowerCase();
    if (!tag) continue;
    if (
      removed.has(`${fix.partId}|${fix.measureMxl}|${tag}`) ||
      removed.has(`${fix.partId}|${fix.measureMxl}|`)
    ) {
      continue;
    }
    const placement =
      fix.placement === 'above' || fix.placement === 'below' ? fix.placement : null;
    const spaces =
      parseArticulationStaffSpaces(fix.distance) ??
      articulationStaffSpacesFromHint(fix.distance, null);
    for (const h of hints) {
      if (!hitlPreviewPartIdsMatch(fix.partId, h.partId)) continue;
      if (String(h.measureMxl) !== String(fix.measureMxl)) continue;
      if (normalizeDynText(h.tag) !== normalizeDynText(tag)) continue;
      if (placement) h.placement = placement;
      h.staffSpaces = spaces;
      h.distance = fix.distance?.trim() || String(Math.round(spaces));
      h.defaultY = articulationDefaultYFromStaffSpaces(h.placement, spaces);
    }
  }
}

function hideDynamicsGlyphEl(el: Element): void {
  el.setAttribute('data-hitl-dyn-hidden', '1');
  const sty = (el as SVGElement & { style?: CSSStyleDeclaration }).style;
  if (sty?.setProperty) sty.setProperty('opacity', '0');
  else el.setAttribute('opacity', '0');
}

function shiftDynamicsTextsFromDom(
  host: HTMLElement,
  hints: DynamicsPreviewHint[],
  staffSpacePx: number,
  used: Set<Element>,
): number {
  if (!hints.length) return 0;
  const needShift = hints.filter((h) => dynamicsHintNeedsOsmdPreviewShift(h));
  if (!needShift.length) return 0;
  const texts = [...host.querySelectorAll('text')].filter((el) => {
    if (used.has(el)) return false;
    const t = normalizeDynText(el.textContent || '');
    return t.length > 0 && HITL_DYNAMICS_TAG_NAMES.has(t);
  });
  let shifted = 0;
  for (const hint of needShift) {
    const want = normalizeDynText(hint.tag);
    const el =
      texts.find((t) => !used.has(t) && normalizeDynText(t.textContent || '') === want) ??
      texts.find((t) => !used.has(t) && normalizeDynText(t.textContent || '').includes(want));
    if (!el) continue;
    const extraY = extraDynamicsPx(hint.staffSpaces, hint.placement, staffSpacePx);
    if (Math.abs(extraY) < 0.5) continue;
    applyArticulationShiftY(el, extraY);
    used.add(el);
    shifted += 1;
  }
  return shifted;
}

function staffWithinPartFromStaffLine(
  osmd: OpenSheetMusicDisplay,
  staffLine: Record<string, unknown>,
  staffIndex: number,
): number {
  const fromPart = staffWithinPartFromPartId(
    String(staffLine.partId ?? staffLine.PartId ?? staffLine.parentPart?.id ?? ''),
  );
  if (fromPart != null) return fromPart;
  const pm = asRecord(staffLine.parentMeasure ?? staffLine.ParentMeasure);
  if (pm) {
    const pid = partIdFromGraphic(pm as Parameters<typeof partIdFromGraphic>[0]);
    const fromPm = pid ? staffWithinPartFromPartId(pid) : null;
    if (fromPm != null) return fromPm;
  }
  return staffIndex + 1;
}

export function applyOsmdDynamicsOffsets(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  xml?: string | null,
  pendingFixes?: ReadonlyArray<ArticulationPreviewFix>,
): number {
  const hintXml = xml?.trim() || previewXmlByOsmd.get(osmd);
  if (!hintXml) return 0;
  const hints = collectDynamicsPreviewHintsFromXml(hintXml);
  if (pendingFixes?.length) overlayDynamicsFixesOnHints(hints, pendingFixes);

  const rec = osmd as unknown as Record<string, unknown>;
  const sheet = asRecord(rec.GraphicSheet ?? rec.graphicSheet ?? rec.graphic);
  if (!sheet) return 0;

  let staffSpacePx = 10;
  const rules = asRecord(rec.EngravingRules ?? rec.engravingRules);
  const spacing = rules?.SpacingBetweenLines ?? rules?.spacingBetweenLines;
  if (typeof spacing === 'number' && spacing > 2) staffSpacePx = spacing;

  let shifted = 0;
  const usedElements = new Set<Element>();
  const pages = (sheet.MusicPages ?? sheet.musicPages ?? []) as unknown[];
  for (const pageRaw of pages) {
    const page = asRecord(pageRaw);
    const systems = (page?.MusicSystems ?? page?.musicSystems ?? []) as unknown[];
    for (const sysRaw of systems) {
      const sys = asRecord(sysRaw);
      const lines = (sys?.StaffLines ?? sys?.staffLines ?? []) as unknown[];
      for (let staffIndex = 0; staffIndex < lines.length; staffIndex += 1) {
        const sl = asRecord(lines[staffIndex]);
        if (!sl) continue;
        const linePx = staffSpaceFromStaffLine(sl, staffSpacePx);
        const staffWithinPart = staffWithinPartFromStaffLine(osmd, sl, staffIndex);
        const exprs = (sl?.AbstractExpressions ?? sl?.abstractExpressions ?? []) as unknown[];
        for (const exprRaw of exprs) {
          const expr = asRecord(exprRaw);
          if (!expr) continue;
          const text = labelTextFromExpression(expr);
          if (!isDynamicsGlyph(text)) continue;

          const pm = asRecord(expr.parentMeasure ?? expr.ParentMeasure);
          const measureMxl = pm ? measureMxlFromGraphic(pm as Parameters<typeof measureMxlFromGraphic>[0]) : null;
          const partId = pm ? partIdFromGraphic(pm as Parameters<typeof partIdFromGraphic>[0]) ?? '' : '';
          if (measureMxl == null || !partId) continue;

          const svg = labelSvgFromExpression(expr);
          const hint = hintForExpression(hints, partId, String(measureMxl), staffWithinPart, text);
          if (!hint) {
            if (svg) {
              hideDynamicsGlyphEl(svg);
              usedElements.add(svg);
            }
            continue;
          }
          if (!dynamicsHintNeedsOsmdPreviewShift(hint)) continue;
          const extraY = extraDynamicsPx(hint.staffSpaces, hint.placement, linePx);
          if (Math.abs(extraY) < 0.5) continue;
          if (!svg) continue;
          applyArticulationShiftY(svg, extraY);
          usedElements.add(svg);
          shifted += 1;
        }
      }
    }
  }
  if (host) {
    shifted += shiftDynamicsTextsFromDom(host, hints, staffSpacePx, usedElements);
    for (const el of host.querySelectorAll('text')) {
      if (usedElements.has(el)) continue;
      if (el.getAttribute('data-hitl-dyn-hidden') === '1') continue;
      const t = normalizeDynText(el.textContent || '');
      if (!t || !HITL_DYNAMICS_TAG_NAMES.has(t)) continue;
      const hinted = hints.some((h) => normalizeDynText(h.tag) === t);
      if (!hinted) hideDynamicsGlyphEl(el);
    }
  }
  return shifted;
}

/** MutationObserver·pending fix 재적용용 — OSMD graphic tree 없이도 동작 */
export function applyPendingDynamicsOffsetsOnly(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay | null | undefined,
  xml: string | null | undefined,
  pendingFixes: ReadonlyArray<ArticulationPreviewFix>,
): number {
  if (!host || !osmd?.IsReadyToRender?.()) return 0;
  return applyOsmdDynamicsOffsets(host, osmd, xml, pendingFixes);
}

import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { MeasureTimingIssue } from '../shared/musicXmlMeasureTiming';
import {
  forEachGraphicalMeasure,
  getOsmdUnitInPixels,
  measureMxlFromGraphic,
  partIdFromGraphic,
} from './osmdMeasureClick';
import { syncVfStemsAndBeamsAfterStavenoteAlign } from './osmdOnsetColumnAlignFix';

const OVERLAY_CLASS = 'hitl-measure-timing-warning';

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

function issueForGraphic(
  partId: string | null,
  measureNumber: number | null,
  issues: readonly MeasureTimingIssue[],
): MeasureTimingIssue | null {
  if (!partId || measureNumber == null) return null;
  return (
    issues.find(
      (i) => i.measureNumber === measureNumber && partIdsMatch(partId, i.partId),
    ) ?? null
  );
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function domRectsFromStaffEntry(entry: unknown): DOMRect[] {
  const rects: DOMRect[] = [];
  const e = asRecord(entry);
  if (!e) return rects;
  const gves = (e.graphicalVoiceEntries ?? e.GraphicalVoiceEntries) as unknown[] | undefined;
  for (const gve of gves ?? []) {
    const gr = asRecord(gve);
    const notes = (gr?.notes ?? gr?.Notes ?? gr?.graphicalNotes ?? gr?.GraphicalNotes) as
      | unknown[]
      | undefined;
    for (const note of notes ?? []) {
      const nr = asRecord(note);
      if (nr && typeof nr.getSVGGElement === 'function') {
        try {
          const el = (nr.getSVGGElement as () => SVGGraphicsElement | null | undefined)();
          if (el?.getBoundingClientRect) {
            const r = el.getBoundingClientRect();
            if (r.width >= 0.5 && r.height >= 0.5) rects.push(r);
          }
        } catch {
          /* ignore */
        }
      }
    }
  }
  return rects;
}

function domBoundsForGraphicMeasure(
  gm: unknown,
  host: HTMLElement,
): { left: number; top: number; width: number; height: number } | null {
  const rec = asRecord(gm);
  if (!rec) return null;
  const hostRect = host.getBoundingClientRect();
  const entries = (rec.staffEntries ?? rec.StaffEntries) as unknown[] | undefined;
  if (!Array.isArray(entries) || entries.length === 0) return null;

  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const entry of entries) {
    for (const r of domRectsFromStaffEntry(entry)) {
      left = Math.min(left, r.left - hostRect.left);
      top = Math.min(top, r.top - hostRect.top);
      right = Math.max(right, r.right - hostRect.left);
      bottom = Math.max(bottom, r.bottom - hostRect.top);
    }
  }
  if (!Number.isFinite(left)) return null;
  const w = right - left;
  const h = bottom - top;
  if (w < 1 || h < 1) return null;
  const padX = Math.max(4, w * 0.1);
  const padY = Math.max(3, h * 0.15);
  return {
    left: left - padX,
    top: top - padY,
    width: w + padX * 2,
    height: h + padY * 2,
  };
}

/** over/under full 마디에 붉은 톤 오버레이 — 자동 박자 보정 대신 경고만. */
export function applyMeasureTimingWarningsToOsmdHost(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  issues: readonly MeasureTimingIssue[],
): void {
  host.querySelectorAll(`.${OVERLAY_CLASS}`).forEach((el) => el.remove());
  if (!issues.length || !osmd.IsReadyToRender()) return;

  const layer =
    (host.querySelector('.osmd-measure-timing-layer') as HTMLElement | null) ??
    (() => {
      const el = document.createElement('div');
      el.className = 'osmd-measure-timing-layer';
      el.style.cssText =
        'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2;';
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      host.appendChild(el);
      return el;
    })();

  const seen = new Set<string>();
  forEachGraphicalMeasure(osmd, (gmRaw) => {
    const partId = partIdFromGraphic(gmRaw as Parameters<typeof partIdFromGraphic>[0]);
    const measureNumber = measureMxlFromGraphic(gmRaw as Parameters<typeof measureMxlFromGraphic>[0]);
    const issue = issueForGraphic(partId, measureNumber, issues);
    if (!issue) return;
    const key = `${partId}|${measureNumber}|${issue.kind}`;
    if (seen.has(key)) return;
    seen.add(key);

    const bounds = domBoundsForGraphicMeasure(gmRaw, host);
    if (!bounds) return;

    const box = document.createElement('div');
    box.className = OVERLAY_CLASS;
    const tint =
      issue.kind === 'overfull'
        ? 'rgba(198, 40, 40, 0.32)'
        : 'rgba(198, 40, 40, 0.16)';
    box.style.cssText = [
      'position:absolute',
      `left:${bounds.left}px`,
      `top:${bounds.top}px`,
      `width:${bounds.width}px`,
      `height:${bounds.height}px`,
      `background:${tint}`,
      'border:1.5px solid rgba(183, 28, 28, 0.65)',
      'border-radius:2px',
      'box-sizing:border-box',
      'pointer-events:none',
    ].join(';');
    box.title =
      issue.kind === 'overfull'
        ? `마디 ${measureNumber}: 박자 초과 (${issue.actual}/${issue.expected}) — 음표는 유지, 앞·뒤 마디로 넘어가지 않게 잘림`
        : `마디 ${measureNumber}: 박자 부족 (${issue.actual}/${issue.expected})`;
    layer.appendChild(box);
  });
}

function asGmRecord(gm: unknown): Record<string, unknown> | null {
  return gm && typeof gm === 'object' ? (gm as Record<string, unknown>) : null;
}

function readAbsX(gm: unknown): number | null {
  const rec = asGmRecord(gm);
  if (!rec) return null;
  const bb = asRecord(rec.PositionAndShape ?? rec.positionAndShape);
  if (!bb) return null;
  const abs = asRecord(bb.AbsolutePosition ?? bb.absolutePosition);
  if (!abs) return null;
  const x = Number(abs.x ?? abs.X);
  return Number.isFinite(x) ? x : null;
}

function readBbSizeWidth(gm: unknown): number | null {
  const rec = asGmRecord(gm);
  if (!rec) return null;
  const bb = asRecord(rec.PositionAndShape ?? rec.positionAndShape);
  if (!bb) return null;
  const size = asRecord(bb.Size ?? bb.size);
  if (!size) return null;
  const w = Number(size.width ?? size.Width);
  return Number.isFinite(w) && w > 0.5 ? w : null;
}

function readBbSizeHeight(gm: unknown): number | null {
  const rec = asGmRecord(gm);
  if (!rec) return null;
  const bb = asRecord(rec.PositionAndShape ?? rec.positionAndShape);
  if (!bb) return null;
  const size = asRecord(bb.Size ?? bb.size);
  if (!size) return null;
  const h = Number(size.height ?? size.Height);
  return Number.isFinite(h) && h > 0.5 ? h : null;
}

/**
 * 마디에 할당된 가로 폭(OSMD 단위).
 * Size.width≤0(SkyBottomLine 실패)이어도 다음 마디 AbsolutePosition.x 간격으로 복구.
 * 앞·뒤 마디 침범 clip의 공통 기준(곡·마디 하드코딩 없음).
 */
export function allocatedMeasureWidthOsmd(
  gm: unknown,
  nextGm: unknown | undefined,
  fallbackWidth = 28,
): number {
  const absX = readAbsX(gm);
  const nextX = nextGm != null ? readAbsX(nextGm) : null;
  if (absX != null && nextX != null && nextX > absX + 0.5) {
    return nextX - absX;
  }
  const sizeW = readBbSizeWidth(gm);
  if (sizeW != null) return sizeW;
  return Math.max(0.5, fallbackWidth);
}

function isSvgElement(el: Element | null | undefined): el is Element {
  return !!el && el.namespaceURI === 'http://www.w3.org/2000/svg';
}

function closestVfMeasure(el: Element | null | undefined): Element | null {
  if (!el) return null;
  if (typeof el.closest === 'function') {
    const m = el.closest('g.vf-measure');
    if (isSvgElement(m)) return m;
  }
  const cls = el.getAttribute?.('class') ?? '';
  if (/\bvf-measure\b/.test(cls) && isSvgElement(el)) return el;
  return null;
}

/**
 * GraphicalMeasure → 실제 음표가 들어 있는 SVG `g.vf-measure`.
 * OSMD `getSVGGElement()`는 버전/백엔드에 따라 undefined인 경우가 많아,
 * stave / staffEntry 음표 DOM의 `closest('.vf-measure')`로 복구한다.
 * (clip이 measure G에 걸려야 자식 `.vf-stavenote`가 앞 마디로 넘치지 않음)
 */
/** GraphicalMeasure → `g.vf-measure` (onset align·contain·clip 공용). */
export function osmdGraphicalMeasureSvgG(gm: unknown): Element | null {
  return svgGElement(gm);
}

function svgGElement(gm: unknown): Element | null {
  const rec = asGmRecord(gm);
  if (!rec) return null;

  if (typeof rec.getSVGGElement === 'function') {
    try {
      const g = (rec.getSVGGElement as () => Element | null | undefined)() ?? null;
      const m = closestVfMeasure(g) ?? (isSvgElement(g) ? g : null);
      if (m) return m;
    } catch {
      /* fall through */
    }
  }

  const stave = asRecord(rec.stave ?? rec.Stave ?? rec.vfStave);
  if (stave && typeof stave.getSVGElement === 'function') {
    try {
      const el = (stave.getSVGElement as () => Element | null | undefined)() ?? null;
      const m = closestVfMeasure(el);
      if (m) return m;
    } catch {
      /* fall through */
    }
  }

  const entries = (rec.staffEntries ?? rec.StaffEntries) as unknown[] | undefined;
  for (const entry of entries ?? []) {
    const e = asRecord(entry);
    const gves = (e?.graphicalVoiceEntries ?? e?.GraphicalVoiceEntries) as unknown[] | undefined;
    for (const gve of gves ?? []) {
      const gr = asRecord(gve);
      const notes = (gr?.notes ?? gr?.Notes ?? gr?.graphicalNotes ?? gr?.GraphicalNotes) as
        | unknown[]
        | undefined;
      for (const note of notes ?? []) {
        const nr = asRecord(note);
        if (!nr || typeof nr.getSVGGElement !== 'function') continue;
        try {
          const el = (nr.getSVGGElement as () => Element | null | undefined)() ?? null;
          const m = closestVfMeasure(el);
          if (m) return m;
        } catch {
          /* next note */
        }
      }
    }
  }

  return null;
}

function readAbsY(gm: unknown): number | null {
  const rec = asGmRecord(gm);
  if (!rec) return null;
  const bb = asRecord(rec.PositionAndShape ?? rec.positionAndShape);
  if (!bb) return null;
  const abs = asRecord(bb.AbsolutePosition ?? bb.absolutePosition);
  if (!abs) return null;
  const y = Number(abs.y ?? abs.Y);
  return Number.isFinite(y) ? y : null;
}

/**
 * 마디 clip의 세로 범위 — 가로는 칸만 제한하고 세로는 페이지 전체를 덮어야 함.
 * 고정 y=-800/h=2400 이면 긴 악보 아래쪽 system에서 S·A만 남고 T/B/PR/PL이
 * 하얗게 잘림(한 system이 밴드 경계를 가로지를 때 A 하반부만 잘리기도 함).
 */
export function measureClipVerticalBandPx(svg: Element): { y: number; height: number } {
  const vb = svg.getAttribute('viewBox');
  if (vb) {
    const parts = vb
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const minY = parts[1]!;
      const vbH = parts[3]!;
      if (vbH > 1) {
        const pad = Math.max(4000, vbH * 0.5);
        return { y: minY - pad, height: vbH + pad * 2 };
      }
    }
  }
  const hAttr = Number(svg.getAttribute('height'));
  if (Number.isFinite(hAttr) && hAttr > 1) {
    const pad = Math.max(4000, hAttr);
    return { y: -pad, height: hAttr + pad * 2 };
  }
  // viewBox/height 미정 — 세로 사실상 무제한(가로만 제한)
  return { y: -1e6, height: 2e6 };
}

function svgViewBoxWidth(svg: Element): number {
  const vb = svg.getAttribute('viewBox');
  if (vb) {
    const parts = vb
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && Number.isFinite(parts[2])) return parts[2]!;
  }
  const w = Number(svg.getAttribute('width'));
  return Number.isFinite(w) ? w : 0;
}

/**
 * HITL faithful 미리보기 — 모든 마디 SVG를 할당 폭으로 clip해 이웃 칸 침범을 막음.
 * (overfull만이 아니라 정원 마디도 첫 음이 앞 칸으로 넘칠 수 있음)
 * VexFlow `g.vf-measure`는 오선 절대 좌표 → clip rect도 stave/AbsolutePosition 기준
 * (x=0 고정 시 오른쪽 마디가 하얗게 사라짐).
 *
 * `issues`를 넘기면 overfull 마디만 clip(테스트용). 생략 시 전 마디.
 */
export function clipOsmdMeasuresToAllocatedWidth(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  issues?: readonly MeasureTimingIssue[],
): void {
  const svg = host.querySelector('svg');
  if (!svg || !osmd.IsReadyToRender()) return;

  svg.querySelectorAll('clipPath[data-hitl-measure-clip]').forEach((el) => el.remove());
  svg.querySelectorAll('[data-hitl-measure-clipped]').forEach((el) => {
    el.removeAttribute('clip-path');
    el.removeAttribute('data-hitl-measure-clipped');
  });

  // 컨테이너 폭 0 → OSMD가 모든 마디를 왼쪽에 겹침. 그때 clip하면 악보 전체가 하얗게 사라짐.
  if (svgViewBoxWidth(svg) <= 1) return;

  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svg.insertBefore(defs, svg.firstChild);
  }

  const zoom =
    typeof (osmd as { zoom?: number }).zoom === 'number' &&
    Number.isFinite((osmd as { zoom?: number }).zoom) &&
    ((osmd as { zoom?: number }).zoom as number) > 0
      ? ((osmd as { zoom?: number }).zoom as number)
      : 1;
  const scale = getOsmdUnitInPixels(osmd) * zoom;
  const { y: yPx, height: hPx } = measureClipVerticalBandPx(svg);
  let idx = 0;
  forEachGraphicalMeasure(osmd, (gmRaw, _si, mi, row) => {
    if (issues !== undefined) {
      const partId = partIdFromGraphic(gmRaw as Parameters<typeof partIdFromGraphic>[0]);
      const measureNumber = measureMxlFromGraphic(
        gmRaw as Parameters<typeof measureMxlFromGraphic>[0],
      );
      const issue = issueForGraphic(partId, measureNumber, issues);
      if (!issue || issue.kind !== 'overfull') return;
    }

    const g = svgGElement(gmRaw);
    if (!g) return;

    let bounds = measureBoundsPx(gmRaw, row[mi + 1], scale, osmd);
    if (!bounds) return;
    // 빔·줄기 tip이 할당 폭 계산보다 살짝 밖이면 clip이 빔만 잘라 8분·16분이 4분처럼 보임.
    // contain 이후에도 OSMD 빔이 stave 폭을 1~수 px 넘는 경우가 있어 빔 bbox만큼 가로를 확장.
    bounds = expandBoundsForEngravingGlyphs(g, bounds);
    const wPx = bounds.right - bounds.left;
    if (wPx <= 0.5) return;
    // 세로는 viewBox 전체(+여유). 고정 2400px는 아래 system·아래 성부를 잘라 하얗게 만듦.

    const id = `hitl-mclip-${idx}`;
    idx += 1;
    const cp = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
    cp.setAttribute('id', id);
    cp.setAttribute('data-hitl-measure-clip', '1');
    cp.setAttribute('clipPathUnits', 'userSpaceOnUse');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(bounds.left));
    rect.setAttribute('y', String(yPx));
    rect.setAttribute('width', String(wPx));
    rect.setAttribute('height', String(hPx));
    cp.appendChild(rect);
    defs!.appendChild(cp);
    g.setAttribute('clip-path', `url(#${id})`);
    g.setAttribute('data-hitl-measure-clipped', '1');
  });
}

function elementTranslateXRelativeTo(el: Element, ancestor: Element): number {
  let x = 0;
  let cur: Element | null = el;
  while (cur && cur !== ancestor) {
    const tr = cur.getAttribute?.('transform') ?? '';
    const m = /translate\(\s*([-\d.eE+]+)/.exec(tr);
    if (m) x += parseFloat(m[1]!);
    cur = cur.parentElement;
  }
  return x;
}

/** 빔·줄기·붙임줄(tie)·이음줄(slur) path의 x 범위가 마디 bounds 밖이면 clip 가로를 그만큼 넓힘(마디 경계를 넘는 붙임줄/이음줄이 잘려 보이지 않는 현상 방지). */
export function expandBoundsForEngravingGlyphs(
  measureG: Element,
  bounds: { left: number; right: number },
): { left: number; right: number } {
  let left = bounds.left;
  let right = bounds.right;
  const pad = 2;
  // 1) 빔 & 줄기
  for (const p of measureG.querySelectorAll('.vf-beam path, .vf-stem path, :scope > .vf-stem path')) {
    const d = p.getAttribute('d') || '';
    const tx = elementTranslateXRelativeTo(p, measureG);
    const xs: number[] = [];
    const re = /[MmLl]\s*([-\d.eE+]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(d))) {
      const x = parseFloat(m[1]!);
      if (Number.isFinite(x)) xs.push(x + tx);
    }
    if (!xs.length) continue;
    left = Math.min(left, Math.min(...xs) - pad);
    right = Math.max(right, Math.max(...xs) + pad);
  }
  // 2) 붙임줄(tie) & 이음줄(slur) - 마디를 가로지르는 곡선(M/Q/C) 좌표 반영
  for (const p of measureG.querySelectorAll('.vf-stavetie path, [class*="vf-tie"] path, .vf-curve path, [class*="vf-curve"] path')) {
    const d = p.getAttribute('d') || '';
    if (!d) continue;
    const tx = elementTranslateXRelativeTo(p, measureG);
    const nums = [...d.matchAll(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)].map((m) => Number(m[0]));
    const xs: number[] = [];
    for (let i = 0; i < nums.length; i += 2) {
      if (Number.isFinite(nums[i])) xs.push(nums[i]! + tx);
    }
    if (!xs.length) continue;
    left = Math.min(left, Math.min(...xs) - pad);
    right = Math.max(right, Math.max(...xs) + pad);
  }
  if (!(right > left)) return bounds;
  return { left, right };
}

function staveBoundsPx(gm: unknown): { left: number; right: number } | null {
  const rec = asGmRecord(gm);
  if (!rec) return null;
  const stave = asRecord(rec.stave ?? rec.Stave ?? rec.vfStave);
  if (!stave) return null;
  try {
    const x =
      typeof stave.getX === 'function'
        ? Number((stave.getX as () => number).call(stave))
        : Number(stave.x ?? stave.X);
    const w =
      typeof stave.getWidth === 'function'
        ? Number((stave.getWidth as () => number).call(stave))
        : Number(stave.width ?? stave.Width);
    if (Number.isFinite(x) && Number.isFinite(w) && w > 8) {
      return { left: x, right: x + w };
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** VexFlow path/AbsolutePosition과 같은 px 공간의 마디 [left,right]. */
export function measureBoundsPx(
  gm: unknown,
  nextGm: unknown | undefined,
  scale: number,
  _osmd?: OpenSheetMusicDisplay | null,
): { left: number; right: number } | null {
  // Softmax/OSMD stave·AbsolutePosition만 사용.
  // onset align 배분 폭으로 바꾸면 clip/contain이 오선·빔과 어긋나 마디가 끊긴다.
  const stave = staveBoundsPx(gm);
  if (stave) return stave;
  const absX = readAbsX(gm);
  if (absX == null) return null;
  const w = allocatedMeasureWidthOsmd(gm, nextGm);
  if (w <= 0.5) return null;
  return { left: absX * scale, right: (absX + w) * scale };
}

function readSvgTranslateX(el: Element): number {
  const tr = el.getAttribute('transform') ?? '';
  const m = /translate\(\s*([-\d.]+)/.exec(tr);
  return m ? parseFloat(m[1]!) : 0;
}

function applySvgTranslateXDelta(el: Element, dx: number): void {
  if (!Number.isFinite(dx) || Math.abs(dx) < 0.5) return;
  const tr = el.getAttribute('transform') ?? '';
  const m = /translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/.exec(tr);
  const ox = m ? parseFloat(m[1]!) : 0;
  const oy = m && m[2] != null ? parseFloat(m[2]!) : 0;
  const rest = tr.replace(/translate\(\s*[-\d.]+\s*(?:,\s*[-\d.]+)?\s*\)/, '').trim();
  const prefix = `translate(${ox + dx}, ${oy})`;
  el.setAttribute('transform', rest ? `${prefix} ${rest}` : prefix);
}

/** stavenote 글리프의 최소 x(기존 translate 반영). */
export function stavenoteContentMinX(stavenote: Element): number | null {
  let minX: number | null = null;
  for (const p of stavenote.querySelectorAll('path')) {
    const d = p.getAttribute('d') || '';
    const re = /[MmLl]\s*([-\d.]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(d))) {
      const x = parseFloat(m[1]!);
      if (!Number.isFinite(x)) continue;
      minX = minX == null ? x : Math.min(minX, x);
    }
  }
  if (minX == null) return null;
  return minX + readSvgTranslateX(stavenote);
}

/**
 * clip만 하면 칸 밖 음표가 잘려 사라질 수 있음 → 할당 폭 안으로 translate.
 * 줄기·빔은 syncVfStemsAndBeamsAfterStavenoteAlign으로 맞춤.
 */
export function containOsmdMeasureNotesInAllocatedWidth(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
): void {
  if (!osmd.IsReadyToRender()) return;
  const zoom =
    typeof (osmd as { zoom?: number }).zoom === 'number' &&
    Number.isFinite((osmd as { zoom?: number }).zoom) &&
    ((osmd as { zoom?: number }).zoom as number) > 0
      ? ((osmd as { zoom?: number }).zoom as number)
      : 1;
  const scale = getOsmdUnitInPixels(osmd) * zoom;
  const edgePad = Math.max(4, scale * 0.4);

  forEachGraphicalMeasure(osmd, (gmRaw, _si, mi, row) => {
    const g = svgGElement(gmRaw);
    if (!g) return;
    const bounds = measureBoundsPx(gmRaw, row[mi + 1], scale, osmd);
    if (!bounds) return;
    const left = bounds.left + edgePad;
    const right = bounds.right - edgePad;
    if (right - left < 8) return;

    // duration 배치가 만든 상대 간격 유지 — 칸 밖만 평행 이동(한쪽으로 몰아 떡 만들지 않음)
    const notes = [...g.querySelectorAll('.vf-stavenote')];
    let minX = Infinity;
    let maxX = -Infinity;
    const xs: { el: Element; x: number }[] = [];
    for (const note of notes) {
      const x = stavenoteContentMinX(note);
      if (x == null) continue;
      xs.push({ el: note, x });
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
    if (!xs.length || !Number.isFinite(minX) || !Number.isFinite(maxX)) return;
    let dx = 0;
    if (minX < left) dx = left - minX;
    else if (maxX > right) dx = right - maxX;
    // 폭이 칸보다 넓으면 균등 스케일 대신 왼쪽에 맞추고 오른쪽 spill은 clip에 맡김
    if (maxX + dx - (minX + dx) > right - left + 1 && minX + dx < left) {
      dx = left - minX;
    }
    if (Math.abs(dx) >= 0.5) {
      for (const n of xs) applySvgTranslateXDelta(n.el, dx);
    }
  });

  // contain 이동 유무와 관계없이 빔을 줄기 끝에 맞춤(앞으로 삐져나옴·이탈 방지)
  syncVfStemsAndBeamsAfterStavenoteAlign(host);
}

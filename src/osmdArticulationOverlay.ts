/**
 * HITL articulation placement — OSMD/VexFlow는 default-y를 무시하므로
 * 네이티브 글리프 path를 표별로 옮기거나(우선), path 좌표 기준 SVG text overlay.
 */
const OVERLAY_ATTR = 'data-hitl-art-overlay';
const HIDDEN_ATTR = 'data-hitl-art-hidden';

export const HITL_ART_OVERLAY_GLYPH: Record<string, string> = {
  accent: '>',
  'strong-accent': '^',
  marcato: '^',
  staccato: '·',
  staccatissimo: '▾',
  tenuto: '–',
  'detached-legato': '–·',
  spiccato: '·',
  'breath-mark': ',',
  caesura: '//',
};

export type HitlArtOverlaySpec = {
  tag: string;
  placement: 'above' | 'below';
  staffSpaces: number;
  glyph: string;
};

/**
 * 같은 쪽 표가 같은 칸이거나 1칸만 차이나면 +2씩 벌림.
 * OSMD 네이티브 스택(~1칸≈10px)과 구분되지 않는 간격은 “차이 없음”으로 보이므로 최소 2칸 간격을 보장.
 */
export function stackOverlayArtSpaces(specs: HitlArtOverlaySpec[]): HitlArtOverlaySpec[] {
  const usedBySide = new Map<string, Set<number>>();
  return specs.map((s) => {
    let spaces = Math.max(1, Math.round(s.staffSpaces));
    const used = usedBySide.get(s.placement) ?? new Set<number>();
    usedBySide.set(s.placement, used);
    const conflicts = (n: number) => used.has(n) || used.has(n - 1) || used.has(n + 1);
    while (conflicts(spaces)) spaces += 2;
    if (spaces > 10) spaces = 10;
    used.add(spaces);
    return { ...s, staffSpaces: spaces };
  });
}

export function clearHitlArticulationOverlays(host: HTMLElement): void {
  for (const el of [...host.querySelectorAll(`[${OVERLAY_ATTR}]`)]) el.remove();
  for (const el of [...host.querySelectorAll(`[${HIDDEN_ATTR}]`)]) {
    el.removeAttribute(HIDDEN_ATTR);
    const sty = (el as SVGElement & { style?: CSSStyleDeclaration }).style;
    if (sty?.removeProperty) {
      sty.removeProperty('opacity');
    } else {
      el.removeAttribute('opacity');
    }
  }
}

function hideArticulationGlyphEl(p: Element): void {
  p.setAttribute(HIDDEN_ATTR, '1');
  const sty = (p as SVGElement & { style?: CSSStyleDeclaration }).style;
  if (sty?.setProperty) sty.setProperty('opacity', '0');
  else p.setAttribute('opacity', '0');
}

/** VexFlow duration Dot — `.vf-dot` 클래스가 없어도 작은 원(A2 2)로 그려진다. */
export function isDurationDotGlyphPath(d: string): boolean {
  return /A\s*2(?:\.0+)?\s+2(?:\.0+)?/i.test(d) && (d.match(/A/gi) ?? []).length <= 2;
}

export function hideNativeArticulationGlyphs(staveNoteSvg: Element): number {
  let n = 0;
  for (const mod of staveNoteSvg.querySelectorAll('.vf-modifiers')) {
    if (mod.classList?.contains?.('vf-dot') || mod.classList?.contains?.('vf-dots')) continue;
    if (/\bvf-dot/.test(mod.getAttribute('class') || '')) continue;
    for (const p of mod.querySelectorAll(':scope > path, :scope > text, :scope > use')) {
      if (p.closest('.vf-note, .vf-notehead, .vf-ledgers, .vf-stavetie, .vf-beam, .vf-accidental, .vf-dot, .vf-dots')) {
        continue;
      }
      if (isDurationDotGlyphPath(p.getAttribute('d') || '')) continue;
      hideArticulationGlyphEl(p);
      n += 1;
    }
  }
  return n;
}

/** XML에 없는 표만 숨김 — 뒤 음에 OSMD가 붙인 유령 accent 등. */
export function hideArticulationGlyphElements(els: Element[]): number {
  let n = 0;
  for (const p of els) {
    if (!p) continue;
    if (p.classList?.contains?.('vf-modifiers') || /\bvf-modifiers\b/.test(p.getAttribute('class') || '')) {
      for (const child of p.querySelectorAll(':scope > path, :scope > text, :scope > use')) {
        if (isDurationDotGlyphPath(child.getAttribute('d') || '')) continue;
        hideArticulationGlyphEl(child);
        n += 1;
      }
      continue;
    }
    if (isDurationDotGlyphPath(p.getAttribute('d') || '')) continue;
    hideArticulationGlyphEl(p);
    n += 1;
  }
  return n;
}

/** VexFlow path `d`의 첫 M x,y — getBBox/CTM 없이도 OSMD 절대 좌표 */
export function pathStartXY(el: Element): { x: number; y: number } | null {
  const d = el.getAttribute('d') || '';
  const m = /M\s*([-\d.eE]+)(?:[\s,]+([-\d.eE]+))?/.exec(d);
  if (!m) return null;
  const x = parseFloat(m[1]!);
  const y = parseFloat(m[2] ?? '0');
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/** 거리 N칸 = notehead에서 N×staffSpace (절대 Y) */
export function overlayArticulationY(
  noteHeadY: number,
  staffSpaces: number,
  placement: 'above' | 'below',
  staffSpacePx: number,
): number {
  const gap = staffSpacePx > 2 ? staffSpacePx : 10;
  const spaces = Math.max(1, staffSpaces);
  const dir = placement === 'below' ? 1 : -1;
  return noteHeadY + dir * spaces * gap;
}

/**
 * notehead Y: VexFlow getYs → notehead path → articulation path로부터 추정.
 */
export function resolveNoteHeadY(
  staveNote: { getYs?: () => number[] } | null | undefined,
  staveNoteSvg: Element,
  artEls: Element[],
  placement: 'above' | 'below',
  staffSpacePx: number,
): number {
  // overlay는 SVG root에 그리므로 음표머리 path(같은 user space)를 우선.
  // Vex getYs는 오선 로컬(~30)이라 y≈20에 `>` 가 오선 복판에 붙는다.
  const nh =
    staveNoteSvg.querySelector('.vf-notehead path') ||
    staveNoteSvg.querySelector('.vf-notehead') ||
    staveNoteSvg.querySelector('.vf-note path');
  if (nh) {
    const p = pathStartXY(nh) ?? (() => {
      try {
        if (typeof (nh as SVGGraphicsElement).getBBox === 'function') {
          const b = (nh as SVGGraphicsElement).getBBox();
          if (b.width > 0 || b.height > 0) return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        }
      } catch {
        /* */
      }
      return null;
    })();
    if (p && Number.isFinite(p.y) && Math.abs(p.y) > 0.5) return p.y;
  }

  const ys = staveNote?.getYs?.();
  if (Array.isArray(ys) && ys.length && Number.isFinite(ys[0]) && Math.abs(ys[0]!) > 0.5) {
    return ys[0]!;
  }

  const coords = artEls.map(pathStartXY).filter(Boolean) as Array<{ x: number; y: number }>;
  const gap = staffSpacePx > 2 ? staffSpacePx : 10;
  if (coords.length) {
    // 표가 이미 1칸 근처에 있다고 보고 notehead 복원
    if (placement === 'above') return Math.max(...coords.map((c) => c.y)) + gap;
    return Math.min(...coords.map((c) => c.y)) - gap;
  }
  return 0;
}

export function resolveNoteHeadX(staveNoteSvg: Element, artEls: Element[]): number {
  // 음표머리 우선 — 표 path x를 쓰면 VexFlow가 오른쪽(다음 음)에 둔 유령 위치를 그대로 씀
  const nh =
    staveNoteSvg.querySelector('.vf-notehead path') ||
    staveNoteSvg.querySelector('.vf-note path') ||
    staveNoteSvg.querySelector('.vf-notehead');
  if (nh) {
    const p = pathStartXY(nh);
    if (p) return p.x;
  }
  for (const el of artEls) {
    const p = pathStartXY(el);
    if (p) return p.x;
  }
  return 0;
}

export function paintHitlArticulationOverlayTexts(
  svg: SVGSVGElement,
  specs: Array<HitlArtOverlaySpec & { x: number; noteHeadY: number }>,
  staffSpacePx: number,
): number {
  const ns = svg.namespaceURI || 'http://www.w3.org/2000/svg';
  const gap = staffSpacePx > 2 ? staffSpacePx : 10;
  let n = 0;
  for (const s of stackOverlayArtSpaces(specs)) {
    const y = overlayArticulationY(s.noteHeadY, s.staffSpaces, s.placement, gap);
    const text = svg.ownerDocument!.createElementNS(ns, 'text');
    text.setAttribute(OVERLAY_ATTR, s.tag);
    text.setAttribute('data-hitl-art-tag', s.tag);
    text.setAttribute('x', String(s.x));
    text.setAttribute('y', String(y));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('font-size', String(Math.max(12, gap * 1.4)));
    text.setAttribute('font-weight', 'bold');
    text.setAttribute('fill', '#111');
    text.setAttribute('data-art-shift-y', String(Math.abs(y - s.noteHeadY)));
    text.setAttribute('data-art-spaces', String(s.staffSpaces));
    text.textContent = s.glyph;
    svg.appendChild(text);
    n += 1;
  }
  return n;
}

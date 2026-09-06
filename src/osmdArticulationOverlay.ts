/**
 * HITL articulation overlays — OSMD/VexFlow 표 위치를 숨기고 SVG text로 표별 거리 배치.
 * (복수 표·거리 조절이 VexFlow modifier 매칭에 의존하지 않도록)
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

/** 같은 쪽 표가 같은 칸이면 +1씩 쌓음 */
export function stackOverlayArtSpaces(specs: HitlArtOverlaySpec[]): HitlArtOverlaySpec[] {
  const used = new Set<string>();
  return specs.map((s) => {
    let spaces = Math.max(1, Math.round(s.staffSpaces));
    const key = (n: number) => `${s.placement}:${n}`;
    while (used.has(key(spaces))) spaces += 1;
    if (spaces > 10) spaces = 10;
    used.add(key(spaces));
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

export function hideNativeArticulationGlyphs(staveNoteSvg: Element): number {
  let n = 0;
  for (const mod of staveNoteSvg.querySelectorAll('.vf-modifiers')) {
    for (const p of mod.querySelectorAll(':scope > path, :scope > text, :scope > use')) {
      if (p.closest('.vf-note, .vf-notehead, .vf-ledgers, .vf-stavetie, .vf-beam, .vf-accidental')) continue;
      p.setAttribute(HIDDEN_ATTR, '1');
      const sty = (p as SVGElement & { style?: CSSStyleDeclaration }).style;
      if (sty?.setProperty) sty.setProperty('opacity', '0');
      else p.setAttribute('opacity', '0');
      n += 1;
    }
  }
  return n;
}

/** notehead 중심을 루트 SVG 좌표로 */
export function noteHeadPointInSvg(staveNoteSvg: Element, svg: SVGSVGElement): { x: number; y: number } | null {
  const nh =
    staveNoteSvg.querySelector('.vf-notehead') ||
    staveNoteSvg.querySelector('.vf-note') ||
    staveNoteSvg;
  try {
    if (typeof (nh as SVGGraphicsElement).getBBox === 'function') {
      const b = (nh as SVGGraphicsElement).getBBox();
      if (Number.isFinite(b.x) && Number.isFinite(b.y) && (b.width > 0 || b.height > 0 || b.x !== 0 || b.y !== 0)) {
        const ctm = typeof (nh as SVGGraphicsElement).getCTM === 'function' ? (nh as SVGGraphicsElement).getCTM() : null;
        if (ctm && typeof svg.createSVGPoint === 'function') {
          const pt = svg.createSVGPoint();
          pt.x = b.x + b.width / 2;
          pt.y = b.y + b.height / 2;
          const p = pt.matrixTransform(ctm);
          if (Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x, y: p.y };
        }
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      }
    }
  } catch {
    /* jsdom */
  }
  const tf = nh.getAttribute('transform') || staveNoteSvg.getAttribute('transform') || '';
  const m = /translate\(\s*([-\d.eE]+)(?:[\s,]+([-\d.eE]+))?\s*\)/.exec(tf);
  if (m) {
    return { x: parseFloat(m[1]!), y: parseFloat(m[2] ?? '0') };
  }
  // jsdom: notehead bbox 없을 때 고정 앵커 — 표별 Δ만 검증
  return { x: 0, y: 0 };
}

/**
 * 거리 N칸 = notehead에서 N×staffSpace (절대 위치).
 * (기존 VexFlow 경로의 Δ=(N−1)×space 와 달리, 네이티브 1칸 기본 위치를 대체한다.)
 */
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

export function paintHitlArticulationOverlayTexts(
  svg: SVGSVGElement,
  specs: Array<HitlArtOverlaySpec & { x: number; noteHeadY: number }>,
  staffSpacePx: number,
): number {
  const ns = svg.namespaceURI || 'http://www.w3.org/2000/svg';
  const gap = staffSpacePx > 2 ? staffSpacePx : 10;
  let n = 0;
  // 호출측에서 이미 stack 했을 수 있음 — 한 번 더 해도 idempotent
  for (const s of stackOverlayArtSpaces(specs)) {
    const y = overlayArticulationY(s.noteHeadY, s.staffSpaces, s.placement, gap);
    const text = svg.ownerDocument!.createElementNS(ns, 'text');
    text.setAttribute(OVERLAY_ATTR, s.tag);
    text.setAttribute('x', String(s.x));
    text.setAttribute('y', String(y));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('font-size', String(Math.max(12, gap * 1.4)));
    text.setAttribute('font-weight', 'bold');
    text.setAttribute('fill', '#111');
    // 테스트·배너용: notehead 대비 절대 거리(px)
    text.setAttribute('data-art-shift-y', String(Math.abs(y - s.noteHeadY)));
    text.setAttribute('data-art-spaces', String(s.staffSpaces));
    text.textContent = s.glyph;
    svg.appendChild(text);
    n += 1;
  }
  return n;
}

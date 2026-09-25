import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

type NoteheadInfo = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  cy: number;
};

function ancestorTranslate(el: Element | null): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let cur: Element | null = el;
  while (cur && cur.tagName.toLowerCase() !== 'svg') {
    const tr = cur.getAttribute('transform') || '';
    const m = /translate\(\s*([-\d.eE+]+)(?:[\s,]+([-\d.eE+]+))?/.exec(tr);
    if (m) {
      x += parseFloat(m[1]!);
      y += m[2] != null ? parseFloat(m[2]!) : 0;
    }
    cur = cur.parentElement;
  }
  return { x, y };
}

function getNoteheadInfos(noteEl: Element): NoteheadInfo[] {
  const heads = noteEl.querySelectorAll('.vf-notehead');
  const out: NoteheadInfo[] = [];
  for (const h of heads) {
    const p = h.tagName.toLowerCase() === 'path' ? h : h.querySelector('path');
    if (!p) continue;
    const d = p.getAttribute('d') || '';
    const nums = [...d.matchAll(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)].map((m) => Number(m[0]));
    const t = ancestorTranslate(p);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < nums.length; i += 2) {
      if (Number.isFinite(nums[i])) xs.push(nums[i]! + t.x);
      if (Number.isFinite(nums[i + 1])) ys.push(nums[i + 1]! + t.y);
    }
    if (xs.length && ys.length) {
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      out.push({
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY,
        maxY,
        cy: (minY + maxY) / 2,
      });
    }
  }
  return out;
}

function findClosestNotehead(heads: NoteheadInfo[], y: number): NoteheadInfo | null {
  if (!heads.length) return null;
  let best = heads[0]!;
  let bestDist = Math.abs(best.cy - y);
  for (let i = 1; i < heads.length; i++) {
    const dist = Math.abs(heads[i]!.cy - y);
    if (dist < bestDist) {
      bestDist = dist;
      best = heads[i]!;
    }
  }
  return best;
}

function snapTiePathToNoteheads(
  tiePath: SVGPathElement,
  fnHeads: NoteheadInfo[],
  lnHeads: NoteheadInfo[],
): boolean {
  const d = tiePath.getAttribute('d') || '';
  // VexFlow tie path format:
  // M x_start y1 Q cpx1 cpy1, x_end y2 Q cpx2 cpy2, x_start y1 Z
  const m = /^\s*M\s*([-\d.]+)\s+([-\d.]+)\s*Q\s*([-\d.]+)\s+([-\d.]+)[,\s]+([-\d.]+)\s+([-\d.]+)\s*Q\s*([-\d.]+)\s+([-\d.]+)[,\s]+([-\d.]+)\s+([-\d.]+)\s*Z/i.exec(d);
  if (!m) return false;

  let x_start = parseFloat(m[1]!);
  const y1 = parseFloat(m[2]!);
  const cpy1 = m[4]!;
  let x_end = parseFloat(m[5]!);
  const y2 = parseFloat(m[6]!);
  const cpy2 = m[8]!;

  const tieTx = ancestorTranslate(tiePath).x;
  let abs_start = x_start + tieTx;
  let abs_end = x_end + tieTx;

  let changed = false;

  // 1) First note: tie start should be at or to the left of notehead right edge
  if (fnHeads.length > 0) {
    const head = findClosestNotehead(fnHeads, y1);
    if (head) {
      const targetStart = head.maxX;
      if (Math.abs(abs_start - targetStart) > 0.5) {
        abs_start = targetStart;
        changed = true;
      }
    }
  }

  // 2) Last note: tie end should be at or to the right of notehead left edge
  if (lnHeads.length > 0) {
    const head = findClosestNotehead(lnHeads, y2);
    if (head) {
      const targetEnd = head.minX;
      if (Math.abs(abs_end - targetEnd) > 0.5) {
        abs_end = targetEnd;
        changed = true;
      }
    }
  }

  if (!changed) return false;
  if (abs_start >= abs_end - 2) return false;

  x_start = abs_start - tieTx;
  x_end = abs_end - tieTx;
  const newCpX = (x_start + x_end) / 2;

  const newD = `M${x_start} ${m[2]}Q${newCpX} ${cpy1},${x_end} ${m[6]}Q${newCpX} ${cpy2},${x_start} ${m[2]}Z`;
  tiePath.setAttribute('d', newD);
  tiePath.setAttribute('data-hitl-tie-snapped', '1');
  return true;
}

/**
 * onset alignment 등으로 음표 위치(stavenote)가 평행 이동되었을 때,
 * 붙임줄(StaveTie)의 시작점과 끝점을 음표 머리 경계에 완벽히 동기화.
 * - 첫 음 머리 오른쪽 끝(maxX)과 붙임줄 시작 X가 일치하도록 연결 (간격 분리 해소)
 * - 끝 음 머리 왼쪽 끝(minX)과 붙임줄 끝 X가 일치하도록 연결
 */
export function snapOsmdTiesToNoteheads(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
): number {
  const sheet = (osmd as unknown as { GraphicSheet?: { MeasureList?: unknown[][] } }).GraphicSheet;
  if (!sheet?.MeasureList) return 0;

  let snapped = 0;
  for (const row of sheet.MeasureList) {
    for (const gm of row as Array<{ vfTies?: Array<{ first_note?: unknown; last_note?: unknown; attrs?: { el?: Element } }> }>) {
      if (!gm?.vfTies) continue;
      for (const vfTie of gm.vfTies) {
        const fn = vfTie.first_note as Record<string, unknown> | undefined;
        const ln = vfTie.last_note as Record<string, unknown> | undefined;
        if (!fn && !ln) continue;

        const fnAttrs = fn?.attrs as Record<string, unknown> | undefined;
        const lnAttrs = ln?.attrs as Record<string, unknown> | undefined;

        const fnId = (fnAttrs?.id ?? (typeof fn?.getAttribute === 'function' ? (fn.getAttribute as (k: string) => string)('id') : '')) as string;
        const lnId = (lnAttrs?.id ?? (typeof ln?.getAttribute === 'function' ? (ln.getAttribute as (k: string) => string)('id') : '')) as string;

        const fnEl = (fnAttrs?.el as Element | undefined) ?? (fnId ? host.querySelector(`#vf-${fnId}`) : null);
        const lnEl = (lnAttrs?.el as Element | undefined) ?? (lnId ? host.querySelector(`#vf-${lnId}`) : null);

        const fnHeads = fnEl ? getNoteheadInfos(fnEl) : [];
        const lnHeads = lnEl ? getNoteheadInfos(lnEl) : [];

        const tieGroup = (vfTie.attrs?.el as Element | undefined) ?? (fnId ? host.querySelector(`#vf-${fnId}-tie`) : null);
        if (!tieGroup) continue;

        const tiePaths = tieGroup.querySelectorAll('path');
        for (const tp of tiePaths) {
          if (snapTiePathToNoteheads(tp as SVGPathElement, fnHeads, lnHeads)) {
            snapped += 1;
          }
        }
      }
    }
  }
  return snapped;
}

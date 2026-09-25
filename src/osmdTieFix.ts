import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { getOsmdPreviewXml } from './osmdOnsetColumnAlignFix';
import { partIdFromGraphic, forEachGraphicalMeasure } from './osmdMeasureClick';
import { osmdGraphicalMeasureSvgG } from './osmdMeasureTimingWarning';
import { parseMusicXmlDocument } from '../shared/musicXmlParse';

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

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

/**
 * 미리보기 화면이 마디/시스템 단위로 분할되었을 때,
 * 구간 경계를 넘는 붙임줄(Tie)의 미연결 시작점(Start)과 끝점(Stop)에 대해
 * 양쪽 화면에 반쪽짜리 붙임줄 스텁(Tie Stub)을 렌더링.
 * - Outgoing Stub: 이전 마디 끝 음표에서 오른쪽 마디선 방향으로 뻗어나가는 곡선
 * - Incoming Stub: 다음 마디 첫 음표로 왼쪽(조표/음자리표 방향)에서 들어오는 곡선
 */
export function renderOsmdTieStubs(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  explicitXml?: string | null,
): number {
  host.querySelectorAll('[data-hitl-tie-stub]').forEach((el) => el.remove());

  const rawXml = explicitXml ?? getOsmdPreviewXml(osmd);
  if (!rawXml) return 0;
  const xmlDoc = parseMusicXmlDocument(rawXml);
  if (!xmlDoc) return 0;

  // 1) XML 전체에서 각 파트/성부별 비-쉼표 음표를 순서대로 수집
  const xmlNotesByPartVoice = new Map<
    string,
    Array<{
      el: Element;
      pitch: string;
      hasStart: boolean;
      hasStop: boolean;
      placement?: string | null;
      stem?: string | null;
    }>
  >();

  for (const part of xmlDoc.querySelectorAll('part')) {
    const pid = part.getAttribute('id') || '';
    for (const m of part.querySelectorAll('measure')) {
      for (const n of m.querySelectorAll('note')) {
        if (n.querySelector('rest')) continue;
        const v = n.querySelector('voice')?.textContent?.trim() || '1';
        const key = `${pid}|${v}`;
        if (!xmlNotesByPartVoice.has(key)) xmlNotesByPartVoice.set(key, []);

        const step = n.querySelector('step')?.textContent?.trim() || '';
        const oct = n.querySelector('octave')?.textContent?.trim() || '';
        const alter = n.querySelector('alter')?.textContent?.trim() || '';
        const pitch = `${step}${alter}${oct}`;

        const startEl = n.querySelector('tie[type="start"], tied[type="start"]');
        const stopEl = n.querySelector('tie[type="stop"], tied[type="stop"]');
        const hasStart = !!startEl;
        const hasStop = !!stopEl;

        const placement =
          (startEl || stopEl)?.getAttribute('placement') ||
          (startEl || stopEl)?.getAttribute('orientation');
        const stem = n.querySelector('stem')?.textContent?.trim();

        xmlNotesByPartVoice.get(key)!.push({
          el: n,
          pitch,
          hasStart,
          hasStop,
          placement,
          stem,
        });
      }
    }
  }

  // 2) 현재 미리보기 범위 내에서 같은 파트/성부/음고의 start-stop 쌍을 큐로 매칭하여,
  //    구간 밖으로 나가는 미완결 시작점(unpairedStarts)과
  //    구간 밖에서 들어오는 미완결 끝점(unpairedStops)을 선별
  const unpairedStarts = new Set<Element>();
  const unpairedStops = new Set<Element>();

  for (const notes of xmlNotesByPartVoice.values()) {
    const openTies = new Map<string, Element[]>();
    for (const note of notes) {
      if (note.hasStop) {
        const queue = openTies.get(note.pitch);
        if (queue && queue.length > 0) {
          queue.shift(); // 현재 뷰 내에서 완결된 붙임줄
        } else {
          unpairedStops.add(note.el);
        }
      }
      if (note.hasStart) {
        if (!openTies.has(note.pitch)) openTies.set(note.pitch, []);
        openTies.get(note.pitch)!.push(note.el);
      }
    }
    for (const queue of openTies.values()) {
      for (const el of queue) {
        unpairedStarts.add(el);
      }
    }
  }

  if (unpairedStarts.size === 0 && unpairedStops.size === 0) return 0;

  // 3) OSMD 그래픽 트리에서 각 파트/성부별 GraphicalNote 수집
  const osmdNotesByPartVoice = new Map<
    string,
    Array<{ gn: unknown; gm: unknown; gve: unknown }>
  >();

  forEachGraphicalMeasure(osmd, (gm) => {
    const pid = partIdFromGraphic(gm);
    if (!pid) return;
    const rec = gm as Record<string, unknown>;
    const staffEntries = (rec.staffEntries ?? rec.StaffEntries ?? []) as unknown[];
    for (const seRaw of staffEntries) {
      const se = seRaw as Record<string, unknown>;
      const gves = (se?.graphicalVoiceEntries ?? se?.GraphicalVoiceEntries ?? []) as unknown[];
      for (const gveRaw of gves) {
        const gve = gveRaw as Record<string, unknown>;
        const notes = (gve?.notes ?? gve?.Notes ?? []) as unknown[];
        for (const gnRaw of notes) {
          const gn = gnRaw as Record<string, unknown>;
          const sn = gn?.sourceNote as Record<string, unknown> | undefined;
          if (!sn || sn.isRestFlag) continue;
          const ve = sn.voiceEntry as Record<string, unknown> | undefined;
          const pv = ve?.parentVoice as Record<string, unknown> | undefined;
          const v = String(pv?.voiceId ?? pv?.VoiceId ?? '1');
          const key = `${pid}|${v}`;
          if (!osmdNotesByPartVoice.has(key)) osmdNotesByPartVoice.set(key, []);
          osmdNotesByPartVoice.get(key)!.push({ gn, gm, gve });
        }
      }
    }
  });

  let stubCount = 0;

  // 4) 각 미완결 붙임줄에 대해 SVG 스텁 생성
  for (const [key, xNotes] of xmlNotesByPartVoice.entries()) {
    const oNotes = osmdNotesByPartVoice.get(key);
    if (!oNotes || oNotes.length === 0) continue;

    for (let i = 0; i < Math.min(xNotes.length, oNotes.length); i++) {
      const xn = xNotes[i]!;
      const isStart = unpairedStarts.has(xn.el);
      const isStop = unpairedStops.has(xn.el);
      if (!isStart && !isStop) continue;

      const { gn, gm, gve } = oNotes[i]!;
      const measureG = osmdGraphicalMeasureSvgG(gm);
      if (!measureG) continue;

      const gveRec = gve as Record<string, unknown>;
      const vfNotes = gveRec.vfNotes ?? gveRec.VFNotes;
      const vfNote =
        (gveRec.mVexFlowStaveNote ??
          gveRec.vfStaveNote ??
          (Array.isArray(vfNotes) ? vfNotes[0] : null)) as Record<string, unknown> | null;
      if (!vfNote) continue;

      const vfAttrs = vfNote.attrs as Record<string, unknown> | undefined;
      const vfId =
        (vfAttrs?.id ?? (typeof vfNote.getAttribute === 'function' ? (vfNote.getAttribute as (k: string) => string)('id') : '')) as string;
      const noteEl = (vfAttrs?.el as Element | undefined) ?? (vfId ? host.querySelector(`#vf-${vfId}`) : null);
      if (!noteEl) continue;

      const allHeads = getNoteheadInfos(noteEl);
      if (!allHeads.length) continue;

      // 화음인 경우 해당 음표의 Y좌표와 가장 가까운 머리 선택
      const gnRec = gn as Record<string, unknown>;
      const pas = asRecord(gnRec.PositionAndShape ?? gnRec.positionAndShape);
      const absPos = asRecord(pas?.AbsolutePosition ?? pas?.absolutePosition);
      const gnY = Number(absPos?.y ?? absPos?.Y);
      const head = Number.isFinite(gnY) ? findClosestNotehead(allHeads, gnY) ?? allHeads[0]! : allHeads[0]!;

      // measureG 기준 로컬 좌표 계산
      const mTx = ancestorTranslate(measureG);
      const localMinX = head.minX - mTx.x;
      const localMaxX = head.maxX - mTx.x;
      const localMinY = head.minY - mTx.y;
      const localMaxY = head.maxY - mTx.y;

      const isBelow =
        xn.placement === 'below' ||
        xn.placement === 'under' ||
        (!xn.placement && xn.stem === 'up');
      const dir = isBelow ? 1 : -1;

      const len = 22;
      const dip = 4.5;
      const thickness = 2.5;

      if (isStart) {
        // Outgoing Stub: 음표 머리 오른쪽 끝에서 오른쪽으로 뻗어나감
        const x1 = localMaxX;
        const x2 = x1 + len;
        const y1 = isBelow ? localMaxY + 1 : localMinY - 1;
        const y2 = y1 + dir * 2;
        const cpx = (x1 + x2) / 2;
        const cpy1 = y1 + dir * dip;
        const cpy2 = y1 + dir * (dip + thickness);
        const d = `M ${x1.toFixed(2)} ${y1.toFixed(2)} Q ${cpx.toFixed(2)} ${cpy1.toFixed(2)}, ${x2.toFixed(2)} ${y2.toFixed(2)} Q ${cpx.toFixed(2)} ${cpy2.toFixed(2)}, ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'vf-stavetie vf-tie-stub vf-tie-stub-outgoing');
        g.setAttribute('data-hitl-tie-stub', '1');
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', d);
        p.setAttribute('fill', '#000000');
        p.setAttribute('stroke', 'none');
        g.appendChild(p);
        measureG.appendChild(g);
        stubCount += 1;
      }

      if (isStop) {
        // Incoming Stub: 왼쪽에서 들어와 음표 머리 왼쪽 끝에 도착
        const x2 = localMinX;
        const x1 = x2 - len;
        const y2 = isBelow ? localMaxY + 1 : localMinY - 1;
        const y1 = y2 + dir * 2;
        const cpx = (x1 + x2) / 2;
        const cpy1 = y2 + dir * dip;
        const cpy2 = y2 + dir * (dip + thickness);
        const d = `M ${x1.toFixed(2)} ${y1.toFixed(2)} Q ${cpx.toFixed(2)} ${cpy1.toFixed(2)}, ${x2.toFixed(2)} ${y2.toFixed(2)} Q ${cpx.toFixed(2)} ${cpy2.toFixed(2)}, ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'vf-stavetie vf-tie-stub vf-tie-stub-incoming');
        g.setAttribute('data-hitl-tie-stub', '1');
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', d);
        p.setAttribute('fill', '#000000');
        p.setAttribute('stroke', 'none');
        g.appendChild(p);
        measureG.appendChild(g);
        stubCount += 1;
      }
    }
  }

  return stubCount;
}


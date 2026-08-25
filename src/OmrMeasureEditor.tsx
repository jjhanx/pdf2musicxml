import { useCallback, useEffect, useMemo, useState } from 'react';
import { articulationDistanceSelectValue, hitlPreviewPartIdsMatch } from '../shared/musicXmlArticulationDistance';
import { isNavigationDirectionType, navigationDirectionLabel, newFixId, type OmrHitlFix } from './omrHitlFixes';
import {
  PitchAlterSelect,
  formatPitchLabel,
  pitchAlterFromOption,
  pitchAlterToOption,
  type PitchAlterOption,
} from './omrPitchUi';

type FixPartial = Omit<OmrHitlFix, 'id' | 'partId' | 'measureMxl'> & { measureMxl?: string };

const NOTE_TYPES = ['whole', 'half', 'quarter', 'eighth', '16th', '32nd'] as const;
const GRACE_NOTE_TYPES = ['eighth', '16th', '32nd'] as const;
const PITCH_STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

type NoteTypeOption = { value: string; type: string; dots: number; label: string };

const NOTE_TYPE_LABELS: Record<string, string> = {
  whole: '온음표',
  half: '2분음표',
  quarter: '4분음표',
  eighth: '8분음표',
  '16th': '16분음표',
  '32nd': '32분음표',
};

const NOTE_TYPE_OPTIONS: NoteTypeOption[] = [
  ...NOTE_TYPES.flatMap((t) => [
    { value: `${t}:0`, type: t, dots: 0, label: NOTE_TYPE_LABELS[t] ?? t },
    {
      value: `${t}:1`,
      type: t,
      dots: 1,
      label: `${NOTE_TYPE_LABELS[t] ?? t} · (점)`,
    },
  ]),
];

function noteTypeValue(type: string, dots: number): string {
  return `${type}:${dots}`;
}

function parseNoteTypeValue(value: string): { type: string; dots: number } {
  const [type, dotsRaw] = value.split(':');
  const dots = dotsRaw === '1' ? 1 : 0;
  return { type: type || 'quarter', dots };
}

function tripletRangeFor(el: MeasureNoteEl, noteEls: MeasureNoteEl[]): { from: number; to: number } {
  const sorted = [...noteEls].sort((a, b) => a.index - b.index);
  const leaderIdx = chordLeaderIndex(el, sorted);
  const leader = sorted.find((n) => n.index === leaderIdx) ?? el;
  const rhythmic = sorted.filter(isRhythmicSlice);
  const pos = rhythmic.findIndex((n) => n.index === leaderIdx);
  if (pos < 0) return { from: leaderIdx, to: leaderIdx };

  const hasTuplet =
    Boolean(leader.timeMod) ||
    leader.tuplet === 'start' ||
    leader.tuplet === 'stop' ||
    Boolean(el.timeMod) ||
    el.tuplet === 'start' ||
    el.tuplet === 'stop';
  if (!hasTuplet) return { from: leaderIdx, to: leaderIdx };

  let start = pos;
  while (start > 0) {
    const prev = rhythmic[start - 1];
    if (leader.timeMod && prev.timeMod === leader.timeMod) {
      start -= 1;
      continue;
    }
    if (leader.tuplet && (prev.tuplet === 'start' || prev.tuplet === 'stop' || prev.timeMod)) {
      start -= 1;
      continue;
    }
    break;
  }
  let end = pos;
  while (end + 1 < rhythmic.length) {
    const next = rhythmic[end + 1];
    if (leader.timeMod && next.timeMod === leader.timeMod) {
      end += 1;
      continue;
    }
    if (leader.tuplet && (next.tuplet === 'stop' || next.tuplet === 'start' || next.timeMod)) {
      end += 1;
      continue;
    }
    break;
  }
  return { from: rhythmic[start].index, to: rhythmic[end].index };
}

const SHORT_BEAM_TYPES = new Set(['eighth', '16th', '32nd', '64th', '128th', '256th']);

function isBeamableNoteEl(n: MeasureNoteEl): boolean {
  if (n.isCue) return false;
  if (n.kind !== 'note' || n.chord) return false;
  return SHORT_BEAM_TYPES.has(n.type ?? '');
}

const DYNAMICS_DIRECTION_VALUES = ['p', 'pp', 'mp', 'mf', 'f', 'ff', 'sf', 'sfz'] as const;

const ARTICULATION_ADD_OPTIONS: { id: string; label: string }[] = [
  { id: 'accent', label: 'Accent (>)' },
  { id: 'strong-accent', label: 'Strong accent (^)' },
  { id: 'staccato', label: 'Staccato (.)' },
  { id: 'tenuto', label: 'Tenuto (-)' },
  { id: 'marcato', label: 'Marcato (^)' },
  { id: 'staccatissimo', label: 'Staccatissimo (▾)' },
  { id: 'breath-mark', label: '숨표 (쉼표 모양 , / Breath mark)' },
  { id: 'caesura', label: '카에수라 (// / Caesura)' },
  { id: 'detached-legato', label: 'Detached legato' },
  { id: 'spiccato', label: 'Spiccato' },
];

function articulationOptionLabel(id: string): string {
  const base = id.split('(')[0].trim().toLowerCase();
  return ARTICULATION_ADD_OPTIONS.find((o) => o.id === base)?.label ?? id;
}

const ORNAMENT_ADD_OPTIONS: { id: string; label: string }[] = [
  { id: 'inverted-mordent', label: 'Inverted mordent (짧은 지그재그, 윗모르덴트)' },
  { id: 'mordent', label: 'Mordent (모르덴트)' },
  { id: 'trill-mark', label: 'Trill (트릴)' },
  { id: 'turn', label: 'Turn (턴)' },
  { id: 'inverted-turn', label: 'Inverted turn' },
  { id: 'delayed-turn', label: 'Delayed turn' },
  { id: 'shake', label: 'Shake' },
];

function ornamentOptionLabel(id: string): string {
  const base = id.split(':')[0];
  return ORNAMENT_ADD_OPTIONS.find((o) => o.id === base)?.label ?? id;
}

function ornamentIdsFromEl(orns: string[] | undefined): string[] {
  return (orns ?? []).map((a) => a.split('(')[0]);
}

function articulationIdsFromEl(arts: string[] | undefined): string[] {
  return (arts ?? []).map((a) => a.split('(')[0]);
}

function markPlacementOf(raw: string): 'above' | 'below' | null {
  if (/\(above/.test(raw)) return 'above';
  if (/\(below/.test(raw)) return 'below';
  return null;
}

function markDefaultYOf(raw: string): number | null {
  const m = raw.match(/y=(-?\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

function markDistanceLevelOf(raw: string): string {
  const distM = raw.match(/dist=([a-z0-9.-]+)/i);
  if (distM?.[1]) return distM[1]!.toLowerCase();
  const dy = markDefaultYOf(raw);
  return articulationDistanceSelectValue(null, dy);
}

const ARTICULATION_DISTANCE_OPTIONS: { value: string; label: string }[] = [
  { value: 'auto', label: '보통 (자동 / 1칸)' },
  { value: '1', label: '1칸 (기준)' },
  { value: '2', label: '2칸' },
  { value: '3', label: '3칸' },
  { value: '4', label: '4칸' },
  { value: '5', label: '5칸' },
  { value: '6', label: '6칸' },
  { value: '7', label: '7칸' },
  { value: '8', label: '8칸' },
  { value: '9', label: '9칸' },
  { value: '10', label: '10칸' },
];

function defaultArticulationPlacement(stem?: string | null): 'above' | 'below' {
  if (stem === 'up') return 'below';
  if (stem === 'down') return 'above';
  return 'above';
}

function placementKo(pl: 'above' | 'below' | null | undefined): string {
  if (pl === 'above') return '위';
  if (pl === 'below') return '아래';
  return '';
}

function isLikelySpuriousDirection(text: string | null | undefined): boolean {
  const compact = (text ?? '').replace(/\s+/g, '');
  if (!compact) return false;
  if (/^dyn:[pP]{1,3}$/.test(compact)) return true;
  if (/^[Pp]{1,3}$/.test(compact)) return true;
  if (compact === '9') return true;
  return false;
}

/** 세잇단·박자 slice — 화음 하위음·grace·cue 제외 */
function isRhythmicSlice(n: MeasureNoteEl): boolean {
  if (n.hasGrace || n.isCue) return false;
  return n.kind === 'rest' || (n.kind === 'note' && !n.chord);
}

function defaultTripletNormalType(el: MeasureNoteEl): string {
  const t = el.type ?? 'quarter';
  if (t === '32nd' || t === '64th') return '32nd';
  if (t === '16th') return '16th';
  if (t === 'quarter' || t === 'half' || t === 'whole') return t;
  return 'eighth';
}

function tripletNormalTypeLabel(normalType: string): string {
  switch (normalType) {
    case 'whole':
      return '온음표';
    case 'half':
      return '2분음표';
    case 'quarter':
      return '4분음표';
    case '16th':
      return '16분음표';
    case '32nd':
      return '32분음표';
    default:
      return '8분음표';
  }
}

const TRIPLET_TYPE_WEIGHT: Record<string, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  '16th': 0.25,
  '32nd': 0.125,
};

function noteTypeWeight(type: string | null | undefined, dotted = false): number {
  const base = TRIPLET_TYPE_WEIGHT[type ?? 'quarter'] ?? 1;
  return dotted ? base * 1.5 : base;
}

function rhythmicSlicesInRange(from: number, to: number, noteEls: MeasureNoteEl[]): MeasureNoteEl[] {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return noteEls.filter((n) => n.index >= lo && n.index <= hi && isRhythmicSlice(n));
}

function tripletRangeHasMixedTypes(from: number, to: number, noteEls: MeasureNoteEl[]): boolean {
  const slices = rhythmicSlicesInRange(from, to, noteEls);
  const types = new Set(slices.map((n) => n.type ?? 'quarter'));
  return types.size > 1;
}

function tripletSlotCount(from: number, to: number, noteEls: MeasureNoteEl[]): number {
  const slices = rhythmicSlicesInRange(from, to, noteEls);
  const sum = slices.reduce((acc, n) => acc + noteTypeWeight(n.type, n.isDotted), 0);
  return Math.max(2, Math.round(sum));
}

function smallestTripletNormalType(from: number, to: number, noteEls: MeasureNoteEl[]): string {
  const order = ['32nd', '64th', '16th', 'eighth', 'quarter', 'half', 'whole'];
  const rank = new Map(order.map((t, i) => [t, i]));
  let best = 'quarter';
  for (const n of rhythmicSlicesInRange(from, to, noteEls)) {
    const t = n.type ?? 'quarter';
    if ((rank.get(t) ?? 99) < (rank.get(best) ?? 99)) best = t;
  }
  return best;
}

function defaultTripletEndIndex(elIndex: number, noteEls: MeasureNoteEl[]): number {
  const startPos = noteEls.findIndex((n) => n.index === elIndex);
  if (startPos < 0) return elIndex;
  let count = 0;
  let endIdx = elIndex;
  for (let i = startPos; i < noteEls.length && count < 3; i++) {
    if (isRhythmicSlice(noteEls[i])) {
      count += 1;
      endIdx = noteEls[i].index;
    }
  }
  return endIdx;
}

function defaultBeamEndIndex(
  elIndex: number,
  noteEls: MeasureNoteEl[],
  el?: MeasureNoteEl,
): number {
  if (el?.beams?.length) {
    const { to } = beamLeaderRange(el, noteEls);
    if (to > elIndex) return to;
  }
  const startPos = noteEls.findIndex((n) => n.index === elIndex);
  if (startPos < 0) return elIndex;
  const isGrace = Boolean(el?.hasGrace);
  let count = 0;
  let endIdx = elIndex;
  for (let i = startPos; i < noteEls.length && count < 3; i++) {
    if (isBeamableNoteEl(noteEls[i]) && (el == null || Boolean(noteEls[i].hasGrace) === isGrace)) {
      count += 1;
      endIdx = noteEls[i].index;
    }
  }
  return endIdx;
}

function beamRangeFor(el: MeasureNoteEl, noteEls: MeasureNoteEl[]): { from: number; to: number } {
  if (!el.beams?.length) return { from: el.index, to: el.index };
  const pos = noteEls.findIndex((n) => n.index === el.index);
  if (pos < 0) return { from: el.index, to: el.index };
  let start = pos;
  while (start > 0) {
    const prev = noteEls[start - 1];
    if (prev.chord) {
      start -= 1;
      continue;
    }
    const b = prev.beams ?? [];
    if (b.includes('continue') || b.includes('begin')) start -= 1;
    else break;
  }
  let end = pos;
  while (end + 1 < noteEls.length) {
    const next = noteEls[end + 1];
    if (next.chord) {
      end += 1;
      continue;
    }
    const b = next.beams ?? [];
    if (b.includes('continue') || b.includes('end')) end += 1;
    else break;
  }
  return { from: noteEls[start].index, to: noteEls[end].index };
}

/** 빔 UI·해제용 — 화음(리더) 음표 인덱스만 (드롭다운 후보와 동일) */
function beamLeaderRange(el: MeasureNoteEl, noteEls: MeasureNoteEl[]): { from: number; to: number } {
  const span = beamRangeFor(el, noteEls);
  const isGrace = Boolean(el.hasGrace);
  const leaders = noteEls.filter(
    (n) => n.index >= span.from && n.index <= span.to && isBeamableNoteEl(n) && Boolean(n.hasGrace) === isGrace,
  );
  if (leaders.length === 0) return { from: el.index, to: el.index };
  return { from: leaders[0].index, to: leaders[leaders.length - 1].index };
}

function clampBeamEnd(elIndex: number, want: number, noteEls: MeasureNoteEl[], el?: MeasureNoteEl): number {
  const isGrace = Boolean(el?.hasGrace);
  const candidates = noteEls.filter(
    (n) => n.index >= elIndex && isBeamableNoteEl(n) && (el == null || (Boolean(n.hasGrace) === isGrace && (n.staff ?? 1) === (el.staff ?? 1))),
  ).slice(0, 8);
  if (candidates.length === 0) return elIndex;
  if (candidates.some((n) => n.index === want)) return want;
  if (el?.beams?.length) {
    const { to } = beamLeaderRange(el, noteEls);
    if (candidates.some((n) => n.index === to)) return to;
  }
  return candidates[Math.min(2, candidates.length - 1)].index;
}

function countBeamableInRange(from: number, to: number, noteEls: MeasureNoteEl[], isGrace?: boolean): number {
  return noteEls.filter(
    (n) => n.index >= from && n.index <= to && isBeamableNoteEl(n) && (isGrace === undefined || Boolean(n.hasGrace) === isGrace),
  ).length;
}

function countNotesInRange(from: number, to: number, noteEls: MeasureNoteEl[]): number {
  return noteEls.filter((n) => n.index >= from && n.index <= to && isRhythmicSlice(n)).length;
}

export type MeasureDirectionEl = {
  elementKind: 'direction';
  directionIndex: number;
  text: string;
  staff?: number | null;
  placement?: string | null;
  directionType?: string;
  directionValue?: string;
  distance?: string | null;
  defaultY?: number | null;
  /** `<notations><dynamics>` — 음표 #index에 붙음 */
  attachedToNoteIndex?: number;
  fromNoteDynamics?: boolean;
};

export type MeasureNoteEl = {
  elementKind: 'note';
  index: number;
  kind: 'rest' | 'note';
  type?: string | null;
  staff?: number | null;
  voice?: string | null;
  chord?: boolean;
  pitch?: string | null;
  pitchAlter?: number | null;
  displayStep?: string | null;
  displayOctave?: string | null;
  measureRest?: boolean;
  duration?: number | null;
  isDotted?: boolean;
  dotCount?: number;
  hasGrace?: boolean;
  isCue?: boolean;
  tieStart?: boolean;
  tieStop?: boolean;
  slurStart?: boolean;
  slurStop?: boolean;
  /** 이음줄 start placement (above|below) */
  slurStartPlacement?: 'above' | 'below' | null;
  /** 이음줄 stop placement (above|below) */
  slurStopPlacement?: 'above' | 'below' | null;
  beams?: string[];
  stem?: string | null;
  /** 잇단음표 비율 (예: "3:2" = 세잇단) */
  timeMod?: string | null;
  /** 잇단 괄호 시작/끝 ("start" | "stop") */
  tuplet?: string | null;
  /** 붙어 있는 articulation 목록 (예: "staccato(above)") */
  articulations?: string[];
  /** 꾸밈음 — inverted-mordent(지그재그) 등. 예: "inverted-mordent(above)" */
  ornaments?: string[];
  /** 늘임표 (예: "upright", "inverted(below)") */
  fermatas?: string[];
  graceSlash?: boolean | null;
  noteDirection?: NoteDirectionInfo | null;
  /** 동일 음표에 words + dynamics 등 복수 direction */
  noteDirections?: NoteDirectionInfo[] | null;
  /** HITL 명시 연주순번 (1-based). 없으면 자동. */
  playOrder?: number | null;
  /** voice timeline 기본 연주순번 — UI에는 document order만 표시 */
  defaultPlayOrder?: number | null;
  /** UI 표시용 — playOrder ?? defaultPlayOrder */
  displayPlayOrder?: number | null;
};

export type NoteDirectionInfo = {
  directionType: 'dynamics' | 'words' | 'rehearsal';
  directionValue: string;
  placement?: 'above' | 'below';
  distance?: string | null;
  defaultY?: number | null;
};

export type MeasureElement = MeasureNoteEl;

type MeasureSnapshot = {
  partId: string;
  measureMxl: string;
  elements?: MeasureElement[];
  notes?: MeasureNoteEl[];
  tempos?: MeasureTempoEntry[];
  measureDirections?: MeasureDirectionEl[];
  directionSourcePartId?: string;
  effectiveTempoBpm?: number | null;
  effectiveClef?: { sign?: string; line?: number };
};

type MeasureTempoEntry = {
  directionIndex: number;
  tempoBpm: number | null;
  beatUnit: string;
  label: string;
};

const BEAT_UNIT_OPTIONS = [
  { value: 'quarter', label: '4분음표(♩)' },
  { value: 'half', label: '2분음표(𝅗)' },
  { value: 'eighth', label: '8분음표(♪)' },
] as const;

const NAVIGATION_INSERT_OPTIONS = [
  { directionType: 'segno' as const, directionValue: '', label: 'Segno (𝄋)' },
  { directionType: 'coda' as const, directionValue: '', label: 'Coda (𝄌)' },
  { directionType: 'fine' as const, directionValue: '', label: 'Fine' },
  { directionType: 'dacapo' as const, directionValue: '', label: 'D.C. (Da Capo)' },
  { directionType: 'dalsegno' as const, directionValue: '', label: 'D.S.' },
  { directionType: 'tocoda' as const, directionValue: '', label: 'To Coda' },
  { directionType: 'words' as const, directionValue: 'D.S. al Fine', label: 'D.S. al Fine' },
  { directionType: 'words' as const, directionValue: 'D.C. al Fine', label: 'D.C. al Fine' },
  { directionType: 'words' as const, directionValue: 'D.S. al Coda', label: 'D.S. al Coda' },
  { directionType: 'words' as const, directionValue: 'D.C. al Coda', label: 'D.C. al Coda' },
];

function isNavigationDirection(d: MeasureDirectionEl): boolean {
  return isNavigationDirectionType(d.directionType, d.directionValue || d.text);
}

function isWedgeDirection(d: MeasureDirectionEl): boolean {
  const t = (d.directionType || '').trim().toLowerCase();
  if (t === 'wedge') return true;
  return /^wedge\(/i.test((d.text || d.directionValue || '').trim());
}

function wedgeTypeOf(d: MeasureDirectionEl): string {
  if ((d.directionType || '').trim().toLowerCase() === 'wedge') {
    return (d.directionValue || '').trim().toLowerCase();
  }
  const m = /wedge\(([^)]+)\)/i.exec((d.text || d.directionValue || '').trim());
  return (m?.[1] || '').trim().toLowerCase();
}

function wedgeDirectionLabel(d: MeasureDirectionEl): string {
  const v = wedgeTypeOf(d);
  if (v === 'crescendo') return 'crescendo (<)';
  if (v === 'diminuendo') return 'diminuendo (>)';
  if (v === 'stop') return 'stop (끝)';
  return d.text || v || 'wedge';
}

function MeasureNavigationEditor({
  directions,
  partStaveCount,
  editStaffWithinPart,
  insertStaff,
  onFix,
}: {
  directions: MeasureDirectionEl[];
  partStaveCount: number;
  editStaffWithinPart?: number | null;
  insertStaff: number;
  onFix: (partial: FixPartial) => void;
}) {
  const [navKind, setNavKind] = useState(0);
  const [measureAnchor, setMeasureAnchor] = useState<'start' | 'end'>('end');
  const [staff, setStaff] = useState(editStaffWithinPart ?? insertStaff ?? 1);
  const [placement, setPlacement] = useState<'above' | 'below'>('above');

  useEffect(() => {
    setStaff(editStaffWithinPart ?? insertStaff ?? 1);
  }, [editStaffWithinPart, insertStaff]);

  const selected = NAVIGATION_INSERT_OPTIONS[navKind] ?? NAVIGATION_INSERT_OPTIONS[0];

  useEffect(() => {
    const t = selected.directionType;
    // Segno·Coda 기호는 보통 마디 처음, To Coda·Fine·D.C./D.S.는 마디 끝
    if (t === 'segno' || t === 'coda') setMeasureAnchor('start');
    else setMeasureAnchor('end');
  }, [navKind, selected.directionType]);

  return (
    <div
      className="omr-measure-navigation-panel"
      style={{
        marginBottom: '0.85rem',
        padding: '0.65rem 0.75rem',
        background: '#eef7ff',
        borderRadius: 6,
        border: '1px solid #90caf9',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6 }}>진행 제어 (Segno·Coda·Fine 등)</div>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.86rem', lineHeight: 1.45, color: '#444' }}>
        OMR이 Segno(𝄋)를 <code>$5-f</code> 같은 OCR 찌끼로 오인한 경우, 위 「마디 텍스트」에서 삭제한 뒤 여기서{' '}
        <strong>올바른 기호를 추가</strong>하세요. 위치는 <strong>마디 처음</strong> 또는 <strong>마디 끝</strong>
        (대부분 위쪽에 표시).
      </p>
      {directions.length > 0 ? (
        <ul style={{ margin: '0 0 0.65rem', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {directions.map((d) => (
            <li
              key={`nav-${d.directionIndex}`}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'center',
                padding: '0.35rem 0',
                borderBottom: '1px solid #bbdefb',
              }}
            >
              <span style={{ fontSize: '0.82rem', color: '#666', minWidth: 72 }}>
                dir #{d.directionIndex}
                {d.staff != null ? ` · staff ${d.staff}` : ''}
              </span>
              <strong>{navigationDirectionLabel(d.directionType, d.directionValue || d.text)}</strong>
              <select
                value={d.placement || 'above'}
                onChange={(e) =>
                  onFix({
                    kind: 'setDirectionPlacement',
                    directionIndex: d.directionIndex,
                    placement: e.target.value as 'above' | 'below',
                  })
                }
                style={{ fontSize: '0.82rem', padding: '1px 4px' }}
                title="위치 (위/아래)"
              >
                <option value="above">위 (above)</option>
                <option value="below">아래 (below)</option>
              </select>
              <button
                type="button"
                className="omr-hitl-fix-btn"
                onClick={() =>
                  onFix({
                    kind: 'removeDirection',
                    directionIndex: d.directionIndex,
                  })
                }
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.86rem', color: '#555' }}>이 마디에 진행 제어 기호 없음</p>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <label className="omr-measure-inline-field">
          기호
          <select value={navKind} onChange={(e) => setNavKind(Number(e.target.value))} style={{ marginLeft: 4, minWidth: '10rem' }}>
            {NAVIGATION_INSERT_OPTIONS.map((o, i) => (
              <option key={`${o.directionType}-${o.directionValue}-${i}`} value={i}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="omr-measure-inline-field">
          위치
          <select
            value={measureAnchor}
            onChange={(e) => setMeasureAnchor(e.target.value as 'start' | 'end')}
            style={{ marginLeft: 4 }}
          >
            <option value="start">마디 처음</option>
            <option value="end">마디 끝</option>
          </select>
        </label>
        <label className="omr-measure-inline-field">
          위/아래
          <select
            value={placement}
            onChange={(e) => setPlacement(e.target.value as 'above' | 'below')}
            style={{ marginLeft: 4 }}
          >
            <option value="above">위 (above)</option>
            <option value="below">아래 (below)</option>
          </select>
        </label>
        {partStaveCount >= 2 && editStaffWithinPart == null ? (
          <label className="omr-measure-inline-field">
            staff
            <select value={String(staff)} onChange={(e) => setStaff(parseInt(e.target.value, 10) || 1)} style={{ marginLeft: 4 }}>
              <option value="1">staff 1 (PR)</option>
              <option value="2">staff 2 (PL)</option>
            </select>
          </label>
        ) : null}
        <button
          type="button"
          className="omr-hitl-fix-btn"
          onClick={() =>
            onFix({
              kind: 'insertDirection',
              directionType: selected.directionType,
              directionValue: selected.directionValue || undefined,
              measureAnchor,
              afterNoteIndex: measureAnchor === 'start' ? -1 : undefined,
              staff: editStaffWithinPart ?? staff,
              placement,
            })
          }
        >
          진행 제어 추가
        </button>
      </div>
    </div>
  );
}

function MeasureWedgeEditor({
  directions,
  noteEls,
  partStaveCount,
  editStaffWithinPart,
  insertStaff,
  onFix,
}: {
  directions: MeasureDirectionEl[];
  noteEls: MeasureNoteEl[];
  partStaveCount: number;
  editStaffWithinPart?: number | null;
  insertStaff: number;
  onFix: (partial: FixPartial) => void;
}) {
  const [wedgeKind, setWedgeKind] = useState<'crescendo' | 'diminuendo'>('crescendo');
  const [staff, setStaff] = useState(editStaffWithinPart ?? insertStaff ?? 1);
  const [placement, setPlacement] = useState<'above' | 'below'>('below');

  useEffect(() => {
    setStaff(editStaffWithinPart ?? insertStaff ?? 1);
  }, [editStaffWithinPart, insertStaff]);

  const staffNotes = noteEls.filter(
    (n) => isRhythmicSlice(n) && (editStaffWithinPart == null || (n.staff ?? 1) === staff),
  );
  const firstIdx = staffNotes[0]?.index ?? 0;
  const lastIdx = staffNotes[staffNotes.length - 1]?.index ?? firstIdx;
  const [fromNote, setFromNote] = useState(firstIdx);
  const [toNote, setToNote] = useState(lastIdx);
  const [stopNote, setStopNote] = useState(lastIdx);

  useEffect(() => {
    setFromNote(firstIdx);
    setToNote(lastIdx);
    setStopNote(lastIdx);
  }, [firstIdx, lastIdx, staff, noteEls.length]);

  const noteOptions = [
    ...staffNotes.map((n) => ({
      value: n.index,
      label: `#${n.index} ${noteAnchorLabel(n)}${n.type ? ` ${NOTE_TYPE_LABELS[n.type] ?? n.type}` : ''}`,
    })),
    { value: -1, label: '마디 끝 (마지막 음 뒤)' },
  ];

  return (
    <div
      className="omr-measure-wedge-panel"
      style={{
        marginBottom: '0.85rem',
        padding: '0.65rem 0.75rem',
        background: '#f3e5f5',
        borderRadius: 6,
        border: '1px solid #ce93d8',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6 }}>셈여림 점선 (wedge / hairpin)</div>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.86rem', lineHeight: 1.45, color: '#444' }}>
        크레센도 <code>&lt;</code> / 디미뉴엔도 <code>&gt;</code> 는{' '}
        <strong>시작 음 앞</strong>에 들어가고, <strong>끝 음 뒤</strong>에 wedge(stop)이 들어가 그 음까지
        덮습니다. 마지막 음으로 끝낼 때도 stop은 그 음 바로 뒤(backup 앞)에 두어 다음 마디로 이어지지 않게 합니다.
        {editStaffWithinPart != null ? (
          <>
            {' '}
            이 줄(staff {editStaffWithinPart})의 점선만 표시·추가·삭제합니다. PR과 PL은 서로 독립입니다.
          </>
        ) : partStaveCount >= 2 ? (
          <> staff를 고르면 PR(staff 1)·PL(staff 2)을 각각 설정할 수 있습니다.</>
        ) : null}
      </p>
      {directions.length > 0 ? (
        <ul style={{ margin: '0 0 0.65rem', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {directions.map((d) => (
            <li
              key={`wedge-${d.directionIndex}`}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'center',
                padding: '0.35rem 0',
                borderBottom: '1px solid #e1bee7',
              }}
            >
              <span style={{ fontSize: '0.82rem', color: '#666', minWidth: 72 }}>
                dir #{d.directionIndex}
                {d.staff != null ? ` · staff ${d.staff}` : ''}
              </span>
              <strong>{wedgeDirectionLabel(d)}</strong>
              <select
                value={d.placement || 'below'}
                onChange={(e) =>
                  onFix({
                    kind: 'setDirectionPlacement',
                    directionIndex: d.directionIndex,
                    placement: e.target.value as 'above' | 'below',
                  })
                }
                style={{ fontSize: '0.82rem', padding: '1px 4px' }}
                title="위치 (위/아래)"
              >
                <option value="below">아래 (below)</option>
                <option value="above">위 (above)</option>
              </select>
              <button
                type="button"
                className="omr-hitl-fix-btn"
                onClick={() =>
                  onFix({
                    kind: 'removeDirection',
                    directionIndex: d.directionIndex,
                  })
                }
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.86rem', color: '#555' }}>이 마디에 셈여림 점선 없음</p>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <label className="omr-measure-inline-field">
          종류
          <select
            value={wedgeKind}
            onChange={(e) => setWedgeKind(e.target.value as 'crescendo' | 'diminuendo')}
            style={{ marginLeft: 4 }}
          >
            <option value="crescendo">crescendo (&lt;)</option>
            <option value="diminuendo">diminuendo (&gt;)</option>
          </select>
        </label>
        <label className="omr-measure-inline-field">
          시작 음
          <select
            value={String(fromNote)}
            onChange={(e) => setFromNote(parseInt(e.target.value, 10))}
            style={{ marginLeft: 4, minWidth: '9rem' }}
          >
            {noteOptions.filter((o) => o.value >= 0).map((o) => (
              <option key={`from-${o.value}`} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="omr-measure-inline-field">
          끝 음 (이 음까지)
          <select
            value={String(toNote)}
            onChange={(e) => setToNote(parseInt(e.target.value, 10))}
            style={{ marginLeft: 4, minWidth: '9rem' }}
          >
            {noteOptions.map((o) => (
              <option key={`to-${o.value}`} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {partStaveCount >= 2 && editStaffWithinPart == null ? (
          <label className="omr-measure-inline-field">
            staff
            <select value={String(staff)} onChange={(e) => setStaff(parseInt(e.target.value, 10) || 1)} style={{ marginLeft: 4 }}>
              <option value="1">staff 1 (PR)</option>
              <option value="2">staff 2 (PL)</option>
            </select>
          </label>
        ) : null}
        <label className="omr-measure-inline-field">
          위치
          <select value={placement} onChange={(e) => setPlacement(e.target.value as 'above' | 'below')} style={{ marginLeft: 4 }}>
            <option value="below">아래</option>
            <option value="above">위</option>
          </select>
        </label>
        <button
          type="button"
          className="omr-hitl-fix-btn omr-hitl-fix-btn--primary"
          onClick={() =>
            onFix({
              kind: 'insertWedge',
              directionType: 'wedge',
              directionValue: wedgeKind,
              fromNoteIndex: fromNote,
              toNoteIndex: toNote,
              staff: editStaffWithinPart ?? staff,
              placement,
            })
          }
        >
          점선 추가 (시작→끝)
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <label className="omr-measure-inline-field">
          끝을 이 음까지
          <select
            value={String(stopNote)}
            onChange={(e) => setStopNote(parseInt(e.target.value, 10))}
            style={{ marginLeft: 4, minWidth: '9rem' }}
          >
            {noteOptions.map((o) => (
              <option key={`stop-${o.value}`} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="omr-hitl-fix-btn"
          onClick={() =>
            onFix({
              kind: 'moveWedgeStop',
              directionType: 'wedge',
              directionValue: 'stop',
              beforeNoteIndex: stopNote >= 0 ? stopNote : undefined,
              toNoteIndex: stopNote,
              staff: editStaffWithinPart ?? staff,
              placement,
            })
          }
        >
          wedge(stop)을 이 음 뒤로
        </button>
      </div>
    </div>
  );
}

function MeasureDirectionsEditor({
  directions,
  measureMxl,
  directionSourcePartId,
  onFix,
}: {
  directions: MeasureDirectionEl[];
  measureMxl: number;
  directionSourcePartId?: string;
  onFix: (partial: FixPartial) => void;
}) {
  const [edits, setEdits] = useState<Record<number, string>>({});

  useEffect(() => {
    const next: Record<number, string> = {};
    for (const d of directions) {
      next[d.directionIndex] = d.text;
    }
    setEdits(next);
  }, [directions, measureMxl]);

  if (!directions.length) return null;

  const textDirections = directions.filter((d) => !isNavigationDirection(d));
  if (!textDirections.length) return null;

  return (
    <div
      className="omr-measure-directions-panel"
      style={{
        marginBottom: '0.85rem',
        padding: '0.65rem 0.75rem',
        background: '#fff8e6',
        borderRadius: 6,
        border: '1px solid #ffe082',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6 }}>마디 텍스트 (제목·OCR 찌끼)</div>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.86rem', lineHeight: 1.45, color: '#444' }}>
        OMR이 넣은 <code>&lt;direction&gt;&lt;words&gt;</code> 입니다. clean_score에 남은 제목 한글·숫자 찌끼를{' '}
        <strong>삭제</strong>하거나 올바른 제목으로 <strong>고친 뒤</strong> 「MXL에 반영·미리보기」를 누르세요.
        {measureMxl === 1 ? ' 1마디 상단 제목은 여기서 지우는 경우가 많습니다.' : ''}
        {directionSourcePartId ?
          ` (제목 direction은 part ${directionSourcePartId}에 저장됩니다.)`
        : ''}
      </p>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {textDirections.map((d) => (
          <li
            key={`dir-${d.directionIndex}`}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              alignItems: 'center',
              padding: '0.35rem 0',
              borderBottom: '1px solid #ffe082',
            }}
          >
            <span style={{ fontSize: '0.82rem', color: '#666', minWidth: 72 }}>
              dir #{d.directionIndex}
              {d.staff != null ? ` · staff ${d.staff}` : ''}
            </span>
            <input
              type="text"
              value={edits[d.directionIndex] ?? d.text}
              onChange={(e) =>
                setEdits((prev) => ({
                  ...prev,
                  [d.directionIndex]: e.target.value,
                }))
              }
              style={{ flex: '1 1 12rem', minWidth: '8rem', padding: '0.35rem 0.5rem' }}
            />
            <select
              value={d.placement || 'above'}
              onChange={(e) =>
                onFix({
                  kind: 'setDirectionPlacement',
                  directionIndex: d.directionIndex,
                  placement: e.target.value as 'above' | 'below',
                  distance: d.distance ?? undefined,
                })
              }
              style={{ fontSize: '0.82rem', padding: '0.35rem 0.4rem' }}
              title="위치 (위/아래)"
            >
              <option value="above">위 (above)</option>
              <option value="below">아래 (below)</option>
            </select>
            <select
              value={articulationDistanceSelectValue(d.distance, d.defaultY)}
              onChange={(e) =>
                onFix({
                  kind: 'setDirectionPlacement',
                  directionIndex: d.directionIndex,
                  placement: (d.placement || 'above') as 'above' | 'below',
                  distance: e.target.value,
                })
              }
              style={{ fontSize: '0.82rem', padding: '0.35rem 0.4rem' }}
              title="거리 (칸수)"
            >
              {ARTICULATION_DISTANCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="omr-hitl-fix-btn"
              onClick={() =>
                onFix({
                  kind: 'setMeasureDirectionText',
                  directionIndex: d.directionIndex,
                  text: (edits[d.directionIndex] ?? d.text).trim(),
                })
              }
            >
              텍스트 적용
            </button>
            <button
              type="button"
              className="omr-hitl-fix-btn"
              onClick={() =>
                onFix({
                  kind: 'removeDirection',
                  directionIndex: d.directionIndex,
                })
              }
            >
              삭제
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MeasureTempoEditor({
  tempos,
  effectiveTempoBpm,
  onFix,
}: {
  tempos: MeasureTempoEntry[];
  effectiveTempoBpm?: number | null;
  onFix: (partial: FixPartial) => void;
}) {
  const primary = tempos[0];
  const [bpmText, setBpmText] = useState(
    primary?.tempoBpm != null ? String(primary.tempoBpm) : effectiveTempoBpm != null ? String(effectiveTempoBpm) : '',
  );
  const [beatUnit, setBeatUnit] = useState(primary?.beatUnit ?? 'quarter');

  useEffect(() => {
    setBpmText(
      primary?.tempoBpm != null
        ? String(primary.tempoBpm)
        : effectiveTempoBpm != null
          ? String(effectiveTempoBpm)
          : '',
    );
    setBeatUnit(primary?.beatUnit ?? 'quarter');
  }, [primary?.tempoBpm, primary?.beatUnit, effectiveTempoBpm, tempos.length]);

  const parsedBpm = parseFloat(bpmText.replace(/[^\d.]/g, ''));
  const bpmValid = Number.isFinite(parsedBpm) && parsedBpm >= 1 && parsedBpm <= 400;

  return (
    <div className="omr-measure-tempo-panel" style={{ marginBottom: '0.85rem', padding: '0.65rem 0.75rem', background: '#f3f6fb', borderRadius: 6, border: '1px solid #c5cae9' }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>마디 템포 (BPM)</div>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.86rem', lineHeight: 1.45, color: '#444' }}>
        clean_score·OMR 과정에서 사라진 ♩= 템포를 복구합니다.{' '}
        <strong>어느 파트에서 설정해도 모든 파트</strong>에 동일 재생 템포가 들어가며, 이후 마디까지 MusicXML 재생 규칙으로 유지됩니다(첫 파트만 ♩= 표기).
      </p>
      {tempos.length > 0 ? (
        <ul style={{ margin: '0 0 0.5rem', paddingLeft: '1.2rem', fontSize: '0.88rem' }}>
          {tempos.map((t) => (
            <li key={t.directionIndex}>
              {t.label}
              {t.tempoBpm != null ? ` (${t.tempoBpm} BPM)` : ''}
              <button
                type="button"
                className="omr-hitl-fix-btn"
                style={{ marginLeft: 8 }}
                onClick={() =>
                  onFix({
                    kind: 'removeMeasureTempo',
                    directionIndex: t.directionIndex,
                  })
                }
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      ) : effectiveTempoBpm != null ? (
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.86rem', color: '#555' }}>
          이 마디 MXL에는 템포 표기 없음 — 직전 마디부터 재생 템포 약 <strong>{effectiveTempoBpm} BPM</strong>
        </p>
      ) : (
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.86rem', color: '#555' }}>이 마디에 템포 표기 없음</p>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <label className="omr-measure-inline-field">
          BPM
          <input
            type="text"
            inputMode="decimal"
            value={bpmText}
            onChange={(e) => setBpmText(e.target.value)}
            placeholder="예: 72"
            style={{ width: 64, marginLeft: 4 }}
          />
        </label>
        <label className="omr-measure-inline-field">
          박자 단위
          <select value={beatUnit} onChange={(e) => setBeatUnit(e.target.value)} style={{ marginLeft: 4 }}>
            {BEAT_UNIT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="omr-hitl-fix-btn omr-hitl-fix-btn--primary"
          disabled={!bpmValid}
          onClick={() =>
            onFix({
              kind: 'setMeasureTempo',
              tempoBpm: parsedBpm,
              beatUnit,
              directionIndex: primary?.directionIndex,
            })
          }
        >
          {tempos.length ? '템포 변경' : '템포 추가'}
        </button>
        {tempos.length > 0 ? (
          <button
            type="button"
            className="omr-hitl-fix-btn"
            onClick={() => onFix({ kind: 'removeMeasureTempo' })}
          >
            전체 삭제
          </button>
        ) : null}
      </div>
    </div>
  );
}

type Props = {
  jobId: string;
  partId: string;
  measureMxl: number;
  measurePrinted: number;
  measureOffset: number;
  staffLabel?: string;
  /** 피아노 PR/PL 등 — 목록·삽입 기본 staff 필터 (원본 #index 유지) */
  editStaffWithinPart?: number | null;
  /** part `<staves>` — 동시 시작 voice 복원 staff 선택용 */
  partStaveCount?: number;
  /** 전체 악보 파트 목록 — 마디 복사/이동 대상 지정용 */
  availableScoreParts?: Array<{ id: string; displayLabel?: string; suggestedLabel?: string; staffCount?: number }>;
  onAddFix: (fix: OmrHitlFix) => void;
  pendingFixes?: OmrHitlFix[];
  previewRevision?: number;
  lastPreviewMsg?: string;
  pendingFixCount?: number;
  previewBusy?: boolean;
  onPreview?: () => void;
};

function parsePitch(pitch: string | null | undefined): { step: string; octave: number } {
  if (!pitch || pitch.length < 2) return { step: 'C', octave: 4 };
  const step = pitch.slice(0, -1);
  const octave = parseInt(pitch.slice(-1), 10);
  return { step: PITCH_STEPS.includes(step as (typeof PITCH_STEPS)[number]) ? step : 'C', octave: Number.isFinite(octave) ? octave : 4 };
}

function chordLeaderIndex(el: MeasureNoteEl, noteEls: MeasureNoteEl[]): number {
  const sorted = [...noteEls].sort((a, b) => a.index - b.index);
  let pos = sorted.findIndex((n) => n.index === el.index);
  if (pos < 0) return el.index;
  while (pos > 0 && sorted[pos]?.chord) pos -= 1;
  return sorted[pos]?.index ?? el.index;
}

/** insertNote 직후 리더가 될 #index (서버 `_resolve_insert_after_context`와 동일). */
function predictLeaderIndexAfterInsert(noteEls: MeasureNoteEl[], afterNoteIndex: number): number {
  if (afterNoteIndex < 0) return 0;
  if (afterNoteIndex >= noteEls.length) return noteEls.length;
  const anchor = noteEls.find((n) => n.index === afterNoteIndex);
  if (!anchor) return afterNoteIndex + 1;
  const leaderIdx = chordLeaderIndex(anchor, noteEls);
  const sorted = [...noteEls].sort((a, b) => a.index - b.index);
  let endIdx = leaderIdx;
  for (const n of sorted) {
    if (n.index <= leaderIdx) continue;
    if (n.chord) endIdx = n.index;
    else break;
  }
  return endIdx + 1;
}

type PendingInsertLeader = {
  leaderNoteIndex: number;
  pitchLabel: string;
  noteType: string;
  dotCount?: number;
};

function noteAnchorLabel(n: MeasureNoteEl): string {
  if (n.kind === 'rest') return `쉼표(${n.type ?? '?'})`;
  return n.pitch ?? n.type ?? '?';
}

function graceNotesBefore(index: number, noteEls: MeasureNoteEl[]): MeasureNoteEl[] {
  const out: MeasureNoteEl[] = [];
  for (let i = index - 1; i >= 0; i--) {
    const n = noteEls.find((x) => x.index === i);
    if (!n) break;
    if (!n.hasGrace) break;
    out.unshift(n);
  }
  return out;
}

function resolveAfterNoteIndex(el: MeasureElement, _elements: MeasureElement[]): number {
  return el.index;
}

function noteDirectionsOf(el: MeasureNoteEl): NoteDirectionInfo[] {
  if (el.noteDirections?.length) return el.noteDirections;
  if (el.noteDirection) return [el.noteDirection];
  return [];
}

function noteDirectionsSummary(el: MeasureNoteEl): string {
  return noteDirectionsOf(el)
    .map((d) => noteDirectionLabel(d))
    .filter(Boolean)
    .join(' · ');
}

function noteDirectionLabel(dir: NoteDirectionInfo | null | undefined): string {
  if (!dir?.directionValue && dir?.directionType !== 'dynamics') return '';
  const pl = dir.placement === 'below' ? '↓' : dir.placement === 'above' ? '↑' : '';
  if (dir.directionType === 'dynamics') {
    return `dir:${dir.directionValue || 'p'}${pl}`;
  }
  if (dir.directionType === 'rehearsal') return `reh:${dir.directionValue || 'A'}${pl}`;
  return `txt:${dir.directionValue}${pl}`;
}

function elementTitle(
  el: MeasureElement,
  _noteEls: MeasureNoteEl[],
  ctx?: { partId?: string; staffLabel?: string | null; editStaffWithinPart?: number | null },
): string {
  const idx = el.index;
  const dirSuffix = noteDirectionsSummary(el) ? ` · ${noteDirectionsSummary(el)}` : '';
  const staffVoice =
    `${el.staff != null ? ` staff=${el.staff}` : ''}${el.voice != null && el.voice !== '' ? ` voice=${el.voice}` : ''}`;
  if (el.kind === 'rest') {
    const dots = el.dotCount ? ` ·×${el.dotCount}` : '';
    const pos =
      el.displayStep && el.type && ['whole', 'half'].includes(el.type)
        ? ` (${el.displayStep}${el.displayOctave ?? ''})`
        : '';
    const dur = el.duration != null ? ` dur=${el.duration}` : '';
    const ferms = el.fermatas?.length ? ` fermata=${el.fermatas.join(',')}` : '';
    return `#${idx} ${el.type ?? 'rest'}쉼표${dots}${pos}${dur}${ferms}${dirSuffix}${staffVoice}`;
  }
  const tie =
    el.tieStart && el.tieStop ? ' tie↔' : el.tieStart ? ' tie→' : el.tieStop ? ' tie←' : '';
  const slur =
    el.slurStart && el.slurStop
      ? ' slur↔'
      : el.slurStart
        ? ' slur→'
        : el.slurStop
          ? ' slur←'
          : '';
  const slurPl =
    el.slurStartPlacement === 'above' || el.slurStopPlacement === 'above'
      ? '↑'
      : el.slurStartPlacement === 'below' || el.slurStopPlacement === 'below'
        ? '↓'
        : '';
  const slurTag = slur ? `${slur}${slurPl}` : '';
  const dots = el.dotCount ? ` ·×${el.dotCount}` : '';
  const chord = el.chord ? ' (화음)' : '';
  const tuplet = el.timeMod
    ? ` ${el.timeMod === '3:2' ? '세잇단' : `잇단 ${el.timeMod}`}${el.tuplet === 'start' ? '▸' : el.tuplet === 'stop' ? '◂' : ''}`
    : '';
  const artSource =
    el.chord && _noteEls.length
      ? _noteEls.find((n) => n.index === chordLeaderIndex(el, _noteEls)) ?? el
      : el;
  const arts = artSource.articulations?.length
    ? ` [${artSource.articulations
        .map((a) => {
          const name = a.split('(')[0];
          const pl = markPlacementOf(a);
          const plStr = pl === 'above' ? '↑' : pl === 'below' ? '↓' : '';
          return `${articulationOptionLabel(name)}${plStr}`;
        })
        .join(', ')}]`
    : '';
  const orns = artSource.ornaments?.length ? ` orn=[${artSource.ornaments.join(', ')}]` : '';
  const ferms = el.fermatas?.length ? ` fermata=${el.fermatas.join(',')}` : '';
  const beam = el.beams?.length ? ` beam=[${el.beams.join(',')}]` : '';
  const dur = el.duration != null ? ` dur=${el.duration}` : '';
  const pitchLabel =
    el.pitch != null
      ? formatPitchLabel(
          parsePitch(el.pitch).step,
          parsePitch(el.pitch).octave,
          el.pitchAlter,
        )
      : '?';
  const graceTag = el.hasGrace ? ` 꾸밈음${el.graceSlash ? '(slash)' : ''}` : '';
  return `#${idx} ${pitchLabel}${graceTag} ${el.type ?? ''}${dots}${tie}${slurTag}${chord}${tuplet}${beam}${dur}${arts}${orns}${ferms}${dirSuffix}${el.stem ? ` stem=${el.stem}` : ''}${staffVoice}`;
}

export function OmrMeasureEditor({
  jobId,
  partId,
  measureMxl,
  measurePrinted,
  measureOffset,
  staffLabel,
  editStaffWithinPart = null,
  partStaveCount = 1,
  onAddFix,
  pendingFixes = [],
  previewRevision = 0,
  lastPreviewMsg = '',
  pendingFixCount = 0,
  previewBusy = false,
  availableScoreParts,
  onPreview,
}: Props) {
  const [snapshot, setSnapshot] = useState<MeasureSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  const [insertAfter, setInsertAfter] = useState(-1);
  const [insertStaff, setInsertStaff] = useState(editStaffWithinPart ?? 1);
  const [fixMsg, setFixMsg] = useState('');
  const [pendingInsertLeader, setPendingInsertLeader] = useState<PendingInsertLeader | null>(null);
  const [repairStaff, setRepairStaff] = useState(editStaffWithinPart ?? 1);
  const [playOrderDraft, setPlayOrderDraft] = useState<Record<number, string>>({});

  const availableParts = useMemo(() => {
    if (availableScoreParts && availableScoreParts.length > 0) {
      return availableScoreParts.map((p) => ({
        id: p.id,
        label: p.displayLabel || p.suggestedLabel || p.id,
      }));
    }
    return [
      { id: 'P1', label: 'S' },
      { id: 'P2', label: 'A' },
      { id: 'P3', label: 'T' },
      { id: 'P4', label: 'B' },
      { id: 'P5', label: 'P' },
    ];
  }, [availableScoreParts]);

  const [copyFromPartId, setCopyFromPartId] = useState(partId);
  const [copyToPartIds, setCopyToPartIds] = useState<string[]>(() => {
    const isBass = partId === 'P4' || staffLabel === 'B' || staffLabel === 'Bass';
    if (isBass) {
      const sa = (availableScoreParts || [])
        .filter((p) => ['S', 'A', 'SOPRANO', 'ALTO'].includes((p.displayLabel || p.suggestedLabel || '').toUpperCase()))
        .map((p) => p.id);
      return sa.length > 0 ? sa : ['P1', 'P2'];
    }
    return ['P1'];
  });
  const [copyRangeMode, setCopyRangeMode] = useState<'single' | 'range'>('single');
  const [copyStartMeasure, setCopyStartMeasure] = useState(measureMxl);
  const [copyEndMeasure, setCopyEndMeasure] = useState(measureMxl);
  const [clearSourceAfterCopy, setClearSourceAfterCopy] = useState(false);
  const [splitVoicesOnCopy, setSplitVoicesOnCopy] = useState(true);

  const handleExecuteCopy = useCallback(() => {
    if (copyToPartIds.length === 0) return;
    const measureSpec = copyRangeMode === 'single' ? String(measureMxl) : `${copyStartMeasure}-${copyEndMeasure}`;
    const fromLabel = availableParts.find((p) => p.id === copyFromPartId)?.label || copyFromPartId;
    const toLabels = copyToPartIds.map((id) => availableParts.find((p) => p.id === id)?.label || id).join(', ');

    const fix: OmrHitlFix = {
      id: newFixId(),
      kind: 'copyMeasureContent',
      partId: copyFromPartId,
      fromPartId: copyFromPartId,
      toPartIds: copyToPartIds,
      measureMxl: measureSpec,
      clearSource: clearSourceAfterCopy,
      splitVoices: splitVoicesOnCopy,
      detail: `${fromLabel} ➡️ ${toLabels} (${copyRangeMode === 'single' ? `m.${measureMxl}` : `m.${measureSpec}`})${clearSourceAfterCopy ? ' [이동]' : ''}`,
    };

    onAddFix(fix);
    setFixMsg(
      `✅ ${fromLabel} 파트의 ${copyRangeMode === 'single' ? `${measureMxl}마디` : `${measureSpec}마디`} 내용을 ${toLabels} 파트로 복사/이동 등록했습니다. 아래 [MXL에 반영·미리보기]를 눌러 적용하세요.`,
    );
  }, [
    copyToPartIds,
    copyRangeMode,
    measureMxl,
    copyStartMeasure,
    copyEndMeasure,
    availableParts,
    copyFromPartId,
    clearSourceAfterCopy,
    splitVoicesOnCopy,
    onAddFix,
  ]);

  const [clefScope, setClefScope] = useState<'all' | 'single' | 'range'>('all');
  const [clefStartMeasure, setClefStartMeasure] = useState(measureMxl);
  const [clefEndMeasure, setClefEndMeasure] = useState(measureMxl);

  const handleApplyClef = useCallback(
    (sign: 'G' | 'F', line: 2 | 4) => {
      let rangeStr = String(measureMxl);
      let scopeLabel = `${measureMxl}마디`;
      if (clefScope === 'all') {
        rangeStr = '1-999';
        scopeLabel = '1마디부터 곡 전체';
      } else if (clefScope === 'range') {
        rangeStr = `${clefStartMeasure}-${clefEndMeasure}`;
        scopeLabel = `${rangeStr}마디`;
      }

      const clefName = sign === 'G' ? '높은음자리표(𝄞)' : '낮은음자리표(𝄢)';

      const fix: OmrHitlFix = {
        id: newFixId(),
        kind: 'setMeasureClef',
        partId,
        measureMxl: rangeStr,
        clefSign: sign,
        clefLine: line,
        staff: editStaffWithinPart ?? 1,
        removeSubsequentClefs: true,
        detail: `${staffLabel ? `${staffLabel} ` : ''}${clefName} (${scopeLabel})`,
      };

      onAddFix(fix);
      setFixMsg(
        `✅ ${staffLabel ? `${staffLabel} 파트 ` : ''}${scopeLabel}를 ${clefName}로 변경 등록했습니다. 아래 [MXL에 반영·미리보기]를 눌러 적용하세요.`,
      );
    },
    [
      measureMxl,
      clefScope,
      clefStartMeasure,
      clefEndMeasure,
      partId,
      staffLabel,
      editStaffWithinPart,
      onAddFix,
    ],
  );

  const measureMxlStr = String(measureMxl);

  const pendingPlayOrderForNote = useCallback(
    (noteIndex: number): number | null | undefined => {
      for (let i = pendingFixes.length - 1; i >= 0; i -= 1) {
        const f = pendingFixes[i]!;
        if (f.kind !== 'setPlayOrder') continue;
        if (f.partId !== partId) continue;
        if (String(f.measureMxl) !== measureMxlStr) continue;
        if (f.noteIndex !== noteIndex) continue;
        if (f.playOrder == null || f.playOrder < 1) return null;
        return f.playOrder;
      }
      return undefined;
    },
    [pendingFixes, partId, measureMxlStr],
  );

  const pendingArticulationForNote = useCallback(
    (
      noteIndex: number,
      articulation: string,
    ): { placement?: 'above' | 'below'; distance?: string | null } | undefined => {
      const art = articulation.split('(')[0]!.trim().toLowerCase();
      for (let i = pendingFixes.length - 1; i >= 0; i -= 1) {
        const f = pendingFixes[i]!;
        if (f.kind !== 'setArticulationPlacement' && f.kind !== 'addArticulation') continue;
        if (!hitlPreviewPartIdsMatch(partId, f.partId)) continue;
        if (String(f.measureMxl) !== measureMxlStr) continue;
        if (f.noteIndex !== noteIndex) continue;
        const fArt = (f.articulation ?? '').split('(')[0]!.trim().toLowerCase();
        if (fArt !== art) continue;
        return {
          placement:
            f.placement === 'above' || f.placement === 'below' ? f.placement : undefined,
          ...(f.distance !== undefined
            ? {
                distance:
                  f.distance == null || f.distance === '' || f.distance === 'auto' ? null : f.distance,
              }
            : {}),
        };
      }
      return undefined;
    },
    [pendingFixes, partId, measureMxlStr],
  );

  const playOrderInputValue = useCallback(
    (el: MeasureNoteEl): string => {
      if (Object.prototype.hasOwnProperty.call(playOrderDraft, el.index)) {
        return playOrderDraft[el.index]!;
      }
      const pending = pendingPlayOrderForNote(el.index);
      if (pending !== undefined) return pending == null ? '' : String(pending);
      if (el.playOrder != null) return String(el.playOrder);
      if (el.displayPlayOrder != null) return String(el.displayPlayOrder);
      return '';
    },
    [playOrderDraft, pendingPlayOrderForNote],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr('');
    try {
      const r = await fetch(
        `/api/omr-hitl/${jobId}/measure?partId=${encodeURIComponent(partId)}&measureMxl=${encodeURIComponent(String(measureMxl))}`,
        { cache: 'no-store' },
      );
      const j = (await r.json()) as MeasureSnapshot & { error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      if (j.error) throw new Error(j.error);
      setSnapshot(j);
    } catch (e) {
      setSnapshot(null);
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [jobId, partId, measureMxl]);

  useEffect(() => {
    void load();
  }, [load, previewRevision]);

  const elements = useMemo(() => {
    if (snapshot?.elements?.length) return snapshot.elements;
    return (snapshot?.notes ?? []).map((n) => ({ ...n, elementKind: 'note' as const }));
  }, [snapshot]);

  useEffect(() => {
    if (editStaffWithinPart != null) setInsertStaff(editStaffWithinPart);
  }, [editStaffWithinPart]);

  useEffect(() => {
    if (editStaffWithinPart != null) setRepairStaff(editStaffWithinPart);
  }, [editStaffWithinPart]);

  useEffect(() => {
    setPendingInsertLeader(null);
  }, [previewRevision, insertAfter, partId, measureMxl]);

  const displayElements = useMemo(() => {
    const notes = elements.filter((el): el is MeasureNoteEl => el.elementKind === 'note');
    if (editStaffWithinPart == null) return notes;
    return notes.filter((el) => (el.staff ?? 1) === editStaffWithinPart);
  }, [elements, editStaffWithinPart]);

  const noteEls = useMemo(
    () => elements.filter((e): e is MeasureNoteEl => e.elementKind === 'note'),
    [elements],
  );

  const breathMarkNotes = useMemo(() => {
    return displayElements.filter((n) =>
      (n.articulations ?? []).some((a) => a.split('(')[0].toLowerCase() === 'breath-mark'),
    );
  }, [displayElements]);

  const measureDirections = snapshot?.measureDirections ?? [];
  const navigationDirections = useMemo(
    () => measureDirections.filter((d) => isNavigationDirection(d)),
    [measureDirections],
  );
  const textDirections = useMemo(
    () => measureDirections.filter((d) => !isNavigationDirection(d) && !isWedgeDirection(d)),
    [measureDirections],
  );
  const wedgeDirections = useMemo(
    () =>
      measureDirections.filter((d) => {
        if (!isWedgeDirection(d)) return false
        if (editStaffWithinPart == null) return true
        return (d.staff ?? 1) === editStaffWithinPart;
      }),
    [measureDirections, editStaffWithinPart],
  );

  useEffect(() => {
    setPlayOrderDraft({});
  }, [previewRevision, partId, measureMxl]);

  const pushFix = (partial: FixPartial) => {
    const { measureMxl: overrideMxl, ...rest } = partial;
    const directionKinds = new Set(['setMeasureDirectionText', 'removeDirection']);
    const fixPartId =
      directionKinds.has(String(rest.kind)) && snapshot?.directionSourcePartId
        ? snapshot.directionSourcePartId
        : partId;
    onAddFix({
      id: newFixId(),
      partId: fixPartId,
      measureMxl: overrideMxl ?? String(measureMxl),
      source: 'manual',
      ...rest,
    });
    setFixMsg('대기 목록에 반영됨 — 오른쪽 MXL 미리보기에 바로 반영됩니다. MXL 저장은 아래 「MXL에 반영·미리보기」를 누르세요.');
  };

  const commitPlayOrder = (el: MeasureNoteEl, raw: string) => {
    const trimmed = raw.trim();
    const order = trimmed === '' || trimmed === '0' ? 0 : parseInt(trimmed, 10);
    if (trimmed !== '' && trimmed !== '0' && !Number.isFinite(order)) return;
    pushFix({
      kind: 'setPlayOrder',
      noteIndex: el.index,
      playOrder: order,
      staff: el.staff ?? repairStaff,
    });
    setFixMsg(
      order > 0
        ? `#${el.index} 연주순번 ${order} (반영 대기)`
        : `#${el.index} 연주순번 자동 (반영 대기)`,
    );
    setPlayOrderDraft((prev) => {
      const next = { ...prev };
      delete next[el.index];
      return next;
    });
  };

  return (
    <div className="omr-measure-editor">
      <div className="omr-measure-editor-head">
        <strong>
          마디 편집 · 인쇄 m.{measurePrinted}
          <span className="omr-measure-editor-sub">
            (MXL {measureMxl} · part {partId}
            {staffLabel ? ` · ${staffLabel}` : ''}
            {editStaffWithinPart != null ? ` · staff ${editStaffWithinPart}` : ''})
          </span>
        </strong>
        <button type="button" className="btn-muted" disabled={loading} onClick={() => void load()}>
          {loading ? '불러오는 중…' : '다시 불러오기'}
        </button>
      </div>
      <p className="omr-measure-editor-hint">
        요소를 고친 뒤 아래 <strong>「MXL에 반영·미리보기」</strong>를 눌러 오른쪽 MusicXML에서 결과를 확인하세요. 인쇄 마디 ≈ MXL <code>measure@number</code> + {measureOffset} − 1.
        {' '}
        <strong>연주순번</strong>은 음표·쉼표 모두에 지정할 수 있습니다(같은 번호 = 동시 시작). 예전에 음표만 순번이 저장된 마디는 열 때 쉼표를 포함해 자동 재배열됩니다.
      </p>
      <div className="omr-measure-insert-row">
        <strong>빈 마디 삽입</strong>
        <span className="omr-measure-editor-hint" style={{ margin: '0 0 0 6px' }}>
          OMR이 마디를 통째로 빠뜨리거나 다음 마디 내용이 당겨진 경우 — <strong>모든 파트</strong>에 동시에 빈 마디(온쉼)를 넣고 이후 MXL 번호를 밀어 넣습니다.
        </span>
        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            type="button"
            className="btn-muted"
            onClick={() => pushFix({ kind: 'insertEmptyMeasureBefore' })}
          >
            MXL {measureMxl} <strong>앞</strong>에 빈 마디
          </button>
          <button
            type="button"
            className="btn-muted"
            onClick={() => pushFix({ kind: 'insertEmptyMeasureAfter' })}
          >
            MXL {measureMxl} <strong>뒤</strong>에 빈 마디
          </button>
        </div>
        <p className="omr-measure-editor-hint" style={{ margin: '6px 0 0', fontSize: '0.84rem' }}>
          예: 26마디에 27마디 내용이 들어와 있으면 「26 <strong>앞</strong>에 빈 마디」→ 반영 후 새 26마디에 음표를 추가하세요.
        </p>
      </div>

      <div
        className="omr-measure-copy-section"
        style={{
          marginTop: 10,
          marginBottom: 10,
          padding: '10px 14px',
          background: '#f8fafc',
          border: '1px solid #cbd5e1',
          borderRadius: 6,
        }}
      >
        <div
          style={{
            fontWeight: 700,
            fontSize: '0.92rem',
            color: '#1e293b',
            marginBottom: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span>📋</span>
          <span>마디 파트 복사 / 이동 (다른 파트로 내용 배분)</span>
        </div>
        <p className="omr-measure-editor-hint" style={{ margin: '0 0 8px', fontSize: '0.82rem', color: '#475569' }}>
          이미 고친 파트(예: B 파트)의 마디 내용을 <strong>다른 파트(예: S, A 파트)로 마디 단위 또는 범위로 복사·이동</strong>합니다.
        </p>

        {/* 1. 출처 및 대상 파트 선택 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 8 }}>
          <label style={{ fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 600 }}>출처 파트:</span>
            <select
              value={copyFromPartId}
              onChange={(e) => setCopyFromPartId(e.target.value)}
              style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid #94a3b8' }}
            >
              {availableParts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} (part {p.id})
                </option>
              ))}
            </select>
          </label>

          <div style={{ fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600 }}>대상 파트:</span>
            {availableParts
              .filter((p) => p.id !== copyFromPartId)
              .map((p) => (
                <label key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={copyToPartIds.includes(p.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setCopyToPartIds([...copyToPartIds, p.id]);
                      } else {
                        setCopyToPartIds(copyToPartIds.filter((id) => id !== p.id));
                      }
                    }}
                  />
                  <span>{p.label}</span>
                </label>
              ))}
          </div>

          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              className="btn-muted"
              style={{ padding: '2px 6px', fontSize: '0.78rem' }}
              onClick={() => {
                const saIds = availableParts
                  .filter((p) => ['S', 'A', 'SOPRANO', 'ALTO'].includes(p.label.toUpperCase()))
                  .map((p) => p.id);
                if (saIds.length) setCopyToPartIds(saIds);
                else setCopyToPartIds(availableParts.slice(0, 2).map((p) => p.id));
              }}
            >
              S·A 선택
            </button>
            <button
              type="button"
              className="btn-muted"
              style={{ padding: '2px 6px', fontSize: '0.78rem' }}
              onClick={() => {
                const tbIds = availableParts
                  .filter((p) => ['T', 'B', 'TENOR', 'BASS'].includes(p.label.toUpperCase()))
                  .map((p) => p.id);
                if (tbIds.length) setCopyToPartIds(tbIds);
                else setCopyToPartIds(availableParts.slice(2, 4).map((p) => p.id));
              }}
            >
              T·B 선택
            </button>
          </div>
        </div>

        {/* 2. 마디 범위 선택 */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'center',
            marginBottom: 8,
            fontSize: '0.86rem',
          }}
        >
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name="copyRangeType"
              checked={copyRangeMode === 'single'}
              onChange={() => setCopyRangeMode('single')}
            />
            <span>현재 마디만 (MXL {measureMxl} / 인쇄 m.{measurePrinted})</span>
          </label>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name="copyRangeType"
              checked={copyRangeMode === 'range'}
              onChange={() => setCopyRangeMode('range')}
            />
            <span>마디 범위 일괄:</span>
            <input
              type="number"
              min={1}
              value={copyStartMeasure}
              onChange={(e) => setCopyStartMeasure(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{ width: 48, padding: '2px 4px', textAlign: 'center', border: '1px solid #94a3b8', borderRadius: 4 }}
              disabled={copyRangeMode !== 'range'}
            />
            <span>~</span>
            <input
              type="number"
              min={1}
              value={copyEndMeasure}
              onChange={(e) => setCopyEndMeasure(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{ width: 48, padding: '2px 4px', textAlign: 'center', border: '1px solid #94a3b8', borderRadius: 4 }}
              disabled={copyRangeMode !== 'range'}
            />
            <span>마디</span>
          </label>
        </div>

        {/* 3. 옵션 및 실행 버튼 */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 8,
            paddingTop: 8,
            borderTop: '1px dashed #cbd5e1',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: '0.82rem' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={clearSourceAfterCopy}
                onChange={(e) => setClearSourceAfterCopy(e.target.checked)}
              />
              <span>
                복사 후 출처 파트를 <strong>온쉼표로 비우기 (이동)</strong>
              </span>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={splitVoicesOnCopy}
                onChange={(e) => setSplitVoicesOnCopy(e.target.checked)}
              />
              <span>
                2개 성부/화음 시 <strong>상하 성부 자동 분할 (위 음 ➡️ S, 아래 음 ➡️ A)</strong>
              </span>
            </label>
          </div>

          <button
            type="button"
            className="btn-primary"
            style={{ padding: '5px 14px', fontSize: '0.86rem', fontWeight: 600 }}
            disabled={copyToPartIds.length === 0}
            onClick={handleExecuteCopy}
          >
            📋 파트 복사/이동 등록
          </button>
        </div>
      </div>

      <div
        className="omr-measure-clef-section"
        style={{
          marginTop: 10,
          marginBottom: 10,
          padding: '10px 14px',
          background: '#f1f5f9',
          border: '1px solid #cbd5e1',
          borderRadius: 6,
        }}
      >
        <div
          style={{
            fontWeight: 700,
            fontSize: '0.92rem',
            color: '#1e293b',
            marginBottom: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>𝄞 / 𝄢</span>
            <span>음자리표 변경 (높은음 / 낮은음자리표)</span>
          </div>
          {snapshot?.effectiveClef ? (
            <span
              style={{
                fontSize: '0.82rem',
                fontWeight: 600,
                color: snapshot.effectiveClef.sign === 'F' ? '#b45309' : '#0369a1',
                background: snapshot.effectiveClef.sign === 'F' ? '#fef3c7' : '#e0f2fe',
                padding: '2px 8px',
                borderRadius: 4,
                border: snapshot.effectiveClef.sign === 'F' ? '1px solid #fde68a' : '1px solid #bae6fd',
              }}
            >
              현재 적용: {snapshot.effectiveClef.sign === 'F' ? '𝄢 낮은음자리표 (F)' : '𝄞 높은음자리표 (G)'}
            </span>
          ) : null}
        </div>

        <p className="omr-measure-editor-hint" style={{ margin: '0 0 8px', fontSize: '0.82rem', color: '#475569' }}>
          현재 파트(<strong>{staffLabel ? `${staffLabel} · ` : ''}part {partId}</strong>)의 음자리표를 높은음자리표(𝄞) 또는 낮은음자리표(𝄢)로 변경합니다.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 8, fontSize: '0.86rem' }}>
          <span style={{ fontWeight: 600 }}>적용 범위:</span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name="clefRangeScope"
              checked={clefScope === 'all'}
              onChange={() => setClefScope('all')}
            />
            <span>1마디부터 곡 전체 적용 (m.1 ~ 끝)</span>
          </label>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name="clefRangeScope"
              checked={clefScope === 'single'}
              onChange={() => setClefScope('single')}
            />
            <span>현재 마디만 (m.{measurePrinted})</span>
          </label>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name="clefRangeScope"
              checked={clefScope === 'range'}
              onChange={() => setClefScope('range')}
            />
            <span>마디 범위 지정:</span>
            <input
              type="number"
              min={1}
              value={clefStartMeasure}
              onChange={(e) => setClefStartMeasure(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{ width: 48, padding: '2px 4px', textAlign: 'center', border: '1px solid #94a3b8', borderRadius: 4 }}
              disabled={clefScope !== 'range'}
            />
            <span>~</span>
            <input
              type="number"
              min={1}
              value={clefEndMeasure}
              onChange={(e) => setClefEndMeasure(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{ width: 48, padding: '2px 4px', textAlign: 'center', border: '1px solid #94a3b8', borderRadius: 4 }}
              disabled={clefScope !== 'range'}
            />
            <span>마디</span>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            className="btn-primary"
            style={{ padding: '5px 12px', fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => handleApplyClef('G', 2)}
          >
            <span>𝄞</span>
            <span>높은음자리표 (Treble G) 로 변경</span>
          </button>
          <button
            type="button"
            className="btn-muted"
            style={{ padding: '5px 12px', fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => handleApplyClef('F', 4)}
          >
            <span>𝄢</span>
            <span>낮은음자리표 (Bass F) 로 변경</span>
          </button>
        </div>
      </div>
      {editStaffWithinPart != null ? (
        <p className="omr-measure-editor-hint" style={{ marginTop: '-0.35rem', fontSize: '0.88rem' }}>
          {staffLabel ?? `staff ${editStaffWithinPart}`} 줄만 표시 — 보정은 MusicXML part <code>{partId}</code> staff{' '}
          {editStaffWithinPart}(#번호는 전체 마디 기준).
        </p>
      ) : null}
      <p className="omr-measure-editor-hint" style={{ marginTop: '-0.35rem', fontSize: '0.88rem' }}>
        <strong>staff</strong> — 한 파트 안 <em>어느 오선 줄</em>인지입니다(피아노 2단이면 보통 1=PR·오른손, 2=PL·왼손). 같은
        줄에서 위·아래로 겹치는 동시 연주를 가르는 값이 <strong>아닙니다</strong>.{' '}
        <strong>voice</strong> — 같은 staff 위의 다른 성부 줄(겹침·다른 줄기).{' '}
        <strong>연주순번</strong> — 왼쪽→오른쪽 열; <strong>같은 번호 = 동시 시작</strong>. 같은 오선에서
        8분쉼표와 2분음표를 위아래로 그리려면 <strong>같은 staff + 다른 voice + 같은 순번</strong>이 맞고, staff만
        바꾸면 PR/PL로 갈라집니다. 같은 voice로만 이어져 있으면 「동시 시작 voice 복원」을 쓰세요. 빈 칸·0이면
        자동 순번입니다.
      </p>
      {fixMsg ? <p className="omr-measure-fix-msg">{fixMsg}</p> : null}
      {lastPreviewMsg ? <p className="omr-measure-preview-msg">{lastPreviewMsg}</p> : null}
      {loadErr ? <p className="omr-measure-editor-err">{loadErr}</p> : null}
      {loading && !snapshot ? <p className="omr-measure-editor-loading">마디 요소 불러오는 중…</p> : null}

      {snapshot ? (
        <>
          <MeasureNavigationEditor
            directions={navigationDirections}
            partStaveCount={partStaveCount}
            editStaffWithinPart={editStaffWithinPart}
            insertStaff={insertStaff}
            onFix={pushFix}
          />
          <MeasureWedgeEditor
            directions={wedgeDirections}
            noteEls={noteEls}
            partStaveCount={partStaveCount}
            editStaffWithinPart={editStaffWithinPart}
            insertStaff={insertStaff}
            onFix={pushFix}
          />
          <MeasureDirectionsEditor
            directions={textDirections}
            measureMxl={measureMxl}
            directionSourcePartId={snapshot.directionSourcePartId}
            onFix={pushFix}
          />
          <MeasureTempoEditor
            tempos={snapshot.tempos ?? []}
            effectiveTempoBpm={snapshot.effectiveTempoBpm}
            onFix={pushFix}
          />
        </>
      ) : null}

      {breathMarkNotes.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
            margin: '10px 0',
            padding: '10px 14px',
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: 6,
            fontSize: '0.86rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#92400e' }}>
            <span style={{ fontSize: '1.1rem' }}>⚠️</span>
            <span>
              이 마디에 <strong>숨표(콤마 , 모양 기호) {breathMarkNotes.length}건</strong>이 감지되었습니다.
              <br />
              <span style={{ fontSize: '0.8rem', color: '#b45309' }}>
                (OMR이 악센트 <code>&gt;</code>나 이음줄을 쉼표 모양 숨표(breath-mark)로 오인식한 경우 아래 버튼으로 일괄 제거할 수 있습니다)
              </span>
            </span>
          </div>
          <button
            type="button"
            className="omr-hitl-fix-btn omr-hitl-fix-btn--primary"
            style={{ fontWeight: 600, fontSize: '0.84rem', padding: '5px 12px' }}
            onClick={() => {
              for (const bNote of breathMarkNotes) {
                pushFix({
                  kind: 'removeArticulation',
                  noteIndex: bNote.index,
                  articulation: 'breath-mark',
                });
              }
              setFixMsg(`마디 내 숨표(,) ${breathMarkNotes.length}건 제거 대기 등록 → 아래 「MXL에 반영·미리보기」를 누르세요.`);
            }}
          >
            마디 내 숨표(,) 일괄 제거 ({breathMarkNotes.length}건)
          </button>
        </div>
      )}

      {displayElements.length > 0 && (
        <ol className="omr-measure-element-list">
          {displayElements.map((el) => (
            <li key={`note-${el.index}`}>
              <div className="omr-measure-element-title">
                {!el.chord ? (
                  <label style={{ marginRight: 10, fontWeight: 400, fontSize: '0.86rem' }}>
                    순번{' '}
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      style={{ width: 48, marginLeft: 2 }}
                      value={playOrderInputValue(el)}
                      onChange={(e) => {
                        setPlayOrderDraft((prev) => ({ ...prev, [el.index]: e.target.value }));
                      }}
                      onBlur={(e) => commitPlayOrder(el, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitPlayOrder(el, (e.target as HTMLInputElement).value);
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                    />
                  </label>
                ) : null}
                {elementTitle(el, noteEls, { partId, staffLabel, editStaffWithinPart })}
              </div>
              <MeasureNoteEditor
                el={el}
                noteEls={noteEls}
                jobId={jobId}
                partId={partId}
                measureMxl={measureMxl}
                previewRevision={previewRevision}
                onFix={pushFix}
                pendingArticulationForNote={pendingArticulationForNote}
              />
              <div className="omr-measure-insert-row">
                <span className="omr-measure-insert-label">이 위치 뒤에 추가:</span>
                <button
                  type="button"
                  className="btn-muted omr-measure-insert-btn"
                  onClick={() => {
                    const anchor = resolveAfterNoteIndex(el, elements);
                    setInsertAfter(anchor);
                    setInsertStaff(el.staff ?? editStaffWithinPart ?? 1);
                    const anchorNote = anchor >= 0 ? noteEls.find((n) => n.index === anchor) : null;
                    setFixMsg(
                      anchor < 0
                        ? '삽입 위치: 마디 앞 — 아래 삽입 폼에서 확인하세요.'
                        : `삽입 위치: #${anchor} ${anchorNote ? noteAnchorLabel(anchorNote) : ''} 뒤`,
                    );
                  }}
                >
                  여기 뒤
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <InsertElementForm
        afterNoteIndex={insertAfter}
        staffDefault={insertStaff}
        noteEls={noteEls}
        pendingLeader={pendingInsertLeader}
        onInsertRest={(afterNoteIndex, noteType, dotCount, staff, voice) => {
          setPendingInsertLeader(null);
          pushFix({ kind: 'insertRest', afterNoteIndex, noteType, dotCount, staff, voice });
        }}
        onInsertNote={(afterNoteIndex, pitchStep, pitchOctave, noteType, dotCount, staff, pitchAlter, extraChordMembers, voice) => {
          const leaderIdx = predictLeaderIndexAfterInsert(noteEls, afterNoteIndex);
          const leaderLabel = formatPitchLabel(pitchStep, pitchOctave, pitchAlter);
          pushFix({
            kind: 'insertNote',
            afterNoteIndex,
            pitchStep,
            pitchOctave,
            pitchAlter,
            noteType,
            dotCount,
            staff,
            voice,
          });
          for (const cm of extraChordMembers) {
            pushFix({
              kind: 'insertChordMember',
              leaderNoteIndex: leaderIdx,
              pitchStep: cm.step,
              pitchOctave: cm.octave,
              pitchAlter: cm.alter,
            });
          }
          if (extraChordMembers.length > 0) {
            setPendingInsertLeader(null);
            setFixMsg(
              `리더 #${leaderIdx}(예정) ${leaderLabel} + 화음 ${extraChordMembers.length}개 대기 목록 추가 → 「MXL에 반영·미리보기」`,
            );
          } else {
            setPendingInsertLeader({
              leaderNoteIndex: leaderIdx,
              pitchLabel: leaderLabel,
              noteType,
              dotCount,
            });
            setFixMsg(
              `리더 음표 대기 (#${leaderIdx} 예정 · ${leaderLabel}). 아래 「화음 음 추가」로 2·3음을 더 붙이거나 「MXL에 반영·미리보기」를 누르세요.`,
            );
          }
        }}
        onInsertChordMember={(leaderNoteIndex, pitchStep, pitchOctave, pitchAlter) => {
          pushFix({
            kind: 'insertChordMember',
            leaderNoteIndex,
            pitchStep,
            pitchOctave,
            pitchAlter,
          });
          setFixMsg(
            `화음 음 ${formatPitchLabel(pitchStep, pitchOctave, pitchAlter)} 대기 (리더 #${leaderNoteIndex} 예정) → 「MXL에 반영·미리보기」`,
          );
        }}
        onClearPendingLeader={() => setPendingInsertLeader(null)}
      />

      {!loading && elements.length === 0 && !loadErr ? (
        <p className="omr-measure-editor-empty">이 마디에 편집할 요소가 없습니다.</p>
      ) : null}

      <div className="omr-measure-editor-preview-row">
        <button
          type="button"
          className="omr-measure-preview-btn"
          disabled={previewBusy}
          onClick={() => onPreview?.()}
        >
          {previewBusy ? '반영 중…' : `MXL에 반영·미리보기${pendingFixCount > 0 ? ` (${pendingFixCount}건)` : ''}`}
        </button>
        <span className="omr-measure-editor-preview-hint">
          반영 후 오른쪽 MusicXML에서 삭제·추가 결과를 확인하세요.
        </span>
      </div>
    </div>
  );
}

function CrossMeasureTieForm({
  jobId,
  partId,
  currentMeasureMxl,
  el,
  onFix,
}: {
  jobId: string;
  partId: string;
  currentMeasureMxl: number;
  el: MeasureNoteEl;
  onFix: (partial: FixPartial) => void;
}) {
  const parsed = parsePitch(el.pitch);
  const [nextMxl, setNextMxl] = useState(String(currentMeasureMxl + 1));
  const [prevMxl, setPrevMxl] = useState(String(Math.max(1, currentMeasureMxl - 1)));
  const [nextNotes, setNextNotes] = useState<MeasureNoteEl[]>([]);
  const [prevNotes, setPrevNotes] = useState<MeasureNoteEl[]>([]);
  const [toPitchStep, setToPitchStep] = useState(parsed.step);
  const [toPitchOctave, setToPitchOctave] = useState(parsed.octave);
  const [toPitchAlter, setToPitchAlter] = useState<PitchAlterOption>(pitchAlterToOption(el.pitchAlter));
  const [fromPitchStep, setFromPitchStep] = useState(parsed.step);
  const [fromPitchOctave, setFromPitchOctave] = useState(parsed.octave);
  const [fromPitchAlter, setFromPitchAlter] = useState<PitchAlterOption>(pitchAlterToOption(el.pitchAlter));
  const [nextPick, setNextPick] = useState('');
  const [prevPick, setPrevPick] = useState('');

  const loadNeighborNotes = useCallback(
    async (mxl: string, setter: (notes: MeasureNoteEl[]) => void) => {
      try {
        const r = await fetch(
          `/api/omr-hitl/${jobId}/measure?partId=${encodeURIComponent(partId)}&measureMxl=${encodeURIComponent(mxl)}&readOnly=1`,
          { cache: 'no-store' },
        );
        const j = (await r.json()) as MeasureSnapshot & { error?: string };
        if (!r.ok || j.error) {
          setter([]);
          return;
        }
        const notes = (j.notes ?? []).filter(
          (n) => n.kind === 'note' && !n.chord && !n.hasGrace && !n.isCue,
        ) as MeasureNoteEl[];
        setter(notes);
      } catch {
        setter([]);
      }
    },
    [jobId, partId],
  );

  useEffect(() => {
    void loadNeighborNotes(nextMxl, setNextNotes);
  }, [loadNeighborNotes, nextMxl]);

  useEffect(() => {
    void loadNeighborNotes(prevMxl, setPrevNotes);
  }, [loadNeighborNotes, prevMxl]);

  useEffect(() => {
    setNextPick('');
    setPrevPick('');
    const p = parsePitch(el.pitch);
    setToPitchStep(p.step);
    setToPitchOctave(p.octave);
    setToPitchAlter(pitchAlterToOption(el.pitchAlter));
    setFromPitchStep(p.step);
    setFromPitchOctave(p.octave);
    setFromPitchAlter(pitchAlterToOption(el.pitchAlter));
  }, [el.index, el.pitch, el.pitchAlter]);

  const noteOptionLabel = (n: MeasureNoteEl) =>
    `#${n.index} ${formatPitchLabel(parsePitch(n.pitch).step, parsePitch(n.pitch).octave, n.pitchAlter)}`;

  const applyForward = () => {
    const partial: FixPartial = {
      kind: 'addTie',
      fromNoteIndex: el.index,
      toMeasureMxl: nextMxl,
      toPitchStep,
      toPitchOctave,
      toPitchAlter: pitchAlterFromOption(toPitchAlter),
    };
    if (nextPick !== '') partial.toNoteIndex = parseInt(nextPick, 10);
    onFix(partial);
  };

  const applyBackward = () => {
    const partial: FixPartial = {
      kind: 'addTie',
      measureMxl: prevMxl,
      fromPitchStep,
      fromPitchOctave,
      fromPitchAlter: pitchAlterFromOption(fromPitchAlter),
      toMeasureMxl: String(currentMeasureMxl),
      toNoteIndex: el.index,
    };
    if (prevPick !== '') {
      const picked = prevNotes.find((n) => String(n.index) === prevPick);
      if (picked?.pitch) {
        const p = parsePitch(picked.pitch);
        partial.fromPitchStep = p.step;
        partial.fromPitchOctave = p.octave;
        partial.fromPitchAlter = pitchAlterFromOption(pitchAlterToOption(picked.pitchAlter));
        partial.fromNoteIndex = picked.index;
      }
    }
    onFix(partial);
  };

  return (
    <div className="omr-measure-cross-tie" style={{ marginTop: '6px' }}>
      <p className="omr-measure-editor-hint" style={{ fontSize: '0.82rem', margin: '0 0 4px' }}>
        <strong>마디 넘김 붙임줄</strong> — 줄 바꿈 등으로 다음·이전 마디 음과 연결. #index 대신{' '}
        <strong>연결할 음높이</strong>로 찾습니다.
      </p>
      <div className="omr-measure-insert-form-row">
        <label className="omr-measure-inline-field">
          다음 MXL m
          <input
            type="number"
            min={1}
            value={nextMxl}
            onChange={(e) => setNextMxl(e.target.value)}
            style={{ width: 52 }}
          />
        </label>
        <label className="omr-measure-inline-field">
          연결 음(끝)
          <select value={nextPick} onChange={(e) => setNextPick(e.target.value)}>
            <option value="">음높이로 찾기</option>
            {nextNotes.map((n) => (
              <option key={n.index} value={String(n.index)}>
                {noteOptionLabel(n)}
              </option>
            ))}
          </select>
        </label>
        {nextPick === '' ? (
          <>
            <select value={toPitchStep} onChange={(e) => setToPitchStep(e.target.value)}>
              {PITCH_STEPS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              max={9}
              value={toPitchOctave}
              onChange={(e) => setToPitchOctave(Number(e.target.value))}
              style={{ width: 40 }}
            />
            <PitchAlterSelect value={toPitchAlter} onChange={setToPitchAlter} />
          </>
        ) : null}
        <button type="button" className="omr-hitl-fix-btn" onClick={applyForward}>
          이 음 → 다음 마디
        </button>
      </div>
      <div className="omr-measure-insert-form-row" style={{ marginTop: '4px' }}>
        <label className="omr-measure-inline-field">
          이전 MXL m
          <input
            type="number"
            min={1}
            value={prevMxl}
            onChange={(e) => setPrevMxl(e.target.value)}
            style={{ width: 52 }}
          />
        </label>
        <label className="omr-measure-inline-field">
          연결 음(시작)
          <select value={prevPick} onChange={(e) => setPrevPick(e.target.value)}>
            <option value="">음높이로 찾기</option>
            {prevNotes.map((n) => (
              <option key={n.index} value={String(n.index)}>
                {noteOptionLabel(n)}
              </option>
            ))}
          </select>
        </label>
        {prevPick === '' ? (
          <>
            <select value={fromPitchStep} onChange={(e) => setFromPitchStep(e.target.value)}>
              {PITCH_STEPS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              max={9}
              value={fromPitchOctave}
              onChange={(e) => setFromPitchOctave(Number(e.target.value))}
              style={{ width: 40 }}
            />
            <PitchAlterSelect value={fromPitchAlter} onChange={setFromPitchAlter} />
          </>
        ) : null}
        <button type="button" className="omr-hitl-fix-btn" onClick={applyBackward}>
          이전 마디 → 이 음
        </button>
      </div>
    </div>
  );
}

function NoteDirectionEditor({
  noteIndex,
  currentDirections,
  onFix,
}: {
  noteIndex: number;
  currentDirections?: NoteDirectionInfo[];
  onFix: (partial: Omit<OmrHitlFix, 'id' | 'partId' | 'measureMxl'>) => void;
}) {
  const dirs = currentDirections ?? [];
  const [mode, setMode] = useState<'none' | 'dynamics' | 'words' | 'rehearsal'>('none');
  const [dynValue, setDynValue] = useState('mf');
  const [dirPlacement, setDirPlacement] = useState<'above' | 'below'>('above');
  const [dirDistance, setDirDistance] = useState('auto');
  const [textValue, setTextValue] = useState('');

  useEffect(() => {
    setMode('none');
    setDynValue('mf');
    setDirPlacement('above');
    setDirDistance('auto');
    setTextValue('');
  }, [noteIndex]);

  const apply = () => {
    if (mode === 'none') return;
    onFix({
      kind: 'addNoteDirection',
      noteIndex,
      directionType: mode,
      directionValue: mode === 'dynamics' ? dynValue : textValue.trim() || (mode === 'rehearsal' ? 'A' : ' '),
      placement: dirPlacement,
      distance: dirDistance,
    });
  };

  return (
    <div className="omr-measure-direction-row" style={{ marginTop: 6 }}>
      <span className="omr-measure-articulation-current">
        direction: {dirs.length ? dirs.map((d) => noteDirectionLabel(d)).filter(Boolean).join(' · ') : '없음'}
      </span>
      {dirs.length > 0 ? (
        <div className="omr-measure-direction-list" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {dirs.map((d, i) => (
            <span key={`${d.directionType}-${d.directionValue}-${i}`} className="omr-measure-direction-chip">
              {noteDirectionLabel(d)}
              <select
                value={d.placement || (d.directionType === 'dynamics' ? 'below' : 'above')}
                onChange={(e) =>
                  onFix({
                    kind: 'setNoteDirectionPlacement',
                    noteIndex,
                    directionType: d.directionType,
                    directionValue: d.directionValue,
                    placement: e.target.value as 'above' | 'below',
                    distance: d.distance ?? undefined,
                  })
                }
                style={{ marginLeft: 4, fontSize: '0.78rem', padding: '1px 2px' }}
                title="위치 (위/아래)"
              >
                <option value="above">위 (↑)</option>
                <option value="below">아래 (↓)</option>
              </select>
              <select
                value={articulationDistanceSelectValue(d.distance, d.defaultY)}
                onChange={(e) =>
                  onFix({
                    kind: 'setNoteDirectionPlacement',
                    noteIndex,
                    directionType: d.directionType,
                    directionValue: d.directionValue,
                    placement: (d.placement || (d.directionType === 'dynamics' ? 'below' : 'above')) as 'above' | 'below',
                    distance: e.target.value,
                  })
                }
                style={{ marginLeft: 4, fontSize: '0.78rem', padding: '1px 2px' }}
                title="거리 (칸수)"
              >
                {ARTICULATION_DISTANCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="omr-hitl-fix-btn"
                style={{ marginLeft: 4 }}
                onClick={() =>
                  onFix({
                    kind: 'removeNoteDirection',
                    noteIndex,
                    directionType: d.directionType,
                    directionValue: d.directionValue,
                  })
                }
              >
                삭제
              </button>
            </span>
          ))}
          <button type="button" className="omr-hitl-fix-btn" onClick={() => onFix({ kind: 'clearNoteDirection', noteIndex })}>
            전체 지우기
          </button>
          <span className="omr-measure-editor-hint" style={{ fontSize: '0.8rem' }}>
            「삭제」= 표시된 항목 하나만 · 「전체 지우기」= 이 음표의 셈여림·텍스트 direction 전부
          </span>
        </div>
      ) : null}
      <label className="omr-measure-inline-field">
        추가
        <select
          value={mode === 'none' ? '' : mode}
          onChange={(e) => {
            const v = e.target.value;
            setMode(v === '' ? 'none' : (v as 'dynamics' | 'words' | 'rehearsal'));
            if (v === 'dynamics') setDirPlacement('below');
          }}
        >
          <option value="">종류 선택</option>
          <option value="dynamics">셈여림</option>
          <option value="words">텍스트</option>
          <option value="rehearsal">리허설</option>
        </select>
      </label>
      {mode === 'dynamics' ? (
        <select value={dynValue} onChange={(e) => setDynValue(e.target.value)} aria-label="dynamics">
          {DYNAMICS_DIRECTION_VALUES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      ) : mode === 'words' || mode === 'rehearsal' ? (
        <input
          type="text"
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          placeholder={mode === 'rehearsal' ? 'A' : 'a tempo, rit. …'}
          style={{ minWidth: 120 }}
        />
      ) : null}
      {mode !== 'none' ? (
        <>
          <label className="omr-measure-inline-field">
            위치
            <select
              value={dirPlacement}
              onChange={(e) => setDirPlacement(e.target.value as 'above' | 'below')}
              aria-label="direction placement"
            >
              <option value="above">음표 위</option>
              <option value="below">음표 아래</option>
            </select>
          </label>
          <label className="omr-measure-inline-field">
            거리
            <select
              value={dirDistance}
              onChange={(e) => setDirDistance(e.target.value)}
              aria-label="direction distance"
            >
              {ARTICULATION_DISTANCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
      <button
        type="button"
        className="omr-hitl-fix-btn omr-hitl-fix-btn--primary"
        onClick={apply}
        disabled={mode === 'none'}
      >
        direction 추가
      </button>
    </div>
  );
}

function pitchFieldsFromMeasureNote(el: MeasureNoteEl | undefined): {
  pitchStep?: string;
  pitchOctave?: number;
  pitchAlter?: number;
  staff?: number;
} {
  if (!el) return {};
  const staff = el.staff != null ? el.staff : undefined;
  const raw = (el.pitch ?? '').trim().replace(/♯/g, '#').replace(/♭/g, 'b');
  const m = /^([A-G])([#b]*)(\d+)$/i.exec(raw);
  if (!m) return staff != null ? { staff } : {};
  const acc = (m[2] ?? '').toLowerCase();
  let alter = el.pitchAlter ?? 0;
  if (el.pitchAlter == null) {
    if (acc.includes('##')) alter = 2;
    else if (acc.includes('#')) alter = 1;
    else if (acc.includes('bb')) alter = -2;
    else if (acc.includes('b')) alter = -1;
  }
  return {
    pitchStep: m[1]!.toUpperCase(),
    pitchOctave: parseInt(m[3]!, 10),
    pitchAlter: alter,
    ...(staff != null ? { staff } : {}),
  };
}

function effectiveArticulationDistance(
  art: string,
  pending?: { distance?: string | null },
): string {
  if (pending && pending.distance !== undefined) {
    return pending.distance == null || pending.distance === '' ? 'auto' : pending.distance;
  }
  return markDistanceLevelOf(art);
}

function effectiveArticulationPlacement(
  art: string,
  fallback: 'above' | 'below',
  pending?: { placement?: 'above' | 'below' },
): 'above' | 'below' {
  if (pending?.placement) return pending.placement;
  return markPlacementOf(art) ?? fallback;
}

function MeasureNoteEditor({
  el,
  noteEls,
  jobId,
  partId,
  measureMxl,
  previewRevision,
  onFix,
  pendingArticulationForNote,
}: {
  el: MeasureNoteEl;
  noteEls: MeasureNoteEl[];
  jobId: string;
  partId: string;
  measureMxl: number;
  previewRevision: number;
  onFix: (partial: Omit<OmrHitlFix, 'id' | 'partId' | 'measureMxl'>) => void;
  pendingArticulationForNote: (
    noteIndex: number,
    articulation: string,
  ) => { placement?: 'above' | 'below'; distance?: string | null } | undefined;
}) {
  const parsed = parsePitch(el.pitch);
  const [pitchStep, setPitchStep] = useState(parsed.step);
  const [pitchOctave, setPitchOctave] = useState(parsed.octave);
  const [pitchAlter, setPitchAlter] = useState<PitchAlterOption>(pitchAlterToOption(el.pitchAlter));
  const [noteTypeValueSel, setNoteTypeValueSel] = useState(
    noteTypeValue(el.type ?? 'quarter', el.dotCount ?? (el.isDotted ? 1 : 0)),
  );
  const [staffN, setStaffN] = useState(el.staff ?? 1);
  const [voiceN, setVoiceN] = useState(String(el.voice ?? '1'));
  const [tieTo, setTieTo] = useState('');
  const [slurTo, setSlurTo] = useState('');
  const [slurPlacement, setSlurPlacement] = useState<'above' | 'below'>(() =>
    el.stem === 'down' ? 'above' : 'below',
  );
  const [tripletEnd, setTripletEnd] = useState(() => defaultTripletEndIndex(chordLeaderIndex(el, noteEls), noteEls));
  const [tripletNormalType, setTripletNormalType] = useState(() => defaultTripletNormalType(el));
  const [tripletPreserveTypes, setTripletPreserveTypes] = useState(() =>
    tripletRangeHasMixedTypes(chordLeaderIndex(el, noteEls), defaultTripletEndIndex(chordLeaderIndex(el, noteEls), noteEls), noteEls),
  );
  const [beamEnd, setBeamEnd] = useState(() =>
    defaultBeamEndIndex(chordLeaderIndex(el, noteEls), noteEls, el),
  );
  const [beamNumber, setBeamNumber] = useState(1);
  const [chordStep, setChordStep] = useState('G');
  const [chordOctave, setChordOctave] = useState(4);
  const [chordAlter, setChordAlter] = useState<PitchAlterOption>('0');
  const [pendingArtIds, setPendingArtIds] = useState<string[]>([]);
  const [pendingArtPlacement, setPendingArtPlacement] = useState<Record<string, 'above' | 'below'>>({});
  const [artPlacement, setArtPlacement] = useState<'above' | 'below'>(() =>
    defaultArticulationPlacement(el.stem),
  );
  const [artDistance, setArtDistance] = useState<string>('auto');
  const [artControlDraft, setArtControlDraft] = useState<
    Record<string, { placement?: 'above' | 'below'; distance?: string }>
  >({});
  const [pendingOrnamentIds, setPendingOrnamentIds] = useState<string[]>([]);
  type GraceDraftItem = {
    step: string;
    octave: number;
    alter: PitchAlterOption;
    noteType: string;
  };

  const [graceNotesDraft, setGraceNotesDraft] = useState<GraceDraftItem[]>([
    { step: parsed.step, octave: parsed.octave, alter: pitchAlterToOption(el.pitchAlter), noteType: '16th' },
  ]);
  const [beamGraceNotes, setBeamGraceNotes] = useState(true);
  const [graceSlash, setGraceSlash] = useState(false);

  useEffect(() => {
    setPendingArtIds([]);
    setPendingArtPlacement({});
    setArtPlacement(defaultArticulationPlacement(el.stem));
    setArtDistance('auto');
    setArtControlDraft({});
    setPendingOrnamentIds([]);
    const p = parsePitch(el.pitch);
    setPitchStep(p.step);
    setPitchOctave(p.octave);
    setPitchAlter(pitchAlterToOption(el.pitchAlter));
    setGraceNotesDraft([
      { step: p.step, octave: p.octave, alter: pitchAlterToOption(el.pitchAlter), noteType: '16th' },
    ]);
    setBeamGraceNotes(true);
    setGraceSlash(false);
    setNoteTypeValueSel(
      noteTypeValue(el.type ?? 'quarter', el.dotCount ?? (el.isDotted ? 1 : 0)),
    );
    setStaffN(el.staff ?? 1);
    setVoiceN(String(el.voice ?? '1'));
    setTripletEnd(defaultTripletEndIndex(chordLeaderIndex(el, noteEls), noteEls));
    setTripletNormalType(defaultTripletNormalType(el));
    setTripletPreserveTypes(
      tripletRangeHasMixedTypes(
        chordLeaderIndex(el, noteEls),
        defaultTripletEndIndex(chordLeaderIndex(el, noteEls), noteEls),
        noteEls,
      ),
    );
    setBeamEnd(
      clampBeamEnd(
        chordLeaderIndex(el, noteEls),
        defaultBeamEndIndex(chordLeaderIndex(el, noteEls), noteEls, el),
        noteEls,
        el,
      ),
    );
    setTieTo('');
    setSlurTo('');
    setSlurPlacement(
      el.slurStartPlacement === 'above' || el.slurStartPlacement === 'below'
        ? el.slurStartPlacement
        : el.slurStopPlacement === 'above' || el.slurStopPlacement === 'below'
          ? el.slurStopPlacement
          : el.stem === 'down'
            ? 'above'
            : 'below',
    );
  }, [
    el.index,
    el.pitch,
    el.pitchAlter,
    el.type,
    el.staff,
    el.isDotted,
    el.dotCount,
    el.beams,
    el.stem,
    el.slurStartPlacement,
    el.slurStopPlacement,
    noteEls,
  ]);

  useEffect(() => {
    setArtControlDraft({});
  }, [previewRevision, partId, measureMxl, el.index]);

  const laterNotes = noteEls.filter((n) => n.index > el.index && n.kind === 'note');
  const nextNote = noteEls.find((n) => n.index === el.index + 1);
  const tripletLeaderIdx = chordLeaderIndex(el, noteEls);
  const tripletCandidates = noteEls.filter((n) => n.index >= tripletLeaderIdx && isRhythmicSlice(n)).slice(0, 8);
  const tripletNoteCount = countNotesInRange(tripletLeaderIdx, tripletEnd, noteEls);
  const tripletMixedTypes = tripletRangeHasMixedTypes(tripletLeaderIdx, tripletEnd, noteEls);
  const tripletSlotTotal = tripletSlotCount(tripletLeaderIdx, tripletEnd, noteEls);
  const tripletUsePreserve = tripletPreserveTypes || tripletMixedTypes;
  const tripletEffectiveNormalType = tripletUsePreserve
    ? smallestTripletNormalType(tripletLeaderIdx, tripletEnd, noteEls)
    : tripletNormalType;
  const tripletActualNotes = tripletUsePreserve ? tripletSlotTotal : tripletNoteCount;
  const existingTriplet = tripletRangeFor(el, noteEls);
  const isGrace = Boolean(el.hasGrace);
  const beamLeaderIdx = chordLeaderIndex(el, noteEls);
  const beamCandidates = noteEls.filter(
    (n) => n.index >= beamLeaderIdx && isBeamableNoteEl(n) && Boolean(n.hasGrace) === isGrace && (n.staff ?? 1) === (el.staff ?? 1),
  ).slice(0, 8);
  const beamEndNote = noteEls.find((n) => n.index === beamEnd);
  const beamNoteCount = countBeamableInRange(beamLeaderIdx, beamEnd, noteEls, isGrace);
  const existingBeam = beamLeaderRange(el, noteEls);
  const beamEndEl = noteEls.find((n) => n.index === existingBeam.to);
  const beamIncomplete =
    Boolean(el.beams?.includes('begin')) &&
    existingBeam.to > el.index &&
    !beamEndEl?.beams?.some((b) => b === 'end');
  const spuriousAfterRest =
    el.kind === 'rest' &&
    nextNote &&
    (nextNote.hasGrace ||
      nextNote.isCue ||
      nextNote.chord ||
      ['128th', '256th', '64th', '32nd'].includes(nextNote.type ?? '') ||
      (nextNote.dotCount ?? 0) > 0);
  const chordLeaderIdx = chordLeaderIndex(el, noteEls);
  const chordLeaderEl = noteEls.find((n) => n.index === chordLeaderIdx);
  const gracesBefore = graceNotesBefore(chordLeaderIdx, noteEls);
  const savedArtIds = articulationIdsFromEl(chordLeaderEl?.articulations);
  const displayArtIds = [...new Set([...savedArtIds, ...pendingArtIds])];
  const addableArtOptions = ARTICULATION_ADD_OPTIONS.filter((opt) => !displayArtIds.includes(opt.id));
  const savedOrnamentIds = ornamentIdsFromEl(chordLeaderEl?.ornaments);
  const displayOrnamentIds = [...new Set([...savedOrnamentIds, ...pendingOrnamentIds])];
  const addableOrnamentOptions = ORNAMENT_ADD_OPTIONS.filter((opt) => !displayOrnamentIds.includes(opt.id));
  const fermatas = chordLeaderEl?.fermatas ?? el.fermatas ?? [];
  const [fermataTypeSel, setFermataTypeSel] = useState<'upright' | 'inverted'>('upright');
  const [pendingFermata, setPendingFermata] = useState<string | null>(null);
  const displayFermatas = [
    ...fermatas,
    ...(pendingFermata && !fermatas.some((f) => f.startsWith(pendingFermata)) ? [`${pendingFermata}(반영 대기)`] : []),
  ];

  useEffect(() => {
    setPendingArtIds((prev) => prev.filter((id) => !savedArtIds.includes(id)));
    setPendingOrnamentIds((prev) => prev.filter((id) => !savedOrnamentIds.includes(id)));
    setPendingFermata(null);
  }, [savedArtIds.join('|'), savedOrnamentIds.join('|'), fermatas.join('|'), el.index]);

  return (
    <div className="omr-measure-element-actions">
      {el.kind === 'rest' && (
        <>
          <button
            type="button"
            className="omr-hitl-fix-btn omr-hitl-fix-btn--primary"
            onClick={() =>
              onFix({
                kind: 'clearRestDots',
                noteIndex: el.index,
                removeFollowingNote: Boolean(spuriousAfterRest),
              })
            }
          >
            쉼표 옆 점(·) 없애기
            {spuriousAfterRest ? ' (+뒤 잘못된 음표)' : ''}
          </button>
          {(el.dotCount ?? 0) > 0 || el.isDotted ? (
            <button
              type="button"
              className="omr-hitl-fix-btn"
              onClick={() => onFix({ kind: 'removeNoteDot', noteIndex: el.index })}
            >
              &lt;dot&gt;만 제거
            </button>
          ) : null}
        </>
      )}
      {(chordLeaderEl?.articulations ?? []).map((art) => {
        const name = art.split('(')[0];
        const pendingArt = pendingArticulationForNote(chordLeaderIdx, name);
        const draft = artControlDraft[name];
        const currentPl =
          draft?.placement ??
          effectiveArticulationPlacement(
            art,
            defaultArticulationPlacement(chordLeaderEl?.stem ?? el.stem),
            pendingArt,
          );
        const currentDist =
          draft?.distance ??
          effectiveArticulationDistance(art, pendingArt);
        const selectPl = currentPl;
        const beamSide = (chordLeaderEl?.stem ?? el.stem) === 'up' ? 'above' : (chordLeaderEl?.stem ?? el.stem) === 'down' ? 'below' : null;
        const likelyTupletDigit =
          (chordLeaderEl?.timeMod ?? el.timeMod) != null &&
          name === 'staccato' &&
          beamSide != null &&
          art.includes(beamSide);
        const isBreathMark = name === 'breath-mark';
        const artLabel = articulationOptionLabel(name);
        return (
          <span key={art} style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <button
              type="button"
              className={`omr-hitl-fix-btn${likelyTupletDigit || isBreathMark ? ' omr-hitl-fix-btn--primary' : ''}`}
              title={
                likelyTupletDigit
                  ? '잇단 숫자(3)를 가리는 점 — OMR이 숫자를 스타카토로 오인한 것일 가능성이 높습니다'
                  : isBreathMark
                    ? '악센트(>)나 이음줄을 쉼표 모양 숨표(,)로 오인한 것일 수 있습니다 — 클릭하여 제거합니다'
                    : `이 음표의 ${artLabel} 표를 제거합니다`
              }
              onClick={() => onFix({ kind: 'removeArticulation', noteIndex: chordLeaderIdx, articulation: name })}
            >
              {likelyTupletDigit
                ? `세잇단 숫자 가린 점(${name}) 제거`
                : `${artLabel} 제거`}
            </button>
            <label className="omr-measure-inline-field">
              위치
              <select
                value={selectPl}
                onChange={(e) => {
                  const next = e.target.value as 'above' | 'below';
                  if (next === currentPl) return;
                  setArtControlDraft((prev) => ({
                    ...prev,
                    [name]: { ...prev[name], placement: next, distance: currentDist },
                  }));
                  onFix({
                    kind: 'setArticulationPlacement',
                    noteIndex: chordLeaderIdx,
                    articulation: name,
                    placement: next,
                    distance: currentDist,
                    ...pitchFieldsFromMeasureNote(chordLeaderEl),
                  });
                }}
                style={{ marginLeft: 4 }}
              >
                <option value="above">위</option>
                <option value="below">아래</option>
              </select>
            </label>
            <label className="omr-measure-inline-field">
              거리
              <select
                value={currentDist}
                onChange={(e) => {
                  const nextDist = e.target.value;
                  setArtControlDraft((prev) => ({
                    ...prev,
                    [name]: { ...prev[name], placement: selectPl, distance: nextDist },
                  }));
                  onFix({
                    kind: 'setArticulationPlacement',
                    noteIndex: chordLeaderIdx,
                    articulation: name,
                    placement: selectPl,
                    distance: nextDist,
                    ...pitchFieldsFromMeasureNote(chordLeaderEl),
                  });
                }}
                style={{ marginLeft: 4 }}
                title="오선에서 떨어진 칸 수 (1칸 = staff space)"
              >
                {ARTICULATION_DISTANCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </span>
        );
      })}
      {el.kind === 'note' && addableArtOptions.length > 0 && (
        <div className="omr-measure-articulation-row">
          {savedArtIds.length === 0 ? (
            <>
              <span className="omr-measure-articulation-current">
                현재 표:{' '}
                {displayArtIds.length > 0
                  ? displayArtIds
                      .map((id) => {
                        const saved = (chordLeaderEl?.articulations ?? []).find((a) => a.split('(')[0] === id);
                        const pl = saved
                          ? markPlacementOf(saved)
                          : pendingArtPlacement[id] ?? null;
                        const side = placementKo(pl);
                        return `${articulationOptionLabel(id)}${side ? ` (${side})` : ''}`;
                      })
                      .join(' · ')
                  : '없음'}
                {pendingArtIds.length > 0 && savedArtIds.length < displayArtIds.length ? (
                  <span className="omr-measure-articulation-pending"> (반영 대기)</span>
                ) : null}
              </span>
              <label className="omr-measure-inline-field">
                위치
                <select
                  value={artPlacement}
                  onChange={(e) => setArtPlacement(e.target.value as 'above' | 'below')}
                  style={{ marginLeft: 4 }}
                >
                  <option value="above">위</option>
                  <option value="below">아래</option>
                </select>
              </label>
              <label className="omr-measure-inline-field">
                거리
                <select
                  value={artDistance}
                  onChange={(e) => setArtDistance(e.target.value)}
                  style={{ marginLeft: 4 }}
                  title="오선에서 떨어진 칸 수 (1칸 = staff space)"
                >
                  {ARTICULATION_DISTANCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          <label className="omr-measure-inline-field omr-measure-articulation-add">
            표 더 추가
            <select
              value=""
              onChange={(e) => {
                const art = e.target.value;
                if (!art) return;
                setPendingArtIds((prev) => (prev.includes(art) ? prev : [...prev, art]));
                setPendingArtPlacement((prev) => ({ ...prev, [art]: artPlacement }));
                onFix({
                  kind: 'addArticulation',
                  noteIndex: chordLeaderIdx,
                  articulation: art,
                  placement: artPlacement,
                  distance: artDistance !== 'auto' ? artDistance : undefined,
                  ...pitchFieldsFromMeasureNote(chordLeaderEl),
                });
              }}
            >
              <option value="">— 종류 선택 —</option>
              {addableArtOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          {savedArtIds.length > 0 ? (
            <span className="omr-measure-articulation-add-hint" style={{ fontSize: '0.82rem', color: '#666' }}>
              새 표 기본: {placementKo(artPlacement)} ·{' '}
              {ARTICULATION_DISTANCE_OPTIONS.find((o) => o.value === artDistance)?.label ?? artDistance}
            </span>
          ) : null}
        </div>
      )}
      {el.kind === 'note' && addableArtOptions.length === 0 && savedArtIds.length > 0 ? (
        <span className="omr-measure-articulation-full" style={{ fontSize: '0.85rem', color: '#666' }}>
          추가 가능한 표 없음
        </span>
      ) : null}
      {(chordLeaderEl?.ornaments ?? []).map((orn) => {
        const name = orn.split('(')[0];
        return (
          <button
            key={orn}
            type="button"
            className="omr-hitl-fix-btn omr-hitl-fix-btn--primary"
            title={`이 음표의 ${ornamentOptionLabel(name)} 꾸밈음을 제거합니다`}
            onClick={() => onFix({ kind: 'removeOrnament', noteIndex: chordLeaderIdx, ornament: name })}
          >
            {ornamentOptionLabel(name)} 제거
          </button>
        );
      })}
      {el.kind === 'note' && (
        <div className="omr-measure-articulation-row">
          <span className="omr-measure-articulation-current">
            꾸밈음:{' '}
            {displayOrnamentIds.length > 0
              ? displayOrnamentIds.map((id) => ornamentOptionLabel(id)).join(' · ')
              : '없음'}
            {pendingOrnamentIds.length > 0 && savedOrnamentIds.length < displayOrnamentIds.length ? (
              <span className="omr-measure-articulation-pending"> (반영 대기)</span>
            ) : null}
          </span>
          {addableOrnamentOptions.length > 0 ? (
            <label className="omr-measure-inline-field omr-measure-articulation-add">
              꾸밈음 추가
              <select
                value=""
                onChange={(e) => {
                  const orn = e.target.value;
                  if (!orn) return;
                  setPendingOrnamentIds((prev) => (prev.includes(orn) ? prev : [...prev, orn]));
                  onFix({ kind: 'addOrnament', noteIndex: chordLeaderIdx, ornament: orn, placement: 'above' });
                }}
              >
                <option value="">— 종류 선택 —</option>
                {addableOrnamentOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="omr-measure-articulation-full">추가 가능한 꾸밈음 없음</span>
          )}
        </div>
      )}
      {!el.chord && !el.hasGrace && el.index === chordLeaderIdx && (
        <NoteDirectionEditor
          noteIndex={chordLeaderIdx}
          currentDirections={noteDirectionsOf(chordLeaderEl ?? el)}
          onFix={onFix}
        />
      )}
      {spuriousAfterRest && nextNote ? (
        <button
          type="button"
          className="omr-hitl-fix-btn omr-hitl-fix-btn--danger"
          onClick={() => onFix({ kind: 'removeNote', noteIndex: nextNote.index })}
        >
          쉼표 뒤 잘못된 음표 #{nextNote.index} 삭제
        </button>
      ) : null}
      {el.kind === 'rest' && (el.type === 'whole' || el.type === 'half') && (
        <>
          <button
            type="button"
            className="omr-hitl-fix-btn"
            onClick={() => onFix({ kind: 'nudgeRestDisplay', noteIndex: el.index, lineDelta: 1 })}
          >
            쉼표 줄 한 칸 아래
          </button>
          <button
            type="button"
            className="omr-hitl-fix-btn"
            onClick={() => onFix({ kind: 'nudgeRestDisplay', noteIndex: el.index, lineDelta: -1 })}
          >
            쉼표 줄 한 칸 위
          </button>
        </>
      )}
      {el.staff == null && (
        <label className="omr-measure-inline-field">
          스태프
          <input
            type="number"
            min={1}
            max={4}
            value={staffN}
            onChange={(e) => setStaffN(Number(e.target.value))}
            style={{ width: 48 }}
          />
          <button
            type="button"
            className="omr-hitl-fix-btn"
            onClick={() => onFix({ kind: 'setNoteStaff', noteIndex: el.index, staff: staffN })}
          >
            스태프 지정
          </button>
        </label>
      )}
      <label className="omr-measure-inline-field">
        성부(Voice)
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          style={{ width: 48, marginLeft: 2 }}
          value={voiceN}
          onChange={(e) => setVoiceN(e.target.value)}
        />
        <button
          type="button"
          className="omr-hitl-fix-btn"
          onClick={() => onFix({ kind: 'setNoteVoice', noteIndex: el.index, voice: voiceN, staff: el.staff ?? undefined })}
        >
          성부 지정
        </button>
      </label>
      {el.kind === 'note' && (
        <div className="omr-measure-note-pitch">
          <label className="omr-measure-inline-field">
            음높이
            <select value={pitchStep} onChange={(e) => setPitchStep(e.target.value)}>
              {PITCH_STEPS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              max={9}
              value={pitchOctave}
              onChange={(e) => setPitchOctave(Number(e.target.value))}
              style={{ width: 48 }}
            />
            <PitchAlterSelect value={pitchAlter} onChange={setPitchAlter} />
            <button
              type="button"
              className="omr-hitl-fix-btn"
              onClick={() =>
                onFix({
                  kind: 'setNotePitch',
                  noteIndex: el.index,
                  pitchStep,
                  pitchOctave,
                  pitchAlter: pitchAlterFromOption(pitchAlter),
                })
              }
            >
              음높이 적용
            </button>
          </label>
        </div>
      )}
      <label className="omr-measure-inline-field">
        박자(종류)
        <select value={noteTypeValueSel} onChange={(e) => setNoteTypeValueSel(e.target.value)}>
          {NOTE_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="omr-hitl-fix-btn"
          onClick={() => {
            const { type, dots } = parseNoteTypeValue(noteTypeValueSel);
            onFix({ kind: 'setNoteType', noteIndex: el.index, noteType: type, dotCount: dots });
          }}
        >
          박자 적용
        </button>
      </label>
      {el.kind === 'note' && (
        <div className="omr-measure-tie-row">
          {(el.tieStart || el.tieStop) && (
            <>
              {el.tieStart && (
                <button
                  type="button"
                  className="omr-hitl-fix-btn"
                  onClick={() => onFix({ kind: 'removeTie', noteIndex: el.index, tieEnd: 'start' })}
                >
                  붙임 시작 제거
                </button>
              )}
              {el.tieStop && (
                <button
                  type="button"
                  className="omr-hitl-fix-btn"
                  onClick={() => onFix({ kind: 'removeTie', noteIndex: el.index, tieEnd: 'stop' })}
                >
                  붙임 끝 제거
                </button>
              )}
            </>
          )}
          {laterNotes.length > 0 && (
            <label className="omr-measure-inline-field">
              붙임줄 연결
              <select value={tieTo} onChange={(e) => setTieTo(e.target.value)}>
                <option value="">—</option>
                {laterNotes.map((n) => (
                  <option key={n.index} value={String(n.index)}>
                    #{n.index} {n.pitch ?? ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="omr-hitl-fix-btn"
                disabled={!tieTo}
                onClick={() =>
                  onFix({
                    kind: 'addTie',
                    fromNoteIndex: el.index,
                    toNoteIndex: parseInt(tieTo, 10),
                  })
                }
              >
                붙임줄 추가
              </button>
            </label>
          )}
          <CrossMeasureTieForm
            jobId={jobId}
            partId={partId}
            currentMeasureMxl={measureMxl}
            el={el}
            onFix={onFix}
          />
        </div>
      )}
      {el.kind === 'note' && (
        <div className="omr-measure-slur-row" style={{ marginTop: '4px' }}>
          {(el.slurStart || el.slurStop) && (
            <>
              {el.slurStart && (
                <button
                  type="button"
                  className="omr-hitl-fix-btn"
                  onClick={() => onFix({ kind: 'removeSlur', noteIndex: el.index, slurEnd: 'start' })}
                >
                  이음 시작 제거
                </button>
              )}
              {el.slurStop && (
                <button
                  type="button"
                  className="omr-hitl-fix-btn"
                  onClick={() => onFix({ kind: 'removeSlur', noteIndex: el.index, slurEnd: 'stop' })}
                >
                  이음 끝 제거
                </button>
              )}
              <label className="omr-measure-inline-field">
                이음줄 위치
                <select
                  value={
                    (el.slurStart ? el.slurStartPlacement : el.slurStopPlacement) === 'above' ||
                    (el.slurStart ? el.slurStartPlacement : el.slurStopPlacement) === 'below'
                      ? ((el.slurStart ? el.slurStartPlacement : el.slurStopPlacement) as 'above' | 'below')
                      : slurPlacement
                  }
                  onChange={(e) => {
                    const next = e.target.value as 'above' | 'below';
                    setSlurPlacement(next);
                    onFix({
                      kind: 'setSlurPlacement',
                      noteIndex: el.index,
                      slurEnd: el.slurStart && el.slurStop ? 'both' : el.slurStart ? 'start' : 'stop',
                      placement: next,
                    });
                  }}
                  style={{ marginLeft: 4 }}
                >
                  <option value="above">위</option>
                  <option value="below">아래</option>
                </select>
              </label>
            </>
          )}
          {laterNotes.length > 0 && (
            <label className="omr-measure-inline-field">
              이음줄 연결
              <select value={slurTo} onChange={(e) => setSlurTo(e.target.value)}>
                <option value="">—</option>
                {laterNotes.map((n) => (
                  <option key={n.index} value={String(n.index)}>
                    #{n.index}{n.hasGrace ? ' (꾸밈음)' : ''} {n.pitch ?? ''}
                  </option>
                ))}
              </select>
              <select
                value={slurPlacement}
                onChange={(e) => setSlurPlacement(e.target.value as 'above' | 'below')}
                style={{ marginLeft: 4 }}
                aria-label="이음줄 위치"
              >
                <option value="above">위</option>
                <option value="below">아래</option>
              </select>
              <button
                type="button"
                className="omr-hitl-fix-btn"
                disabled={!slurTo}
                onClick={() =>
                  onFix({
                    kind: 'addSlur',
                    fromNoteIndex: el.index,
                    toNoteIndex: parseInt(slurTo, 10),
                    placement: slurPlacement,
                  })
                }
              >
                이음줄 추가
              </button>
            </label>
          )}
        </div>
      )}
      {el.kind === 'note' && (
        <div className="omr-measure-stem-row">
          <button type="button" className="omr-hitl-fix-btn" onClick={() => onFix({ kind: 'setNoteStem', noteIndex: el.index, stem: 'up' })}>
            줄기 위
          </button>
          <button type="button" className="omr-hitl-fix-btn" onClick={() => onFix({ kind: 'setNoteStem', noteIndex: el.index, stem: 'down' })}>
            줄기 아래
          </button>
        </div>
      )}
      {beamCandidates.length >= 2 && (
        <div className="omr-measure-beam-row">
          <label className="omr-measure-inline-field">
            빔 끝
            <select value={String(beamEnd)} onChange={(e) => setBeamEnd(parseInt(e.target.value, 10))}>
              {beamCandidates.map((n) => (
                <option key={n.index} value={String(n.index)}>
                  #{n.index} {n.pitch ?? ''}
                </option>
              ))}
            </select>
          </label>
          <label className="omr-measure-inline-field">
            빔 단
            <select value={String(beamNumber)} onChange={(e) => setBeamNumber(parseInt(e.target.value, 10))}>
              <option value="1">1</option>
              <option value="2">2</option>
            </select>
          </label>
          <button
            type="button"
            className="omr-hitl-fix-btn omr-hitl-fix-btn--primary"
            disabled={beamNoteCount < 2}
            title={
              beamNoteCount < 2
                ? '빔은 8분음표 이하(16·32분 등)에만 적용됩니다 — 2분·4분·세잇단 혼합은 「세잇단 적용」과 bracket을 사용하세요'
                : `${beamNoteCount}개 음표를 빔 ${beamNumber}로 연결`
            }
            onClick={() => {
              const fromEl = noteEls.find((n) => n.index === beamLeaderIdx);
              onFix({
                kind: 'applyBeam',
                fromNoteIndex: beamLeaderIdx,
                toNoteIndex: beamEnd,
                fromPitch: fromEl?.pitch ?? undefined,
                toPitch: beamEndNote?.pitch ?? undefined,
                fromStaff: fromEl?.staff ?? undefined,
                toStaff: beamEndNote?.staff ?? undefined,
                beamNumber,
                beamNoteCount,
              });
            }}
          >
            빔 연결 ({beamNoteCount}개)
          </button>
          {el.beams?.length ? (
            <button
              type="button"
              className="omr-hitl-fix-btn"
              onClick={() =>
                onFix({
                  kind: 'removeBeam',
                  fromNoteIndex: existingBeam.from,
                  toNoteIndex: existingBeam.to,
                })
              }
            >
              빔 해제 (#{existingBeam.from}→#{existingBeam.to})
            </button>
          ) : null}
          {beamIncomplete ? (
            <p className="omr-measure-beam-hint" style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#c62828' }}>
              #{existingBeam.to}에 <code>beam=[end]</code>가 없습니다. OMR 잔여 태그일 수 있습니다 — 「빔 해제」 후 「빔 연결」→「MXL에 반영·미리보기」를
              다시 하세요. #0·#2 모두 8분음표·같은 줄기 방향인지 확인하세요.
            </p>
          ) : null}
        </div>
      )}
      {tripletCandidates.length >= 2 && (
        <div className="omr-measure-tuplet-row">
          <p className="omr-measure-tuplet-hint">
            <strong>빔 끝</strong>과 <strong>세잇단 끝</strong>은 별도입니다. <strong>2분+4분</strong>처럼 길이가 다른
            세잇단은 「<strong>음표 길이 유지</strong>」를 켜세요(2음표·3박). 균일 4분 3연음은 「기준 박자 →
            4분음표」. 빔 없는 잇단은 숫자 <strong>3</strong> 좌우 bracket. 가짜 스타카토 점이 가리면 「세잇단 숫자
            가린 점 제거」.
          </p>
          <label className="omr-measure-inline-field omr-measure-tuplet-preserve">
            <input
              type="checkbox"
              checked={tripletUsePreserve}
              onChange={(e) => setTripletPreserveTypes(e.target.checked)}
            />
            음표 길이 유지 (2분+4분 등)
          </label>
          <label className="omr-measure-inline-field">
            세잇단 끝
            <select value={String(tripletEnd)} onChange={(e) => setTripletEnd(parseInt(e.target.value, 10))}>
              {tripletCandidates.map((n) => (
                <option key={n.index} value={String(n.index)}>
                  #{n.index} {n.kind === 'rest' ? `${n.type ?? 'rest'}쉼표` : (n.pitch ?? '')}
                </option>
              ))}
            </select>
          </label>
          <label className="omr-measure-inline-field">
            기준 박자
            <select
              value={tripletUsePreserve ? tripletEffectiveNormalType : tripletNormalType}
              disabled={tripletUsePreserve}
              onChange={(e) => setTripletNormalType(e.target.value)}
            >
              <option value="quarter">4분음표</option>
              <option value="eighth">8분음표</option>
              <option value="16th">16분음표</option>
              <option value="half">2분음표</option>
            </select>
          </label>
          <button
            type="button"
            className="omr-hitl-fix-btn omr-hitl-fix-btn--primary"
            disabled={tripletNoteCount < 2}
            title={
              tripletNoteCount < 2
                ? '세잇단은 연속 음·쉼표 2개 이상이 필요합니다'
                : tripletUsePreserve
                  ? `${tripletNoteCount}개(${tripletActualNotes}박)를 ${tripletActualNotes}:2 ${tripletNormalTypeLabel(tripletEffectiveNormalType)} 잇단 — 길이 유지`
                  : `${tripletNoteCount}개를 ${tripletNoteCount}:2 ${tripletNormalTypeLabel(tripletNormalType)} 잇단으로 표시`
            }
            onClick={() =>
              onFix({
                kind: 'applyTriplet',
                fromNoteIndex: tripletLeaderIdx,
                toNoteIndex: tripletEnd,
                actualNotes: tripletActualNotes,
                normalNotes: 2,
                normalType: tripletEffectiveNormalType,
                preserveNoteTypes: tripletUsePreserve,
              })
            }
          >
            {tripletUsePreserve
              ? `세잇단 적용 (${tripletNoteCount}음·${tripletActualNotes}박)`
              : `세잇단 적용 (${tripletNoteCount}개)`}
          </button>
          {existingTriplet.from <= existingTriplet.to &&
          (el.timeMod || el.tuplet || chordLeaderEl?.timeMod || chordLeaderEl?.tuplet) ? (
            <button
              type="button"
              className="omr-hitl-fix-btn"
              onClick={() =>
                onFix({
                  kind: 'removeTriplet',
                  fromNoteIndex: tripletLeaderIdx,
                  toNoteIndex: existingTriplet.to,
                })
              }
            >
              세잇단 해제 (#{existingTriplet.from}→#{existingTriplet.to})
            </button>
          ) : null}
        </div>
      )}
      {(el.kind === 'note' || el.kind === 'rest') && (
        <div className="omr-measure-fermata-row">
          <span className="omr-measure-articulation-current">
            늘임표: {displayFermatas.length > 0 ? displayFermatas.join(' · ') : '없음'}
          </span>
          {fermatas.map((f) => {
            const ftype = f.split('(')[0];
            return (
              <button
                key={f}
                type="button"
                className="omr-hitl-fix-btn omr-hitl-fix-btn--danger"
                onClick={() => onFix({ kind: 'removeFermata', noteIndex: chordLeaderIdx, fermataType: ftype })}
              >
                늘임표({ftype}) 제거
              </button>
            );
          })}
          {fermatas.length === 0 ? (
            <>
              <label className="omr-measure-inline-field">
                종류
                <select value={fermataTypeSel} onChange={(e) => setFermataTypeSel(e.target.value as 'upright' | 'inverted')}>
                  <option value="upright">𝄐 upright</option>
                  <option value="inverted">𝄑 inverted</option>
                </select>
              </label>
              <button
                type="button"
                className="omr-hitl-fix-btn omr-hitl-fix-btn--primary"
                onClick={() => {
                  setPendingFermata(fermataTypeSel);
                  onFix({ kind: 'addFermata', noteIndex: chordLeaderIdx, fermataType: fermataTypeSel });
                }}
              >
                늘임표 추가
              </button>
            </>
          ) : null}
        </div>
      )}
      {el.kind === 'note' && !el.chord && (
        <div className="omr-measure-grace-row">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
            <span className="omr-measure-chord-hint" style={{ fontWeight: 600 }}>
              {el.hasGrace
                ? `꾸밈음 #${el.index} (${el.pitch}) 바로 앞 삽입`
                : `꾸밈음 — 본음 #${chordLeaderIdx}${chordLeaderEl?.pitch ? ` (${chordLeaderEl.pitch})` : ''} 바로 앞에 삽입`}
            </span>
            <button
              type="button"
              className="omr-hitl-fix-btn"
              style={{ fontSize: '0.78rem', padding: '2px 8px' }}
              onClick={() => {
                setGraceNotesDraft((prev) => [
                  ...prev,
                  {
                    step: prev[prev.length - 1]?.step ?? 'D',
                    octave: prev[prev.length - 1]?.octave ?? 4,
                    alter: prev[prev.length - 1]?.alter ?? '0',
                    noteType: prev[prev.length - 1]?.noteType ?? '16th',
                  },
                ]);
              }}
            >
              + 꾸밈음 추가 ({graceNotesDraft.length + 1}개로)
            </button>
          </div>

          {graceNotesDraft.map((draft, dIdx) => (
            <div key={dIdx} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.8rem', color: '#666', minWidth: 28 }}>#{dIdx + 1}:</span>
              <label className="omr-measure-inline-field">
                음
                <select
                  value={draft.step}
                  onChange={(e) => {
                    const next = [...graceNotesDraft];
                    next[dIdx].step = e.target.value;
                    setGraceNotesDraft(next);
                  }}
                >
                  {PITCH_STEPS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  max={9}
                  value={draft.octave}
                  onChange={(e) => {
                    const next = [...graceNotesDraft];
                    next[dIdx].octave = Number(e.target.value);
                    setGraceNotesDraft(next);
                  }}
                  style={{ width: 44 }}
                />
                <PitchAlterSelect
                  value={draft.alter}
                  onChange={(val) => {
                    const next = [...graceNotesDraft];
                    next[dIdx].alter = val;
                    setGraceNotesDraft(next);
                  }}
                />
              </label>
              <label className="omr-measure-inline-field">
                길이
                <select
                  value={draft.noteType}
                  onChange={(e) => {
                    const next = [...graceNotesDraft];
                    next[dIdx].noteType = e.target.value;
                    setGraceNotesDraft(next);
                  }}
                >
                  {GRACE_NOTE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {NOTE_TYPE_LABELS[t] ?? t}
                    </option>
                  ))}
                </select>
              </label>
              {graceNotesDraft.length > 1 ? (
                <button
                  type="button"
                  className="omr-hitl-fix-btn omr-hitl-fix-btn--danger"
                  style={{ padding: '2px 6px', fontSize: '0.75rem' }}
                  title="이 꾸밈음 항목 제거"
                  onClick={() => {
                    setGraceNotesDraft((prev) => prev.filter((_, i) => i !== dIdx));
                  }}
                >
                  ✕
                </button>
              ) : null}
            </div>
          ))}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
            {graceNotesDraft.length >= 2 ? (
              <label className="omr-measure-inline-field" style={{ fontWeight: 600, color: '#1d4ed8' }}>
                <input
                  type="checkbox"
                  checked={beamGraceNotes}
                  onChange={(e) => setBeamGraceNotes(e.target.checked)}
                />
                빔(연결줄) 연결
              </label>
            ) : null}
            <label className="omr-measure-inline-field">
              <input
                type="checkbox"
                checked={graceSlash}
                onChange={(e) => setGraceSlash(e.target.checked)}
              />
              slash 빗금 (단일 꾸밈음 acciaccatura)
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="omr-hitl-fix-btn omr-hitl-fix-btn--primary"
              onClick={() => {
                if (graceNotesDraft.length === 1) {
                  const d0 = graceNotesDraft[0];
                  onFix({
                    kind: 'insertGraceNote',
                    beforeNoteIndex: el.hasGrace ? el.index : chordLeaderIdx,
                    pitchStep: d0.step,
                    pitchOctave: d0.octave,
                    pitchAlter: pitchAlterFromOption(d0.alter),
                    noteType: d0.noteType,
                    graceSlash,
                  });
                } else {
                  onFix({
                    kind: 'insertGraceNote',
                    beforeNoteIndex: el.hasGrace ? el.index : chordLeaderIdx,
                    graceNotes: graceNotesDraft.map((g) => ({
                      pitchStep: g.step,
                      pitchOctave: g.octave,
                      pitchAlter: pitchAlterFromOption(g.alter),
                      noteType: g.noteType,
                      graceSlash,
                    })),
                    beamGraceNotes,
                    graceSlash,
                  });
                }
              }}
            >
              {graceNotesDraft.length > 1
                ? `앞에 빔 연결 꾸밈음 삽입 (${graceNotesDraft.length}개)`
                : '앞에 꾸밈음 추가'}
            </button>
            {gracesBefore.length > 0 && !el.hasGrace ? (
              <button
                type="button"
                className="omr-hitl-fix-btn omr-hitl-fix-btn--danger"
                onClick={() =>
                  onFix({
                    kind: 'removeGraceBeforeNote',
                    beforeNoteIndex: chordLeaderIdx,
                  })
                }
              >
                앞 꾸밈음 삭제 ({gracesBefore.length}개)
              </button>
            ) : null}
          </div>
        </div>
      )}
      {el.kind === 'note' && (
        <div className="omr-measure-chord-row">
          <span className="omr-measure-chord-hint">
            빠진 화음 음 — 리더 #{chordLeaderIdx}
            {chordLeaderEl?.pitch ? ` (${chordLeaderEl.pitch})` : ''} 와 같은 박자·줄기
          </span>
          <label className="omr-measure-inline-field">
            화음 음
            <select value={chordStep} onChange={(e) => setChordStep(e.target.value)}>
              {PITCH_STEPS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              max={9}
              value={chordOctave}
              onChange={(e) => setChordOctave(Number(e.target.value))}
              style={{ width: 48 }}
            />
            <PitchAlterSelect value={chordAlter} onChange={setChordAlter} />
          </label>
          <button
            type="button"
            className="omr-hitl-fix-btn omr-hitl-fix-btn--primary"
            onClick={() =>
              onFix({
                kind: 'insertChordMember',
                leaderNoteIndex: chordLeaderIdx,
                pitchStep: chordStep,
                pitchOctave: chordOctave,
                pitchAlter: pitchAlterFromOption(chordAlter),
              })
            }
          >
            화음 음 추가
          </button>
        </div>
      )}
      <button
        type="button"
        className="omr-hitl-fix-btn omr-hitl-fix-btn--danger"
        onClick={() => onFix({ kind: 'removeNote', noteIndex: el.index })}
      >
        {el.hasGrace ? '꾸밈음 삭제' : el.chord ? '이 화음 음만 삭제' : '이 요소 삭제'}
      </button>
    </div>
  );
}

type ChordMemberDraft = { step: string; octave: number; alter: PitchAlterOption };

function InsertElementForm({
  afterNoteIndex,
  staffDefault,
  noteEls,
  pendingLeader,
  onClearPendingLeader,
  onInsertRest,
  onInsertNote,
  onInsertChordMember,
}: {
  afterNoteIndex: number;
  staffDefault: number;
  noteEls: MeasureNoteEl[];
  pendingLeader: PendingInsertLeader | null;
  onClearPendingLeader: () => void;
  onInsertRest: (after: number, type: string, dotCount: number, staff: number, voice?: string) => void;
  onInsertNote: (
    after: number,
    step: string,
    octave: number,
    type: string,
    dotCount: number,
    staff: number,
    pitchAlter: number | undefined,
    extraChordMembers: Array<{ step: string; octave: number; alter?: number }>,
    voice?: string,
  ) => void;
  onInsertChordMember: (
    leaderNoteIndex: number,
    step: string,
    octave: number,
    pitchAlter: number | undefined,
  ) => void;
}) {
  const [restTypeValueSel, setRestTypeValueSel] = useState(noteTypeValue('quarter', 0));
  const [noteTypeValueSel, setNoteTypeValueSel] = useState(noteTypeValue('eighth', 0));
  const [staff, setStaff] = useState(staffDefault);
  const [voice, setVoice] = useState('1');
  const [step, setStep] = useState('C');
  const [octave, setOctave] = useState(4);
  const [insertAlter, setInsertAlter] = useState<PitchAlterOption>('0');
  const [extraChords, setExtraChords] = useState<ChordMemberDraft[]>([]);
  const [attachStep, setAttachStep] = useState('E');
  const [attachOctave, setAttachOctave] = useState(4);
  const [attachAlter, setAttachAlter] = useState<PitchAlterOption>('0');

  useEffect(() => {
    setStaff(staffDefault);
  }, [staffDefault]);

  const afterLabel = afterNoteIndex < 0 ? '마디 맨 앞' : `음·쉼표 #${afterNoteIndex} 뒤 (staff ${staff})`;
  const predictedLeader = predictLeaderIndexAfterInsert(noteEls, afterNoteIndex);

  const addExtraChordRow = () => {
    setExtraChords((prev) => [...prev, { step: 'G', octave: 4, alter: '0' }]);
  };

  const updateExtraChord = (i: number, patch: Partial<ChordMemberDraft>) => {
    setExtraChords((prev) => prev.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  };

  const removeExtraChord = (i: number) => {
    setExtraChords((prev) => prev.filter((_, j) => j !== i));
  };

  const submitNote = () => {
    const { type, dots } = parseNoteTypeValue(noteTypeValueSel);
    const extras = extraChords.map((c) => ({
      step: c.step,
      octave: c.octave,
      alter: pitchAlterFromOption(c.alter),
    }));
    onInsertNote(afterNoteIndex, step, octave, type, dots, staff, pitchAlterFromOption(insertAlter), extras, voice);
    setExtraChords([]);
  };

  return (
    <div className="omr-measure-insert-form">
      <div className="omr-measure-insert-form-title">빠진 요소 추가 ({afterLabel})</div>
      {pendingLeader ? (
        <div className="omr-measure-insert-pending-leader">
          <strong>
            리더 음표 대기 · #{pendingLeader.leaderNoteIndex} 예정 · {pendingLeader.pitchLabel}{' '}
            {NOTE_TYPE_OPTIONS.find(
              (o) => o.type === pendingLeader.noteType && o.dots === (pendingLeader.dotCount ?? 0),
            )?.label ?? pendingLeader.noteType}
          </strong>
          <p style={{ margin: '4px 0 8px', fontSize: '0.86rem', lineHeight: 1.45 }}>
            MXL 반영 전까지 목록에는 안 보입니다. 아래에서 <strong>화음 음</strong>을 더 추가한 뒤 「MXL에
            반영·미리보기」를 누르세요.
          </p>
          <div className="omr-measure-insert-form-row">
            <label>
              화음 음
              <select value={attachStep} onChange={(e) => setAttachStep(e.target.value)}>
                {PITCH_STEPS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                max={9}
                value={attachOctave}
                onChange={(e) => setAttachOctave(Number(e.target.value))}
                style={{ width: 48 }}
              />
              <PitchAlterSelect value={attachAlter} onChange={setAttachAlter} />
            </label>
            <button
              type="button"
              className="omr-hitl-fix-btn omr-hitl-fix-btn--primary"
              onClick={() =>
                onInsertChordMember(
                  pendingLeader.leaderNoteIndex,
                  attachStep,
                  attachOctave,
                  pitchAlterFromOption(attachAlter),
                )
              }
            >
              화음 음 추가
            </button>
            <button type="button" className="btn-muted" onClick={onClearPendingLeader}>
              리더 대기 취소
            </button>
          </div>
        </div>
      ) : null}
      <div className="omr-measure-insert-form-row">
        <label>
          스태프
          <input type="number" min={1} max={4} value={staff} onChange={(e) => setStaff(Number(e.target.value))} style={{ width: 48 }} />
        </label>
        <label>
          성부
          <input type="text" inputMode="numeric" pattern="[0-9]*" value={voice} onChange={(e) => setVoice(e.target.value)} style={{ width: 40 }} />
        </label>
        <label>
          쉼표 종류
          <select value={restTypeValueSel} onChange={(e) => setRestTypeValueSel(e.target.value)}>
            {NOTE_TYPE_OPTIONS.map((opt) => (
              <option key={`rest-${opt.value}`} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="omr-hitl-fix-btn"
          onClick={() => {
            const { type, dots } = parseNoteTypeValue(restTypeValueSel);
            onInsertRest(afterNoteIndex, type, dots, staff, voice);
          }}
        >
          쉼표 추가
        </button>
      </div>
      <div className="omr-measure-insert-form-row">
        <label>
          성부
          <input type="text" inputMode="numeric" pattern="[0-9]*" value={voice} onChange={(e) => setVoice(e.target.value)} style={{ width: 40 }} />
        </label>
        <label>
          리더 음높이
          <select value={step} onChange={(e) => setStep(e.target.value)}>
            {PITCH_STEPS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input type="number" min={0} max={9} value={octave} onChange={(e) => setOctave(Number(e.target.value))} style={{ width: 48 }} />
          <PitchAlterSelect value={insertAlter} onChange={setInsertAlter} />
        </label>
        <label>
          박자
          <select value={noteTypeValueSel} onChange={(e) => setNoteTypeValueSel(e.target.value)}>
            {NOTE_TYPE_OPTIONS.map((opt) => (
              <option key={`note-${opt.value}`} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="omr-measure-insert-chord-extras">
        <div className="omr-measure-insert-chord-extras-head">
          <span>화음 추가 음 (선택 · 반영 후 리더 #{predictedLeader} 예정)</span>
          <button type="button" className="btn-muted" onClick={addExtraChordRow}>
            + 화음 줄
          </button>
        </div>
        {extraChords.length === 0 ? (
          <p className="omr-measure-insert-chord-hint">3화음이면 「+ 화음 줄」 2번 → 아래 「음표+화음 추가」</p>
        ) : (
          extraChords.map((row, i) => (
            <div key={i} className="omr-measure-insert-form-row">
              <label>
                화음 {i + 2}음
                <select value={row.step} onChange={(e) => updateExtraChord(i, { step: e.target.value })}>
                  {PITCH_STEPS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  max={9}
                  value={row.octave}
                  onChange={(e) => updateExtraChord(i, { octave: Number(e.target.value) })}
                  style={{ width: 48 }}
                />
                <PitchAlterSelect value={row.alter} onChange={(v) => updateExtraChord(i, { alter: v })} />
              </label>
              <button type="button" className="btn-muted" onClick={() => removeExtraChord(i)}>
                제거
              </button>
            </div>
          ))
        )}
      </div>
      <div className="omr-measure-insert-form-row">
        <button type="button" className="omr-hitl-fix-btn omr-hitl-fix-btn--primary" onClick={submitNote}>
          {extraChords.length > 0 ? `음표+화음 추가 (1+${extraChords.length})` : '음표 추가'}
        </button>
      </div>
    </div>
  );
}


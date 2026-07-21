import { useCallback, useEffect, useMemo, useState } from 'react';
import { newFixId, type OmrHitlFix } from './omrHitlFixes';
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
  if (n.hasGrace || n.isCue) return false;
  if (n.kind !== 'note' || n.chord) return false;
  return SHORT_BEAM_TYPES.has(n.type ?? '');
}

const DYNAMICS_DIRECTION_VALUES = ['p', 'pp', 'mp', 'mf', 'f', 'ff', 'sf', 'sfz'] as const;

const ARTICULATION_ADD_OPTIONS: { id: string; label: string }[] = [
  { id: 'accent', label: 'Accent (>)' },
  { id: 'strong-accent', label: 'Strong accent (^)' },
  { id: 'staccato', label: 'Staccato (.)' },
  { id: 'tenuto', label: 'Tenuto (-)' },
  { id: 'marcato', label: 'Marcato' },
  { id: 'staccatissimo', label: 'Staccatissimo' },
];

function articulationOptionLabel(id: string): string {
  return ARTICULATION_ADD_OPTIONS.find((o) => o.id === id)?.label ?? id;
}

function articulationIdsFromEl(arts: string[] | undefined): string[] {
  return (arts ?? []).map((a) => a.split('(')[0]);
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

function noteDeletesWholeChord(el: MeasureNoteEl, noteEls: MeasureNoteEl[]): boolean {
  if (el.chord) return true;
  const pos = noteEls.findIndex((n) => n.index === el.index);
  if (pos < 0) return false;
  return noteEls[pos + 1]?.chord === true;
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
  let count = 0;
  let endIdx = elIndex;
  for (let i = startPos; i < noteEls.length && count < 3; i++) {
    if (isBeamableNoteEl(noteEls[i])) {
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
  const leaders = noteEls.filter(
    (n) => n.index >= span.from && n.index <= span.to && isBeamableNoteEl(n),
  );
  if (leaders.length === 0) return { from: el.index, to: el.index };
  return { from: leaders[0].index, to: leaders[leaders.length - 1].index };
}

function clampBeamEnd(elIndex: number, want: number, noteEls: MeasureNoteEl[], el?: MeasureNoteEl): number {
  const candidates = noteEls.filter((n) => n.index >= elIndex && isBeamableNoteEl(n)).slice(0, 8);
  if (candidates.length === 0) return elIndex;
  if (candidates.some((n) => n.index === want)) return want;
  if (el?.beams?.length) {
    const { to } = beamLeaderRange(el, noteEls);
    if (candidates.some((n) => n.index === to)) return to;
  }
  return candidates[Math.min(2, candidates.length - 1)].index;
}

function countBeamableInRange(from: number, to: number, noteEls: MeasureNoteEl[]): number {
  return noteEls.filter((n) => n.index >= from && n.index <= to && isBeamableNoteEl(n)).length;
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
  beams?: string[];
  stem?: string | null;
  /** 잇단음표 비율 (예: "3:2" = 세잇단) */
  timeMod?: string | null;
  /** 잇단 괄호 시작/끝 ("start" | "stop") */
  tuplet?: string | null;
  /** 붙어 있는 articulation 목록 (예: "staccato(above)") */
  articulations?: string[];
  /** 늘임표 (예: "upright", "inverted(below)") */
  fermatas?: string[];
  graceSlash?: boolean | null;
  noteDirection?: NoteDirectionInfo | null;
  /** 동일 음표에 words + dynamics 등 복수 direction */
  noteDirections?: NoteDirectionInfo[] | null;
};

export type NoteDirectionInfo = {
  directionType: 'dynamics' | 'words' | 'rehearsal';
  directionValue: string;
  placement?: 'above' | 'below';
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
        {directions.map((d) => (
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
              {d.placement ? ` · ${d.placement}` : ''}
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
  onAddFix: (fix: OmrHitlFix) => void;
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
  if (dir.directionType === 'dynamics') {
    const pl = dir.placement === 'below' ? '↓' : dir.placement === 'above' ? '↑' : '';
    return `dir:${dir.directionValue || 'p'}${pl}`;
  }
  if (dir.directionType === 'rehearsal') return `reh:${dir.directionValue || 'A'}`;
  return `txt:${dir.directionValue}`;
}

function elementTitle(
  el: MeasureElement,
  _noteEls: MeasureNoteEl[],
  ctx?: { partId?: string; staffLabel?: string | null; editStaffWithinPart?: number | null },
): string {
  const idx = el.index;
  const dirSuffix = noteDirectionsSummary(el) ? ` · ${noteDirectionsSummary(el)}` : '';
  if (el.kind === 'rest') {
    const dots = el.dotCount ? ` ·×${el.dotCount}` : '';
    const pos =
      el.displayStep && el.type && ['whole', 'half'].includes(el.type)
        ? ` (${el.displayStep}${el.displayOctave ?? ''})`
        : '';
    const dur = el.duration != null ? ` dur=${el.duration}` : '';
    const ferms = el.fermatas?.length ? ` fermata=${el.fermatas.join(',')}` : '';
    return `#${idx} ${el.type ?? 'rest'}쉼표${dots}${pos}${dur}${ferms}${dirSuffix}${el.staff != null ? ` staff=${el.staff}` : ''}`;
  }
  const tie =
    el.tieStart && el.tieStop ? ' tie↔' : el.tieStart ? ' tie→' : el.tieStop ? ' tie←' : '';
  const slur =
    el.slurStart && el.slurStop ? ' slur↔' : el.slurStart ? ' slur→' : el.slurStop ? ' slur←' : '';
  const dots = el.dotCount ? ` ·×${el.dotCount}` : '';
  const chord = el.chord ? ' (화음)' : '';
  const tuplet = el.timeMod
    ? ` ${el.timeMod === '3:2' ? '세잇단' : `잇단 ${el.timeMod}`}${el.tuplet === 'start' ? '▸' : el.tuplet === 'stop' ? '◂' : ''}`
    : '';
  const artSource =
    el.chord && _noteEls.length
      ? _noteEls.find((n) => n.index === chordLeaderIndex(el, _noteEls)) ?? el
      : el;
  const arts = artSource.articulations?.length ? ` [${artSource.articulations.join(', ')}]` : '';
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
  return `#${idx} ${pitchLabel}${graceTag} ${el.type ?? ''}${dots}${tie}${slur}${chord}${tuplet}${beam}${dur}${arts}${ferms}${dirSuffix}${el.stem ? ` stem=${el.stem}` : ''}${el.staff != null ? ` staff=${el.staff}` : ''}`;
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
  previewRevision = 0,
  lastPreviewMsg = '',
  pendingFixCount = 0,
  previewBusy = false,
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
    setFixMsg('대기 목록에 추가됨 → 아래 「MXL에 반영·미리보기」로 오른쪽 악보를 확인하세요.');
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
        요소를 고친 뒤 아래 <strong>「MXL에 반영·미리보기」</strong>를 눌러 오른쪽 MusicXML에서 결과를 확인하세요. 인쇄 마디 ≈ MXL <code>measure@number</code> + {measureOffset}.
      </p>
      {editStaffWithinPart != null ? (
        <p className="omr-measure-editor-hint" style={{ marginTop: '-0.35rem', fontSize: '0.88rem' }}>
          {staffLabel ?? `staff ${editStaffWithinPart}`} 줄만 표시 — 보정은 MusicXML part <code>{partId}</code> staff{' '}
          {editStaffWithinPart}(#번호는 전체 마디 기준).
        </p>
      ) : null}
      <p className="omr-measure-editor-hint" style={{ marginTop: '-0.35rem', fontSize: '0.88rem' }}>
        <strong>동시 시작·박자 다른 음</strong>(화음 아님)이 차례로 그려지면:{' '}
        {partStaveCount >= 2 && editStaffWithinPart == null ? (
          <label style={{ marginRight: 6 }}>
            줄
            <select
              value={String(repairStaff)}
              onChange={(e) => setRepairStaff(parseInt(e.target.value, 10) || 1)}
              style={{ marginLeft: 4 }}
            >
              <option value="1">{staffLabel === 'PL' ? 'staff 1' : 'PR / staff 1'}</option>
              <option value="2">PL / staff 2</option>
            </select>
          </label>
        ) : (
          <span style={{ marginRight: 6 }}>
            part <code>{partId}</code> staff {repairStaff}
            {staffLabel ? ` (${staffLabel})` : ''}
          </span>
        )}
        <button
          type="button"
          className="btn-muted"
          onClick={() =>
            pushFix({
              kind: 'repairParallelOnsets',
              staff: repairStaff,
              detail: 'same-x parallel',
            })
          }
        >
          동시 시작 voice 복원
        </button>
        <span style={{ marginLeft: 6, color: '#555' }}>
          → 「MXL에 반영·미리보기」 (전체·PR·PL 필터 모두에서 사용 가능)
        </span>
      </p>
      {fixMsg ? <p className="omr-measure-fix-msg">{fixMsg}</p> : null}
      {lastPreviewMsg ? <p className="omr-measure-preview-msg">{lastPreviewMsg}</p> : null}
      {loadErr ? <p className="omr-measure-editor-err">{loadErr}</p> : null}
      {loading && !snapshot ? <p className="omr-measure-editor-loading">마디 요소 불러오는 중…</p> : null}

      {snapshot ? (
        <>
          <MeasureDirectionsEditor
            directions={snapshot.measureDirections ?? []}
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

      {displayElements.length > 0 && (
        <ol className="omr-measure-element-list">
          {displayElements.map((el) => (
            <li key={`note-${el.index}`}>
              <div className="omr-measure-element-title">
                {elementTitle(el, noteEls, { partId, staffLabel, editStaffWithinPart })}
              </div>
              <MeasureNoteEditor
                el={el}
                noteEls={noteEls}
                jobId={jobId}
                partId={partId}
                measureMxl={measureMxl}
                onFix={pushFix}
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
        onInsertRest={(afterNoteIndex, noteType, dotCount, staff) => {
          setPendingInsertLeader(null);
          pushFix({ kind: 'insertRest', afterNoteIndex, noteType, dotCount, staff });
        }}
        onInsertNote={(afterNoteIndex, pitchStep, pitchOctave, noteType, dotCount, staff, pitchAlter, extraChordMembers) => {
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
  onFix: (partial: Omit<OmrHitlFix, 'id' | 'partId' | 'measureMxl'>) => void;
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
          `/api/omr-hitl/${jobId}/measure?partId=${encodeURIComponent(partId)}&measureMxl=${encodeURIComponent(mxl)}`,
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
    const partial: Omit<OmrHitlFix, 'id' | 'partId' | 'measureMxl'> = {
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
    const partial: Omit<OmrHitlFix, 'id' | 'partId' | 'measureMxl'> = {
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
        partial.fromPitchAlter = pitchAlterFromOption(picked.pitchAlter);
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
  const [dynPlacement, setDynPlacement] = useState<'above' | 'below'>('above');
  const [textValue, setTextValue] = useState('');

  useEffect(() => {
    setMode('none');
    setDynValue('mf');
    setDynPlacement('above');
    setTextValue('');
  }, [noteIndex]);

  const apply = () => {
    if (mode === 'none') return;
    if (mode === 'dynamics') {
      onFix({
        kind: 'addNoteDirection',
        noteIndex,
        directionType: 'dynamics',
        directionValue: dynValue,
        placement: dynPlacement,
      });
      return;
    }
    onFix({
      kind: 'addNoteDirection',
      noteIndex,
      directionType: mode,
      directionValue: textValue.trim() || (mode === 'rehearsal' ? 'A' : ' '),
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
        </div>
      ) : null}
      <label className="omr-measure-inline-field">
        추가
        <select
          value={mode === 'none' ? '' : mode}
          onChange={(e) => {
            const v = e.target.value;
            setMode(v === '' ? 'none' : (v as 'dynamics' | 'words' | 'rehearsal'));
          }}
        >
          <option value="">종류 선택</option>
          <option value="dynamics">셈여림</option>
          <option value="words">텍스트</option>
          <option value="rehearsal">리허설</option>
        </select>
      </label>
      {mode === 'dynamics' ? (
        <>
          <select value={dynValue} onChange={(e) => setDynValue(e.target.value)} aria-label="dynamics">
            {DYNAMICS_DIRECTION_VALUES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <label className="omr-measure-inline-field">
            위치
            <select
              value={dynPlacement}
              onChange={(e) => setDynPlacement(e.target.value as 'above' | 'below')}
              aria-label="dynamics placement"
            >
              <option value="above">음표 위</option>
              <option value="below">음표 아래</option>
            </select>
          </label>
        </>
      ) : mode === 'words' || mode === 'rehearsal' ? (
        <input
          type="text"
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          placeholder={mode === 'rehearsal' ? 'A' : 'a tempo, rit. …'}
          style={{ minWidth: 120 }}
        />
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

function MeasureNoteEditor({
  el,
  noteEls,
  jobId,
  partId,
  measureMxl,
  onFix,
}: {
  el: MeasureNoteEl;
  noteEls: MeasureNoteEl[];
  jobId: string;
  partId: string;
  measureMxl: number;
  onFix: (partial: Omit<OmrHitlFix, 'id' | 'partId' | 'measureMxl'>) => void;
}) {
  const parsed = parsePitch(el.pitch);
  const [pitchStep, setPitchStep] = useState(parsed.step);
  const [pitchOctave, setPitchOctave] = useState(parsed.octave);
  const [pitchAlter, setPitchAlter] = useState<PitchAlterOption>(pitchAlterToOption(el.pitchAlter));
  const [noteTypeValueSel, setNoteTypeValueSel] = useState(
    noteTypeValue(el.type ?? 'quarter', el.dotCount ?? (el.isDotted ? 1 : 0)),
  );
  const [staffN, setStaffN] = useState(el.staff ?? 1);
  const [tieTo, setTieTo] = useState('');
  const [slurTo, setSlurTo] = useState('');
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
  const [graceStep, setGraceStep] = useState(parsed.step);
  const [graceOctave, setGraceOctave] = useState(parsed.octave);
  const [graceAlter, setGraceAlter] = useState<PitchAlterOption>(pitchAlterToOption(el.pitchAlter));
  const [graceType, setGraceType] = useState<string>('eighth');
  const [graceSlash, setGraceSlash] = useState(true);

  useEffect(() => {
    setPendingArtIds([]);
    const p = parsePitch(el.pitch);
    setPitchStep(p.step);
    setPitchOctave(p.octave);
    setPitchAlter(pitchAlterToOption(el.pitchAlter));
    setGraceStep(p.step);
    setGraceOctave(p.octave);
    setGraceAlter(pitchAlterToOption(el.pitchAlter));
    setGraceType('eighth');
    setGraceSlash(true);
    setNoteTypeValueSel(
      noteTypeValue(el.type ?? 'quarter', el.dotCount ?? (el.isDotted ? 1 : 0)),
    );
    setStaffN(el.staff ?? 1);
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
  }, [el.index, el.pitch, el.pitchAlter, el.type, el.staff, el.isDotted, el.dotCount, el.beams, noteEls]);

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
  const beamLeaderIdx = chordLeaderIndex(el, noteEls);
  const beamCandidates = noteEls.filter((n) => n.index >= beamLeaderIdx && isBeamableNoteEl(n)).slice(0, 8);
  const beamEndNote = noteEls.find((n) => n.index === beamEnd);
  const beamNoteCount = countBeamableInRange(beamLeaderIdx, beamEnd, noteEls);
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
  const fermatas = chordLeaderEl?.fermatas ?? el.fermatas ?? [];
  const [fermataTypeSel, setFermataTypeSel] = useState<'upright' | 'inverted'>('upright');
  const [pendingFermata, setPendingFermata] = useState<string | null>(null);
  const displayFermatas = [
    ...fermatas,
    ...(pendingFermata && !fermatas.some((f) => f.startsWith(pendingFermata)) ? [`${pendingFermata}(반영 대기)`] : []),
  ];

  useEffect(() => {
    setPendingArtIds((prev) => prev.filter((id) => !savedArtIds.includes(id)));
    setPendingFermata(null);
  }, [savedArtIds.join('|'), fermatas.join('|'), el.index]);

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
        const beamSide = (chordLeaderEl?.stem ?? el.stem) === 'up' ? 'above' : (chordLeaderEl?.stem ?? el.stem) === 'down' ? 'below' : null;
        const likelyTupletDigit =
          (chordLeaderEl?.timeMod ?? el.timeMod) != null &&
          name === 'staccato' &&
          beamSide != null &&
          art.includes(beamSide);
        return (
          <button
            key={art}
            type="button"
            className={`omr-hitl-fix-btn${likelyTupletDigit ? ' omr-hitl-fix-btn--primary' : ''}`}
            title={
              likelyTupletDigit
                ? '잇단 숫자(3)를 가리는 점 — OMR이 숫자를 스타카토로 오인한 것일 가능성이 높습니다'
                : `이 음표의 ${name} 표를 제거합니다`
            }
            onClick={() => onFix({ kind: 'removeArticulation', noteIndex: chordLeaderIdx, articulation: name })}
          >
            {likelyTupletDigit ? `세잇단 숫자 가린 점(${name}) 제거` : `${name} 제거`}
          </button>
        );
      })}
      {el.kind === 'note' && (
        <div className="omr-measure-articulation-row">
          <span className="omr-measure-articulation-current">
            현재 표:{' '}
            {displayArtIds.length > 0
              ? displayArtIds.map((id) => articulationOptionLabel(id)).join(' · ')
              : '없음'}
            {pendingArtIds.length > 0 && savedArtIds.length < displayArtIds.length ? (
              <span className="omr-measure-articulation-pending"> (반영 대기)</span>
            ) : null}
          </span>
          {addableArtOptions.length > 0 ? (
            <label className="omr-measure-inline-field omr-measure-articulation-add">
              표 더 추가
              <select
                value=""
                onChange={(e) => {
                  const art = e.target.value;
                  if (!art) return;
                  setPendingArtIds((prev) => (prev.includes(art) ? prev : [...prev, art]));
                  onFix({ kind: 'addArticulation', noteIndex: chordLeaderIdx, articulation: art });
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
          ) : (
            <span className="omr-measure-articulation-full">추가 가능한 표 없음</span>
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
            </>
          )}
          {laterNotes.length > 0 && (
            <label className="omr-measure-inline-field">
              이음줄 연결
              <select value={slurTo} onChange={(e) => setSlurTo(e.target.value)}>
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
                disabled={!slurTo}
                onClick={() =>
                  onFix({
                    kind: 'addSlur',
                    fromNoteIndex: el.index,
                    toNoteIndex: parseInt(slurTo, 10),
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
                  beamNumber,
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
      {el.kind === 'note' && !el.hasGrace && !el.chord && (
        <div className="omr-measure-grace-row">
          <span className="omr-measure-chord-hint">
            꾸밈음 — 본음 #{chordLeaderIdx}
            {chordLeaderEl?.pitch ? ` (${chordLeaderEl.pitch})` : ''} 바로 앞에 삽입
          </span>
          <label className="omr-measure-inline-field">
            꾸밈음 음
            <select value={graceStep} onChange={(e) => setGraceStep(e.target.value)}>
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
              value={graceOctave}
              onChange={(e) => setGraceOctave(Number(e.target.value))}
              style={{ width: 48 }}
            />
            <PitchAlterSelect value={graceAlter} onChange={setGraceAlter} />
          </label>
          <label className="omr-measure-inline-field">
            길이
            <select value={graceType} onChange={(e) => setGraceType(e.target.value)}>
              {GRACE_NOTE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {NOTE_TYPE_LABELS[t] ?? t}
                </option>
              ))}
            </select>
          </label>
          <label className="omr-measure-inline-field">
            <input type="checkbox" checked={graceSlash} onChange={(e) => setGraceSlash(e.target.checked)} />
            slash 꾸밈음
          </label>
          <button
            type="button"
            className="omr-hitl-fix-btn omr-hitl-fix-btn--primary"
            onClick={() =>
              onFix({
                kind: 'insertGraceNote',
                beforeNoteIndex: chordLeaderIdx,
                pitchStep: graceStep,
                pitchOctave: graceOctave,
                pitchAlter: pitchAlterFromOption(graceAlter),
                noteType: graceType,
                graceSlash,
              })
            }
          >
            앞에 꾸밈음 추가
          </button>
          {gracesBefore.length > 0 ? (
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
        {el.hasGrace ? '꾸밈음 삭제' : noteDeletesWholeChord(el, noteEls) ? '화음 삭제' : '이 요소 삭제'}
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
  onInsertRest: (after: number, type: string, dotCount: number, staff: number) => void;
  onInsertNote: (
    after: number,
    step: string,
    octave: number,
    type: string,
    dotCount: number,
    staff: number,
    pitchAlter: number | undefined,
    extraChordMembers: Array<{ step: string; octave: number; alter?: number }>,
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
    onInsertNote(afterNoteIndex, step, octave, type, dots, staff, pitchAlterFromOption(insertAlter), extras);
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
            onInsertRest(afterNoteIndex, type, dots, staff);
          }}
        >
          쉼표 추가
        </button>
      </div>
      <div className="omr-measure-insert-form-row">
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


import { useCallback, useEffect, useMemo, useState } from 'react';
import { newFixId, type OmrHitlFix } from './omrHitlFixes';
import {
  PitchAlterSelect,
  formatPitchLabel,
  pitchAlterFromOption,
  pitchAlterToOption,
  type PitchAlterOption,
} from './omrPitchUi';

type FixPartial = Omit<OmrHitlFix, 'id' | 'partId' | 'measureMxl'>;

const NOTE_TYPES = ['whole', 'half', 'quarter', 'eighth', '16th', '32nd'] as const;
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
  if (!el.timeMod) return { from: el.index, to: el.index };
  const pos = noteEls.findIndex((n) => n.index === el.index);
  if (pos < 0) return { from: el.index, to: el.index };
  let start = pos;
  while (start > 0 && noteEls[start - 1].timeMod === el.timeMod) start -= 1;
  let end = pos;
  while (end + 1 < noteEls.length && noteEls[end + 1].timeMod === el.timeMod) end += 1;
  return { from: noteEls[start].index, to: noteEls[end].index };
}

function isBeamableNoteEl(n: MeasureNoteEl): boolean {
  if (n.hasGrace || n.isCue) return false;
  return n.kind === 'note' && !n.chord;
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
};

export type MeasureElement = MeasureDirectionEl | MeasureNoteEl;

type MeasureSnapshot = {
  partId: string;
  measureMxl: string;
  elements?: MeasureElement[];
  notes?: MeasureNoteEl[];
};

type Props = {
  jobId: string;
  partId: string;
  measureMxl: number;
  measurePrinted: number;
  measureOffset: number;
  staffLabel?: string;
  /** 피아노 PR/PL 등 — 목록·삽입 기본 staff 필터 (원본 #index 유지) */
  editStaffWithinPart?: number | null;
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
};

function elementTitle(el: MeasureElement, _noteEls: MeasureNoteEl[]): string {
  if (el.elementKind === 'direction') {
    const label = el.text?.trim() || '(표기 없음 — dynamics 등 XML 태그만 있을 수 있음)';
    return `direction #${el.directionIndex}: ${label}`;
  }
  const idx = el.index;
  if (el.kind === 'rest') {
    const dots = el.dotCount ? ` ·×${el.dotCount}` : '';
    const pos =
      el.displayStep && el.type && ['whole', 'half'].includes(el.type)
        ? ` (${el.displayStep}${el.displayOctave ?? ''})`
        : '';
    const dur = el.duration != null ? ` dur=${el.duration}` : '';
    return `#${idx} ${el.type ?? 'rest'}쉼표${dots}${pos}${dur}${el.staff != null ? ` staff=${el.staff}` : ''}`;
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
  const arts = el.articulations?.length ? ` [${el.articulations.join(', ')}]` : '';
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
  return `#${idx} ${pitchLabel} ${el.type ?? ''}${dots}${tie}${slur}${chord}${tuplet}${beam}${dur}${arts}${el.stem ? ` stem=${el.stem}` : ''}${el.staff != null ? ` staff=${el.staff}` : ''}`;
}

export function OmrMeasureEditor({
  jobId,
  partId,
  measureMxl,
  measurePrinted,
  measureOffset,
  staffLabel,
  editStaffWithinPart = null,
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
    setPendingInsertLeader(null);
  }, [previewRevision, insertAfter, partId, measureMxl]);

  const displayElements = useMemo(() => {
    if (editStaffWithinPart == null) return elements;
    return elements.filter((el) => {
      if (el.elementKind === 'direction') return true;
      return (el.staff ?? 1) === editStaffWithinPart;
    });
  }, [elements, editStaffWithinPart]);

  const noteEls = useMemo(
    () => elements.filter((e): e is MeasureNoteEl => e.elementKind === 'note'),
    [elements],
  );

  const pushFix = (partial: FixPartial) => {
    onAddFix({
      id: newFixId(),
      partId,
      measureMxl: String(measureMxl),
      source: 'manual',
      ...partial,
    });
    setFixMsg('대기 목록에 추가됨 → 아래 「MXL에 반영·미리보기」로 오른쪽 악보를 확인하세요.');
  };

  return (
    <div className="omr-measure-editor">
      <div className="omr-measure-editor-head">
        <strong>
          마디 편집 · 인쇄 m.{measurePrinted}
          <span className="omr-measure-editor-sub">
            (MXL {measureMxl}
            {staffLabel ? ` · ${staffLabel}` : ''})
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
          staff {editStaffWithinPart} 줄만 표시 (#번호는 전체 마디 기준).
        </p>
      ) : null}
      {fixMsg ? <p className="omr-measure-fix-msg">{fixMsg}</p> : null}
      {lastPreviewMsg ? <p className="omr-measure-preview-msg">{lastPreviewMsg}</p> : null}
      {loadErr ? <p className="omr-measure-editor-err">{loadErr}</p> : null}
      {loading && !snapshot ? <p className="omr-measure-editor-loading">마디 요소 불러오는 중…</p> : null}

      {displayElements.length > 0 && (
        <ol className="omr-measure-element-list">
          {displayElements.map((el) => (
            <li key={el.elementKind === 'direction' ? `dir-${el.directionIndex}` : `note-${el.index}`}>
              <div className="omr-measure-element-title">{elementTitle(el, noteEls)}</div>
              {el.elementKind === 'direction' ? (
                <div className="omr-measure-element-actions omr-measure-direction-actions">
                  <button
                    type="button"
                    className="omr-hitl-fix-btn omr-hitl-fix-btn--danger"
                    onClick={() =>
                      pushFix({ kind: 'removeDirection', directionIndex: el.directionIndex, detail: el.text })
                    }
                  >
                    direction 삭제
                  </button>
                  {isLikelySpuriousDirection(el.text) ? (
                    <button
                      type="button"
                      className="omr-hitl-fix-btn omr-hitl-fix-btn--primary"
                      onClick={() =>
                        pushFix({
                          kind: 'removeSpuriousDirection',
                          detail: el.text || undefined,
                        })
                      }
                    >
                      잘못된 P·숫자 direction 삭제
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="omr-hitl-fix-btn"
                      onClick={() =>
                        pushFix({
                          kind: 'removeSpuriousDirection',
                          detail: el.text || undefined,
                        })
                      }
                    >
                      P·잡텍스트 패턴 삭제
                    </button>
                  )}
                  {isLikelySpuriousDirection(el.text) ? (
                    <p className="omr-measure-direction-hint" style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#1565c0' }}>
                      Accent(&gt;)·세잇단 숫자 등이 셈여림 <code>dyn:p</code>로 오인된 경우입니다. 삭제한 뒤 해당 음표에 「Accent 추가」를 사용하세요.
                    </p>
                  ) : null}
                </div>
              ) : (
                <MeasureNoteEditor
                  el={el}
                  noteEls={noteEls}
                  onFix={pushFix}
                />
              )}
              <div className="omr-measure-insert-row">
                <span className="omr-measure-insert-label">이 위치 뒤에 추가:</span>
                <button
                  type="button"
                  className="btn-muted omr-measure-insert-btn"
                  onClick={() => {
                    if (el.elementKind === 'note') {
                      setInsertAfter(el.index);
                      const staff = el.staff ?? editStaffWithinPart ?? 1;
                      setInsertStaff(staff);
                    }
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
        onInsertRest={(afterNoteIndex, noteType, staff) => {
          setPendingInsertLeader(null);
          pushFix({ kind: 'insertRest', afterNoteIndex, noteType, staff });
        }}
        onInsertNote={(afterNoteIndex, pitchStep, pitchOctave, noteType, staff, pitchAlter, extraChordMembers) => {
          const leaderIdx = predictLeaderIndexAfterInsert(noteEls, afterNoteIndex);
          const leaderLabel = formatPitchLabel(pitchStep, pitchOctave, pitchAlter);
          pushFix({
            kind: 'insertNote',
            afterNoteIndex,
            pitchStep,
            pitchOctave,
            pitchAlter,
            noteType,
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

      <DirectionInsertForm
        afterNoteIndex={insertAfter}
        staffDefault={insertStaff}
        noteEls={noteEls}
        onInsert={(partial) => {
          pushFix(partial);
          setFixMsg('direction 추가 보정을 대기 목록에 넣었습니다 → 「MXL에 반영·미리보기」');
        }}
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

function MeasureNoteEditor({
  el,
  noteEls,
  onFix,
}: {
  el: MeasureNoteEl;
  noteEls: MeasureNoteEl[];
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
  const [tripletNormalType, setTripletNormalType] = useState(
    el.type === '16th' || el.type === '32nd' ? el.type : 'eighth',
  );
  const [beamEnd, setBeamEnd] = useState(() =>
    defaultBeamEndIndex(chordLeaderIndex(el, noteEls), noteEls, el),
  );
  const [beamNumber, setBeamNumber] = useState(1);
  const [chordStep, setChordStep] = useState('G');
  const [chordOctave, setChordOctave] = useState(4);
  const [chordAlter, setChordAlter] = useState<PitchAlterOption>('0');

  useEffect(() => {
    const p = parsePitch(el.pitch);
    setPitchStep(p.step);
    setPitchOctave(p.octave);
    setPitchAlter(pitchAlterToOption(el.pitchAlter));
    setNoteTypeValueSel(
      noteTypeValue(el.type ?? 'quarter', el.dotCount ?? (el.isDotted ? 1 : 0)),
    );
    setStaffN(el.staff ?? 1);
    setTripletEnd(defaultTripletEndIndex(chordLeaderIndex(el, noteEls), noteEls));
    setTripletNormalType(el.type === '16th' || el.type === '32nd' ? el.type : 'eighth');
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
      {(el.articulations ?? []).map((art) => {
        const name = art.split('(')[0];
        const beamSide = el.stem === 'up' ? 'above' : el.stem === 'down' ? 'below' : null;
        const likelyTupletDigit =
          el.timeMod != null && name === 'staccato' && beamSide != null && art.includes(beamSide);
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
            onClick={() => onFix({ kind: 'removeArticulation', noteIndex: el.index, articulation: name })}
          >
            {likelyTupletDigit ? `세잇단 숫자 가린 점(${name}) 제거` : `${name} 제거`}
          </button>
        );
      })}
      {el.kind === 'note' && (
        <label className="omr-measure-inline-field omr-measure-articulation-add">
          표 추가
          <select
            defaultValue=""
            onChange={(e) => {
              const art = e.target.value;
              if (!art) return;
              const leaderIdx = chordLeaderIndex(el, noteEls);
              onFix({ kind: 'addArticulation', noteIndex: leaderIdx, articulation: art });
              e.target.value = '';
            }}
          >
            <option value="">— 선택 —</option>
            {ARTICULATION_ADD_OPTIONS.filter((opt) => {
              const leaderIdx = chordLeaderIndex(el, noteEls);
              const leaderEl = noteEls.find((n) => n.index === leaderIdx);
              return !(leaderEl?.articulations ?? []).some((a) => a.split('(')[0] === opt.id);
            }).map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
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
                ? '빔 연결은 음표 2개 이상이 필요합니다 (쉼표·화음 하위음·grace 제외)'
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
            <strong>빔 끝</strong>과 <strong>세잇단 끝</strong>은 별도입니다. 8분 3연음이면 보통 같은 3개(#) 범위를
            씁니다 — 「세잇단 적용」→ (필요 시) 「빔 연결」→ 「MXL에 반영·미리보기」. 숫자 <strong>3</strong>은
            괄호 없이 빔·줄기 쪽에 그려지며, 가짜 스타카토 점이 가리면 「세잇단 숫자 가린 점 제거」를 누르세요.
          </p>
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
            <select value={tripletNormalType} onChange={(e) => setTripletNormalType(e.target.value)}>
              <option value="eighth">8분음표</option>
              <option value="16th">16분음표</option>
            </select>
          </label>
          <button
            type="button"
            className="omr-hitl-fix-btn omr-hitl-fix-btn--primary"
            disabled={tripletNoteCount < 2}
            title={
              tripletNoteCount < 2
                ? '세잇단은 연속 음·쉼표 2개 이상이 필요합니다'
                : `${tripletNoteCount}개를 ${tripletNoteCount}:2 ${tripletNormalType === '16th' ? '16분' : '8분'} 잇단으로 표시`
            }
            onClick={() =>
              onFix({
                kind: 'applyTriplet',
                fromNoteIndex: tripletLeaderIdx,
                toNoteIndex: tripletEnd,
                actualNotes: tripletNoteCount,
                normalNotes: 2,
                normalType: tripletNormalType,
              })
            }
          >
            세잇단 적용 ({tripletNoteCount}개)
          </button>
          {el.timeMod ? (
            <button
              type="button"
              className="omr-hitl-fix-btn"
              onClick={() =>
                onFix({
                  kind: 'removeTriplet',
                  fromNoteIndex: existingTriplet.from,
                  toNoteIndex: existingTriplet.to,
                })
              }
            >
              세잇단 해제 (#{existingTriplet.from}→#{existingTriplet.to})
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
                pitchAlter: chordAlter === '0' ? undefined : Number(chordAlter),
              })
            }
          >
            화음 음 추가
          </button>
        </div>
      )}
      <button type="button" className="omr-hitl-fix-btn omr-hitl-fix-btn--danger" onClick={() => onFix({ kind: 'removeNote', noteIndex: el.index })}>
        이 요소 삭제
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
  onInsertRest: (after: number, type: string, staff: number) => void;
  onInsertNote: (
    after: number,
    step: string,
    octave: number,
    type: string,
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
  const [restType, setRestType] = useState('quarter');
  const [noteType, setNoteType] = useState('eighth');
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
    const extras = extraChords.map((c) => ({
      step: c.step,
      octave: c.octave,
      alter: pitchAlterFromOption(c.alter),
    }));
    onInsertNote(afterNoteIndex, step, octave, noteType, staff, pitchAlterFromOption(insertAlter), extras);
    setExtraChords([]);
  };

  return (
    <div className="omr-measure-insert-form">
      <div className="omr-measure-insert-form-title">빠진 요소 추가 ({afterLabel})</div>
      {pendingLeader ? (
        <div className="omr-measure-insert-pending-leader">
          <strong>
            리더 음표 대기 · #{pendingLeader.leaderNoteIndex} 예정 · {pendingLeader.pitchLabel}{' '}
            {pendingLeader.noteType}
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
          <select value={restType} onChange={(e) => setRestType(e.target.value)}>
            {NOTE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="omr-hitl-fix-btn" onClick={() => onInsertRest(afterNoteIndex, restType, staff)}>
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
          <select value={noteType} onChange={(e) => setNoteType(e.target.value)}>
            {NOTE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
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

function DirectionInsertForm({
  afterNoteIndex,
  staffDefault,
  noteEls,
  onInsert,
}: {
  afterNoteIndex: number;
  staffDefault: number;
  noteEls: MeasureNoteEl[];
  onInsert: (partial: Omit<OmrHitlFix, 'id' | 'partId' | 'measureMxl'>) => void;
}) {
  const [directionType, setDirectionType] = useState<'dynamics' | 'words' | 'rehearsal'>('dynamics');
  const [dynamicsValue, setDynamicsValue] = useState<string>('p');
  const [wordsValue, setWordsValue] = useState('');
  const [staff, setStaff] = useState(staffDefault);
  const [localAfter, setLocalAfter] = useState(afterNoteIndex);

  useEffect(() => {
    setStaff(staffDefault);
  }, [staffDefault]);

  useEffect(() => {
    setLocalAfter(afterNoteIndex);
  }, [afterNoteIndex]);

  const afterLabel =
    localAfter < 0
      ? '마디 앞'
      : (() => {
          const n = noteEls.find((x) => x.index === localAfter);
          return n ? `#${localAfter} ${n.pitch ?? n.type ?? ''} 뒤` : `#${localAfter} 뒤`;
        })();

  return (
    <div className="omr-measure-direction-insert">
      <p className="omr-measure-insert-heading">direction 추가</p>
      <p className="omr-measure-editor-hint" style={{ fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
        셈여림·텍스트·리허설 표 등. 「여기 뒤」로 위치를 고른 뒤 추가하거나, 아래에서 직접 지정하세요.
      </p>
      <div className="omr-measure-insert-form-row">
        <label className="omr-measure-inline-field">
          위치
          <select value={String(localAfter)} onChange={(e) => setLocalAfter(parseInt(e.target.value, 10))}>
            <option value="-1">마디 앞</option>
            {noteEls.map((n) => (
              <option key={n.index} value={String(n.index)}>
                #{n.index} {n.pitch ?? n.type ?? ''} 뒤
              </option>
            ))}
          </select>
        </label>
        <label className="omr-measure-inline-field">
          종류
          <select
            value={directionType}
            onChange={(e) => setDirectionType(e.target.value as 'dynamics' | 'words' | 'rehearsal')}
          >
            <option value="dynamics">셈여림 (dynamics)</option>
            <option value="words">텍스트 (words)</option>
            <option value="rehearsal">리허설 (rehearsal)</option>
          </select>
        </label>
        <label className="omr-measure-inline-field">
          스태프
          <input type="number" min={1} max={4} value={staff} onChange={(e) => setStaff(Number(e.target.value))} style={{ width: 48 }} />
        </label>
      </div>
      <div className="omr-measure-insert-form-row">
        {directionType === 'dynamics' ? (
          <label className="omr-measure-inline-field">
            dynamics
            <select value={dynamicsValue} onChange={(e) => setDynamicsValue(e.target.value)}>
              {DYNAMICS_DIRECTION_VALUES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="omr-measure-inline-field">
            {directionType === 'rehearsal' ? '리허설 글자' : '텍스트'}
            <input
              type="text"
              value={wordsValue}
              onChange={(e) => setWordsValue(e.target.value)}
              placeholder={directionType === 'rehearsal' ? 'A' : 'Andante'}
              style={{ minWidth: 120 }}
            />
          </label>
        )}
        <button
          type="button"
          className="omr-hitl-fix-btn omr-hitl-fix-btn--primary"
          onClick={() =>
            onInsert({
              kind: 'insertDirection',
              afterNoteIndex: localAfter,
              staff,
              directionType,
              directionValue:
                directionType === 'dynamics'
                  ? dynamicsValue
                  : wordsValue.trim() || (directionType === 'rehearsal' ? 'A' : ' '),
            })
          }
        >
          direction 추가 ({afterLabel})
        </button>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { newFixId, type OmrHitlFix } from './omrHitlFixes';

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

function defaultTripletEndIndex(elIndex: number, noteEls: MeasureNoteEl[]): number {
  const startPos = noteEls.findIndex((n) => n.index === elIndex);
  if (startPos < 0) return elIndex;
  const endNote = noteEls[Math.min(startPos + 2, noteEls.length - 1)];
  return endNote?.index ?? elIndex;
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
  return n.kind === 'note' && !n.chord;
}

function defaultBeamEndIndex(elIndex: number, noteEls: MeasureNoteEl[]): number {
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

function countBeamableInRange(from: number, to: number, noteEls: MeasureNoteEl[]): number {
  return noteEls.filter((n) => n.index >= from && n.index <= to && isBeamableNoteEl(n)).length;
}

function countNotesInRange(from: number, to: number, noteEls: MeasureNoteEl[]): number {
  return noteEls.filter((n) => n.index >= from && n.index <= to).length;
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

function elementTitle(el: MeasureElement, noteEls: MeasureNoteEl[]): string {
  if (el.elementKind === 'direction') {
    return `direction #${el.directionIndex}${el.text ? `: ${el.text}` : ''}`;
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
  const dots = el.dotCount ? ` ·×${el.dotCount}` : '';
  const chord = el.chord ? ' (화음)' : '';
  const tuplet = el.timeMod
    ? ` ${el.timeMod === '3:2' ? '세잇단' : `잇단 ${el.timeMod}`}${el.tuplet === 'start' ? '▸' : el.tuplet === 'stop' ? '◂' : ''}`
    : '';
  const arts = el.articulations?.length ? ` [${el.articulations.join(', ')}]` : '';
  const beam = el.beams?.length ? ` beam=[${el.beams.join(',')}]` : '';
  return `#${idx} ${el.pitch ?? '?'} ${el.type ?? ''}${dots}${tie}${chord}${tuplet}${beam}${arts}${el.stem ? ` stem=${el.stem}` : ''}`;
}

export function OmrMeasureEditor({
  jobId,
  partId,
  measureMxl,
  measurePrinted,
  measureOffset,
  staffLabel,
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
  const [fixMsg, setFixMsg] = useState('');

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
  }, [load]);

  const elements = useMemo(() => {
    if (snapshot?.elements?.length) return snapshot.elements;
    return (snapshot?.notes ?? []).map((n) => ({ ...n, elementKind: 'note' as const }));
  }, [snapshot]);

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
      {fixMsg ? <p className="omr-measure-fix-msg">{fixMsg}</p> : null}
      {lastPreviewMsg ? <p className="omr-measure-preview-msg">{lastPreviewMsg}</p> : null}
      {loadErr ? <p className="omr-measure-editor-err">{loadErr}</p> : null}
      {loading && !snapshot ? <p className="omr-measure-editor-loading">마디 요소 불러오는 중…</p> : null}

      {elements.length > 0 && (
        <ol className="omr-measure-element-list">
          {elements.map((el) => (
            <li key={el.elementKind === 'direction' ? `dir-${el.directionIndex}` : `note-${el.index}`}>
              <div className="omr-measure-element-title">{elementTitle(el, noteEls)}</div>
              {el.elementKind === 'direction' ? (
                <div className="omr-measure-element-actions">
                  <button
                    type="button"
                    className="omr-hitl-fix-btn"
                    onClick={() =>
                      pushFix({ kind: 'removeDirection', directionIndex: el.directionIndex, detail: el.text })
                    }
                  >
                    direction 삭제
                  </button>
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
                    P·잡텍스트로 삭제
                  </button>
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
                  onClick={() => setInsertAfter(el.elementKind === 'note' ? el.index : insertAfter)}
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
        staffDefault={noteEls.find((n) => n.staff != null)?.staff ?? 1}
        onInsertRest={(afterNoteIndex, noteType, staff) =>
          pushFix({ kind: 'insertRest', afterNoteIndex, noteType, staff })
        }
        onInsertNote={(afterNoteIndex, pitchStep, pitchOctave, noteType, staff) =>
          pushFix({
            kind: 'insertNote',
            afterNoteIndex,
            pitchStep,
            pitchOctave,
            noteType,
            staff,
          })
        }
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
  const [noteTypeValueSel, setNoteTypeValueSel] = useState(
    noteTypeValue(el.type ?? 'quarter', el.dotCount ?? (el.isDotted ? 1 : 0)),
  );
  const [staffN, setStaffN] = useState(el.staff ?? 1);
  const [tieTo, setTieTo] = useState('');
  const [tripletEnd, setTripletEnd] = useState(() => defaultTripletEndIndex(el.index, noteEls));
  const [tripletNormalType, setTripletNormalType] = useState(
    el.type === '16th' || el.type === '32nd' ? el.type : 'eighth',
  );
  const [beamEnd, setBeamEnd] = useState(() => defaultBeamEndIndex(el.index, noteEls));
  const [beamNumber, setBeamNumber] = useState(1);

  useEffect(() => {
    const p = parsePitch(el.pitch);
    setPitchStep(p.step);
    setPitchOctave(p.octave);
    setNoteTypeValueSel(
      noteTypeValue(el.type ?? 'quarter', el.dotCount ?? (el.isDotted ? 1 : 0)),
    );
    setStaffN(el.staff ?? 1);
    setTripletEnd(defaultTripletEndIndex(el.index, noteEls));
    setTripletNormalType(el.type === '16th' || el.type === '32nd' ? el.type : 'eighth');
    setBeamEnd(defaultBeamEndIndex(el.index, noteEls));
  }, [el.index, el.pitch, el.type, el.staff, el.isDotted, el.dotCount, noteEls]);

  const laterNotes = noteEls.filter((n) => n.index > el.index && n.kind === 'note');
  const nextNote = noteEls.find((n) => n.index === el.index + 1);
  const tripletCandidates = noteEls.filter((n) => n.index >= el.index).slice(0, 8);
  const tripletNoteCount = countNotesInRange(el.index, tripletEnd, noteEls);
  const existingTriplet = tripletRangeFor(el, noteEls);
  const beamCandidates = noteEls.filter((n) => n.index >= el.index && isBeamableNoteEl(n)).slice(0, 8);
  const beamNoteCount = countBeamableInRange(el.index, beamEnd, noteEls);
  const existingBeam = beamRangeFor(el, noteEls);
  const spuriousAfterRest =
    el.kind === 'rest' &&
    nextNote &&
    (nextNote.hasGrace ||
      nextNote.isCue ||
      nextNote.chord ||
      ['128th', '256th', '64th', '32nd'].includes(nextNote.type ?? '') ||
      (nextNote.dotCount ?? 0) > 0);

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
            <button
              type="button"
              className="omr-hitl-fix-btn"
              onClick={() =>
                onFix({
                  kind: 'setNotePitch',
                  noteIndex: el.index,
                  pitchStep,
                  pitchOctave,
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
                  이음 시작 제거
                </button>
              )}
              {el.tieStop && (
                <button
                  type="button"
                  className="omr-hitl-fix-btn"
                  onClick={() => onFix({ kind: 'removeTie', noteIndex: el.index, tieEnd: 'stop' })}
                >
                  이음 끝 제거
                </button>
              )}
            </>
          )}
          {laterNotes.length > 0 && (
            <label className="omr-measure-inline-field">
              이음줄 연결
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
      {isBeamableNoteEl(el) && beamCandidates.length >= 2 && (
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
                ? '빔 연결은 음표 2개 이상이 필요합니다 (쉼표·화음 하위음 제외)'
                : `${beamNoteCount}개 음표를 빔 ${beamNumber}로 연결`
            }
            onClick={() =>
              onFix({
                kind: 'applyBeam',
                fromNoteIndex: el.index,
                toNoteIndex: beamEnd,
                beamNumber,
              })
            }
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
        </div>
      )}
      {tripletCandidates.length >= 2 && (
        <div className="omr-measure-tuplet-row">
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
                fromNoteIndex: el.index,
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
      <button type="button" className="omr-hitl-fix-btn omr-hitl-fix-btn--danger" onClick={() => onFix({ kind: 'removeNote', noteIndex: el.index })}>
        이 요소 삭제
      </button>
    </div>
  );
}

function InsertElementForm({
  afterNoteIndex,
  staffDefault,
  onInsertRest,
  onInsertNote,
}: {
  afterNoteIndex: number;
  staffDefault: number;
  onInsertRest: (after: number, type: string, staff: number) => void;
  onInsertNote: (after: number, step: string, octave: number, type: string, staff: number) => void;
}) {
  const [restType, setRestType] = useState('quarter');
  const [noteType, setNoteType] = useState('quarter');
  const [staff, setStaff] = useState(staffDefault);
  const [step, setStep] = useState('C');
  const [octave, setOctave] = useState(4);

  useEffect(() => {
    setStaff(staffDefault);
  }, [staffDefault]);

  const afterLabel = afterNoteIndex < 0 ? '마디 맨 앞' : `음·쉼표 #${afterNoteIndex} 뒤`;

  return (
    <div className="omr-measure-insert-form">
      <div className="omr-measure-insert-form-title">빠진 요소 추가 ({afterLabel})</div>
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
          음높이
          <select value={step} onChange={(e) => setStep(e.target.value)}>
            {PITCH_STEPS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input type="number" min={0} max={9} value={octave} onChange={(e) => setOctave(Number(e.target.value))} style={{ width: 48 }} />
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
        <button type="button" className="omr-hitl-fix-btn" onClick={() => onInsertNote(afterNoteIndex, step, octave, noteType, staff)}>
          음표 추가
        </button>
      </div>
    </div>
  );
}

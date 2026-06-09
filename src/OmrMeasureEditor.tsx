import { useCallback, useEffect, useMemo, useState } from 'react';
import { newFixId, type OmrHitlFix } from './omrHitlFixes';

const NOTE_TYPES = ['whole', 'half', 'quarter', 'eighth', '16th', '32nd'] as const;
const PITCH_STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

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
  tieStart?: boolean;
  tieStop?: boolean;
  beams?: string[];
  stem?: string | null;
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
    return `#${idx} ${el.type ?? 'rest'}쉼표${dots}${pos}${el.staff != null ? ` staff=${el.staff}` : ''}`;
  }
  const tie =
    el.tieStart && el.tieStop ? ' tie↔' : el.tieStart ? ' tie→' : el.tieStop ? ' tie←' : '';
  const dots = el.dotCount ? ` ·×${el.dotCount}` : '';
  const chord = el.chord ? ' (화음)' : '';
  return `#${idx} ${el.pitch ?? '?'} ${el.type ?? ''}${dots}${tie}${chord}${el.stem ? ` stem=${el.stem}` : ''}`;
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

  const pushFix = (partial: Omit<OmrHitlFix, 'id' | 'partId' | 'measureMxl'>) => {
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
  const [noteType, setNoteType] = useState(el.type ?? 'quarter');
  const [staffN, setStaffN] = useState(el.staff ?? 1);
  const [tieTo, setTieTo] = useState('');

  useEffect(() => {
    const p = parsePitch(el.pitch);
    setPitchStep(p.step);
    setPitchOctave(p.octave);
    setNoteType(el.type ?? 'quarter');
    setStaffN(el.staff ?? 1);
  }, [el.index, el.pitch, el.type, el.staff]);

  const laterNotes = noteEls.filter((n) => n.index > el.index && n.kind === 'note');

  const showDotFix =
    el.kind === 'rest' &&
    ((el.dotCount ?? 0) > 0 || el.isDotted || el.type === 'whole' || el.type === 'half');
  const prev = noteEls.find((n) => n.index === el.index - 1);
  const trailingAfterRest =
    el.index > 0 &&
    prev?.kind === 'rest' &&
    (prev.type === 'whole' || prev.type === 'half');

  return (
    <div className="omr-measure-element-actions">
      {showDotFix && (
        <>
          <button
            type="button"
            className="omr-hitl-fix-btn"
            onClick={() => onFix({ kind: 'removeNoteDot', noteIndex: el.index })}
          >
            점(·) XML 제거
          </button>
          <button
            type="button"
            className="omr-hitl-fix-btn"
            onClick={() => onFix({ kind: 'setNoteUndotted', noteIndex: el.index })}
          >
            덧점 없애기 (점·긴 duration)
          </button>
        </>
      )}
      {trailingAfterRest && (
        <button
          type="button"
          className="omr-hitl-fix-btn omr-hitl-fix-btn--danger"
          onClick={() => onFix({ kind: 'removeNote', noteIndex: el.index })}
        >
          쉼표 뒤 의심 요소 삭제
        </button>
      )}
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
        <select value={noteType} onChange={(e) => setNoteType(e.target.value)}>
          {NOTE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="omr-hitl-fix-btn"
          onClick={() => onFix({ kind: 'setNoteType', noteIndex: el.index, noteType })}
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

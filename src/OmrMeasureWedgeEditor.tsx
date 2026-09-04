import { useEffect, useMemo, useState } from 'react';
import { articulationDistanceSelectValue } from '../shared/musicXmlArticulationDistance';
import type { OmrHitlFix } from './omrHitlFixes';
import type { MeasureDirectionEl, MeasureNoteEl } from './OmrMeasureEditor';

type FixPartial = Omit<OmrHitlFix, 'id' | 'partId' | 'measureMxl'> & { measureMxl?: string };

const NOTE_TYPE_LABELS: Record<string, string> = {
  whole: '온음표',
  half: '2분',
  quarter: '4분',
  eighth: '8분',
  '16th': '16분',
  '32nd': '32분',
  '64th': '64분',
};

const ARTICULATION_DISTANCE_OPTIONS: { value: string; label: string }[] = [
  { value: 'auto', label: '자동' },
  { value: '1', label: '1칸' },
  { value: '2', label: '2칸' },
  { value: '3', label: '3칸' },
  { value: '4', label: '4칸' },
  { value: '5', label: '5칸' },
  { value: '6', label: '6칸' },
  { value: '7', label: '7칸' },
  { value: '8', label: '8칸' },
];

function isRhythmicSlice(n: MeasureNoteEl): boolean {
  return !n.chord && !n.hasGrace && !n.isCue;
}

function noteAnchorLabel(n: MeasureNoteEl): string {
  if (n.kind === 'rest') return '쉼';
  const p = (n.pitch || '').trim();
  return p || '?';
}

function wedgeTypeOf(d: MeasureDirectionEl): string {
  if ((d.directionType || '').trim().toLowerCase() === 'wedge') {
    return (d.directionValue || '').trim().toLowerCase();
  }
  const m = /wedge\(([^)]+)\)/i.exec((d.text || d.directionValue || '').trim());
  return (m?.[1] || '').trim().toLowerCase();
}

type WedgeGroup = {
  number: string;
  staff: number;
  start?: MeasureDirectionEl;
  stop?: MeasureDirectionEl;
  wedgeKind: 'crescendo' | 'diminuendo';
  placement: 'above' | 'below';
  distance?: string | null;
  fromNoteIndex: number;
  toNoteIndex: number;
  toMeasureMxl?: string | null;
  startMeasureMxl?: string | null;
};

type DirWithMxl = MeasureDirectionEl & { measureMxl?: string };

function groupWedgeDirections(directions: DirWithMxl[], baseMeasureMxl?: string): WedgeGroup[] {
  const map = new Map<string, WedgeGroup>();
  for (const d of directions) {
    const num = (d.wedgeNumber || '1').trim() || '1';
    const staff = d.staff ?? 1;
    const key = `${staff}:${num}`;
    let g = map.get(key);
    if (!g) {
      g = {
        number: num,
        staff,
        wedgeKind: 'crescendo',
        placement: (d.placement === 'above' ? 'above' : 'below') as 'above' | 'below',
        distance: d.distance,
        fromNoteIndex: d.anchorNoteIndex ?? 0,
        toNoteIndex: d.anchorNoteIndex ?? 0,
        startMeasureMxl: baseMeasureMxl ?? null,
        toMeasureMxl: null,
      };
      map.set(key, g);
    }
    const v = wedgeTypeOf(d);
    if (v === 'stop') {
      g.stop = d;
      if (d.anchorNoteIndex != null) g.toNoteIndex = d.anchorNoteIndex;
      if (d.measureMxl) g.toMeasureMxl = d.measureMxl;
    } else if (v === 'crescendo' || v === 'diminuendo') {
      g.start = d;
      g.wedgeKind = v;
      if (d.anchorNoteIndex != null) g.fromNoteIndex = d.anchorNoteIndex;
      if (d.measureMxl) g.startMeasureMxl = d.measureMxl;
    }
    if (d.placement) g.placement = d.placement === 'above' ? 'above' : 'below';
    if (d.distance) g.distance = d.distance;
  }
  return [...map.values()].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
}

type WedgeNoteOption = {
  key: string;
  measureMxl: string;
  noteIndex: number;
  label: string;
};

function wedgeNoteKey(measureMxl: string, noteIndex: number): string {
  return `${measureMxl}:${noteIndex}`;
}

function parseWedgeNoteKey(
  key: string,
  fallbackMxl: string,
): { measureMxl: string; noteIndex: number } {
  const m = /^(\d+):(-?\d+)$/.exec(key.trim());
  if (m) return { measureMxl: m[1]!, noteIndex: parseInt(m[2]!, 10) };
  const n = parseInt(key, 10);
  return { measureMxl: fallbackMxl, noteIndex: Number.isFinite(n) ? n : 0 };
}

export function MeasureWedgeEditor({
  directions,
  noteEls,
  measureMxl,
  nextMeasureMxl,
  nextNoteEls,
  nextDirections,
  partStaveCount,
  editStaffWithinPart,
  insertStaff,
  onFix,
}: {
  directions: MeasureDirectionEl[];
  noteEls: MeasureNoteEl[];
  measureMxl: string;
  nextMeasureMxl?: string | null;
  nextNoteEls?: MeasureNoteEl[];
  nextDirections?: MeasureDirectionEl[];
  partStaveCount: number;
  editStaffWithinPart?: number | null;
  insertStaff: number;
  onFix: (partial: FixPartial) => void;
}) {
  const baseMxl = String(measureMxl);
  const nextMxl = nextMeasureMxl ? String(nextMeasureMxl) : null;
  const [wedgeKind, setWedgeKind] = useState<'crescendo' | 'diminuendo'>('crescendo');
  const [staff, setStaff] = useState(editStaffWithinPart ?? insertStaff ?? 1);
  const [placement, setPlacement] = useState<'above' | 'below'>('above');
  const [wedgeDistance, setWedgeDistance] = useState('auto');

  useEffect(() => {
    setStaff(editStaffWithinPart ?? insertStaff ?? 1);
  }, [editStaffWithinPart, insertStaff]);

  const staffNotes = noteEls.filter(
    (n) => isRhythmicSlice(n) && (editStaffWithinPart == null || (n.staff ?? 1) === staff),
  );
  const nextStaffNotes = (nextNoteEls ?? []).filter(
    (n) => isRhythmicSlice(n) && (editStaffWithinPart == null || (n.staff ?? 1) === staff),
  );
  const firstIdx = staffNotes[0]?.index ?? 0;
  const lastCurIdx = staffNotes[staffNotes.length - 1]?.index ?? firstIdx;

  const [fromKey, setFromKey] = useState(wedgeNoteKey(baseMxl, firstIdx));
  const [toKey, setToKey] = useState(wedgeNoteKey(baseMxl, lastCurIdx));

  useEffect(() => {
    setFromKey(wedgeNoteKey(baseMxl, firstIdx));
    setToKey(
      nextMxl && nextStaffNotes.length
        ? wedgeNoteKey(nextMxl, nextStaffNotes[nextStaffNotes.length - 1]!.index)
        : wedgeNoteKey(baseMxl, lastCurIdx),
    );
  }, [baseMxl, nextMxl, firstIdx, lastCurIdx, staff, noteEls.length, nextNoteEls?.length, nextStaffNotes]);

  const mergedDirections = useMemo(() => {
    const cur = directions.map((d) => ({ ...d, measureMxl: baseMxl }));
    const nxt = (nextDirections ?? []).map((d) => ({ ...d, measureMxl: nextMxl || baseMxl }));
    return [...cur, ...nxt];
  }, [directions, nextDirections, baseMxl, nextMxl]);

  const wedgeGroups = useMemo(
    () => groupWedgeDirections(mergedDirections, baseMxl),
    [mergedDirections, baseMxl],
  );

  const fromOptions: WedgeNoteOption[] = staffNotes.map((n) => ({
    key: wedgeNoteKey(baseMxl, n.index),
    measureMxl: baseMxl,
    noteIndex: n.index,
    label: `m.${baseMxl} #${n.index} ${noteAnchorLabel(n)}${n.type ? ` ${NOTE_TYPE_LABELS[n.type] ?? n.type}` : ''}`,
  }));

  const toOptions: WedgeNoteOption[] = [
    ...staffNotes.map((n) => ({
      key: wedgeNoteKey(baseMxl, n.index),
      measureMxl: baseMxl,
      noteIndex: n.index,
      label: `m.${baseMxl} #${n.index} ${noteAnchorLabel(n)}${n.type ? ` ${NOTE_TYPE_LABELS[n.type] ?? n.type}` : ''}`,
    })),
    {
      key: wedgeNoteKey(baseMxl, -1),
      measureMxl: baseMxl,
      noteIndex: -1,
      label: `m.${baseMxl} 마디 끝 (마지막 음 뒤)`,
    },
    ...(nextMxl
      ? [
          ...nextStaffNotes.map((n) => ({
            key: wedgeNoteKey(nextMxl, n.index),
            measureMxl: nextMxl,
            noteIndex: n.index,
            label: `m.${nextMxl} #${n.index} ${noteAnchorLabel(n)}${n.type ? ` ${NOTE_TYPE_LABELS[n.type] ?? n.type}` : ''}`,
          })),
          {
            key: wedgeNoteKey(nextMxl, -1),
            measureMxl: nextMxl,
            noteIndex: -1,
            label: `m.${nextMxl} 마디 끝 (마지막 음 뒤)`,
          },
        ]
      : []),
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
        크레센도 <code>&lt;</code> / 디미뉴엔도 <code>&gt;</code> 는 <strong>시작 음 앞</strong>과{' '}
        <strong>끝 음 뒤</strong>(stop)로 들어갑니다. 「다음 마디 포함」을 켜면 끝 음을 m.{baseMxl}
        {nextMxl ? ` 또는 m.${nextMxl}` : ''}에서 고를 수 있습니다(예: 42→43 diminuendo).
      </p>
      {wedgeGroups.length > 0 ? (
        <ul style={{ margin: '0 0 0.65rem', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {wedgeGroups.map((g) => (
            <WedgeGroupEditor
              key={`wedge-group-${g.staff}-${g.number}`}
              group={g}
              baseMeasureMxl={baseMxl}
              fromOptions={fromOptions}
              toOptions={toOptions}
              onFix={onFix}
            />
          ))}
        </ul>
      ) : (
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.86rem', color: '#555' }}>이 범위에 셈여림 점선 없음</p>
      )}
      <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: 6 }}>새 점선 추가</div>
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
          <select value={fromKey} onChange={(e) => setFromKey(e.target.value)} style={{ marginLeft: 4, minWidth: '11rem' }}>
            {fromOptions.map((o) => (
              <option key={`from-${o.key}`} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="omr-measure-inline-field">
          끝 음 (이 음까지)
          <select value={toKey} onChange={(e) => setToKey(e.target.value)} style={{ marginLeft: 4, minWidth: '11rem' }}>
            {toOptions.map((o) => (
              <option key={`to-${o.key}`} value={o.key}>
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
        <label className="omr-measure-inline-field">
          거리
          <select value={wedgeDistance} onChange={(e) => setWedgeDistance(e.target.value)} style={{ marginLeft: 4 }}>
            {ARTICULATION_DISTANCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="omr-hitl-fix-btn omr-hitl-fix-btn--primary"
          onClick={() => {
            const from = parseWedgeNoteKey(fromKey, baseMxl);
            const to = parseWedgeNoteKey(toKey, baseMxl);
            onFix({
              kind: 'insertWedge',
              directionType: 'wedge',
              directionValue: wedgeKind,
              fromNoteIndex: from.noteIndex,
              toNoteIndex: to.noteIndex,
              toMeasureMxl: to.measureMxl !== baseMxl ? to.measureMxl : undefined,
              staff: editStaffWithinPart ?? staff,
              placement,
              distance: wedgeDistance,
            });
          }}
        >
          점선 추가 (시작→끝)
        </button>
      </div>
    </div>
  );
}

function WedgeGroupEditor({
  group,
  baseMeasureMxl,
  fromOptions,
  toOptions,
  onFix,
}: {
  group: WedgeGroup;
  baseMeasureMxl: string;
  fromOptions: WedgeNoteOption[];
  toOptions: WedgeNoteOption[];
  onFix: (partial: FixPartial) => void;
}) {
  const startMxl = group.startMeasureMxl || baseMeasureMxl;
  const stopMxl = group.toMeasureMxl || startMxl;
  const [fromKey, setFromKey] = useState(wedgeNoteKey(startMxl, group.fromNoteIndex));
  const [toKey, setToKey] = useState(wedgeNoteKey(stopMxl, group.toNoteIndex));
  const [placement, setPlacement] = useState<'above' | 'below'>(group.placement);
  const [distance, setDistance] = useState(articulationDistanceSelectValue(group.distance, group.start?.defaultY));

  useEffect(() => {
    setFromKey(wedgeNoteKey(group.startMeasureMxl || baseMeasureMxl, group.fromNoteIndex));
    setToKey(wedgeNoteKey(group.toMeasureMxl || group.startMeasureMxl || baseMeasureMxl, group.toNoteIndex));
    setPlacement(group.placement);
    setDistance(articulationDistanceSelectValue(group.distance, group.start?.defaultY));
  }, [
    group.fromNoteIndex,
    group.toNoteIndex,
    group.placement,
    group.distance,
    group.start?.defaultY,
    group.toMeasureMxl,
    group.startMeasureMxl,
    baseMeasureMxl,
  ]);

  const kindLabel = group.wedgeKind === 'diminuendo' ? 'diminuendo (>)' : 'crescendo (<)';

  return (
    <li
      style={{
        padding: '0.5rem 0.6rem',
        border: '1px solid #e1bee7',
        borderRadius: 6,
        background: '#faf5fc',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <strong>
          #{group.number} {kindLabel}
        </strong>
        <span style={{ fontSize: '0.82rem', color: '#666' }}>staff {group.staff}</span>
        <span style={{ fontSize: '0.82rem', color: '#555' }}>
          m.{startMxl}#{group.fromNoteIndex} → m.{stopMxl}#{group.toNoteIndex}
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <label className="omr-measure-inline-field">
          시작 음
          <select value={fromKey} onChange={(e) => setFromKey(e.target.value)} style={{ marginLeft: 4, minWidth: '11rem' }}>
            {fromOptions.map((o) => (
              <option key={`g-from-${group.number}-${o.key}`} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="omr-measure-inline-field">
          끝 음
          <select value={toKey} onChange={(e) => setToKey(e.target.value)} style={{ marginLeft: 4, minWidth: '11rem' }}>
            {toOptions.map((o) => (
              <option key={`g-to-${group.number}-${o.key}`} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="omr-measure-inline-field">
          위치
          <select value={placement} onChange={(e) => setPlacement(e.target.value as 'above' | 'below')} style={{ marginLeft: 4 }}>
            <option value="below">아래</option>
            <option value="above">위</option>
          </select>
        </label>
        <label className="omr-measure-inline-field">
          거리
          <select value={distance} onChange={(e) => setDistance(e.target.value)} style={{ marginLeft: 4 }}>
            {ARTICULATION_DISTANCE_OPTIONS.map((opt) => (
              <option key={`g-dist-${group.number}-${opt.value}`} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="omr-hitl-fix-btn omr-hitl-fix-btn--primary"
          onClick={() => {
            const from = parseWedgeNoteKey(fromKey, baseMeasureMxl);
            const to = parseWedgeNoteKey(toKey, baseMeasureMxl);
            onFix({
              kind: 'setWedgeSpan',
              directionType: 'wedge',
              directionValue: group.wedgeKind,
              wedgeNumber: group.number,
              fromNoteIndex: from.noteIndex,
              toNoteIndex: to.noteIndex,
              toMeasureMxl: to.measureMxl !== baseMeasureMxl ? to.measureMxl : undefined,
              staff: group.staff,
              placement,
              distance,
            });
          }}
        >
          범위 적용
        </button>
        <button
          type="button"
          className="omr-hitl-fix-btn"
          onClick={() =>
            onFix({
              kind: 'removeWedge',
              wedgeNumber: group.number,
              staff: group.staff,
              toMeasureMxl:
                group.toMeasureMxl && group.toMeasureMxl !== baseMeasureMxl
                  ? group.toMeasureMxl
                  : undefined,
            })
          }
        >
          삭제
        </button>
      </div>
    </li>
  );
}

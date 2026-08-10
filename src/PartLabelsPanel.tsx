import { useCallback, useEffect, useState } from 'react';
import { defaultPartLabels, PART_LABEL_PICKLIST, PART_LABEL_PICKLIST_HINT, suggestedPartLabel } from './partLabelOptions';

type ScorePart = {
  index: number;
  partIndex: number;
  id: string;
  name: string;
  instrumentName?: string;
  suggestedLabel: string;
};

type Props = {
  jobId: string;
  onSubmitted: () => void;
};

export function PartLabelsPanel({ jobId, onSubmitted }: Props) {
  const [parts, setParts] = useState<ScorePart[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [customInputIndices, setCustomInputIndices] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const slotCount = labels.length;

  const resizeLabels = (n: number, prev: string[]): string[] => {
    const count = Math.max(1, Math.min(12, n));
    const next = defaultPartLabels(count);
    for (let i = 0; i < count; i++) {
      next[i] = (prev[i] ?? next[i] ?? `P${i + 1}`).trim();
    }
    return next;
  };

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await fetch(`/api/diagnostic/${jobId}/score-parts`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as {
        parts?: ScorePart[];
        presetLabelsByIndex?: string[];
        savedLabelsByIndex?: string[];
      };
      const list = Array.isArray(j.parts) ? j.parts : [];
      setParts(list);
      const omrCount = list.length;
      const presetLen = j.presetLabelsByIndex?.length ?? 0;
      const savedLen = j.savedLabelsByIndex?.length ?? 0;
      let n = Math.max(omrCount, presetLen, savedLen);
      if (presetLen === 0 && savedLen === 0 && omrCount >= 2 && omrCount <= 4) {
        n = 6;
      }
      const initial = defaultPartLabels(n);
      for (let i = 0; i < n; i++) {
        const saved = j.savedLabelsByIndex?.[i];
        const preset = j.presetLabelsByIndex?.[i];
        const inferred =
          i < omrCount
            ? suggestedPartLabel(
                list[i]?.name ?? '',
                i,
                Math.max(omrCount, n),
                list[i]?.suggestedLabel,
                list[i]?.instrumentName,
              )
            : '';
        initial[i] = (saved || preset || inferred || initial[i] || `P${i + 1}`).trim();
      }
      setLabels(initial);
      setCustomInputIndices(new Set());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyPreset = (preset: string[]) => {
    setCustomInputIndices(new Set());
    setLabels(preset);
  };

  const addPartSlot = () => {
    setLabels((prev) => {
      if (prev.length >= 12) return prev;
      return [...prev, `P${prev.length + 1}`];
    });
  };

  const removePartSlot = () => {
    setLabels((prev) => (prev.length <= 1 ? prev : prev.slice(0, -1)));
  };

  const submit = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/part-labels/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labelsByIndex: labels }),
      });
      if (!r.ok) {
        const j = (await r.json()) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      onSubmitted();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-light" style={{ maxWidth: 640 }}>
      <h2 style={{ margin: '0 0 0.5rem' }}>성부 라벨 지정</h2>
      <p style={{ margin: '0 0 1rem', lineHeight: 1.55, fontSize: '0.92rem', color: '#333' }}>
        악보 정리(가사 제거)를 시작하기 전에 <strong>악보의 성부 구성(S/A/T/B 등)</strong>을 미리 알려주세요.
        이 초기 정보를 바탕으로 성부 위치를 추정하여 <strong>음표(오선 영역)가 지워지는 것을 방지</strong>합니다.
        실제 악보에 쓰인 전체 성부 수에 맞춰 라벨을 지정하세요. 확정한 라벨은 
        이후 OMR 과정과 <strong>최종 MXL part-name</strong>에 그대로 쓰입니다.
      </p>

      {loading && <p>성부 정보 불러오는 중…</p>}
      {err && <p style={{ color: '#c62828' }}>{err}</p>}

      {!loading && slotCount > 0 && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem', alignItems: 'center' }}>
            <button type="button" className="btn-muted" onClick={() => applyPreset(defaultPartLabels(6))}>
              합창+피아노 (S A T B PR PL)
            </button>
            <button
              type="button"
              className="btn-muted"
              onClick={() => applyPreset(['M', 'W'])}
            >
              M W (남성·여성)
            </button>
            <button
              type="button"
              className="btn-muted"
              onClick={() => applyPreset(['M', 'W', 'P'])}
            >
              M W + P
            </button>
            <button
              type="button"
              className="btn-muted"
              onClick={() => applyPreset(['M', 'W', 'PR', 'PL'])}
            >
              M W + PR PL
            </button>
            <button
              type="button"
              className="btn-muted"
              onClick={() => applyPreset(['S', 'A', 'T', 'B'])}
            >
              SATB 4성부
            </button>
            <button
              type="button"
              className="btn-muted"
              onClick={() => applyPreset(['S', 'A', 'T', 'B', 'P'])}
            >
              SATB + P (피아노 1파트)
            </button>
            <button
              type="button"
              className="btn-muted"
              onClick={() =>
                applyPreset(
                  parts.map((p, i) => p.suggestedLabel || `P${i + 1}`),
                )
              }
            >
              OMR 제안으로
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.88rem' }}>
              파트 수
              <input
                type="number"
                min={1}
                max={12}
                value={slotCount}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (!Number.isFinite(n)) return;
                  setLabels((prev) => resizeLabels(n, prev));
                }}
                style={{ width: '3rem', padding: '0.3rem' }}
              />
            </label>
            <button type="button" className="btn-muted" onClick={addPartSlot} disabled={slotCount >= 12}>
              + 파트 추가
            </button>
            <button type="button" className="btn-muted" onClick={removePartSlot} disabled={slotCount <= 1}>
              − 파트
            </button>
          </div>

          {parts.length > 0 && parts.length < slotCount && (
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.88rem', color: '#555', lineHeight: 1.45 }}>
              OMR MXL에는 파트 <strong>{parts.length}개</strong>만 있습니다. 아래{' '}
              <strong>{slotCount - parts.length}개</strong> 슬롯은 문자 검토·가사 주입·lint용
              라벨입니다.
            </p>
          )}

          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.9rem',
              marginBottom: '1.25rem',
            }}
          >
            <thead>
              <tr style={{ background: '#e8eaf0', textAlign: 'left' }}>
                <th style={{ padding: '0.45rem 0.5rem' }}>순서</th>
                <th style={{ padding: '0.45rem 0.5rem' }}>OMR part-name</th>
                <th style={{ padding: '0.45rem 0.5rem' }}>라벨 (lint·UI용)</th>
              </tr>
            </thead>
            <tbody>
              {labels.map((_, i) => {
                const p = parts[i];
                return (
                <tr key={p?.id ?? `slot-${i}`} style={{ borderBottom: '1px solid #ddd' }}>
                  <td style={{ padding: '0.45rem 0.5rem', fontWeight: 600 }}>파트 {i + 1}</td>
                  <td style={{ padding: '0.45rem 0.5rem', color: '#444' }}>
                    {p ? (
                      <>
                        <code>{p.id}</code>
                        {p.name ? ` · ${p.name}` : ''}
                        {p.instrumentName ? ` · ${p.instrumentName}` : ''}
                      </>
                    ) : (
                      <span style={{ color: '#888', fontStyle: 'italic' }}>
                        OMR 미인식 (가사·lint 매핑용)
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '0.45rem 0.5rem' }}>
                    <select
                      value={
                        !customInputIndices.has(i) && (PART_LABEL_PICKLIST as readonly string[]).includes(labels[i] ?? '')
                          ? labels[i]
                          : '__custom__'
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '__custom__') {
                          setCustomInputIndices((prev) => new Set(prev).add(i));
                        } else {
                          setCustomInputIndices((prev) => {
                            const next = new Set(prev);
                            next.delete(i);
                            return next;
                          });
                          setLabels((prev) => {
                            const next = [...prev];
                            next[i] = v;
                            return next;
                          });
                        }
                      }}
                      style={{ padding: '0.35rem', minWidth: '5rem' }}
                    >
                      {PART_LABEL_PICKLIST.map((opt) => (
                        <option key={opt} value={opt}>
                          {PART_LABEL_PICKLIST_HINT[opt] ?? opt}
                        </option>
                      ))}
                      <option value="__custom__">직접 입력</option>
                    </select>
                    {(customInputIndices.has(i) || !(PART_LABEL_PICKLIST as readonly string[]).includes(labels[i] ?? '')) && (
                      <input
                        type="text"
                        value={labels[i] ?? ''}
                        onChange={(e) =>
                          setLabels((prev) => {
                            const next = [...prev];
                            next[i] = e.target.value;
                            return next;
                          })
                        }
                        placeholder="예: S"
                        style={{ marginLeft: 6, width: '4rem', padding: '0.35rem' }}
                      />
                    )}
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>

          <button
            type="button"
            disabled={busy || labels.some((l) => !l.trim())}
            onClick={() => void submit()}
            style={{
              padding: '0.65rem 1.25rem',
              fontSize: '1rem',
              background: '#1565c0',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            {busy ? '저장 중…' : '확정 후 OMR 검토로'}
          </button>
        </>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { defaultPartLabels, PART_LABEL_PICKLIST } from './partLabelOptions';

type ScorePart = {
  index: number;
  partIndex: number;
  id: string;
  name: string;
  suggestedLabel: string;
};

type Props = {
  jobId: string;
  onSubmitted: () => void;
};

export function PartLabelsPanel({ jobId, onSubmitted }: Props) {
  const [parts, setParts] = useState<ScorePart[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

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
      const n = list.length;
      const initial = defaultPartLabels(n);
      for (let i = 0; i < n; i++) {
        const saved = j.savedLabelsByIndex?.[i];
        const preset = j.presetLabelsByIndex?.[i];
        const sug = list[i]?.suggestedLabel;
        initial[i] = (saved || preset || sug || initial[i] || `P${i + 1}`).trim();
      }
      setLabels(initial);
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
    setLabels((prev) => {
      const n = prev.length;
      const next = [...prev];
      for (let i = 0; i < n; i++) {
        next[i] = preset[i] ?? `P${i + 1}`;
      }
      return next;
    });
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
        Audiveris가 인식한 <strong>파트(성부)</strong>마다 짧은 이름을 붙입니다. 확정한 라벨은 OMR
        lint·검토와 <strong>최종 MXL part-name</strong>에 반영됩니다. <strong>P</strong>·
        <strong>PR</strong>·<strong>PL</strong>은 MusicXML에서 <strong>Piano</strong>(약어 Pno.)로
        표기됩니다. 단일 피아노 파트는 기본 <strong>P</strong>를 권장합니다. PDF{' '}
        <strong>페이지(p.)</strong> 번호와 혼동하지 않도록 합니다.
      </p>

      {loading && <p>MXL 파트 목록 불러오는 중…</p>}
      {err && <p style={{ color: '#c62828' }}>{err}</p>}

      {!loading && parts.length > 0 && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
            <button type="button" className="btn-muted" onClick={() => applyPreset(defaultPartLabels(6))}>
              합창+피아노 (S A T B PR PL)
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
              onClick={() =>
                setLabels(parts.map((p, i) => p.suggestedLabel || `P${i + 1}`))
              }
            >
              Audiveris 제안으로
            </button>
          </div>

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
                <th style={{ padding: '0.45rem 0.5rem' }}>Audiveris part-name</th>
                <th style={{ padding: '0.45rem 0.5rem' }}>라벨 (lint·UI용)</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p, i) => (
                <tr key={p.id || i} style={{ borderBottom: '1px solid #ddd' }}>
                  <td style={{ padding: '0.45rem 0.5rem', fontWeight: 600 }}>파트 {p.partIndex}</td>
                  <td style={{ padding: '0.45rem 0.5rem', color: '#444' }}>
                    <code>{p.id}</code>
                    {p.name ? ` · ${p.name}` : ''}
                  </td>
                  <td style={{ padding: '0.45rem 0.5rem' }}>
                    <select
                      value={
                        (PART_LABEL_PICKLIST as readonly string[]).includes(labels[i] ?? '')
                          ? labels[i]
                          : '__custom__'
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        setLabels((prev) => {
                          const next = [...prev];
                          if (v !== '__custom__') next[i] = v;
                          else if (!(PART_LABEL_PICKLIST as readonly string[]).includes(next[i] ?? '')) {
                            next[i] = next[i] ?? '';
                          } else {
                            next[i] = '';
                          }
                          return next;
                        });
                      }}
                      style={{ padding: '0.35rem', minWidth: '5rem' }}
                    >
                      {PART_LABEL_PICKLIST.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                      <option value="__custom__">직접 입력</option>
                    </select>
                    {!(PART_LABEL_PICKLIST as readonly string[]).includes(labels[i] ?? '') && (
                      <input
                        type="text"
                        value={labels[i] ?? ''}
                        onChange={(e) =>
                          setLabels((prev) => {
                            const next = [...prev];
                            next[i] = e.target.value.trim();
                            return next;
                          })
                        }
                        placeholder="예: S"
                        style={{ marginLeft: 6, width: '4rem', padding: '0.35rem' }}
                      />
                    )}
                  </td>
                </tr>
              ))}
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

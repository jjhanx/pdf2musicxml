import { useEffect, useState } from 'react';

export type FontSizeEntry = {
  sizePt: number;
  charCount: number;
  pageCount: number;
  sampleText: string;
  fontnames: string[];
  hasHangul: boolean;
  hasLatin: boolean;
};

export type FontStripRange = {
  minPt: number;
  maxPt: number;
  label?: string;
  sizePt?: number;
};

export type FontStripPreset = {
  id: string;
  label: string;
  ranges: FontStripRange[];
};

export type FontStripStats = {
  entries: FontSizeEntry[];
  defaultRanges: FontStripRange[];
  suggestedRanges: FontStripRange[];
  presets: FontStripPreset[];
  note?: string;
};

function rangeKey(r: FontStripRange): string {
  return `${r.minPt}-${r.maxPt}`;
}

function rangesEqual(a: FontStripRange[], b: FontStripRange[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].map(rangeKey).sort();
  const sb = [...b].map(rangeKey).sort();
  return sa.every((k, i) => k === sb[i]);
}

function mergeSelectedRanges(ranges: FontStripRange[]): FontStripRange[] {
  const sorted = [...ranges].sort((x, y) => x.minPt - y.minPt || x.maxPt - y.maxPt);
  const out: FontStripRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.minPt <= last.maxPt + 0.05) {
      last.maxPt = Math.max(last.maxPt, r.maxPt);
      if (r.label && !last.label?.includes(r.label)) {
        last.label = [last.label, r.label].filter(Boolean).join(' · ');
      }
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

type Props = {
  jobId: string;
  onSubmitted: () => void;
  onCancel?: () => void;
};

export function FontStripPanel({ jobId, onSubmitted, onCancel }: Props) {
  const [stats, setStats] = useState<FontStripStats | null>(null);
  const [selected, setSelected] = useState<FontStripRange[]>([]);
  const [customMin, setCustomMin] = useState('');
  const [customMax, setCustomMax] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [selectedSizes, setSelectedSizes] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setErr('');
      try {
        const r = await fetch(`/api/font-strip/${jobId}`, { cache: 'no-store' });
        if (!r.ok) {
          const j = (await r.json()) as { error?: string };
          throw new Error(j.error || `HTTP ${r.status}`);
        }
        const data = (await r.json()) as FontStripStats;
        if (cancelled) return;
        setStats(data);
        const initial = mergeSelectedRanges([
          ...(data.defaultRanges ?? []),
          ...(data.suggestedRanges ?? []).filter((s) => (s.sizePt ?? 0) > 17),
        ]);
        setSelected(initial);
        const sizeSet = new Set<number>();
        for (const e of data.entries ?? []) {
          if (e.sizePt >= 7 && e.sizePt <= 17) sizeSet.add(e.sizePt);
          if (e.sizePt > 17 && (e.hasHangul || e.hasLatin) && e.sizePt <= 48) sizeSet.add(e.sizePt);
        }
        setSelectedSizes(sizeSet);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const togglePreset = (preset: FontStripPreset) => {
    if (rangesEqual(selected, preset.ranges)) {
      setSelected(stats?.defaultRanges ?? []);
      return;
    }
    setSelected(mergeSelectedRanges(preset.ranges));
  };

  const toggleSizeRow = (sizePt: number) => {
    const tol = 0.35;
    const band: FontStripRange = {
      minPt: Math.round((sizePt - tol) * 100) / 100,
      maxPt: Math.round((sizePt + tol) * 100) / 100,
      label: `${sizePt}pt`,
      sizePt,
    };
    const key = rangeKey(band);
    const has = selected.some((r) => rangeKey(r) === key);
    setSelectedSizes((prev) => {
      const next = new Set(prev);
      if (has) next.delete(sizePt);
      else next.add(sizePt);
      return next;
    });
    if (has) {
      setSelected((prev) => prev.filter((r) => rangeKey(r) !== key));
    } else {
      setSelected((prev) => mergeSelectedRanges([...prev, band]));
    }
  };

  const addCustomRange = () => {
    const lo = parseFloat(customMin);
    const hi = parseFloat(customMax);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      setErr('사용자 범위에 유효한 숫자를 입력하세요.');
      return;
    }
    setErr('');
    setSelected((prev) =>
      mergeSelectedRanges([
        ...prev,
        { minPt: Math.min(lo, hi), maxPt: Math.max(lo, hi), label: '사용자' },
      ]),
    );
  };

  const submit = async () => {
    if (!selected.length) {
      setErr('제거할 폰트 크기 범위를 하나 이상 선택하세요.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const r = await fetch(`/api/font-strip/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ranges: selected }),
      });
      if (!r.ok) {
        const j = (await r.json()) as { error?: string };
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      onSubmitted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="font-strip-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <h2 style={{ margin: '0 0 0.5rem' }}>Audiveris 입력 PDF — 지울 폰트 크기</h2>
        <p style={{ margin: 0, fontSize: '0.92rem', lineHeight: 1.5, color: 'var(--muted, #666)' }}>
          <code>clean_score_only.pdf</code>에서 선택한 크기의 텍스트만 제거합니다.{' '}
          <strong>제목·작곡·가사·저작권</strong> 등은 검토 후{' '}
          <code>inject_ocr.py</code>가 MusicXML에 넣으므로 Audiveris 악보 PDF에는 남기지 않는 편이 좋습니다.{' '}
          <strong>20pt 이상</strong>은 높은음자리표 등 음표 글림과 겹칠 수 있어 주의하세요.
        </p>
        {stats?.note && (
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', color: '#888' }}>{stats.note}</p>
        )}
      </div>

      {err && <div className="status err">{err}</div>}
      {!stats && !err && <div className="status">폰트 크기 목록 불러오는 중…</div>}

      {stats && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {(stats.presets ?? []).map((p) => (
              <button
                key={p.id}
                type="button"
                className="btn-secondary"
                onClick={() => togglePreset(p)}
                style={{
                  fontSize: '0.85rem',
                  outline: rangesEqual(selected, p.ranges) ? '2px solid #1976d2' : undefined,
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div style={{ fontSize: '0.88rem' }}>
            <strong>선택된 제거 범위:</strong>{' '}
            {selected.length ? selected.map((r) => `${r.minPt}–${r.maxPt}pt`).join(', ') : '(없음)'}
          </div>

          <div style={{ overflowX: 'auto', maxHeight: '40vh', border: '1px solid #444', borderRadius: 6 }}>
            <table className="task-table" style={{ margin: 0, fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th>선택</th>
                  <th>크기(pt)</th>
                  <th>글자 수</th>
                  <th>페이지</th>
                  <th>샘플</th>
                  <th>폰트</th>
                </tr>
              </thead>
              <tbody>
                {(stats.entries ?? []).map((e) => {
                  const active = selectedSizes.has(e.sizePt);
                  const likelyMusic = e.sizePt >= 20 && !e.hasHangul && !e.hasLatin;
                  return (
                    <tr
                      key={e.sizePt}
                      style={{
                        opacity: likelyMusic ? 0.65 : 1,
                        background: active ? 'rgba(25, 118, 210, 0.12)' : undefined,
                      }}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={() => toggleSizeRow(e.sizePt)}
                          title={likelyMusic ? '음표 글림일 수 있음 — 신중히 선택' : undefined}
                        />
                      </td>
                      <td>{e.sizePt}</td>
                      <td>{e.charCount}</td>
                      <td>{e.pageCount}</td>
                      <td style={{ maxWidth: 220, wordBreak: 'break-all' }}>{e.sampleText || '—'}</td>
                      <td style={{ maxWidth: 160, fontSize: '0.78rem' }}>{e.fontnames?.join(', ') || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' }}>
            <label>
              사용자 범위 min(pt)
              <input
                type="number"
                step="0.5"
                value={customMin}
                onChange={(ev) => setCustomMin(ev.target.value)}
                style={{ width: '5rem', marginLeft: '0.35rem' }}
              />
            </label>
            <label>
              max(pt)
              <input
                type="number"
                step="0.5"
                value={customMax}
                onChange={(ev) => setCustomMax(ev.target.value)}
                style={{ width: '5rem', marginLeft: '0.35rem' }}
              />
            </label>
            <button type="button" className="btn-secondary" onClick={addCustomRange}>
              범위 추가
            </button>
          </div>

          <div className="row" style={{ gap: '0.75rem', marginTop: '0.5rem' }}>
            <button type="button" disabled={busy || !selected.length} onClick={() => void submit()}>
              {busy ? '적용 중…' : '선택 범위로 clean_score PDF 만들기'}
            </button>
            {onCancel && (
              <button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>
                취소
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

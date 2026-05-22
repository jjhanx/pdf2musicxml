import { useCallback, useEffect, useRef, useState } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

export type InspectSummary = {
  jobId: string;
  status: string;
  originalName: string;
  originalPdf: { exists: boolean; pageCount: number | null };
  maskedPdf: { exists: boolean; pageCount: number | null };
  pageCountForUi: number;
  pageCountsMatch: boolean;
  scoreMusicXmlAvailable: boolean;
};

function parseScoreParts(xml: string): { id: string; name: string }[] {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) return [];
    const nodes = doc.querySelectorAll('part-list > score-part');
    const out: { id: string; name: string }[] = [];
    nodes.forEach((sp) => {
      const id = sp.getAttribute('id');
      if (!id) return;
      const pn = sp.querySelector('part-name');
      const name = pn?.textContent?.trim() || id;
      out.push({ id, name });
    });
    return out;
  } catch {
    return [];
  }
}

function filterMusicXmlToPart(xml: string, partId: string | null): string {
  if (!partId) return xml;
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) return xml;
    const root = doc.documentElement;
    if (root.tagName !== 'score-partwise') return xml;
    const partList = root.querySelector('part-list');
    if (!partList) return xml;
    partList.querySelectorAll(':scope > score-part').forEach((n) => {
      if (n.getAttribute('id') !== partId) n.remove();
    });
    for (const el of Array.from(root.children)) {
      if (el.tagName === 'part' && el.getAttribute('id') !== partId) el.remove();
    }
    return new XMLSerializer().serializeToString(doc);
  } catch {
    return xml;
  }
}

function OsmdBlock({ xml, zoom }: { xml: string; zoom: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const zoomRef = useRef(zoom);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !xml.trim()) return;

    host.innerHTML = '';
    let osmd: OpenSheetMusicDisplay;
    try {
      osmd = new OpenSheetMusicDisplay(host, {
        autoResize: true,
        backend: 'svg',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const d = document.createElement('div');
      d.style.cssText =
        'padding:14px;font-size:0.86rem;line-height:1.5;color:#b71c1c;white-space:pre-wrap;';
      d.textContent = `악보 미리보기(OSMD)를 초기화하지 못했습니다: ${msg}`;
      host.appendChild(d);
      osmdRef.current = null;
      return;
    }
    osmdRef.current = osmd;

    let cancelled = false;
    void osmd
      .load(xml)
      .then(() => {
        if (cancelled) return;
        osmd.zoom = zoomRef.current;
        osmd.render();
      })
      .catch((loadErr: unknown) => {
        if (cancelled || !host) return;
        try {
          osmd.clear();
        } catch {
          /* ignore */
        }
        osmdRef.current = null;
        host.innerHTML = '';
        const d = document.createElement('div');
        d.style.cssText =
          'padding:14px;font-size:0.86rem;line-height:1.5;color:#b71c1c;white-space:pre-wrap;word-break:break-word;';
        const msg =
          loadErr instanceof Error ? loadErr.message : typeof loadErr === 'string' ? loadErr : String(loadErr);
        d.textContent = `MusicXML 미리보기를 불러오지 못했습니다(${msg}). 곡별로 OSMXL 스키마 차이 등으로 실패할 수 있습니다. PNG 비교만으로도 마스킹 여부를 확인할 수 있습니다.`;
        host.appendChild(d);
      });

    return () => {
      cancelled = true;
      osmd.clear();
      osmdRef.current = null;
    };
  }, [xml]);

  useEffect(() => {
    const osmd = osmdRef.current;
    if (!osmd || !osmd.IsReadyToRender()) return;
    osmd.zoom = zoom;
    osmd.render();
  }, [zoom]);

  return (
    <div
      ref={hostRef}
      className="audiveris-inspect-osmd"
      style={{ minHeight: 160, overflow: 'auto', border: '1px solid #ddd', borderRadius: 6, background: '#fff' }}
    />
  );
}

type StepProbeArtifact = { relPath: string; bytes: number };

type StepProbeResponse = {
  runId: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  argv: string[];
  pdfRequested: string;
  pdfUsed: string;
  note?: string;
  artifacts: StepProbeArtifact[];
};

/** 서버 `/api/audiveris-sheet-steps` 실패 시 폴백 (공식 CLI 순서와 동일). */
const AUDIVERIS_STEP_NAMES_FALLBACK = [
  'LOAD',
  'BINARY',
  'SCALE',
  'GRID',
  'HEADERS',
  'STEM_SEEDS',
  'BEAMS',
  'LEDGERS',
  'HEADS',
  'STEMS',
  'REDUCTION',
  'CUE_BEAMS',
  'TEXTS',
  'MEASURES',
  'CHORDS',
  'CURVES',
  'SYMBOLS',
  'LINKS',
  'RHYTHMS',
  'PAGE',
] as const;

function AudiverisStepProbeSection({
  jobId,
  maskedPdfExists,
}: {
  jobId: string;
  maskedPdfExists: boolean;
}) {
  const [steps, setSteps] = useState<string[]>([]);
  const [step, setStep] = useState('GRID');
  const [force, setForce] = useState(false);
  const [sheets, setSheets] = useState('');
  const [pdfSource, setPdfSource] = useState<'masked' | 'original'>('masked');
  const [busy, setBusy] = useState(false);
  const [probeErr, setProbeErr] = useState<string | null>(null);
  const [last, setLast] = useState<StepProbeResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/audiveris-sheet-steps', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { steps?: unknown }) => {
        if (cancelled || !Array.isArray(j.steps)) return;
        const list = j.steps.filter((x): x is string => typeof x === 'string');
        setSteps(list);
        setStep((prev) => {
          if (list.includes(prev)) return prev;
          if (list.includes('GRID')) return 'GRID';
          return list[0] ?? prev;
        });
      })
      .catch(() => {
        if (!cancelled) setSteps([...AUDIVERIS_STEP_NAMES_FALLBACK]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!maskedPdfExists && pdfSource === 'masked') setPdfSource('original');
  }, [maskedPdfExists, pdfSource]);

  const runProbe = async () => {
    setProbeErr(null);
    setBusy(true);
    setLast(null);
    try {
      const r = await fetch(`/api/diagnostic/${jobId}/audiveris-step-probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step,
          force,
          sheets: sheets.trim() || undefined,
          pdfSource,
        }),
      });
      const ct = r.headers.get('Content-Type') ?? '';
      const j = ct.includes('application/json') ? await r.json() : null;
      if (!r.ok) {
        const msg =
          j && typeof j === 'object' && j !== null && 'error' in j
            ? String((j as { error?: unknown }).error ?? `HTTP ${r.status}`)
            : `HTTP ${r.status}`;
        setProbeErr(msg);
        return;
      }
      setLast(j as StepProbeResponse);
    } catch (e) {
      setProbeErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details
      style={{
        marginTop: 14,
        padding: '12px 14px',
        background: '#252a33',
        borderRadius: 8,
        border: '1px solid #3c4049',
      }}
    >
      <summary style={{ cursor: 'pointer', fontWeight: 700, color: '#e8eaed', userSelect: 'none' }}>
        Audiveris 단계별 실행 (디버깅)
      </summary>
      <p style={{ margin: '10px 0 12px', fontSize: '0.86rem', color: '#bdc1c6', lineHeight: 1.5 }}>
        서버에서 Audiveris CLI로 <code>-batch -save -step …</code> 를 실행합니다(<strong>-export 없음</strong>). SCALE→GRID→… 순으로 단계를 올려 가며 로그와 생성된{' '}
        <code>.omr</code>·로그 파일을 받아 GitHub 이슈 재현에 쓸 수 있습니다. 서버 부하가 크므로 필요할 때만 실행하세요.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px', alignItems: 'flex-end', marginBottom: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.78rem', color: '#9aa0a6' }}>목표 단계 (-step)</span>
          <select value={step} onChange={(e) => setStep(e.target.value)} style={{ minWidth: 140 }}>
            {steps.length === 0 ? (
              <option value={step}>{step}</option>
            ) : (
              steps.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))
            )}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.78rem', color: '#9aa0a6' }}>-sheets (선택)</span>
          <input
            type="text"
            placeholder="예: 1 또는 1 4-7"
            value={sheets}
            onChange={(e) => setSheets(e.target.value)}
            style={{ width: 140 }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          <span style={{ fontSize: '0.88rem', color: '#e8eaed' }}>-force (BINARY부터 재처리)</span>
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.78rem', color: '#9aa0a6' }}>입력 PDF</span>
          <div style={{ display: 'flex', gap: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: maskedPdfExists ? 'pointer' : 'not-allowed' }}>
              <input
                type="radio"
                name={`pdfSrc-${jobId}`}
                checked={pdfSource === 'masked'}
                disabled={!maskedPdfExists}
                onChange={() => setPdfSource('masked')}
              />
              <span style={{ color: maskedPdfExists ? '#e8eaed' : '#666' }}>마스킹</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="radio" name={`pdfSrc-${jobId}`} checked={pdfSource === 'original'} onChange={() => setPdfSource('original')} />
              <span style={{ color: '#e8eaed' }}>업로드 원본</span>
            </label>
          </div>
        </div>
        <button type="button" disabled={busy} onClick={() => void runProbe()}>
          {busy ? '실행 중…' : '실행'}
        </button>
      </div>
      {probeErr && (
        <div className="status err" style={{ margin: '8px 0' }}>
          {probeErr}
        </div>
      )}
      {last && (
        <div style={{ marginTop: 10, fontSize: '0.82rem', color: '#bdc1c6' }}>
          <div>
            <strong>종료 코드</strong> {last.exitCode ?? '(null)'} · <strong>사용 PDF</strong> {last.pdfUsed}{' '}
            {last.pdfRequested !== last.pdfUsed && `(요청: ${last.pdfRequested})`}
          </div>
          {last.note && <div style={{ marginTop: 4, color: '#fdd663' }}>{last.note}</div>}
          <div style={{ marginTop: 8 }}>
            <strong>명령 인자</strong>
            <pre
              style={{
                margin: '6px 0 0',
                padding: 8,
                background: '#1a1d24',
                borderRadius: 6,
                overflow: 'auto',
                maxHeight: 120,
                fontSize: '0.76rem',
              }}
            >
              {JSON.stringify(last.argv)}
            </pre>
          </div>
          {last.artifacts.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <strong>생성 파일</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {last.artifacts.map((a) => (
                  <li key={a.relPath}>
                    <a
                      href={`/api/diagnostic/${jobId}/audiveris-step-probe/${last.runId}/download?rel=${encodeURIComponent(a.relPath)}`}
                      style={{ color: '#8ab4ff' }}
                      download
                    >
                      {a.relPath}
                    </a>{' '}
                    ({a.bytes} bytes)
                  </li>
                ))}
              </ul>
            </div>
          )}
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: 'pointer', color: '#e8eaed' }}>stdout / stderr</summary>
            <pre
              style={{
                marginTop: 8,
                padding: 8,
                background: '#1a1d24',
                borderRadius: 6,
                maxHeight: 220,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                fontSize: '0.76rem',
              }}
            >
              === stdout ==={'\n'}
              {last.stdout}
              {'\n\n'}=== stderr ==={'\n'}
              {last.stderr}
            </pre>
          </details>
        </div>
      )}
    </details>
  );
}

type Props = {
  jobId: string;
  onClose: () => void;
};

export function AudiverisInspectPanel({ jobId, onClose }: Props) {
  const [summary, setSummary] = useState<InspectSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(true);
  const [pngFailOrig, setPngFailOrig] = useState(false);
  const [pngFailMasked, setPngFailMasked] = useState(false);
  const [page, setPage] = useState(1);
  const [dpi, setDpi] = useState(132);
  const [rawXml, setRawXml] = useState<string | null>(null);
  const [partId, setPartId] = useState<string>('');
  const [scoreZoom, setScoreZoom] = useState(0.6);

  const refreshSummary = useCallback(async () => {
    setSummaryBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/diagnostic/${jobId}/summary`, { cache: 'no-store' });
      const ct = r.headers.get('Content-Type') ?? '';
      if (!r.ok) {
        if (ct.includes('application/json')) {
          const j = (await r.json()) as { error?: string };
          setErr(j.error || `HTTP ${r.status}`);
        } else {
          setErr(`HTTP ${r.status}`);
        }
        setSummary(null);
        return;
      }
      const data = (await r.json()) as InspectSummary;
      setSummary(data);
      setPage(1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSummary(null);
    } finally {
      setSummaryBusy(false);
    }
  }, [jobId]);

  const refreshScore = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`/api/diagnostic/${jobId}/score-musicxml`, { cache: 'no-store' });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setRawXml(null);
        setErr(j.error || `악보 XML HTTP ${r.status}`);
        return;
      }
      const text = await r.text();
      setRawXml(text);
      setPartId('');
    } catch (e) {
      setRawXml(null);
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [jobId]);

  const parts = rawXml ? parseScoreParts(rawXml) : [];
  const filteredXml = rawXml ? filterMusicXmlToPart(rawXml, partId || null) : '';

  const origSrc =
    summary && page >= 1 && page <= summary.pageCountForUi
      ? `/api/diagnostic/${jobId}/page/${page}/png?source=original&dpi=${dpi}`
      : '';
  const maskedSrc =
    summary?.maskedPdf.exists && page >= 1 && page <= summary.pageCountForUi
      ? `/api/diagnostic/${jobId}/page/${page}/png?source=masked&dpi=${dpi}`
      : '';

  useEffect(() => {
    void refreshSummary();
  }, [refreshSummary]);

  useEffect(() => {
    setPngFailOrig(false);
    setPngFailMasked(false);
  }, [origSrc, maskedSrc]);

  useEffect(() => {
    if (!summary?.scoreMusicXmlAvailable) {
      setRawXml(null);
      return;
    }
    void refreshScore();
  }, [summary?.scoreMusicXmlAvailable, refreshScore]);

  return (
    <div
      className="audiveris-inspect-root"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        minHeight: 200,
        minWidth: 0,
        overflowX: 'hidden',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: '0 0 6px', color: 'var(--text-color, #e8eaed)' }}>마스킹·Audiveris 인식 점검</h3>
          <p style={{ margin: 0, fontSize: '0.9rem', color: '#bdc1c6', lineHeight: 1.45 }}>
            같은 <strong>페이지</strong>에서 <strong>원본 PDF</strong>와 <strong>마스킹 PDF</strong>를 나란히 보고, 가사·제목 등이 과하게 지워졌는지·남았는지 확인하세요.
            Audiveris가 읽기 <strong>직전</strong> 벡터 PDF(<code>masked_input.pdf</code>)는 아래 링크로 브라우저에서 열거나 저장해 MuseScore·Adobe 등으로 비교할 수 있습니다.
            오른쪽은 Audiveris가 낸 악보(MusicXML) 미리보기입니다. 파트를 고르면 해당 <strong>성부 한 줄(파트)</strong>만 보기 쉽게 필터합니다(곡 전체와 페이지는 1:1이 아닐 수 있음).
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn-muted" onClick={() => void refreshSummary()}>
            요약 새로고침
          </button>
          {summary?.scoreMusicXmlAvailable && (
            <button type="button" className="btn-muted" onClick={() => void refreshScore()}>
              악보 XML 새로고침
            </button>
          )}
          <button type="button" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>

      {summaryBusy && !summary && !err && (
        <div className="status" style={{ margin: 0 }}>
          작업 요약을 불러오는 중…
        </div>
      )}

      {err && (
        <div className="status err" style={{ margin: 0 }}>
          {err}
        </div>
      )}

      {summary && (
        <div style={{ fontSize: '0.88rem', color: '#bdc1c6', lineHeight: 1.5 }}>
          <strong>파일</strong> {summary.originalName} · <strong>작업 상태</strong> {summary.status}
          <br />
          <strong>원본</strong> 페이지 수 {summary.originalPdf.pageCount ?? '(알 수 없음)'}
          {summary.maskedPdf.exists ? (
            <>
              {' '}
              · <strong>마스킹</strong> 페이지 수 {summary.maskedPdf.pageCount ?? '(알 수 없음)'}
            </>
          ) : (
            <>
              {' '}
              · <strong>마스킹 PDF 없음</strong>(OCR 결과 없이 원본을 Audiveris에 넘긴 경우 등)
            </>
          )}
          {!summary.pageCountsMatch && (
            <>
              {' '}
              · <span className="err">원본/마스킹 페이지 수가 다릅니다. PDF·스크립트를 확인하세요.</span>
            </>
          )}
          <br />
          {summary.scoreMusicXmlAvailable ? (
            <>악보 미리보기용 MusicXML 사용 가능.</>
          ) : (
            <span className="err">이 단계에서는 악보 XML을 아직 쓸 수 없습니다.</span>
          )}
          {summary.maskedPdf.exists && (
            <div
              style={{
                marginTop: 10,
                padding: '10px 12px',
                background: '#2a2f3a',
                borderRadius: 8,
                border: '1px solid #3c4049',
              }}
            >
              <div style={{ marginBottom: 8, color: '#e8eaed', lineHeight: 1.45 }}>
                <strong>Audiveris 입력 PDF</strong> — 서버의 <code style={{ fontSize: '0.82rem' }}>masked_input.pdf</code>와 동일합니다. MXL·MusicXML이 이미 잘못돼
                있어도, <strong>OCR 마스킹 직후</strong> 악보가 맞는지 여기서 먼저 확인하세요.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', alignItems: 'center' }}>
                <a
                  href={`/api/diagnostic/${jobId}/masked-pdf`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#8ab4ff', fontWeight: 600 }}
                >
                  새 탭에서 PDF 열기
                </a>
                <a
                  href={`/api/diagnostic/${jobId}/masked-pdf?download=1`}
                  style={{ color: '#8ab4ff', fontWeight: 600 }}
                  download
                >
                  마스킹 PDF 다운로드
                </a>
              </div>
            </div>
          )}
          {summary.originalPdf.exists && (
            <div style={{ marginTop: 8, fontSize: '0.84rem', color: '#9aa0a6' }}>
              업로드 원본 PDF:{' '}
              <a
                href={`/api/diagnostic/${jobId}/original-pdf`}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#8ab4ff' }}
              >
                열기
              </a>
              {' · '}
              <a href={`/api/diagnostic/${jobId}/original-pdf?download=1`} style={{ color: '#8ab4ff' }} download>
                다운로드
              </a>
            </div>
          )}
          <AudiverisStepProbeSection jobId={jobId} maskedPdfExists={summary.maskedPdf.exists} />
        </div>
      )}

      {summary && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            페이지 (1〜{summary.pageCountForUi})
            <input
              type="number"
              min={1}
              max={summary.pageCountForUi}
              value={page}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setPage(Number.isFinite(n) ? Math.max(1, Math.min(summary.pageCountForUi, n)) : 1);
              }}
              style={{ width: '4.5rem' }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            렌더 DPI
            <select value={dpi} onChange={(e) => setDpi(parseInt(e.target.value, 10))}>
              <option value={96}>96</option>
              <option value={132}>132</option>
              <option value={168}>168</option>
              <option value={200}>200</option>
            </select>
          </label>
          {summary.scoreMusicXmlAvailable && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                파트(성부)
                <select
                  value={partId}
                  onChange={(e) => setPartId(e.target.value)}
                  style={{ minWidth: 120 }}
                >
                  <option value="">전체</option>
                  {parts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.id})
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                악보 확대
                <input
                  type="range"
                  min={0.35}
                  max={1.2}
                  step={0.05}
                  value={scoreZoom}
                  onChange={(e) => setScoreZoom(parseFloat(e.target.value))}
                />
                <span style={{ width: '2.5rem' }}>{Math.round(scoreZoom * 100)}%</span>
              </label>
            </>
          )}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: summary?.scoreMusicXmlAvailable
            ? 'repeat(auto-fit, minmax(220px, 1fr))'
            : 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
          flex: 1,
          minHeight: 280,
          minWidth: 0,
          overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-color, #e8eaed)' }}>원본 PDF (페이지 {page})</div>
          {origSrc ? (
            <>
              <div
                style={{
                  background: '#eef0f3',
                  borderRadius: 4,
                  border: '1px solid #bdc1c6',
                  overflow: 'auto',
                  maxHeight: 'min(72vh, 920px)',
                }}
              >
                <img
                  key={origSrc}
                  src={origSrc}
                  alt={`원본 ${page}p`}
                  decoding="async"
                  loading="lazy"
                  style={{
                    display: 'block',
                    width: '100%',
                    height: 'auto',
                    minHeight: 60,
                  }}
                  onLoad={() => setPngFailOrig(false)}
                  onError={() => setPngFailOrig(true)}
                />
              </div>
              {pngFailOrig && (
                <div className="err" style={{ fontSize: '0.82rem', lineHeight: 1.35 }}>
                  원본 페이지 PNG 미리보기 로드 실패. 서버의 <code style={{ fontSize: '0.76rem' }}>pdf_diagnostic.py</code>·Python 실행 경로·캐시(
                  <code style={{ fontSize: '0.76rem' }}>.diag-cache/</code>)를 확인하거나 DPI를 바꿔 다시 불러오세요.
                </div>
              )}
            </>
          ) : (
            <div className="sub">{summaryBusy ? '…' : '이미지 없음'}</div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-color, #e8eaed)' }}>마스킹 PDF (페이지 {page})</div>
          {!summary?.maskedPdf.exists && <div className="sub">마스킹 파일 없음 — 비교 불가</div>}
          {summary?.maskedPdf.exists && maskedSrc && (
            <>
              <div
                style={{
                  background: '#eef0f3',
                  borderRadius: 4,
                  border: '1px solid #bdc1c6',
                  overflow: 'auto',
                  maxHeight: 'min(72vh, 920px)',
                }}
              >
                <img
                  key={maskedSrc}
                  src={maskedSrc}
                  alt={`마스킹 ${page}p`}
                  decoding="async"
                  loading="lazy"
                  style={{
                    display: 'block',
                    width: '100%',
                    height: 'auto',
                    minHeight: 60,
                  }}
                  onLoad={() => setPngFailMasked(false)}
                  onError={() => setPngFailMasked(true)}
                />
              </div>
              {pngFailMasked && (
                <div className="err" style={{ fontSize: '0.82rem', lineHeight: 1.35 }}>
                  마스킹 페이지 PNG 미리보기 로드 실패. 마스킹 PDF 저장이 깨졌거나 래스터화에 실패했을 수 있습니다. 위쪽「요약 새로고침」 후 DPI를 바꿔 보거나, 마스킹 PDF 링크로 직접 열어 확인하세요.
                </div>
              )}
            </>
          )}
        </div>
        {summary?.scoreMusicXmlAvailable && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, maxHeight: '70vh' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-color, #e8eaed)' }}>Audiveris 악보(파트 필터)</div>
            {filteredXml ? (
              <OsmdBlock xml={filteredXml} zoom={scoreZoom} />
            ) : (
              <div className="sub">불러오는 중…</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

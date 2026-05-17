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
    const osmd = new OpenSheetMusicDisplay(host, {
      autoResize: true,
      backend: 'svg',
    });
    osmdRef.current = osmd;

    let cancelled = false;
    void osmd.load(xml).then(() => {
      if (cancelled) return;
      osmd.zoom = zoomRef.current;
      osmd.render();
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

type Props = {
  jobId: string;
  onClose: () => void;
};

export function AudiverisInspectPanel({ jobId, onClose }: Props) {
  const [summary, setSummary] = useState<InspectSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [dpi, setDpi] = useState(132);
  const [rawXml, setRawXml] = useState<string | null>(null);
  const [partId, setPartId] = useState<string>('');
  const [scoreZoom, setScoreZoom] = useState(0.6);

  const refreshSummary = useCallback(async () => {
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

  useEffect(() => {
    void refreshSummary();
  }, [refreshSummary]);

  useEffect(() => {
    if (!summary?.scoreMusicXmlAvailable) {
      setRawXml(null);
      return;
    }
    void refreshScore();
  }, [summary?.scoreMusicXmlAvailable, refreshScore]);

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

  return (
    <div className="audiveris-inspect-root" style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '85vh' }}>
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
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-color, #e8eaed)' }}>원본 PDF (페이지 {page})</div>
          {origSrc ? (
            <img
              key={origSrc}
              src={origSrc}
              alt={`원본 ${page}p`}
              style={{ maxWidth: '100%', height: 'auto', border: '1px solid #ccc', borderRadius: 4 }}
            />
          ) : (
            <div className="sub">이미지 없음</div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-color, #e8eaed)' }}>마스킹 PDF (페이지 {page})</div>
          {!summary?.maskedPdf.exists && <div className="sub">마스킹 파일 없음 — 비교 불가</div>}
          {summary?.maskedPdf.exists && maskedSrc && (
            <img
              key={maskedSrc}
              src={maskedSrc}
              alt={`마스킹 ${page}p`}
              style={{ maxWidth: '100%', height: 'auto', border: '1px solid #ccc', borderRadius: 4 }}
            />
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

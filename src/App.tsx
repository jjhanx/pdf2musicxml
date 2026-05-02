import { useCallback, useEffect, useRef, useState } from 'react';

type Health = {
  ok: boolean;
  audiverisConfigured: boolean;
  hint?: string;
};

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState('');

  const prevBlobUrl = useRef<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false, audiverisConfigured: false }));
  }, []);

  useEffect(() => {
    return () => {
      if (prevBlobUrl.current) URL.revokeObjectURL(prevBlobUrl.current);
    };
  }, []);

  const convert = useCallback(async () => {
    if (!file || !health?.audiverisConfigured) return;
    setBusy(true);
    setStatus('Audiveris 실행 중… (PDF 페이지 수에 따라 수 분 걸릴 수 있습니다)');
    if (prevBlobUrl.current) {
      URL.revokeObjectURL(prevBlobUrl.current);
      prevBlobUrl.current = null;
    }
    setDownloadUrl(null);
    setDownloadName('');

    const fd = new FormData();
    fd.append('pdf', file);

    try {
      const res = await fetch('/api/convert', { method: 'POST', body: fd });
      const ct = res.headers.get('Content-Type') ?? '';

      if (!res.ok) {
        if (ct.includes('application/json')) {
          const j = (await res.json()) as { error?: string; detail?: string; stderrTail?: string };
          setStatus(
            [j.error, j.detail, j.stderrTail].filter(Boolean).join('\n') || `HTTP ${res.status}`,
          );
        } else {
          setStatus(await res.text());
        }
        return;
      }

      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition');
      let name = file.name.replace(/\.pdf$/i, '') + (ct.includes('zip') ? '-parts.zip' : '.mxl');
      const m = cd?.match(/filename="([^"]+)"/);
      if (m?.[1]) name = m[1];

      const url = URL.createObjectURL(blob);
      prevBlobUrl.current = url;
      setDownloadUrl(url);
      setDownloadName(name);
      setStatus('완료 — 아래에서 저장하거나 mxlplayer에서 같은 파일을 업로드하세요.');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [file, health?.audiverisConfigured]);

  return (
    <div className="page">
      <div className="card">
        <h1>PDF → MusicXML (Audiveris)</h1>
        <p className="sub">
          mxlplayer와 동일하게 <strong>Vite + React + TypeScript</strong>입니다. 변환은 로컬{' '}
          <strong>Audiveris</strong> CLI를 호출합니다. 결과는 표준 <code>.mxl</code> /
          <code>.musicxml</code> 이라 mxlplayer의 업로드(.xml / .musicxml / .mxl)와 호환됩니다.
        </p>

        <div className="row">
          <label className="file-label">
            <input
              type="file"
              accept=".pdf,application/pdf"
              hidden
              onChange={(ev) => {
                const f = ev.target.files?.[0];
                setFile(f ?? null);
                setStatus(f ? `선택됨: ${f.name}` : '');
              }}
            />
            PDF 선택
          </label>
          <button type="button" disabled={!file || !health?.audiverisConfigured || busy} onClick={convert}>
            변환
          </button>
        </div>

        <div className={`status ${health?.audiverisConfigured ? 'ok' : 'err'}`}>
          {health === null && '서버 상태 확인 중…'}
          {health && !health.audiverisConfigured && (
            <>
              Audiveris 경로가 설정되지 않았습니다.
              <br />
              PowerShell 예:{' '}
              <code>$env:AUDIVERIS_BIN=&quot;D:\Audiveris\bin\Audiveris.bat&quot;</code>
              <br />
              그 다음 이 폴더에서 <code>npm run dev</code> 로 API 서버를 다시 띄우세요.
            </>
          )}
          {health?.audiverisConfigured && <>Audiveris 준비됨 (로컬 API)</>}
        </div>

        {status && <div className="status">{status}</div>}

        {downloadUrl && (
          <p style={{ marginTop: '1rem' }}>
            <a href={downloadUrl} download={downloadName}>
              다운로드: {downloadName}
            </a>
          </p>
        )}
      </div>

      <div className="card">
        <p className="sub" style={{ margin: 0 }}>
          CLI만 쓰려면: <code>npm run convert -- &quot;악보.pdf&quot;</code> → 기본 저장 위치는 이 PC의{' '}
          <strong>Downloads</strong> 폴더입니다.
        </p>
      </div>
    </div>
  );
}

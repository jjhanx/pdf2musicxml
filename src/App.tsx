import { useCallback, useEffect, useRef, useState } from 'react';

type Health = {
  ok: boolean;
  audiverisConfigured: boolean;
  hint?: string;
};

type ConvertTask = {
  id: string;
  fileName: string;
  phase: 'queued' | 'running' | 'done' | 'error';
  downloadUrl?: string;
  downloadName?: string;
  errorMessage?: string;
};

function isPdfFile(f: File): boolean {
  const byName = /\.pdf$/i.test(f.name);
  const byType =
    f.type === 'application/pdf' ||
    f.type === 'application/x-pdf' ||
    (f.type === 'application/octet-stream' && byName);
  return byType || byName;
}

function taskKey(f: File): string {
  return `${f.name}|${f.size}|${f.lastModified}`;
}

function mergePdfFiles(existing: File[], incoming: File[]): File[] {
  const keys = new Set(existing.map(taskKey));
  const out = [...existing];
  for (const f of incoming) {
    if (!isPdfFile(f)) continue;
    const k = taskKey(f);
    if (keys.has(k)) continue;
    keys.add(k);
    out.push(f);
  }
  return out;
}

function revokeTaskUrls(tasks: ConvertTask[]) {
  for (const t of tasks) {
    if (t.downloadUrl) URL.revokeObjectURL(t.downloadUrl);
  }
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [tasks, setTasks] = useState<ConvertTask[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const tasksRef = useRef<ConvertTask[]>([]);
  const filesRef = useRef<File[]>([]);

  tasksRef.current = tasks;
  filesRef.current = files;

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false, audiverisConfigured: false }));
  }, []);

  useEffect(() => {
    return () => {
      revokeTaskUrls(tasksRef.current);
    };
  }, []);

  const addFilesFromList = useCallback((list: FileList | File[]) => {
    const arr = Array.from(list);
    setFiles((prev) => mergePdfFiles(prev, arr));
    const pdfCount = arr.filter(isPdfFile).length;
    if (pdfCount < arr.length) {
      setStatus(`PDF ${pdfCount}개 추가됨 (PDF가 아닌 항목은 제외)`);
    } else {
      setStatus(`PDF ${pdfCount}개 추가됨`);
    }
  }, []);

  const clearFiles = useCallback(() => {
    setFiles([]);
    setTasks([]);
    setStatus('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const removeFileAt = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const convertOne = useCallback(async (file: File): Promise<Omit<ConvertTask, 'id' | 'fileName' | 'phase'>> => {
    const fd = new FormData();
    fd.append('pdf', file);
    const res = await fetch('/api/convert', { method: 'POST', body: fd });
    const ct = res.headers.get('Content-Type') ?? '';

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      if (ct.includes('application/json')) {
        const j = (await res.json()) as { error?: string; detail?: string; stderrTail?: string };
        msg = [j.error, j.detail, j.stderrTail].filter(Boolean).join('\n') || msg;
      } else {
        msg = await res.text();
      }
      return { errorMessage: msg };
    }

    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition');
    let name = file.name.replace(/\.pdf$/i, '') + (ct.includes('zip') ? '-parts.zip' : '.mxl');
    const m = cd?.match(/filename="([^"]+)"/);
    if (m?.[1]) name = m[1];
    const downloadUrl = URL.createObjectURL(blob);
    return { downloadUrl, downloadName: name };
  }, []);

  const runBatch = useCallback(async () => {
    const list = [...filesRef.current];
    if (!list.length || !health?.audiverisConfigured) return;

    revokeTaskUrls(tasksRef.current);

    const initialTasks: ConvertTask[] = list.map((f) => ({
      id: crypto.randomUUID(),
      fileName: f.name,
      phase: 'queued',
    }));
    setTasks(initialTasks);
    setBusy(true);
    setStatus(`총 ${list.length}개 변환 시작 (순차 처리)`);

    try {
      for (let i = 0; i < list.length; i++) {
        const file = list[i];
        const taskId = initialTasks[i].id;

        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, phase: 'running' } : t)),
        );

        try {
          const result = await convertOne(file);
          setTasks((prev) =>
            prev.map((t) => {
              if (t.id !== taskId) return t;
              if (result.errorMessage) {
                return { ...t, phase: 'error', errorMessage: result.errorMessage };
              }
              return {
                ...t,
                phase: 'done',
                downloadUrl: result.downloadUrl,
                downloadName: result.downloadName,
              };
            }),
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setTasks((prev) =>
            prev.map((t) => (t.id === taskId ? { ...t, phase: 'error', errorMessage: msg } : t)),
          );
        }
      }
      setStatus('일괄 변환 종료 — 각 행에서 결과를 저장하세요.');
    } finally {
      setBusy(false);
    }
  }, [health?.audiverisConfigured, convertOne]);

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    setDragOver(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const dt = e.dataTransfer.files;
    if (dt?.length) addFilesFromList(dt);
  };

  return (
    <div className="page">
      <div className="card">
        <h1>PDF → MusicXML (Audiveris)</h1>
        <p className="sub">
          mxlplayer와 동일하게 <strong>Vite + React + TypeScript</strong>입니다. 변환은 로컬{' '}
          <strong>Audiveris</strong> CLI를 호출합니다. 결과는 표준 <code>.mxl</code> /
          <code>.musicxml</code> 이라 mxlplayer의 업로드(.xml / .musicxml / .mxl)와 호환됩니다.
        </p>

        {/* 버튼은 드롭존 밖에 두어, 자식 위로 드래그할 때 dragleave/드롭 타깃 문제를 피함 */}
        <div
          className={`dropzone ${dragOver ? 'dropzone-active' : ''}`}
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <p className="dropzone-title">PDF를 여기에 놓으세요</p>
          <p className="dropzone-hint">여러 파일 한 번에 · 드롭 영역은 위 칸만 해당합니다</p>
        </div>

        <div className="row dropzone-actions">
          <label className="file-label">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              multiple
              hidden
              onChange={(ev) => {
                const fl = ev.target.files;
                if (fl?.length) addFilesFromList(fl);
              }}
            />
            PDF 선택 (복수)
          </label>
          <button type="button" className="btn-secondary" disabled={!files.length} onClick={clearFiles}>
            목록 비우기
          </button>
          <button
            type="button"
            disabled={!files.length || !health?.audiverisConfigured || busy}
            onClick={() => void runBatch()}
          >
            변환 ({files.length}개)
          </button>
        </div>

        {files.length > 0 && (
          <ul className="file-list">
            {files.map((f, i) => (
              <li key={taskKey(f)}>
                <span className="file-list-name">{f.name}</span>
                <button type="button" className="btn-link" disabled={busy} onClick={() => removeFileAt(i)}>
                  제거
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className={`status ${health?.audiverisConfigured ? 'ok' : 'err'}`}>
          {health === null && '서버 상태 확인 중…'}
          {health && !health.audiverisConfigured && (
            <>
              Audiveris 경로가 설정되지 않았습니다.
              <br />
              Linux 예: <code>export AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris</code>
              <br />
              서버를 다시 실행하세요.
            </>
          )}
          {health?.audiverisConfigured && <>Audiveris 준비됨 (로컬 API)</>}
        </div>

        {status && <div className="status">{status}</div>}

        {tasks.length > 0 && (
          <table className="task-table">
            <thead>
              <tr>
                <th>파일</th>
                <th>상태</th>
                <th>결과</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td className="task-name">{t.fileName}</td>
                  <td>
                    {t.phase === 'queued' && '대기'}
                    {t.phase === 'running' && '변환 중…'}
                    {t.phase === 'done' && <span className="ok">완료</span>}
                    {t.phase === 'error' && <span className="err">실패</span>}
                  </td>
                  <td>
                    {t.phase === 'done' && t.downloadUrl && (
                      <a href={t.downloadUrl} download={t.downloadName}>
                        저장
                      </a>
                    )}
                    {t.phase === 'error' && (
                      <span className="err task-err" title={t.errorMessage}>
                        {t.errorMessage?.slice(0, 80)}
                        {(t.errorMessage?.length ?? 0) > 80 ? '…' : ''}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <p className="sub" style={{ margin: 0 }}>
          CLI만 쓰려면: <code>npm run convert -- &quot;악보.pdf&quot;</code> → 기본 저장 위치는{' '}
          <strong>Downloads</strong> 폴더입니다.
        </p>
      </div>
    </div>
  );
}

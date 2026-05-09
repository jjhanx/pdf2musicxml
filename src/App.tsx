import { useCallback, useEffect, useRef, useState } from 'react';

type Health = {
  ok: boolean;
  audiverisConfigured: boolean;
  hint?: string;
  jobRetentionHours?: number;
  jobRetentionNote?: string;
};

/** `/api/status`의 progress와 동일 */
type TaskProgress = {
  phase: string;
  current: number;
  total: number;
  detail?: string;
};

type ConvertTask = {
  id: string;
  fileName: string;
  phase: 'queued' | 'running' | 'done' | 'error';
  downloadUrl?: string;
  downloadName?: string;
  errorMessage?: string;
  progress?: TaskProgress;
};

function isPdfFile(f: File): boolean {
  const byName = /\.pdf$/i.test(f.name);
  const byType =
    f.type === 'application/pdf' ||
    f.type === 'application/x-pdf' ||
    (f.type === 'application/octet-stream' && byName);
  return byType || byName;
}

/** 드롭 직후 일부 환경에서 `files`만 비고 `items`에만 들어오는 경우 보완 */
function extractPdfFilesFromDataTransfer(dt: DataTransfer): File[] {
  const out: File[] = [];
  const seen = new Set<string>();

  const take = (f: File | null) => {
    if (!f || !isPdfFile(f)) return;
    const k = taskKey(f);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(f);
  };

  if (dt.files?.length) {
    for (let i = 0; i < dt.files.length; i++) take(dt.files[i]);
  }
  if (!out.length && dt.items?.length) {
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item.kind === 'file') take(item.getAsFile());
    }
  }
  return out;
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
    const u = t.downloadUrl;
    if (u?.startsWith('blob:')) URL.revokeObjectURL(u);
  }
}

const POLL_INTERVAL_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function taskProgressPhaseLabel(phase: string): string {
  if (phase === 'ocr') return 'OCR·마스킹';
  if (phase === 'audiveris') return '악보 인식(Audiveris)';
  if (phase === 'merge') return '가사 병합';
  return phase;
}

function formatTaskProgressLine(p: TaskProgress): string {
  const frac = p.total > 0 ? `${p.current} / ${p.total}` : '';
  const det = p.detail ? (frac ? ` — ${p.detail}` : p.detail) : '';
  return `${taskProgressPhaseLabel(p.phase)}${frac ? ` (${frac})` : ''}${det}`.trim();
}

/** HTTP(평문)에서는 `crypto.randomUUID()`가 없거나 예외를 유발할 수 있음 */
function newTaskId(): string {
  try {
    const c = globalThis.crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    /* skip */
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [tasks, setTasks] = useState<ConvertTask[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [debugMode, setDebugMode] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const tasksRef = useRef<ConvertTask[]>([]);

  tasksRef.current = tasks;

  useEffect(() => {
    fetch('/api/health')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Health>;
      })
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
    if (!pdfCount) {
      setStatus('추가된 PDF가 없습니다 (.pdf 확장자·MIME 확인)');
      return;
    }
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

  const convertOne = useCallback(
    async (
      file: File,
      debug: boolean,
      onProgress?: (p: TaskProgress | undefined) => void,
    ): Promise<Omit<ConvertTask, 'id' | 'fileName' | 'phase'>> => {
    const fd = new FormData();
    fd.append('pdf', file);
    fd.append('debug', debug ? 'true' : 'false');
    const acceptRes = await fetch('/api/convert', { method: 'POST', body: fd });
    const acceptCt = acceptRes.headers.get('Content-Type') ?? '';

    if (acceptRes.status !== 202) {
      let msg = `HTTP ${acceptRes.status}`;
      if (acceptCt.includes('application/json')) {
        const j = (await acceptRes.json()) as { error?: string; detail?: string; stderrTail?: string };
        msg = [j.error, j.detail, j.stderrTail].filter(Boolean).join('\n') || msg;
      } else {
        msg = await acceptRes.text();
      }
      return { errorMessage: msg };
    }

    const accepted = (await acceptRes.json()) as { jobId?: string };
    if (!accepted.jobId) {
      return { errorMessage: '서버에서 작업 ID(jobId)를 받지 못했습니다' };
    }
    const { jobId } = accepted;

    for (;;) {
      const st = await fetch(`/api/status/${jobId}`);
      const stCt = st.headers.get('Content-Type') ?? '';
      if (!st.ok) {
        let msg = `상태 조회 HTTP ${st.status}`;
        if (stCt.includes('application/json')) {
          const j = (await st.json()) as { error?: string };
          if (j.error) msg = j.error;
        }
        return { errorMessage: msg };
      }

      const j = (await st.json()) as {
        status: string;
        httpError?: number;
        error?: string;
        detail?: string;
        stderrTail?: string;
        progress?: TaskProgress;
      };

      if (j.progress) {
        onProgress?.(j.progress);
      }

      if (j.status === 'failed') {
        const msg =
          [j.error, j.detail, j.stderrTail].filter(Boolean).join('\n') ||
          `변환 실패 (HTTP ${j.httpError ?? '?'})`;
        return { errorMessage: msg };
      }

      if (j.status === 'completed') {
        break;
      }

      await sleep(POLL_INTERVAL_MS);
    }

    const dl = await fetch(`/api/download/${jobId}`);
    const dlCt = dl.headers.get('Content-Type') ?? '';

    if (!dl.ok) {
      let msg = `다운로드 HTTP ${dl.status}`;
      if (dlCt.includes('application/json')) {
        const errBody = (await dl.json()) as { error?: string };
        if (errBody.error) msg = errBody.error;
      } else {
        msg = await dl.text();
      }
      return { errorMessage: msg };
    }

    const blob = await dl.blob();
    const cd = dl.headers.get('Content-Disposition');
    let name = file.name.replace(/\.pdf$/i, '') + (dlCt.includes('zip') ? '-parts.zip' : '.mxl');
    const mUtf8 = cd?.match(/filename\*=UTF-8''([^;]+)/i);
    if (mUtf8?.[1]) {
      name = decodeURIComponent(mUtf8[1]);
    } else {
      const m = cd?.match(/filename="([^"]+)"/);
      if (m?.[1]) name = m[1];
    }
    const downloadUrl = URL.createObjectURL(blob);
    onProgress?.(undefined);
    return { downloadUrl, downloadName: name };
  },
    [],
  );

  const runBatchWith = useCallback(
    async (listArg: File[], healthArg: Health | null, debug: boolean) => {
      const list = [...listArg];

      if (!list.length) {
        setStatus('변환할 PDF가 없습니다. 드롭 또는 파일 선택으로 목록을 채운 뒤 다시 눌러 주세요.');
        return;
      }
      if (healthArg === null) {
        setStatus('서버 상태를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      if (!healthArg.audiverisConfigured) {
        setStatus('Audiveris 경로(AUDIVERIS_BIN)가 서버에 설정되어 있지 않습니다.');
        return;
      }

      revokeTaskUrls(tasksRef.current);

      const initialTasks: ConvertTask[] = list.map((f) => ({
        id: newTaskId(),
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
            const result = await convertOne(file, debug, (p) => {
              setTasks((prev) =>
                prev.map((t) => (t.id === taskId ? { ...t, progress: p } : t)),
              );
            });
            setTasks((prev) =>
              prev.map((t) => {
                if (t.id !== taskId) return t;
                if (result.errorMessage) {
                  return { ...t, phase: 'error', errorMessage: result.errorMessage, progress: undefined };
                }
                return {
                  ...t,
                  phase: 'done',
                  progress: undefined,
                  downloadUrl: result.downloadUrl,
                  downloadName: result.downloadName,
                };
              }),
            );
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setTasks((prev) =>
              prev.map((t) => (t.id === taskId ? { ...t, phase: 'error', errorMessage: msg, progress: undefined } : t)),
            );
          }
        }
        setStatus('일괄 변환 종료 — 각 행에서 결과를 저장하세요.');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus(`변환 준비 중 오류: ${msg}`);
        console.error(e);
      } finally {
        setBusy(false);
      }
    },
    [convertOne],
  );

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
    const dropped = extractPdfFilesFromDataTransfer(e.dataTransfer);
    if (dropped.length) addFilesFromList(dropped);
    else setStatus('여기에 놓인 파일에서 PDF를 찾지 못했습니다. 확장자 .pdf 인지 확인해 주세요.');
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
            onClick={() =>
              void runBatchWith(files, health, debugMode).catch((err: unknown) => {
                console.error(err);
                setBusy(false);
                setStatus(`오류: ${err instanceof Error ? err.message : String(err)}`);
              })
            }
          >
            변환 ({files.length}개)
          </button>
        </div>

        <div className="row" style={{ marginTop: '0.5rem' }}>
          <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-color, inherit)' }}>
            <input
              type="checkbox"
              checked={debugMode}
              onChange={(e) => setDebugMode(e.target.checked)}
              disabled={busy}
            />
            중간 과정 파일 함께 다운로드 (디버그 모드, ZIP)
          </label>
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

        {health?.audiverisConfigured && (health.jobRetentionNote ?? health.jobRetentionHours != null) && (
          <p className="sub retention-note" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
            {health.jobRetentionNote ??
              `변환이 끝난 뒤 서버에 올라온 결과는 최대 ${health.jobRetentionHours}시간 동안만 보관됩니다. 그 안에 다운로드해 주세요.`}
          </p>
        )}

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
                    {t.phase === 'running' && (
                      <div className="task-status-running">
                        {!t.progress && <span>변환 중…</span>}
                        {t.progress && (
                          <>
                            <div className="task-progress-line" title={formatTaskProgressLine(t.progress)}>
                              {formatTaskProgressLine(t.progress)}
                            </div>
                            {t.progress.total > 0 ? (
                              <div className="task-progress-track" aria-hidden>
                                <div
                                  className="task-progress-fill"
                                  style={{
                                    width: `${Math.min(
                                      100,
                                      (100 * Math.min(t.progress.current, t.progress.total)) / t.progress.total,
                                    )}%`,
                                  }}
                                />
                              </div>
                            ) : (
                              <div className="task-progress-indeterminate" aria-hidden>
                                <div className="task-progress-indeterminate-bar" />
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
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

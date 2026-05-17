import { useCallback, useEffect, useRef, useState } from 'react';

type Health = {
  ok: boolean;
  audiverisConfigured: boolean;
  hint?: string;
  jobRetentionHours?: number;
  jobRetentionNote?: string;
};

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

type OcrReviewItem = {
  id: string;
  page: number;
  text: string;
  confidence: number;
  x: number;
  y: number;
  bbox?: number[];
  type?: string;
  /** MusicXML에서 `part` 순서(1=첫 파트, 합창 4부면 보통 4). Audiveris 출력 part-list 순서와 동일 */
  lyricPartIndex?: number;
  /** 해당 파트 안의 MusicXML `<voice>` (미입력 시 1). 피아노·성부 겹침 악보에서 조정 */
  lyricVoice?: string;
  /** 이 블록의 가사를 넣기 전, 해당 성부에서 건너뛸 선율 음표 수(박·도입 등) */
  lyricSkipNotes?: number;
};

function mergeReviewFieldsFromSaved(
  item: OcrReviewItem,
  match: Record<string, unknown>,
): OcrReviewItem {
  const next = { ...item };
  if (typeof match.type === 'string') next.type = match.type;
  if (typeof match.text === 'string') next.text = match.text;
  if (typeof match.lyricPartIndex === 'number' && match.lyricPartIndex >= 1) {
    next.lyricPartIndex = Math.floor(match.lyricPartIndex);
  }
  if (typeof match.lyricVoice === 'string') next.lyricVoice = match.lyricVoice;
  if (typeof match.lyricSkipNotes === 'number' && match.lyricSkipNotes >= 0) {
    next.lyricSkipNotes = Math.floor(match.lyricSkipNotes);
  }
  return next;
}

const LYRIC_VOICE_PRESETS = ['1', '2', '3', '4', '*'] as const;

function lyricVoicePresetKey(v: string | undefined): (typeof LYRIC_VOICE_PRESETS)[number] | '__custom__' {
  const s = (v && String(v).trim()) || '1';
  return (LYRIC_VOICE_PRESETS as readonly string[]).includes(s)
    ? (s as (typeof LYRIC_VOICE_PRESETS)[number])
    : '__custom__';
}

/** 추출 JSON은 type이 unknown인 경우가 많아, 검토 창 첫 표시 시 기본은 가사로 둔다. */
function defaultReviewTypeForInit(t: string | undefined): string {
  if (
    t === 'title' ||
    t === 'composer' ||
    t === 'lyricist' ||
    t === 'copyright' ||
    t === 'lyrics' ||
    t === 'tempo'
  ) {
    return t;
  }
  return 'lyrics';
}

function isPdfFile(f: File): boolean {
  const byName = /\.pdf$/i.test(f.name);
  const byType =
    f.type === 'application/pdf' ||
    f.type === 'application/x-pdf' ||
    (f.type === 'application/octet-stream' && byName);
  return byType || byName;
}

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
  if (phase === 'upload') return 'PDF 업로드';
  if (phase === 'audiveris') return '악보 인식(Audiveris)';
  return phase;
}

function formatTaskProgressLine(p: TaskProgress): string {
  const phase = taskProgressPhaseLabel(p.phase);
  const frac = p.total > 0 ? `${p.current} / ${p.total}` : '';
  const parts: string[] = [phase];
  if (frac) parts.push(`(${frac})`);
  if (p.detail) parts.push(p.detail);
  return parts.join(' ');
}

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
  const [autoSave, setAutoSave] = useState(false);
  
  const [reviewingJobId, setReviewingJobId] = useState<string | null>(null);
  const [reviewData, setReviewData] = useState<OcrReviewItem[]>([]);
  const [reviewOriginalFileName, setReviewOriginalFileName] = useState('');
  const [hasSavedData, setHasSavedData] = useState(false);
  const [scoreTransposeSemitones, setScoreTransposeSemitones] = useState(0);
  const [pauseAfterAudiveris, setPauseAfterAudiveris] = useState(false);
  const [audiverisReviewJobId, setAudiverisReviewJobId] = useState<string | null>(null);
  const [audiverisTranspose, setAudiverisTranspose] = useState(0);
  const audiverisReplaceRef = useRef<HTMLInputElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadReviewRef = useRef<HTMLInputElement>(null);
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
      onProgress?: (p: TaskProgress | undefined) => void,
      onReviewNeeded?: (jobId: string) => void,
      onAudiverisReviewNeeded?: (jobId: string) => void,
      opts?: { pauseAfterAudiveris?: boolean },
    ): Promise<Omit<ConvertTask, 'id' | 'fileName' | 'phase'>> => {
    const fd = new FormData();
    fd.append('pdf', file);
    fd.append('debug', 'false');
    if (opts?.pauseAfterAudiveris) {
      fd.append('pauseAfterAudiveris', 'true');
    }
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
    let reviewTriggered = false;
    let audiverisReviewTriggered = false;

    for (;;) {
      const st = await fetch(`/api/status/${jobId}`, { cache: 'no-store' });
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
        stdoutTail?: string;
        stderrTail?: string;
        progress?: TaskProgress;
      };

      if (j.progress) {
        onProgress?.(j.progress);
      }

      if (j.status === 'review_needed' && !reviewTriggered) {
        reviewTriggered = true;
        onReviewNeeded?.(jobId);
      }

      if (j.status === 'audiveris_review_needed' && !audiverisReviewTriggered) {
        audiverisReviewTriggered = true;
        onAudiverisReviewNeeded?.(jobId);
      }

      if (j.status === 'failed') {
        const msg =
          [j.error, j.detail, j.stdoutTail, j.stderrTail].filter(Boolean).join('\n') ||
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
    async (listArg: File[], healthArg: Health | null, autoSaveFlag: boolean) => {
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
            const result = await convertOne(
              file,
              (p) => {
                setTasks((prev) =>
                  prev.map((t) => (t.id === taskId ? { ...t, progress: p } : t)),
                );
              },
              async (jobId) => {
                try {
                  const r = await fetch(`/api/review/${jobId}`);
                  if (r.ok) {
                    const data: OcrReviewItem[] = await r.json();

                    // Initialize missing fields for the UI
                    const initData = data.map((item) => ({
                      ...item,
                      type: defaultReviewTypeForInit(item.type),
                      lyricPartIndex:
                        typeof item.lyricPartIndex === 'number' && item.lyricPartIndex >= 1
                          ? Math.floor(item.lyricPartIndex)
                          : 1,
                      lyricVoice: (item.lyricVoice && String(item.lyricVoice).trim()) || '1',
                      lyricSkipNotes:
                        typeof item.lyricSkipNotes === 'number' && item.lyricSkipNotes >= 0
                          ? Math.floor(item.lyricSkipNotes)
                          : 0,
                    }));

                    setReviewData(initData);
                    setReviewingJobId(jobId);
                    setReviewOriginalFileName(file.name);

                    const saved = localStorage.getItem('pdf2mxl_review_' + file.name);
                    setHasSavedData(!!saved);
                  }
                } catch (e) {
                  console.error('Failed to fetch review data', e);
                }
              },
              (jobId) => {
                setAudiverisTranspose(0);
                setAudiverisReviewJobId(jobId);
              },
              { pauseAfterAudiveris },
            );
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

            if (autoSaveFlag && result.downloadUrl && !result.errorMessage) {
              const a = document.createElement('a');
              a.href = result.downloadUrl;
              a.download = result.downloadName || 'score.mxl';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            }
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
    [convertOne, pauseAfterAudiveris],
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

  useEffect(() => {
    if (reviewingJobId && reviewOriginalFileName && reviewData.length > 0) {
      localStorage.setItem('pdf2mxl_review_' + reviewOriginalFileName, JSON.stringify(reviewData));
    }
  }, [reviewData, reviewingJobId, reviewOriginalFileName]);

  const handleLoadPrevious = () => {
    if (!reviewOriginalFileName) return;
    const saved = localStorage.getItem('pdf2mxl_review_' + reviewOriginalFileName);
    if (saved) {
       try {
         const parsed = JSON.parse(saved);
         const merged = reviewData.map((item) => {
            const match = parsed.find((p: { id?: string }) => p.id === item.id);
            return match ? mergeReviewFieldsFromSaved(item, match as Record<string, unknown>) : item;
         });
         setReviewData(merged);
       } catch (e) {
         console.error('Failed to load saved data', e);
       }
    }
  };

  const handleDownloadReview = () => {
    const jsonStr = JSON.stringify(reviewData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `review_backup_${reviewOriginalFileName || 'data'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleUploadReview = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
       try {
         const parsed = JSON.parse(ev.target?.result as string);
         if (Array.isArray(parsed)) {
            const merged = reviewData.map((item) => {
               const match = parsed.find((p: { id?: string }) => p.id === item.id);
               return match ? mergeReviewFieldsFromSaved(item, match as Record<string, unknown>) : item;
            });
            setReviewData(merged);
         }
       } catch (err) {
         alert('올바른 백업 파일(.json)이 아닙니다.');
       }
       if (uploadReviewRef.current) uploadReviewRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const submitReview = async () => {
    if (!reviewingJobId) return;
    const normalizedItems = reviewData.map((item) => {
      if (item.type !== 'lyrics') return item;
      const lv = item.lyricVoice?.trim();
      return { ...item, lyricVoice: lv && lv.length > 0 ? lv : '1' };
    });
    try {
      const res = await fetch(`/api/review/${reviewingJobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: normalizedItems,
          transposeSemitones: scoreTransposeSemitones,
        }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          msg = await res.text();
        }
        alert(msg);
        return;
      }
      if (reviewOriginalFileName) {
         localStorage.removeItem('pdf2mxl_review_' + reviewOriginalFileName);
      }
      setReviewingJobId(null);
      setReviewData([]);
      setReviewOriginalFileName('');
      setHasSavedData(false);
      setScoreTransposeSemitones(0);
    } catch (e) {
      console.error(e);
      alert('리뷰 제출 실패');
    }
  };

  const submitContinueAudiveris = async () => {
    if (!audiverisReviewJobId) return;
    const fd = new FormData();
    fd.append('transposeSemitones', String(audiverisTranspose));
    const rep = audiverisReplaceRef.current?.files?.[0];
    if (rep) fd.append('mxl', rep);
    try {
      const r = await fetch(`/api/continue-audiveris/${audiverisReviewJobId}`, {
        method: 'POST',
        body: fd,
      });
      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try {
          const j = (await r.json()) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          msg = await r.text();
        }
        alert(msg);
        return;
      }
      setAudiverisReviewJobId(null);
      setAudiverisTranspose(0);
      if (audiverisReplaceRef.current) audiverisReplaceRef.current.value = '';
    } catch (e) {
      console.error(e);
      alert('Audiveris 이어하기 요청 실패');
    }
  };

  const handleReviewTypeChange = (index: number, type: string) => {
    const newData = [...reviewData];
    newData[index].type = type;
    if (type === 'lyrics') {
      if (newData[index].lyricPartIndex == null || newData[index].lyricPartIndex! < 1) {
        newData[index].lyricPartIndex = 1;
      }
      if (newData[index].lyricVoice == null || newData[index].lyricVoice === '') {
        newData[index].lyricVoice = '1';
      }
      if (newData[index].lyricSkipNotes == null || newData[index].lyricSkipNotes! < 0) {
        newData[index].lyricSkipNotes = 0;
      }
    }
    setReviewData(newData);
  };

  const handleReviewTextChange = (index: number, newText: string) => {
    const newData = [...reviewData];
    newData[index].text = newText;
    setReviewData(newData);
  };

  const handleLyricPartIndexChange = (index: number, v: number) => {
    const newData = [...reviewData];
    newData[index].lyricPartIndex = Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1;
    setReviewData(newData);
  };

  const handleLyricVoicePresetChange = (index: number, v: string) => {
    const newData = [...reviewData];
    if (v === '__custom__') {
      const cur = (newData[index].lyricVoice ?? '').trim();
      newData[index].lyricVoice = (LYRIC_VOICE_PRESETS as readonly string[]).includes(cur)
        ? '5'
        : cur || '5';
    } else {
      newData[index].lyricVoice = v;
    }
    setReviewData(newData);
  };

  const handleLyricVoiceCustomInputChange = (index: number, v: string) => {
    const newData = [...reviewData];
    newData[index].lyricVoice = v;
    setReviewData(newData);
  };

  const handleLyricSkipNotesChange = (index: number, v: number) => {
    const newData = [...reviewData];
    newData[index].lyricSkipNotes = Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
    setReviewData(newData);
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
              void runBatchWith(files, health, autoSave).catch((err: unknown) => {
                console.error(err);
                setBusy(false);
                setStatus(`오류: ${err instanceof Error ? err.message : String(err)}`);
              })
            }
          >
            변환 ({files.length}개)
          </button>
        </div>

        <div className="row" style={{ marginTop: '0.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-color, inherit)' }}>
            <input
              type="checkbox"
              checked={autoSave}
              onChange={(e) => setAutoSave(e.target.checked)}
              disabled={busy}
            />
            결과 저장하기
          </label>
          <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-color, inherit)' }}>
            <input
              type="checkbox"
              checked={pauseAfterAudiveris}
              onChange={(e) => setPauseAfterAudiveris(e.target.checked)}
              disabled={busy}
            />
            Audiveris 직후 멈춤 (MXL 다운로드·조옮김·교체 후 이어하기)
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

      {reviewingJobId && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
        }}>
          <div style={{
            background: 'var(--card-bg, #fff)',
            padding: '2rem',
            borderRadius: '8px',
            maxWidth: '900px',
            maxHeight: '80vh',
            overflowY: 'auto',
            width: '95%'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 0 }}>
               <h2 style={{ margin: 0 }}>문자 검토 및 매핑 (Audiveris 실행 전)</h2>
               <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {hasSavedData && (
                     <button onClick={handleLoadPrevious} style={{ padding: '0.5rem 1rem', background: '#f57c00', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                        이전 작업 불러오기
                     </button>
                  )}
                  <button onClick={handleDownloadReview} style={{ padding: '0.5rem 1rem', background: '#eee', color: '#333', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer' }}>
                     백업(.json) 저장
                  </button>
                  <label style={{ padding: '0.5rem 1rem', background: '#eee', color: '#333', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', display: 'inline-block' }}>
                     불러오기
                     <input type="file" ref={uploadReviewRef} accept=".json" style={{ display: 'none' }} onChange={handleUploadReview} />
                  </label>
               </div>
            </div>
            <p style={{ marginTop: '0.5rem' }}>인식된 글자가 제목인지, 가사인지 등 역할을 지정해주세요. 지정된 영역은 Audiveris에 넘어가기 전 하얗게 마스킹되는 항목(제목·작곡·가사·<strong>템포</strong> 등)과, 마스킹하지 않는 <strong>악보 기호</strong>를 구분해 주세요. 템포는 숫자만(예: 75) 또는 ♩= 75 형태로 편집하면 MusicXML에 <code>sound tempo</code>로 들어가 재생 속도에 반영되기 쉽습니다.</p>
            <div className="status" style={{ background: '#e3f2fd', color: '#0d47a1', border: '1px solid #bbdefb', padding: '1rem', borderRadius: '4px', marginTop: '1rem' }}>
              <strong>💡 가사 매핑 및 임시 저장 안내</strong><br/>
              가사를 선택하면 텍스트를 직접 편집할 수 있습니다. 쉼표나 연장선 등으로 인해 <strong>가사가 없는 음표를 건너뛰려면 하이픈( - )을 넣어주세요.</strong> (띄어쓰기는 무시됨)<br/>
              <strong>파트·성부:</strong> Audiveris가 만든 MusicXML에서 가사를 넣을 <strong>파트 순번</strong>(1=첫 파트, 4부 합창이면 보통 4)과, 같은 파트에 성부가 여러 개일 때의 <strong>voice 번호</strong>(보통 1)를 지정합니다. 피아노·2성부 한 파트처럼 voice가 여러 줄로 갈릴 때는 <strong>전체 순서 (*)</strong>를 쓰면 해당 파트의 음표를 문서 순서대로 맞출 수 있습니다. 가사가 중간부터 밀리면 해당 성부에서 <strong>앞쪽 몇 개 음표를 건너뛰기</strong>를 조정해 보세요.<br/>
              <em>모든 수정 사항은 브라우저에 임시 자동 저장됩니다. 변환 실패 시 파일을 다시 올려 '이전 작업 불러오기'를 누르면 복구됩니다.</em>
            </div>

            <div
              style={{
                marginTop: '1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                flexWrap: 'wrap',
                padding: '0.75rem',
                background: 'var(--bg-color, #fafafa)',
                borderRadius: '4px',
                fontSize: '0.9rem',
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                전역 조옮김(반음)
                <input
                  type="number"
                  min={-24}
                  max={24}
                  value={scoreTransposeSemitones}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    setScoreTransposeSemitones(
                      Number.isFinite(n) ? Math.max(-24, Math.min(24, n)) : 0,
                    );
                  }}
                  style={{ width: '4rem', padding: '0.35rem' }}
                />
              </label>
              <span style={{ color: '#666', maxWidth: '36rem', lineHeight: 1.4 }}>
                가사·메타 주입 시점에 Audiveris 곡 전체를 반음 단위로 올리거나 내립니다. 음높이가 키와 어긋날 때 OCR 제출과 함께 적용해 보세요.
              </span>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1.5rem' }}>
              {reviewData.map((item, i) => (
                <div key={item.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'var(--bg-color, #f5f5f5)', padding: '1rem', borderRadius: '4px', borderLeft: item.type==='lyrics'?'4px solid #1976d2':item.type==='tempo'?'4px solid #e65100':'4px solid #ccc' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <select 
                         value={item.type} 
                         onChange={(e) => handleReviewTypeChange(i, e.target.value)}
                         style={{ padding: '0.5rem', fontSize: '1rem', minWidth: '120px' }}
                      >
                         <option value="unknown">악보 기호 (마스킹 X)</option>
                         <option value="title">제목</option>
                         <option value="composer">작곡가</option>
                         <option value="lyricist">작사가</option>
                         <option value="copyright">저작권</option>
                         <option value="tempo">템포(BPM)</option>
                         <option value="lyrics">가사</option>
                      </select>
                      
                      <input 
                        type="text" 
                        value={item.text} 
                        onChange={(e) => handleReviewTextChange(i, e.target.value)}
                        style={{ padding: '0.5rem', fontSize: '1rem', flex: 1, fontFamily: 'monospace' }}
                      />
                  </div>
                  
                  {item.type === 'lyrics' && (
                    <>
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '12px',
                          alignItems: 'center',
                          marginTop: '0.5rem',
                          marginLeft: '136px',
                          padding: '0.5rem',
                          background: '#f5f5f5',
                          borderRadius: '4px',
                          fontSize: '0.9rem',
                        }}
                      >
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          파트 순번
                          <input
                            type="number"
                            min={1}
                            max={32}
                            value={item.lyricPartIndex ?? 1}
                            onChange={(e) =>
                              handleLyricPartIndexChange(i, parseInt(e.target.value, 10))
                            }
                            style={{ width: '4rem', padding: '0.35rem' }}
                          />
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          voice
                          <select
                            value={lyricVoicePresetKey(item.lyricVoice)}
                            onChange={(e) => handleLyricVoicePresetChange(i, e.target.value)}
                            style={{ padding: '0.35rem', minWidth: '9rem' }}
                          >
                            <option value="1">1</option>
                            <option value="2">2</option>
                            <option value="3">3</option>
                            <option value="4">4</option>
                            <option value="*">전체 순서 (*)</option>
                            <option value="__custom__">기타 (직접)</option>
                          </select>
                          {lyricVoicePresetKey(item.lyricVoice) === '__custom__' && (
                            <input
                              type="text"
                              inputMode="numeric"
                              title="MusicXML voice 번호"
                              value={item.lyricVoice ?? ''}
                              onChange={(e) => handleLyricVoiceCustomInputChange(i, e.target.value)}
                              style={{ width: '3rem', padding: '0.35rem' }}
                            />
                          )}
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          앞쪽 음표 생략
                          <input
                            type="number"
                            min={0}
                            max={999}
                            value={item.lyricSkipNotes ?? 0}
                            onChange={(e) =>
                              handleLyricSkipNotesChange(i, parseInt(e.target.value, 10))
                            }
                            style={{ width: '4rem', padding: '0.35rem' }}
                          />
                        </label>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '8px',
                          marginTop: '0.5rem',
                          marginLeft: '136px',
                          padding: '0.5rem',
                          background: '#e3f2fd',
                          borderRadius: '4px',
                        }}
                      >
                        {item.text.replace(/ /g, '').split('').map((char, slotIdx) => (
                          <div
                            key={slotIdx}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              minWidth: '24px',
                            }}
                          >
                            <span style={{ fontSize: '0.75rem', color: '#666' }}>{slotIdx + 1}</span>
                            <strong
                              style={{ fontSize: '1.1rem', color: char === '-' ? '#999' : '#000' }}
                            >
                              {char}
                            </strong>
                          </div>
                        ))}
                        {item.text.replace(/ /g, '').length === 0 && (
                          <span style={{ fontSize: '0.8rem', color: '#666' }}>
                            텍스트를 입력하면 음표 번호가 표시됩니다.
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={submitReview} style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', background: '#1976d2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Audiveris 실행 (악보 인식 시작)</button>
            </div>
          </div>
        </div>
      )}

      {audiverisReviewJobId && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
          }}
        >
          <div
            style={{
              background: 'var(--card-bg, #fff)',
              padding: '1.75rem',
              borderRadius: '8px',
              maxWidth: '520px',
              width: '92%',
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            }}
          >
            <h2 style={{ margin: '0 0 0.75rem' }}>Audiveris 결과 보정</h2>
            <p style={{ margin: '0 0 1rem', lineHeight: 1.5, color: '#444' }}>
              아래 MXL을 MuseScore 등에서 고친 뒤 다시 올리거나, 조옮김만 지정한 뒤 이어하기를 누르세요. 작업을 마치기 전까지 변환은 잠시 멈춰 있습니다.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <a
                href={`/api/raw-mxl/${audiverisReviewJobId}`}
                download
                style={{ color: '#1565c0', fontWeight: 600 }}
              >
                Audiveris 원본 MXL 다운로드
              </a>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                조옮김(반음, −24〜24)
                <input
                  type="number"
                  min={-24}
                  max={24}
                  value={audiverisTranspose}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    setAudiverisTranspose(Number.isFinite(n) ? Math.max(-24, Math.min(24, n)) : 0);
                  }}
                  style={{ width: '4rem', padding: '0.4rem' }}
                />
              </label>
              <div>
                <div style={{ marginBottom: '6px', fontSize: '0.9rem' }}>교체 MXL (선택)</div>
                <input
                  ref={audiverisReplaceRef}
                  type="file"
                  accept=".mxl,.xml,.musicxml,application/vnd.recordare.musicxml+xml,application/xml,text/xml"
                />
              </div>
              <button
                type="button"
                onClick={() => void submitContinueAudiveris()}
                style={{
                  marginTop: '0.5rem',
                  padding: '0.65rem 1.25rem',
                  fontSize: '1rem',
                  background: '#2e7d32',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                이어하기 (OCR·가사 주입)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

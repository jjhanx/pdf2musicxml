import { useCallback, useEffect, useRef, useState } from 'react';

/** PDF 페이지(pt, PyMuPDF·검토 JSON bbox와 동일: 원점 페이지 좌상, y 아래 증가) */
export type ManualLyricBBox = {
  page: number;
  bbox: [number, number, number, number];
};

type PdfDims = {
  pageCount: number;
  pages: Array<{ widthPt?: number; heightPt?: number }>;
};

/** 검토 미리보기와 동일 — server pdf-page-png 기본 dpi와 맞출 것 */
const PREVIEW_DPI_QUERY = '118';

function clamp01(v: number) {
  return Math.max(0, Math.min(v, 1));
}

function normalizePdfRect(
  a: readonly [number, number, number, number],
  wPt: number,
  hPt: number,
): [number, number, number, number] {
  let [x0, y0, x1, y1] = a;
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  x0 = Math.max(0, Math.min(x0, wPt));
  x1 = Math.max(0, Math.min(x1, wPt));
  y0 = Math.max(0, Math.min(y0, hPt));
  y1 = Math.max(0, Math.min(y1, hPt));
  const minSide = Math.min(Math.abs(x1 - x0), Math.abs(y1 - y0));
  if (minSide < 2) return [0, 0, 0, 0]; // 무시 신호
  return [x0, y0, x1, y1];
}

function clientDragToNatural(
  sx: number,
  sy: number,
  imgEl: HTMLImageElement,
): { nx: number; ny: number } {
  const r = imgEl.getBoundingClientRect();
  const rx = sx - r.left;
  const ry = sy - r.top;
  const fx = clamp01(rx / r.width);
  const fy = clamp01(ry / r.height);
  return {
    nx: fx * imgEl.naturalWidth,
    ny: fy * imgEl.naturalHeight,
  };
}

function naturalToPdf(
  nx: number,
  ny: number,
  imgEl: HTMLImageElement,
  wPt: number,
  hPt: number,
): { xPt: number; yPt: number } {
  return {
    xPt: clamp01(nx / imgEl.naturalWidth) * wPt,
    yPt: clamp01(ny / imgEl.naturalHeight) * hPt,
  };
}

type Props = {
  jobId: string;
  value: ManualLyricBBox[];
  onChange: (next: ManualLyricBBox[]) => void;
};

export function ManualLyricMaskPanel(props: Props) {
  const { jobId, value, onChange } = props;
  const imgRef = useRef<HTMLImageElement | null>(null);
  const latestRectsRef = useRef(value);
  const [dims, setDims] = useState<PdfDims | null>(null);
  const [page, setPage] = useState(1);
  const [imgErr, setImgErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  /** 드래그 중 (표시좌표 natural px) */
  const [dragStart, setDragStart] = useState<{ nx: number; ny: number } | null>(null);
  const [dragCur, setDragCur] = useState<{ nx: number; ny: number } | null>(null);
  const [imgNatural, setImgNatural] = useState<{ nw: number; nh: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/review/${jobId}/pdf-dimensions`);
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}`);
        }
        const j = (await r.json()) as PdfDims;
        if (cancelled) return;
        if (!j.pages?.length || !j.pageCount) {
          setDims(null);
          return;
        }
        setDims(j);
        setPage((p) => Math.min(Math.max(1, p), j.pageCount));
      } catch {
        if (!cancelled) setDims(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const wPt = dims?.pages[page - 1]?.widthPt ?? 0;
  const hPt = dims?.pages[page - 1]?.heightPt ?? 0;
  const pageCount = dims?.pageCount ?? 1;
  const imgSrc =
    dims && page >= 1 && page <= pageCount && wPt > 0 && hPt > 0
      ? `/api/review/${jobId}/pdf-page-png/${page}?dpi=${PREVIEW_DPI_QUERY}&cb=${reloadKey}`
      : null;

  const rectsOnPage = value.filter((r) => r.page === page);

  const finalizeDrag = useCallback(() => {
    const imgEl = imgRef.current;
    const base = latestRectsRef.current;
    if (
      !imgEl?.naturalWidth ||
      !dims ||
      !dragStart ||
      !dragCur ||
      !(wPt > 0) ||
      !(hPt > 0)
    ) {
      setDragStart(null);
      setDragCur(null);
      return;
    }

    const a = naturalToPdf(dragStart.nx, dragStart.ny, imgEl, wPt, hPt);
    const b = naturalToPdf(dragCur.nx, dragCur.ny, imgEl, wPt, hPt);
    const bx: [number, number, number, number] = [a.xPt, a.yPt, b.xPt, b.yPt];
    const norm = normalizePdfRect(bx, wPt, hPt);
    if (norm.every((z) => z === 0)) {
      setDragStart(null);
      setDragCur(null);
      return;
    }
    onChange([...base, { page, bbox: norm }]);
    setDragStart(null);
    setDragCur(null);
  }, [dims, dragCur, dragStart, hPt, onChange, page, wPt]);

  useEffect(() => {
    latestRectsRef.current = value;
  }, [value]);

  useEffect(() => {
    const fn = () => finalizeDrag();
    window.addEventListener('mouseup', fn);
    return () => window.removeEventListener('mouseup', fn);
  }, [finalizeDrag]);

  const overlayRects = rectsOnPage;

  const onMouseDownOverlay = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const imgEl = imgRef.current;
      if (!imgEl?.naturalWidth) return;
      e.preventDefault();
      const pt = clientDragToNatural(e.clientX, e.clientY, imgEl);
      setDragStart(pt);
      setDragCur(pt);
    },
    [],
  );

  const onMouseMoveOverlay = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!dragStart) return;
      const imgEl = imgRef.current;
      if (!imgEl?.naturalWidth) return;
      setDragCur(clientDragToNatural(e.clientX, e.clientY, imgEl));
    },
    [dragStart],
  );

  return (
    <div
      style={{
        padding: '1rem',
        background: '#fff8e1',
        border: '1px solid #ffca28',
        borderRadius: '6px',
      }}
    >
      <strong>수동 가사 지우기 (선택)</strong>
      <p style={{ margin: '0.5rem 0', fontSize: '0.9rem', color: '#5d4037' }}>
        PDF 위에서 마우스를 끌어 <strong>가사만 지울 영역</strong>을 표시합니다. 음표·오선에는 닿지 않게
        가능한 좁게 그려 주세요. 이 영역 안의 글립만 블랭크하며 자동 MUSIC 겹침 생략을 적용하지
        않습니다(영역 선택은 사용자 책임). 서버 재시작 후 미리보기가 어긋나면 같은 페이지 번호에서
        다시 그립니다.
      </p>

      {!dims ? (
        <div style={{ color: '#757575', fontSize: '0.9rem' }}>
          페이지 정보를 불러오는 중이거나 불러올 수 없습니다…
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem' }}>
            페이지
            <input
              type="number"
              min={1}
              max={pageCount}
              value={page}
              onChange={(e) => setPage(parseInt(e.target.value, 10) || 1)}
              style={{ width: '5rem', padding: '4px 6px' }}
            />
            {' / '}
            {pageCount}
          </label>
          <button
            type="button"
            onClick={() => onChange([])}
            style={{ padding: '4px 10px', fontSize: '0.85rem' }}
          >
            전체 영역 지우기
          </button>
          <button
            type="button"
            onClick={() => {
              const next = value.filter((r) => r.page !== page);
              onChange(next);
            }}
            style={{ padding: '4px 10px', fontSize: '0.85rem' }}
          >
            이 페이지 표시만 지우기
          </button>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            style={{ padding: '4px 10px', fontSize: '0.85rem' }}
          >
            미리보기 다시 받기
          </button>
        </div>
      )}

      {imgSrc ? (
        <div
          style={{
            marginTop: '12px',
            display: 'inline-block',
            maxWidth: '100%',
            position: 'relative',
            overflow: 'auto',
            maxHeight: '380px',
            border: '1px solid #ccc',
            cursor: 'crosshair',
            userSelect: 'none',
            touchAction: 'none',
          }}
        >
          <img
            ref={imgRef}
            src={imgSrc}
            alt={`PDF page ${page}`}
            onLoad={(e) => {
              setImgErr(null);
              const el = e.currentTarget;
              setImgNatural({ nw: el.naturalWidth, nh: el.naturalHeight });
            }}
            onError={() => setImgErr('미리보기 PNG를 불러오지 못했습니다')}
            style={{ width: '100%', height: 'auto', display: 'block', verticalAlign: 'middle' }}
            draggable={false}
          />
          {imgErr && (
            <div style={{ padding: '0.5rem', color: '#b71c1c', fontSize: '0.85rem' }}>{imgErr}</div>
          )}
          {/* 확인용 사각형 */}
          {imgNatural &&
            (overlayRects.length > 0 ||
              (dragStart && dragCur && wPt > 0 && hPt > 0)) && (
              <svg
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none',
                }}
                viewBox={`0 0 ${imgNatural.nw} ${imgNatural.nh}`}
                preserveAspectRatio="none"
              >
                {overlayRects.map((r, ri) => {
                  const nw = imgNatural.nw;
                  const nh = imgNatural.nh;
                  const xa = clamp01(r.bbox[0] / wPt) * nw;
                  const ya = clamp01(r.bbox[1] / hPt) * nh;
                  const xb = clamp01(r.bbox[2] / wPt) * nw;
                  const yb = clamp01(r.bbox[3] / hPt) * nh;
                  return (
                    <rect
                      key={`${page}-${ri}`}
                      x={Math.min(xa, xb)}
                      y={Math.min(ya, yb)}
                      width={Math.abs(xb - xa)}
                      height={Math.abs(yb - ya)}
                      fill="rgba(233,30,99,0.12)"
                      stroke="rgba(194,24,91,0.85)"
                      strokeWidth={Math.max(1, nw / 400)}
                    />
                  );
                })}
                {dragStart && dragCur && (
                  <rect
                    x={Math.min(dragStart.nx, dragCur.nx)}
                    y={Math.min(dragStart.ny, dragCur.ny)}
                    width={Math.abs(dragCur.nx - dragStart.nx)}
                    height={Math.abs(dragCur.ny - dragStart.ny)}
                    fill="rgba(255,152,0,0.08)"
                    stroke="rgba(255,143,0,0.9)"
                    strokeWidth={Math.max(1, imgNatural.nw / 420)}
                  />
                )}
              </svg>
            )}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              cursor: 'crosshair',
              touchAction: 'none',
              zIndex: 2,
            }}
            role="presentation"
            onMouseDown={onMouseDownOverlay}
            onMouseMove={onMouseMoveOverlay}
          />
        </div>
      ) : dims ? (
        <div style={{ marginTop: '8px', color: '#757575' }}>이 페이지를 불러오는 중…</div>
      ) : null}

      <p style={{ margin: '8px 0 0', fontSize: '0.82rem', color: '#795548' }}>
        저장된 표시 영역 전체{' '}
        <strong>{value.length}</strong>개 (모든 페이지)
      </p>
    </div>
  );
}

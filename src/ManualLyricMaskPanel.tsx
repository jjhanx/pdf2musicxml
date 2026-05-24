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

export type OcrReviewItemBBox = {
  id: string;
  page: number;
  bbox?: number[];
  spans?: { text: string; bbox: number[] }[];
  /** 기타 검토 줄 필드는 미리보기에서 사용 안 함 */
  type?: string;
};

/** 검토 미리보기와 동일 — server pdf-page-png 기본 dpi와 맞출 것 */
const PREVIEW_DPI_QUERY = '118';

function clamp01(v: number) {
  return Math.max(0, Math.min(v, 1));
}

function clampRectToPage(
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
  return [x0, y0, x1, y1];
}

function normalizePdfRectForManualMask(
  a: readonly [number, number, number, number],
  wPt: number,
  hPt: number,
): [number, number, number, number] {
  const [x0, y0, x1, y1] = clampRectToPage(a, wPt, hPt);
  const minSide = Math.min(Math.abs(x1 - x0), Math.abs(y1 - y0));
  if (minSide < 2) return [0, 0, 0, 0];
  return [x0, y0, x1, y1];
}

/** 검토 줄·수정용: 작은 크기 허용(가늘게 조여도 유지) */
function normalizeReviewItemBBox(
  a: readonly [number, number, number, number],
  wPt: number,
  hPt: number,
): [number, number, number, number] {
  const [x0, y0, x1, y1] = clampRectToPage(a, wPt, hPt);
  const minSide = Math.min(Math.abs(x1 - x0), Math.abs(y1 - y0));
  if (minSide < 0.5) return [0, 0, 0, 0];
  return [x0, y0, x1, y1];
}

/** spans 병합 → 없으면 item.bbox (PDF pt 가정). */
export function unionItemBBoxPdfPt(item: OcrReviewItemBBox): [number, number, number, number] | null {
  const spans = item.spans;
  if (Array.isArray(spans) && spans.length > 0) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const sp of spans) {
      const bb = sp?.bbox;
      if (!bb || bb.length < 4) continue;
      const nx0 = Number(bb[0]);
      const ny0 = Number(bb[1]);
      const nx1 = Number(bb[2]);
      const ny1 = Number(bb[3]);
      if (![nx0, ny0, nx1, ny1].every((x) => Number.isFinite(x))) continue;
      x0 = Math.min(x0, Math.min(nx0, nx1));
      y0 = Math.min(y0, Math.min(ny0, ny1));
      x1 = Math.max(x1, Math.max(nx0, nx1));
      y1 = Math.max(y1, Math.max(ny0, ny1));
    }
    if (x0 !== Infinity && y0 !== Infinity && x1 !== -Infinity && y1 !== -Infinity) {
      return [x0, y0, x1, y1];
    }
  }
  const b = item.bbox;
  if (Array.isArray(b) && b.length >= 4) {
    const nx0 = Number(b[0]);
    const ny0 = Number(b[1]);
    const nx1 = Number(b[2]);
    const ny1 = Number(b[3]);
    if ([nx0, ny0, nx1, ny1].every((x) => Number.isFinite(x))) {
      return [nx0, ny0, nx1, ny1];
    }
  }
  return null;
}

function clientDragToNatural(
  sx: number,
  sy: number,
  imgEl: HTMLImageElement,
): { nx: number; ny: number } {
  const r = imgEl.getBoundingClientRect();
  const rx = sx - r.left;
  const ry = sy - r.top;
  const fx = clamp01(rx / Math.max(r.width, 1e-6));
  const fy = clamp01(ry / Math.max(r.height, 1e-6));
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
    xPt: clamp01(nx / Math.max(imgEl.naturalWidth, 1)) * wPt,
    yPt: clamp01(ny / Math.max(imgEl.naturalHeight, 1)) * hPt,
  };
}

type CornerKey = 'nw' | 'ne' | 'sw' | 'se';

/** 미리보기 가로 기준 화면 px → PDF 가로폭 방향 여유(pt). */
function tolerancePdfAcrossWidthPx(imgEl: HTMLImageElement, wPt: number, px = 14): number {
  const rw = Math.max(imgEl.getBoundingClientRect().width, 1e-6);
  return Math.max(2.5, (px / rw) * wPt);
}

function resizeBboxCornerFrozen(
  freeze: readonly [number, number, number, number],
  corner: CornerKey,
  nx: number,
  ny: number,
  wPt: number,
  hPt: number,
): [number, number, number, number] {
  const [sx0, sy0, sx1, sy1] = freeze;
  let out: [number, number, number, number];
  switch (corner) {
    case 'nw':
      out = [nx, ny, sx1, sy1];
      break;
    case 'ne':
      out = [sx0, ny, nx, sy1];
      break;
    case 'sw':
      out = [nx, sy0, sx1, ny];
      break;
    case 'se':
      out = [sx0, sy0, nx, ny];
      break;
    default:
      out = [...freeze] as [number, number, number, number];
  }
  return clampRectToPage(out, wPt, hPt);
}

type Props = {
  jobId: string;
  /** 수동 “추가” 지우기 영역(검색과 별개) */
  value: ManualLyricBBox[];
  onChange: (next: ManualLyricBBox[]) => void;
  reviewItems?: OcrReviewItemBBox[];
  /** 아래 카드에서 선택한 검토 줄 index */
  focusedReviewIndex?: number | null;
  onFocusedReviewIndexChange?: (idx: number | null) => void;
  /** 줄 bbox를 바꿀 때 호출(span은 상위에서 제거해 거친 bbox 마스킹으로 전환) */
  onReviewItemBBoxChange?: (itemIndex: number, bbox: [number, number, number, number]) => void;
};

export function ManualLyricMaskPanel(props: Props) {
  const {
    jobId,
    value,
    onChange,
    reviewItems,
    focusedReviewIndex,
    onFocusedReviewIndexChange,
    onReviewItemBBoxChange,
  } = props;
  const imgRef = useRef<HTMLImageElement | null>(null);
  const latestRectsRef = useRef(value);
  const editedDraftRef = useRef<[number, number, number, number] | null>(null);
  /** bbox 편집 시 등록한 window 리스너 한 번에 제거 */
  const bboxPointerCleanupRef = useRef<(() => void) | null>(null);
  const interactionRef = useRef<
    | {
        kind: 'resize';
        corner: CornerKey;
        freezeBBox: [number, number, number, number];
      }
    | {
        kind: 'move';
        freezeBBox: [number, number, number, number];
        grabOriginPdf: { x: number; y: number };
      }
    | null
  >(null);

  /** 오버레이 커서(리렌더용) — ref만으로는 cursor 갱신이 안 됨 */
  const [overlayPointerKind, setOverlayPointerKind] = useState<
    'crosshair' | 'grab' | 'grabbing'
  >('crosshair');

  useEffect(() => {
    bboxPointerCleanupRef.current?.();
    bboxPointerCleanupRef.current = null;
    return () => {
      bboxPointerCleanupRef.current?.();
      bboxPointerCleanupRef.current = null;
    };
  }, []);

  const [dims, setDims] = useState<PdfDims | null>(null);
  const [page, setPage] = useState(1);
  const [imgErr, setImgErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [dragStart, setDragStart] = useState<{ nx: number; ny: number } | null>(null);
  const [dragCur, setDragCur] = useState<{ nx: number; ny: number } | null>(null);

  /** 화면에 맞춘 줄 bbox 수정 중 프리뷰(커밋 전) */
  const [editedBboxDraft, setEditedBboxDraft] = useState<[number, number, number, number] | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/review/${jobId}/pdf-dimensions`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
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

  /** 포커스된 줄과 페이지 맞춤 */
  useEffect(() => {
    const idx = focusedReviewIndex;
    if (idx == null || idx < 0 || !reviewItems?.[idx]) return;
    const p = reviewItems[idx].page;
    if (Number.isFinite(p) && p >= 1) setPage(Math.min(Math.max(1, Math.floor(p)), pageCount || 9999));
  }, [focusedReviewIndex, reviewItems, pageCount]);

  const focusedItem =
    focusedReviewIndex != null && reviewItems?.[focusedReviewIndex]
      ? reviewItems[focusedReviewIndex]
      : null;

  useEffect(() => {
    editedDraftRef.current = editedBboxDraft;
  }, [editedBboxDraft]);

  useEffect(() => {
    setEditedBboxDraft(null);
  }, [focusedReviewIndex]);

  const rectsOnPage = value.filter((r) => r.page === page);

  const finalizeManualDrag = useCallback(() => {
    if (interactionRef.current) {
      return;
    }

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
      setOverlayPointerKind('crosshair');
      return;
    }

    const a = naturalToPdf(dragStart.nx, dragStart.ny, imgEl, wPt, hPt);
    const b = naturalToPdf(dragCur.nx, dragCur.ny, imgEl, wPt, hPt);
    const bx: [number, number, number, number] = [a.xPt, a.yPt, b.xPt, b.yPt];
    const norm = normalizePdfRectForManualMask(bx, wPt, hPt);
    if (norm.every((z) => z === 0)) {
      setDragStart(null);
      setDragCur(null);
      setOverlayPointerKind('crosshair');
      return;
    }
    onChange([...base, { page, bbox: norm }]);
    setDragStart(null);
    setDragCur(null);
    setOverlayPointerKind('crosshair');
  }, [dims, dragCur, dragStart, hPt, onChange, page, wPt]);

  useEffect(() => {
    latestRectsRef.current = value;
  }, [value]);

  useEffect(() => {
    const fn = () => finalizeManualDrag();
    window.addEventListener('mouseup', fn);
    return () => window.removeEventListener('mouseup', fn);
  }, [finalizeManualDrag]);

  const commitEditedBbox = useCallback(
    (
      bbox: [number, number, number, number],
      idx: number,
    ): [number, number, number, number] | null => {
      const n = normalizeReviewItemBBox(bbox, wPt, hPt);
      if (n.every((z) => z === 0)) return null;
      onReviewItemBBoxChange?.(idx, n);
      setEditedBboxDraft(null);
      return n;
    },
    [hPt, onReviewItemBBoxChange, wPt],
  );

  const pickCornerNear = (
    xPt: number,
    yPt: number,
    bb: readonly [number, number, number, number],
  ): CornerKey | null => {
    const imgEl = imgRef.current;
    if (!imgEl?.naturalWidth || wPt <= 0) return null;
    const tol = tolerancePdfAcrossWidthPx(imgEl, wPt);
    const [bx0, by0, bx1, by1] = bb;
    const corners: Record<CornerKey, [number, number]> = {
      nw: [bx0, by0],
      ne: [bx1, by0],
      sw: [bx0, by1],
      se: [bx1, by1],
    };
    let best: { k: CornerKey; d: number } | null = null;
    (Object.keys(corners) as CornerKey[]).forEach((k) => {
      const [cx, cy] = corners[k];
      const d = Math.hypot(xPt - cx, yPt - cy);
      if (d <= tol && (!best || d < best.d)) best = { k, d };
    });
    return best?.k ?? null;
  };

  const insideRectTol = (
    xPt: number,
    yPt: number,
    bb: readonly [number, number, number, number],
  ): boolean => {
    const imgEl = imgRef.current;
    if (!imgEl?.naturalWidth || wPt <= 0) return false;
    const tol = tolerancePdfAcrossWidthPx(imgEl, wPt) * 0.35;
    const [bx0, by0, bx1, by1] = bb;
    const xMin = Math.min(bx0, bx1);
    const xMax = Math.max(bx0, bx1);
    const yMin = Math.min(by0, by1);
    const yMax = Math.max(by0, by1);
    return (
      xPt >= xMin - tol &&
      xPt <= xMax + tol &&
      yPt >= yMin - tol &&
      yPt <= yMax + tol &&
      !pickCornerNear(xPt, yPt, bb)
    );
  };

  const onOverlayMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const imgEl = imgRef.current;
      if (!imgEl?.naturalWidth || !(wPt > 0) || !(hPt > 0)) return;
      e.preventDefault();

      const { nx, ny } = clientDragToNatural(e.clientX, e.clientY, imgEl);
      const pdf = naturalToPdf(nx, ny, imgEl, wPt, hPt);

      const idx = focusedReviewIndex;
      const bbNow:
        | [number, number, number, number]
        | null =
        idx != null && focusedItem?.page === page
          ? (editedBboxDraft ?? unionItemBBoxPdfPt(focusedItem))
          : null;

      if (idx != null && bbNow && onReviewItemBBoxChange) {
        const corner = pickCornerNear(pdf.xPt, pdf.yPt, bbNow);
        if (corner) {
          if (!editedBboxDraft && bbNow) {
            const init = [...bbNow] as [number, number, number, number];
            setEditedBboxDraft(init);
            editedDraftRef.current = init;
          }
          interactionRef.current = {
            kind: 'resize',
            corner,
            freezeBBox: [...bbNow] as [number, number, number, number],
          };

          const mv = (ev: MouseEvent) => {
            const el = imgRef.current;
            const cur = interactionRef.current;
            if (!el?.naturalWidth || !cur || !(wPt > 0) || !(hPt > 0)) return;
            const nt = clientDragToNatural(ev.clientX, ev.clientY, el);
            const { xPt, yPt } = naturalToPdf(nt.nx, nt.ny, el, wPt, hPt);
            if (cur.kind === 'resize') {
              const nb = resizeBboxCornerFrozen(cur.freezeBBox, cur.corner, xPt, yPt, wPt, hPt);
              editedDraftRef.current = nb;
              setEditedBboxDraft(nb);
            }
          };

          function detachResize() {
            window.removeEventListener('mousemove', mv as unknown as EventListener);
            window.removeEventListener('mouseup', upResize as unknown as EventListener);
          }

          function upResize() {
            detachResize();
            bboxPointerCleanupRef.current = null;
            interactionRef.current = null;
            setOverlayPointerKind('crosshair');

            const draftNow = editedDraftRef.current;
            if (draftNow && onReviewItemBBoxChange && idx != null) {
              commitEditedBbox(draftNow, idx);
            }
          }

          bboxPointerCleanupRef.current?.();
          bboxPointerCleanupRef.current = detachResize;
          window.addEventListener('mousemove', mv as unknown as EventListener);
          window.addEventListener('mouseup', upResize as unknown as EventListener);

          setOverlayPointerKind('grabbing');
          return;
        }
        if (insideRectTol(pdf.xPt, pdf.yPt, bbNow)) {
          if (!editedBboxDraft && bbNow) {
            const init = [...bbNow] as [number, number, number, number];
            setEditedBboxDraft(init);
            editedDraftRef.current = init;
          }
          interactionRef.current = {
            kind: 'move',
            freezeBBox: [...bbNow] as [number, number, number, number],
            grabOriginPdf: { x: pdf.xPt, y: pdf.yPt },
          };

          const mvMove = (ev: MouseEvent) => {
            const el = imgRef.current;
            const cur = interactionRef.current;
            if (!el?.naturalWidth || !cur || !(wPt > 0) || !(hPt > 0)) return;
            const nt = clientDragToNatural(ev.clientX, ev.clientY, el);
            const { xPt, yPt } = naturalToPdf(nt.nx, nt.ny, el, wPt, hPt);
            if (cur.kind === 'move') {
              const dx = xPt - cur.grabOriginPdf.x;
              const dy = yPt - cur.grabOriginPdf.y;
              const [fx0, fy0, fx1, fy1] = cur.freezeBBox;
              const nb = clampRectToPage([fx0 + dx, fy0 + dy, fx1 + dx, fy1 + dy], wPt, hPt);
              editedDraftRef.current = nb;
              setEditedBboxDraft(nb);
            }
          };

          function detachMove() {
            window.removeEventListener('mousemove', mvMove as unknown as EventListener);
            window.removeEventListener('mouseup', upMove as unknown as EventListener);
          }

          function upMove() {
            detachMove();
            bboxPointerCleanupRef.current = null;
            interactionRef.current = null;
            setOverlayPointerKind('crosshair');

            const draftNow = editedDraftRef.current;
            if (draftNow && onReviewItemBBoxChange && idx != null) {
              commitEditedBbox(draftNow, idx);
            }
          }

          bboxPointerCleanupRef.current?.();
          bboxPointerCleanupRef.current = detachMove;
          window.addEventListener('mousemove', mvMove as unknown as EventListener);
          window.addEventListener('mouseup', upMove as unknown as EventListener);

          setOverlayPointerKind('grab');
          return;
        }
      }

      bboxPointerCleanupRef.current?.();
      bboxPointerCleanupRef.current = null;
      interactionRef.current = null;

      setDragStart(clientDragToNatural(e.clientX, e.clientY, imgEl));
      setDragCur(clientDragToNatural(e.clientX, e.clientY, imgEl));
      setOverlayPointerKind('grabbing');
    },
    [
      commitEditedBbox,
      editedBboxDraft,
      focusedItem,
      focusedReviewIndex,
      hPt,
      onReviewItemBBoxChange,
      page,
      wPt,
    ],
  );

  const onOverlayMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const imgEl = imgRef.current;
      if (!imgEl?.naturalWidth) return;

      /* bbox 편집 중이면 페이지 오버레이는 window에서 처리 */
      if (interactionRef.current) return;

      if (!dragStart) return;
      setDragCur(clientDragToNatural(e.clientX, e.clientY, imgEl));
    },
    [dragStart],
  );

  const displayFocusedBbox =
    focusedItem?.page === page
      ? (editedBboxDraft ?? unionItemBBoxPdfPt(focusedItem))
      : null;

  const naturalForOverlay = (): { nw: number; nh: number } | null => {
    const imgEl = imgRef.current;
    if (imgEl?.naturalWidth && imgEl.naturalHeight) {
      return { nw: imgEl.naturalWidth, nh: imgEl.naturalHeight };
    }
    return null;
  };

  const nat = naturalForOverlay();
  const showOverlay = !!(nat && dims && wPt > 0 && hPt > 0);

  /** bbox(pt) → viewBox(px) 숫자 */
  const bxToNx = useCallback(
    (bx: readonly [number, number, number, number]) => {
      if (!nat || !showOverlay) return null;
      const nw = nat.nw;
      const nh = nat.nh;
      const xa = clamp01(bx[0] / wPt) * nw;
      const ya = clamp01(bx[1] / hPt) * nh;
      const xb = clamp01(bx[2] / wPt) * nw;
      const yb = clamp01(bx[3] / hPt) * nh;
      return { xa, ya, xb, yb };
    },
    [hPt, nat, showOverlay, wPt],
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
      <strong>미리보기 · 수동 영역 표시 및 검토 줄 BBox 편집</strong>
      <p style={{ margin: '0.5rem 0', fontSize: '0.9rem', color: '#5d4037' }}>
        아래 카드에서 <strong>줄 카드 또는 「미리보기로」</strong>를 눌러 줄을 선택하면 해당{' '}
        <strong>OCR bbox</strong>가 <strong>청록색 점선</strong>으로 겹치고 네 귀퉁이 작은 원이
        보입니다.
        모서리·변 근처를 잡아 <strong>꼭지점 드래그</strong>로 크기를 바꿀 수 있고, 안쪽에서는{' '}
        <strong>이동</strong>(박스 안 드래그)도 됩니다. 줄 bbox를 손보는 경우         세부 스팬(span)은 버리고
        줄 전체 영역 마스킹으로 전환합니다. 빈 바탕에 드래그하면{' '}
        <strong>MUSIC SAFE 없음</strong>인 수동 추가 지우기(진한 분홍)가 됩니다. 음표·오선에
        과하게 닿으면 문자가 깎일 수 있습니다.
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
            추가 수동 영역 전부 지우기
          </button>
          <button
            type="button"
            onClick={() => {
              const next = value.filter((r) => r.page !== page);
              onChange(next);
            }}
            style={{ padding: '4px 10px', fontSize: '0.85rem' }}
          >
            현재 페이지 수동 표시만 지우기
          </button>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            style={{ padding: '4px 10px', fontSize: '0.85rem' }}
          >
            미리보기 다시 받기
          </button>
          {focusedReviewIndex != null &&
            focusedItem &&
            onFocusedReviewIndexChange &&
            reviewItems?.[focusedReviewIndex] && (
              <button
                type="button"
                onClick={() => onFocusedReviewIndexChange(null)}
                style={{ padding: '4px 10px', fontSize: '0.85rem' }}
              >
                줄 선택 해제
              </button>
            )}
        </div>
      )}

      {focusedItem && focusedReviewIndex != null && displayFocusedBbox == null ? (
        <p style={{ fontSize: '0.85rem', color: '#c62828', marginTop: '8px' }}>
          선택한 줄에 bbox 정보가 없어 미리보기에 표시할 수 없습니다. 수동 추가 영역만 그릴 수
          있습니다.
        </p>
      ) : null}

      {imgSrc ? (
        <div
          style={{
            marginTop: '12px',
            position: 'relative',
            display: 'inline-block',
            maxWidth: '100%',
            lineHeight: 0,
            overflow: 'auto',
            maxHeight: '420px',
            border: '1px solid #ccc',
            verticalAlign: 'top',
          }}
        >
          <img
            ref={imgRef}
            key={`${jobId}-${page}-${reloadKey}`}
            src={imgSrc}
            alt={`PDF page ${page}`}
            onLoad={() => setImgErr(null)}
            onError={() => setImgErr('미리보기 PNG를 불러오지 못했습니다')}
            style={{ width: '100%', height: 'auto', display: 'block', maxWidth: '100%' }}
            draggable={false}
          />
          {imgErr ? (
            <div style={{ padding: '0.5rem', color: '#b71c1c', fontSize: '0.85rem' }}>{imgErr}</div>
          ) : null}

          {/* 이미지와 동일 크기 레이어(퍼센트 기준 블록) */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              zIndex: 1,
              overflow: 'hidden',
              borderRadius: 0,
            }}
          >
            {showOverlay &&
              nat &&
              (rectsOnPage.length > 0 || dragStart || dragCur || displayFocusedBbox) && (
              <svg
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'block',
                }}
                viewBox={`0 0 ${nat.nw} ${nat.nh}`}
                preserveAspectRatio="none"
              >
                {rectsOnPage.map((r, ri) => {
                  const c = bxToNx(r.bbox);
                  if (!c) return null;
                  const { xa, ya, xb, yb } = c;
                  return (
                    <rect
                      key={`m-${page}-${ri}`}
                      x={Math.min(xa, xb)}
                      y={Math.min(ya, yb)}
                      width={Math.abs(xb - xa)}
                      height={Math.abs(yb - ya)}
                      fill="rgba(233,30,99,0.14)"
                      stroke="rgba(194,24,91,0.95)"
                      strokeWidth={Math.max(2.5, nat.nw / 320)}
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}
                {displayFocusedBbox ? (
                  <>
                    {(() => {
                      const c = bxToNx(displayFocusedBbox);
                      if (!c) return null;
                      const { xa, ya, xb, yb } = c;
                      const x0 = Math.min(xa, xb);
                      const x1 = Math.max(xa, xb);
                      const y0 = Math.min(ya, yb);
                      const y1 = Math.max(ya, yb);
                      const rk = Math.max(4, nat.nw / 110);
                      const corners: [number, number][] = [
                        [x0, y0],
                        [x1, y0],
                        [x0, y1],
                        [x1, y1],
                      ];
                      return (
                        <>
                          <rect
                            x={x0}
                            y={y0}
                            width={x1 - x0}
                            height={y1 - y0}
                            fill="rgba(0,172,193,0.06)"
                            stroke="rgba(0,131,143,0.95)"
                            strokeDasharray={`${nat.nw / 56} ${nat.nw / 80}`}
                            strokeWidth={Math.max(3, nat.nw / 300)}
                            vectorEffect="non-scaling-stroke"
                          />
                          {focusedReviewIndex != null &&
                            corners.map((pt, hci) => (
                              <circle
                                key={`h-${focusedReviewIndex}-${hci}`}
                                cx={pt[0]}
                                cy={pt[1]}
                                r={rk}
                                fill="rgba(0,77,64,0.92)"
                                stroke="rgba(255,255,255,0.9)"
                                strokeWidth={rk / 5}
                              />
                            ))}
                        </>
                      );
                    })()}
                  </>
                ) : null}
                {dragStart && dragCur && nat ? (
                  <rect
                    x={Math.min(dragStart.nx, dragCur.nx)}
                    y={Math.min(dragStart.ny, dragCur.ny)}
                    width={Math.abs(dragCur.nx - dragStart.nx)}
                    height={Math.abs(dragCur.ny - dragStart.ny)}
                    fill="rgba(255,152,0,0.1)"
                    stroke="rgba(230,126,34,1)"
                    strokeWidth={Math.max(2.5, nat.nw / 340)}
                  />
                ) : null}
              </svg>
            )}
          </div>

          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: '100%',
              height: '100%',
              cursor: overlayPointerKind,
              touchAction: 'none',
              zIndex: 2,
            }}
            role="presentation"
            onMouseDown={onOverlayMouseDown}
            onMouseMove={onOverlayMouseMove}
          />
        </div>
      ) : dims ? (
        <div style={{ marginTop: '8px', color: '#757575' }}>이 페이지를 불러오는 중…</div>
      ) : null}

      <p style={{ margin: '8px 0 0', fontSize: '0.82rem', color: '#795548' }}>
        수동 추가 지우기 표시 영역 전체 <strong>{value.length}</strong>개 (모든 페이지)
      </p>
    </div>
  );
}

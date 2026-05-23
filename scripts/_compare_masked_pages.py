"""
Compare original vs masked PDF: lyric-like text remnants + raster diff.

  python scripts/_compare_masked_pages.py original.pdf masked.pdf
"""

from __future__ import annotations

import os
import sys
import unicodedata

# repo root on path for mask_pdf helpers
_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SCRIPTS = os.path.join(_REPO, "scripts")
# `mask_pdf.py`는 scripts 아래 있음. `python scripts/…`로 실행할 때는 이미 PATH에 포함되지만 cwd만 넣으면 실패함.
for p in (_SCRIPTS, _REPO):
    if p not in sys.path:
        sys.path.insert(0, p)

import fitz  # noqa: E402

try:
    import numpy as np
except ImportError:
    np = None  # type: ignore


def char_lyric_overlay_like(ch: str) -> bool:
    from mask_pdf import HYPHENS, _char_is_music_glyph, _char_strip_as_lyric_overlay

    if len(ch) != 1:
        return False
    if _char_is_music_glyph(ord(ch)):
        return False
    if ch in HYPHENS:
        return True
    return _char_strip_as_lyric_overlay(ch)


def korean_overlay(cp: int) -> bool:
    from mask_pdf import _is_korean_overlay_glyph

    return _is_korean_overlay_glyph(cp)


def analyze_text(page: fitz.Page) -> list[tuple[str, fitz.Rect, str]]:
    """(char, bbox, font) for lyric-like overlay chars still on page."""
    out: list[tuple[str, fitz.Rect, str]] = []
    td = page.get_text("rawdict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
    for block in td.get("blocks") or []:
        if block.get("type") != 0:
            continue
        for line in block.get("lines") or []:
            for sp in line.get("spans") or []:
                fsize = sp.get("size")
                sfont = sp.get("font") or ""
                chars = sp.get("chars") or []
                if chars:
                    for ch in chars:
                        s = ch.get("c") or ""
                        bb = ch.get("bbox")
                        if not bb or len(s) != 1:
                            continue
                        if not char_lyric_overlay_like(s):
                            continue
                        r = fitz.Rect(bb).normalize()
                        if r.is_empty:
                            continue
                        out.append((s, r, f"{sfont}@{fsize}"))
                else:
                    txt = sp.get("text") or ""
                    bb = sp.get("bbox")
                    if not bb or not txt.strip():
                        continue
                    sx0, sy0, sx1, sy1 = bb
                    dw = max((sx1 - sx0) / len(txt), 0.001)
                    for i, cu in enumerate(txt):
                        if not char_lyric_overlay_like(cu):
                            continue
                        cr = fitz.Rect(sx0 + i * dw, sy0, sx0 + (i + 1) * dw, sy1).normalize()
                        if cr.is_empty:
                            continue
                        out.append((cu, cr, f"{sfont}@{fsize}"))
    return out


def _sum_contents_bytes(page: fitz.Page) -> int:
    xl = page.get_contents()
    if xl is None:
        return 0
    xs = xl if isinstance(xl, list) else [xl]
    total = 0
    doc = page.parent
    for x in xs:
        if x is None or x == 0:
            continue
        try:
            total += len(doc.extract_stream(x))
        except Exception:
            continue
    return total


def raster_stats(page_o: fitz.Page, page_m: fitz.Page, zoom: float = 2.0) -> tuple[int, float, float, int, int]:
    """diff_nonzero, mean_abs_gray, pct_changed, width, height."""
    mat = fitz.Matrix(zoom, zoom)
    pa = page_o.get_pixmap(matrix=mat, alpha=False)
    pb = page_m.get_pixmap(matrix=mat, alpha=False)
    w = max(pa.width, pb.width)
    h = max(pa.height, pb.height)
    nchan = pa.n

    def as_buf(px: fitz.Pixmap, w: int, h: int) -> bytes:
        if px.width == w and px.height == h:
            return bytes(px.samples)
        row_in = px.width * px.n
        row_out = w * px.n
        buf = bytearray(w * h * px.n)
        for y in range(min(px.height, h)):
            buf[y * row_out : y * row_out + min(row_out, row_in)] = px.samples[
                y * row_in : y * row_in + min(row_out, row_in)
            ]
        return bytes(buf)

    sa = as_buf(pa, w, h)
    sb = as_buf(pb, w, h)

    if np is not None:
        arr_a = np.frombuffer(sa, dtype=np.uint8).reshape(h, w, nchan)[..., :3].astype(np.int16)
        arr_b = np.frombuffer(sb, dtype=np.uint8).reshape(h, w, nchan)[..., :3].astype(np.int16)
        d = np.abs(arr_a - arr_b).mean(axis=-1)
        nz = int((d > 12).sum())
        mn = float(d.mean())
        pct = 100.0 * nz / (w * h)
        return nz, mn, pct, w, h

    nz = 0
    for yi in range(h):
        for xi in range(w):
            o = yi * w * nchan + xi * nchan
            mx = 0
            for k in range(min(3, nchan)):
                mx = max(mx, abs(sa[o + k] - sb[o + k]))
            if mx > 12:
                nz += 1
    return nz, 0.0, 100.0 * nz / max(w * h, 1), w, h


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__.strip(), file=sys.stderr)
        return 1
    path_o, path_m = sys.argv[1], sys.argv[2]
    d_o = fitz.open(path_o)
    d_m = fitz.open(path_m)
    n = min(len(d_o), len(d_m))
    if len(d_o) != len(d_m):
        print(
            f"warn: page count differs orig={len(d_o)} masked={len(d_m)} — comparing first {n}",
            file=sys.stderr,
        )

    print("=== Lyric-like text still on masked PDF (mask_pdf._char_strip_as_lyric_overlay 기준) ===")
    total_g = 0
    for i in range(n):
        items = analyze_text(d_m[i])
        if not items:
            continue
        total_g += len(items)
        ko = sum(1 for c, _, _ in items if korean_overlay(ord(c)))
        print(f"Page {i+1}: {len(items)} glyph(s) [한글 블록 U+AC00·자모 등: {ko}]")
        for c, r, fn in items[:50]:
            cat = unicodedata.category(c)
            u = f"U+{ord(c):04X}"
            print(f"  {repr(c)} {u} {cat} bbox=({r.x0:.1f},{r.y0:.1f},{r.x1:.1f},{r.y1:.1f}) {fn}")
        if len(items) > 50:
            print(f"  ... +{len(items)-50} more")
    if total_g == 0:
        print("(없음 — 복사 가능한 가사류 텍스트 레이어 없음)")

    print("\n=== Raster diff (원본 vs 마스킹, zoom=2, RGB 평균차>12 픽셀 수) ===")
    print("Page | diff_px | mean_d | pct   | orig_cont_b | mask_cont_b")
    for i in range(n):
        nz, mn, pct, _, _ = raster_stats(d_o[i], d_m[i], zoom=2.0)
        lo, lm = _sum_contents_bytes(d_o[i]), _sum_contents_bytes(d_m[i])
        print(f" {i+1:3d} | {nz:7d} | {mn:6.2f} | {pct:5.1f}% | {lo:12d} | {lm:11d}")

    d_o.close()
    d_m.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

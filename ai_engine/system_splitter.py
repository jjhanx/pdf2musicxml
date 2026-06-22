"""악보 페이지 → 시스템(오선 묶음) 영역 — 수평 잉크 투영."""
from __future__ import annotations

from dataclasses import dataclass

from ai_engine.image_loader import PageImage


@dataclass
class SystemImage:
    page_index: int
    system_index: int
    width: int
    height: int
    rgb_bytes: bytes
    dpi: int
    y_offset: int = 0


def _row_ink(rgb: bytes, width: int, y: int, threshold: int = 200) -> int:
    row_bytes = width * 3
    start = y * row_bytes
    end = start + row_bytes
    total = 0
    for i in range(start, end, 3):
        if rgb[i] < threshold or rgb[i + 1] < threshold or rgb[i + 2] < threshold:
            total += 1
    return total


def _crop_page_band(page: PageImage, y0: int, y1: int) -> SystemImage:
    w = page.width
    row_bytes = w * 3
    chunk = bytearray()
    for row in range(y0, y1):
        start = row * row_bytes
        chunk.extend(page.rgb_bytes[start : start + row_bytes])
    return SystemImage(
        page_index=page.page_index,
        system_index=0,
        width=w,
        height=y1 - y0,
        rgb_bytes=bytes(chunk),
        dpi=page.dpi,
        y_offset=y0,
    )


def detect_system_bands(page: PageImage, min_gap: int = 12, min_system_h: int = 40) -> list[tuple[int, int]]:
    """페이지에서 시스템(마디 줄) y 구간 탐지."""
    h = page.height
    w = page.width
    if h < min_system_h:
        return [(0, h)]

    ink = [_row_ink(page.rgb_bytes, w, y) for y in range(h)]
    max_ink = max(ink) if ink else 0
    if max_ink == 0:
        return [(0, h)]

    thresh = max(3, int(max_ink * 0.06))
    in_ink = [v >= thresh for v in ink]

    bands: list[tuple[int, int]] = []
    y = 0
    while y < h:
        while y < h and not in_ink[y]:
            y += 1
        if y >= h:
            break
        y0 = y
        while y < h and in_ink[y]:
            y += 1
        if y - y0 >= min_system_h // 3:
            bands.append((y0, y))

    if not bands:
        return [(0, h)]

    # ink 밴드를 gap으로 병합해 system 단위로
    systems: list[tuple[int, int]] = []
    cur_y0, cur_y1 = bands[0]
    for y0, y1 in bands[1:]:
        if y0 - cur_y1 <= min_gap:
            cur_y1 = y1
        else:
            if cur_y1 - cur_y0 >= min_system_h:
                systems.append((cur_y0, cur_y1))
            cur_y0, cur_y1 = y0, y1
    if cur_y1 - cur_y0 >= min_system_h // 2:
        systems.append((cur_y0, cur_y1))

    return systems if systems else [(0, h)]


def split_page_into_systems(
    page: PageImage,
    *,
    mode: str = "auto",
    fixed_count: int = 1,
) -> list[SystemImage]:
    """mode: auto(투영) | single(전체) | fixed(N등분)."""
    mode = (mode or "auto").strip().lower()
    if mode == "single" or fixed_count <= 1:
        return [
            SystemImage(
                page_index=page.page_index,
                system_index=0,
                width=page.width,
                height=page.height,
                rgb_bytes=page.rgb_bytes,
                dpi=page.dpi,
            )
        ]

    if mode == "fixed" and fixed_count > 1:
        band_h = max(1, page.height // fixed_count)
        systems: list[SystemImage] = []
        for si in range(fixed_count):
            y0 = si * band_h
            y1 = page.height if si == fixed_count - 1 else (si + 1) * band_h
            sys = _crop_page_band(page, y0, y1)
            sys.system_index = si
            systems.append(sys)
        return systems

    # auto
    bands = detect_system_bands(page)
    systems: list[SystemImage] = []
    for si, (y0, y1) in enumerate(bands):
        sys = _crop_page_band(page, y0, y1)
        sys.system_index = si
        systems.append(sys)
    return systems

"""시스템(오선 묶음) → staff별 크롭 — SATB+피아노 6 staff."""
from __future__ import annotations

from dataclasses import dataclass

from ai_engine.system_splitter import SystemImage


@dataclass
class StaffImage:
    page_index: int
    system_index: int
    staff_index: int
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
        r, g, b = rgb[i], rgb[i + 1], rgb[i + 2]
        if r < threshold or g < threshold or b < threshold:
            total += 1
    return total


def _find_staff_bands(
    rgb: bytes, width: int, height: int, expected: int, min_band: int = 8
) -> list[tuple[int, int]]:
    """수평 잉크 투영으로 staff 밴드 y0,y1 목록."""
    if height < min_band * 2:
        return [(0, height)]

    ink = [_row_ink(rgb, width, y) for y in range(height)]
    max_ink = max(ink) if ink else 0
    if max_ink == 0:
        band = max(min_band, height // max(1, expected))
        return [(i * band, min(height, (i + 1) * band)) for i in range(expected)]

    thresh = max(2, int(max_ink * 0.08))
    in_band = [v >= thresh for v in ink]

    bands: list[tuple[int, int]] = []
    y = 0
    while y < height:
        while y < height and not in_band[y]:
            y += 1
        if y >= height:
            break
        y0 = y
        while y < height and in_band[y]:
            y += 1
        if y - y0 >= min_band:
            bands.append((y0, y))

    if not bands:
        band = max(min_band, height // max(1, expected))
        return [(i * band, min(height, (i + 1) * band)) for i in range(expected)]

    # 너무 많으면 인접 병합 → expected 근처
    while len(bands) > expected + 2:
        # 가장 좁은 gap 병합
        best_i = 0
        best_gap = height
        for i in range(len(bands) - 1):
            gap = bands[i + 1][0] - bands[i][1]
            if gap < best_gap:
                best_gap = gap
                best_i = i
        y0, y1 = bands[best_i][0], bands[best_i + 1][1]
        bands = bands[:best_i] + [(y0, y1)] + bands[best_i + 2 :]

    if len(bands) < expected:
        # 균등 분할 폴백
        band = max(min_band, height // expected)
        return [(i * band, min(height, (i + 1) * band)) for i in range(expected)]

    # expected 개에 맞게 앞에서부터 선택(합창+피아노는 위→아래)
    if len(bands) > expected:
        step = len(bands) / expected
        picked: list[tuple[int, int]] = []
        for i in range(expected):
            idx = min(len(bands) - 1, int(i * step))
            picked.append(bands[idx])
        bands = picked

    return bands[:expected]


def split_system_into_staves(
    system: SystemImage,
    staves_per_system: int = 6,
    margin_px: int = 2,
) -> list[StaffImage]:
    """SystemImage → staff별 StaffImage."""
    bands = _find_staff_bands(
        system.rgb_bytes, system.width, system.height, expected=staves_per_system
    )
    row_bytes = system.width * 3
    out: list[StaffImage] = []
    for si, (y0, y1) in enumerate(bands):
        y0m = max(0, y0 - margin_px)
        y1m = min(system.height, y1 + margin_px)
        h = y1m - y0m
        chunk = bytearray()
        for row in range(y0m, y1m):
            start = row * row_bytes
            chunk.extend(system.rgb_bytes[start : start + row_bytes])
        out.append(
            StaffImage(
                page_index=system.page_index,
                system_index=system.system_index,
                staff_index=si,
                width=system.width,
                height=h,
                rgb_bytes=bytes(chunk),
                dpi=system.dpi,
                y_offset=system.y_offset + y0m,
            )
        )
    return out

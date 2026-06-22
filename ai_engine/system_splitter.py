"""악보 페이지 → 시스템(오선 묶음) 영역.

1차: 페이지 전체를 단일 시스템으로 처리. 후속: 수평 투영·YOLO 등으로 분할.
"""
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


def split_page_into_systems(page: PageImage, max_systems: int = 8) -> list[SystemImage]:
    """페이지를 균등 수평 밴드로 나눔(휴리스틱). 시스템 1개면 전체 페이지."""
    # clean_score SATB+피아노: 페이지당 시스템 수는 가변 — 1차는 전체 페이지 1 system
    if max_systems <= 1:
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

    band_h = max(1, page.height // max_systems)
    systems: list[SystemImage] = []
    for si in range(max_systems):
        y0 = si * band_h
        y1 = page.height if si == max_systems - 1 else (si + 1) * band_h
        h = y1 - y0
        w = page.width
        row_bytes = w * 3
        chunk = bytearray()
        for row in range(y0, y1):
            start = row * row_bytes
            chunk.extend(page.rgb_bytes[start : start + row_bytes])
        systems.append(
            SystemImage(
                page_index=page.page_index,
                system_index=si,
                width=w,
                height=h,
                rgb_bytes=bytes(chunk),
                dpi=page.dpi,
                y_offset=y0,
            )
        )
    return systems

"""AI OMR 설정 — 환경 변수·기본 레이아웃."""
from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass
class PartLayout:
    part_name: str
    staff_count: int = 1
    label: str = ""


@dataclass
class AiOmrConfig:
    """SATB+피아노(6 staff) 기본. staff 0–3=S/A/T/B, 4=PR, 5=PL."""

    backend: str = "mock"  # mock | tromr
    model_id: str = "sanderwood/tr-omr-large"
    dpi: int = 300
    divisions: int = 6
    beats: int = 4
    beat_type: int = 4
    key_fifths: int = 0
    output_basename: str = "score"
    save_symbol_graph: bool = True
    part_layout: list[PartLayout] = field(
        default_factory=lambda: [
            PartLayout("Voice", 1, "S"),
            PartLayout("Voice", 1, "A"),
            PartLayout("Voice", 1, "T"),
            PartLayout("Voice", 1, "B"),
            PartLayout("Piano", 2, "P"),
        ]
    )

    def staff_to_part(self, staff: int) -> tuple[int, int]:
        """global staff index → (part_index 0-based, staff_within_part 1-based)."""
        cursor = 0
        for pi, pl in enumerate(self.part_layout):
            for s in range(pl.staff_count):
                if cursor == staff:
                    return pi, s + 1
                cursor += 1
        return 0, 1

    def total_staves(self) -> int:
        return sum(p.staff_count for p in self.part_layout)

    def measure_length(self) -> int:
        return max(1, round(self.divisions * self.beats * 4 / self.beat_type))


def load_config() -> AiOmrConfig:
    backend = (os.environ.get("AI_OMR_BACKEND") or "mock").strip().lower()
    model_id = (os.environ.get("AI_OMR_MODEL") or "sanderwood/tr-omr-large").strip()
    dpi = int(os.environ.get("AI_OMR_DPI") or "300")
    divisions = int(os.environ.get("AI_OMR_DIVISIONS") or "6")
    save_sg = os.environ.get("AI_OMR_SAVE_SYMBOL_GRAPH", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )
    basename = (os.environ.get("AI_OMR_OUTPUT_BASENAME") or "score").strip() or "score"
    return AiOmrConfig(
        backend=backend,
        model_id=model_id,
        dpi=dpi,
        divisions=divisions,
        save_symbol_graph=save_sg,
        output_basename=basename,
    )

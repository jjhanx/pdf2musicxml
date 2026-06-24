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

    backend: str = "tromr"  # tromr(기본) | mock(개발용)
    model_id: str = "sanderwood/tr-omr-large"
    dpi: int = 300
    divisions: int = 6
    beats: int = 4
    beat_type: int = 4
    key_fifths: int = 0
    output_basename: str = "score"
    save_symbol_graph: bool = True
    systems_mode: str = "auto"  # auto | single | fixed
    systems_per_page_fixed: int = 4
    split_staves: bool = True
    staves_per_system: int = 6
    staff_margin_px: int = 2
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

    def global_staff_index(self, system_staff: int) -> int:
        return min(system_staff, self.total_staves() - 1)

    def total_staves(self) -> int:
        return sum(p.staff_count for p in self.part_layout)

    def measure_length(self) -> int:
        return max(1, round(self.divisions * self.beats * 4 / self.beat_type))


def _env_bool(name: str, default: bool = True) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() not in ("0", "false", "no", "off")


def load_config() -> AiOmrConfig:
    backend = (os.environ.get("AI_OMR_BACKEND") or "tromr").strip().lower()
    if backend not in ("mock", "tromr"):
        backend = "tromr"
    model_id = (os.environ.get("AI_OMR_MODEL") or "sanderwood/tr-omr-large").strip()
    dpi = int(os.environ.get("AI_OMR_DPI") or "300")
    divisions = int(os.environ.get("AI_OMR_DIVISIONS") or "6")
    systems_mode = (os.environ.get("AI_OMR_SYSTEMS_MODE") or "auto").strip().lower()
    systems_fixed = int(os.environ.get("AI_OMR_SYSTEMS_PER_PAGE") or "4")
    staves = int(os.environ.get("AI_OMR_STAVES_PER_SYSTEM") or "6")
    basename = (os.environ.get("AI_OMR_OUTPUT_BASENAME") or "score").strip() or "score"
    return AiOmrConfig(
        backend=backend,
        model_id=model_id,
        dpi=dpi,
        divisions=divisions,
        save_symbol_graph=_env_bool("AI_OMR_SAVE_SYMBOL_GRAPH", True),
        output_basename=basename,
        systems_mode=systems_mode,
        systems_per_page_fixed=max(1, systems_fixed),
        split_staves=_env_bool("AI_OMR_SPLIT_STAVES", True),
        staves_per_system=max(1, staves),
        staff_margin_px=int(os.environ.get("AI_OMR_STAFF_MARGIN_PX") or "2"),
    )

#!/usr/bin/env python3
"""Extract NWC notehead pitches for page-5 measure 26 column per staff."""
from __future__ import annotations

import fitz
from collections import defaultdict

PDF = "청산에 살리라 F/청산에 살리라 F장조(이현철 곡).pdf"
PAGE = 4
MX0, MX1 = 259, 346  # measure 26 x band

# staff line y clusters (page 5)
STAVES = [
    ("P1", 99, 117),
    ("P2", 154, 172),
    ("P3", 209, 227),
    ("P4", 263, 281),
    ("P5s1", 336, 354),
    ("P5s2", 382, 400),
]

TREBLE = ["E", "G", "B", "D", "F", "A", "C", "E", "G"]
BASS = ["G", "B", "D", "F", "A", "C", "E", "G", "B"]


def y_to_pitch(y: float, y_bottom: float, y_top: float, clef: str) -> tuple[str, int]:
    """Map y (pt, top-down) to step/octave on 5-line staff."""
    names = TREBLE if clef == "treble" else BASS
    # 4 spaces + 5 lines = 8 steps from bottom line to top line+1
    span = y_top - y_bottom
    if span <= 0:
        return ("?", 0)
    # bottom line at y_top in fitz coords? fitz y increases downward
    # staff bottom line = max y (~117 for S), top line = min y (~99)
    y_bot_line = y_bottom  # larger y
    y_top_line = y_top  # smaller y
    step_h = (y_bot_line - y_top_line) / 8
    idx = round((y_bot_line - y) / step_h)
    idx = max(0, min(len(names) - 1, idx))
    step = names[idx]
    if clef == "treble":
        base_oct = 4 if idx < 5 else 5
        octave = base_oct + (1 if idx >= 5 else 0)
        # refine: bottom line E4 idx0
        octave = 4 + (idx // 7)
        if idx <= 4:
            octave = 4 if names[idx] in ("E", "G", "A", "B") else 5
        else:
            octave = 5 if names[idx] in ("C", "D", "E", "F", "G", "A", "B") else 4
    else:
        octave = 2 + (idx // 7)
        if idx <= 4:
            octave = 3 if names[idx] in ("G", "A", "B") else 2
        else:
            octave = 3
    # simpler map from line index
    treble_pitches = [
        ("E", 4),
        ("G", 4),
        ("B", 4),
        ("D", 5),
        ("F", 5),
        ("A", 5),
        ("C", 5),
        ("E", 5),
        ("G", 5),
    ]
    bass_pitches = [
        ("G", 2),
        ("B", 2),
        ("D", 3),
        ("F", 3),
        ("A", 3),
        ("C", 4),
        ("E", 4),
        ("G", 4),
        ("B", 4),
    ]
    table = treble_pitches if clef == "treble" else bass_pitches
    step, octave = table[idx]
    return step, octave


def main() -> None:
    page = fitz.open(PDF)[PAGE]
    by_staff: dict[str, list[tuple[float, float, str]]] = defaultdict(list)
    for block in page.get_text("rawdict").get("blocks") or []:
        if block.get("type") != 0:
            continue
        for line in block.get("lines") or []:
            for sp in line.get("spans") or []:
                if "NWC" not in str(sp.get("font") or ""):
                    continue
                x0, y0, x1, y1 = sp["bbox"]
                if not (MX0 <= x0 <= MX1):
                    continue
                cy = (y0 + y1) / 2
                for name, y_top, y_bot in STAVES:
                    if y_top - 8 <= cy <= y_bot + 8:
                        clef = "bass" if name == "P5s2" else "treble"
                        step, octv = y_to_pitch(cy, y_bot, y_top, clef)
                        by_staff[name].append((x0, cy, f"{step}{octv}"))
    for name, _, _ in STAVES:
        pts = sorted(by_staff.get(name, []), key=lambda t: t[0])
        print(name, [(round(x, 1), p) for x, _, p in pts])


if __name__ == "__main__":
    main()

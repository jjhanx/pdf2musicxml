"""font_separator jobs must not be forced into image_pdf light HITL by imagePdfOmrEngine."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    server = (ROOT / "server" / "index.ts").read_text(encoding="utf-8")
    panel = (ROOT / "src" / "OmrStaffReviewPanel.tsx").read_text(encoding="utf-8")
    app = (ROOT / "src" / "App.tsx").read_text(encoding="utf-8")

    # summary must not overwrite an existing non-image pipelineMode
    bad = re.search(
        r"pipelineMode !== ['\"]image_pdf['\"]\s*&&\s*\([\s\S]*?imagePdfOmrEngine[\s\S]*?pipelineMode = ['\"]image_pdf['\"]",
        server,
    )
    assert bad is None, "diagnostic summary still forces image_pdf when pipelineMode is set"

    assert "summary?.pipelineMode === IMAGE_PDF_LIGHT_PIPELINE" in panel
    assert "Boolean(summary?.imagePdfOmrEngine)" not in panel.replace(
        "// imagePdfOmrEngine", ""
    ), "imagePdfLight must not key off imagePdfOmrEngine alone"

    assert "=== 'image_pdf')" in app or '=== "image_pdf"' in app
    assert "fd.append('imagePdfOmrEngine'" in app
    # only inside image_pdf guard
    idx = app.find("fd.append('imagePdfOmrEngine'")
    window = app[max(0, idx - 200) : idx]
    assert "image_pdf" in window, "imagePdfOmrEngine append must be gated on image_pdf"

    print("ok vector_hitl_not_image_light")


if __name__ == "__main__":
    main()

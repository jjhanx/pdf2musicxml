import sys
from pathlib import Path

import fitz

src = sys.argv[1] if len(sys.argv) > 1 else "clean_score_only.pdf"
out = Path("_smoke/pages")
out.mkdir(exist_ok=True)
doc = fitz.open(src)
for i, page in enumerate(doc, 1):
    pix = page.get_pixmap(dpi=150)
    pix.save(out / f"p{i}.png")
    print(i, pix.width, pix.height)

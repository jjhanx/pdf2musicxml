# -*- coding: utf-8 -*-
import io
import re
import zipfile
from pathlib import Path

z = zipfile.ZipFile("omr-work-e363bc61.zip")
d = z.read("review.mxl")
z2 = zipfile.ZipFile(io.BytesIO(d))
c = z2.read("META-INF/container.xml").decode()
rf = re.search(r'full-path="([^"]+)"', c).group(1)
Path("_smoke/_e363_review.xml").write_bytes(z2.read(rf))

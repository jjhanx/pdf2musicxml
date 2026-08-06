import pathlib
import json

p = pathlib.Path('server/index.ts')
content = p.read_text('utf-8')
content = content.replace("      pageCountForUi,\n      originalPdf:", "      pageCountForUi,\n      activeOmrEngine: job.imagePdfOmrEngine || 'ai',\n      originalPdf:")
p.write_text(content, 'utf-8')

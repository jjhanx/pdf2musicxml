import pathlib
p = pathlib.Path('server/index.ts')
content = p.read_text('utf-8')
if "process.env.PYTHONUTF8 = '1';" not in content:
    content = content.replace("import path from 'node:path';", "import path from 'node:path';\nprocess.env.PYTHONUTF8 = '1';")
p.write_text(content, 'utf-8')

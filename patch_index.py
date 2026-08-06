import pathlib
p = pathlib.Path('server/index.ts')
content = p.read_text('utf-8')
content = content.replace('아래 로그를 검토하세요.', '디버그 ZIP의 `omr_engine.log`를 검토하세요.')
p.write_text(content, 'utf-8')

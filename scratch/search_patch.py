from pathlib import Path

content = Path('scripts/fix_audiveris_mxl.py').read_text(encoding='utf-8')
lines = content.splitlines()

for idx, line in enumerate(lines):
    if '_repair_four_eighths' in line:
        print(f"Line {idx+1}: {line}")

with open(r'C:\Users\jjhan\.gemini\antigravity-ide\brain\6a7ff7c1-5510-4b4a-9349-3e2fa4be2604\scratch\git_diff_ea6d777_utf8.patch', encoding='utf-8') as f:
    lines = f.readlines()

for idx, line in enumerate(lines):
    if line.startswith('+++') and 'fix_audiveris_mxl.py' in line:
        # scan the whole diff for fix_audiveris_mxl.py
        for j in range(idx, len(lines)):
            if lines[j].startswith('diff --git'):
                if j > idx:
                    break
            if 'def ' in lines[j] and (lines[j].startswith('+') or lines[j].startswith('-')):
                print(f"Line {j:4}: {lines[j].strip()}")

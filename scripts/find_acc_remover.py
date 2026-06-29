import sys
from pathlib import Path

def find_remove():
    code = Path("scripts/fix_audiveris_mxl.py").read_text(encoding="utf-8")
    lines = code.splitlines()
    
    out = []
    for idx, line in enumerate(lines):
        if "accidental" in line or "natural" in line or "acc" in line:
            # print surrounding lines
            start = max(0, idx - 5)
            end = min(len(lines), idx + 6)
            out.append(f"--- Line {idx+1} ---")
            for i in range(start, end):
                marker = ">>" if i == idx else "  "
                out.append(f"{marker} {i+1}: {lines[i]}")
            out.append("")
            
    Path("acc_remover_output.txt").write_text("\n".join(out), encoding="utf-8")

if __name__ == "__main__":
    find_remove()

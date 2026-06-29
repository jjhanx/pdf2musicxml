import sys
from pathlib import Path

def find_logic():
    code = Path("scripts/fix_audiveris_mxl.py").read_text(encoding="utf-8")
    lines = code.splitlines()
    
    out = []
    # Let's find any function containing 'accidental' or 'natural'
    current_func = None
    func_lines = []
    
    for idx, line in enumerate(lines):
        if line.startswith("def "):
            if current_func:
                body = "\n".join(func_lines)
                if "accidental" in body or "natural" in body or "sharp" in body:
                    out.append(f"=== Function: {current_func} (lines {idx - len(func_lines)} to {idx}) ===")
                    out.append(body)
                    out.append("\n")
            current_func = line
            func_lines = [line]
        else:
            if current_func:
                func_lines.append(line)
                
    if current_func:
        body = "\n".join(func_lines)
        if "accidental" in body or "natural" in body or "sharp" in body:
            out.append(f"=== Function: {current_func} ===")
            out.append(body)
            
    Path("accidental_logic.txt").write_text("\n".join(out), encoding="utf-8")

if __name__ == "__main__":
    find_logic()

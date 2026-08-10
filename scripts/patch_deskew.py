import sys

def main():
    try:
        with open('d:\\pdf2musicxml\\server\\index.ts', 'r', encoding='utf-8') as f:
            lines = f.readlines()
    except Exception as e:
        print(f"Error reading file: {e}")
        return
        
    out_lines = []
    found = False
    for line in lines:
        if "Pausing for early part label setup" in line:
            found = True
            # Insert deskew save block BEFORE this line
            out_lines.append("      console.log([job ] Pausing for deskew save...);\n")
            out_lines.append("      setJobProgress(job, {\n")
            out_lines.append("        phase: 'hitl',\n")
            out_lines.append("        current: 0,\n")
            out_lines.append("        total: 1,\n")
            out_lines.append("        detail: '수평 보정 결과 다운로드 대기...',\n")
            out_lines.append("      });\n")
            out_lines.append("      job.status = 'deskew_save_needed';\n")
            out_lines.append("      await new Promise<void>((resolve, reject) => {\n")
            out_lines.append("        job.deskewSaveDeferred = { resolve, reject };\n")
            out_lines.append("      });\n")
            out_lines.append("      delete job.deskewSaveDeferred;\n")
            out_lines.append("      job.status = 'processing';\n")
            out_lines.append("      console.log([job ] Deskew save confirmed, continuing...);\n\n")
            out_lines.append(line)
        else:
            out_lines.append(line)
            
    if not found:
        print("Could not find the target line")
        return
        
    with open('d:\\pdf2musicxml\\server\\index.ts', 'w', encoding='utf-8') as f:
        f.writelines(out_lines)
        
    print("Successfully patched index.ts")

if __name__ == '__main__':
    main()
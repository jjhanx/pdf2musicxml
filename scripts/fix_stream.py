import sys, re

def main():
    try:
        with open('d:\\pdf2musicxml\\server\\index.ts', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        return

    # Find the spawn and replace the stdout handling
    target = """          const proc = spawn(pythonBin, [scriptDeskewProcessor, 'apply', inputPdfPath, deskewAnglesPath, deskewedPdfPath]);
          let errOut = '';
          proc.stdout.on('data', (d: Buffer) => {
            const lines = d.toString().split('\\n');
            for (const line of lines) {
              const m = line.match(/PROGRESS:\\s*(\\d+)\\/(\\d+)/);
              if (m) {
                setJobProgress(job, {
                  phase: 'hitl',
                  current: parseInt(m[1], 10),
                  total: parseInt(m[2], 10),
                  detail: '?섑룊 蹂댁젙 寃곌낵 ?앹꽦 以?..',
                });
              }
            }
          });"""

    replace = """          const proc = spawn(pythonBin, [scriptDeskewProcessor, 'apply', inputPdfPath, deskewAnglesPath, deskewedPdfPath]);
          let errOut = '';
          let outBuf = '';
          proc.stdout.on('data', (d: Buffer) => {
            outBuf += d.toString();
            const lines = outBuf.split('\\n');
            outBuf = lines.pop() || ''; // Keep the incomplete line in the buffer
            for (const line of lines) {
              const m = line.match(/PROGRESS:\\s*(\\d+)\\/(\\d+)/);
              if (m) {
                setJobProgress(job, {
                  phase: 'hitl',
                  current: parseInt(m[1], 10),
                  total: parseInt(m[2], 10),
                  detail: '수평 보정 결과 생성 중...',
                });
              }
            }
          });"""

    # There are two places (image_pdf and font_separator) where executeJob calls this. We replace all occurrences.
    if "let errOut = '';" in content:
        # Since the broken text might be slightly different in bytes, let's use regex
        pattern = re.compile(r"const proc = spawn\([^;]+;\s*let errOut = '';\s*proc\.stdout\.on\('data', \(d: Buffer\) => \{.*?\}\);\s*\}\);", re.DOTALL)
        
        def replacer(match):
            m_text = match.group(0)
            return m_text.replace("let errOut = '';", "let errOut = '';\n          let outBuf = '';").replace("const lines = d.toString().split('\\n');", "outBuf += d.toString();\n            const lines = outBuf.split('\\n');\n            outBuf = lines.pop() || '';").replace("?섑룊 蹂댁젙 寃곌낵 ?앹꽦 以?..", "수평 보정 결과 생성 중...")

        new_content = pattern.sub(replacer, content)
        
        with open('d:\\pdf2musicxml\\server\\index.ts', 'w', encoding='utf-8') as f:
            f.write(new_content)
        print("Fixed stream chunking")
    else:
        print("Target not found")

if __name__ == '__main__':
    main()
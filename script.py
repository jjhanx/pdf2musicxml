import sys

with open('server/index.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()

insert_idx = -1
for i, line in enumerate(lines):
    if "if (enablePymupdfReview) {" in line:
        insert_idx = i
        break

if insert_idx != -1:
    # search backwards for the start of this block where I put "// Extraction already done"
    for j in range(insert_idx, -1, -1):
        if "// Extraction already done earlier in the pipeline for preview" in lines[j]:
            ocr_code = """      const scriptImageProcessor = path.join(__dirname, '..', 'scripts', 'image_pdf_processor.py');
      
      setJobProgress(job, {
        phase: 'separator',
        current: 0,
        total: 2,
        detail: 'PaddleOCR로 이미지 PDF 텍스트 추출 중…',
      });
      if (job.skipPaddleOcr) {
        console.log([job \] Skipping PaddleOCR extract, creating empty JSON);
        const mockEmpty = [];
        await fs.writeFile(extractedJsonPath, JSON.stringify(mockEmpty, null, 2), 'utf8');
      } else {
        console.log([job \] Running image_pdf_processor.py extract);
        try {
          await exec(
            "\" "\" extract "\" "\",
            { maxBuffer: 16 * 1024 * 1024 }
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await fail({ status: 500, error: 'OCR extract error', detail: msg });
          return;
        }
      }\n"""
            lines[j] = ocr_code
            break
            
    with open('server/index.ts', 'w', encoding='utf-8') as f:
        f.writelines(lines)
    print("Restored original OCR block successfully")
else:
    print("Could not find insert point")

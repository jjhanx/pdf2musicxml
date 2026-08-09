import sys

with open('server/index.ts', 'r', encoding='utf-8') as f:
    text = f.read()

# We will inject the OCR and Masking code right before detect_parts.py
injection_point = "      try {\n        console.log([job \] Detecting part labels from \);"

injected_code = """
      // NEW: Run OCR and generate clean_score.pdf BEFORE part labels so user can download them in Deskew UI
      setJobProgress(job, {
        phase: 'separator',
        current: 0,
        total: 2,
        detail: 'PaddleOCR로 이미지 PDF 텍스트 추출 중…',
      });
      const scriptImageProcessor = path.join(__dirname, '..', 'scripts', 'image_pdf_processor.py');
      if (!job.skipPaddleOcr) {
        console.log([job \] Running image_pdf_processor.py extract early);
        try {
          await exec(
            "\" "\" extract "\" "\",
            { maxBuffer: 16 * 1024 * 1024 }
          );
        } catch (err) {
          console.warn([job \] Early OCR failed:, err);
        }
      }
      if (fsSync.existsSync(extractedJsonPath)) {
        console.log([job \] Running mask_pdf.py early for preview);
        try {
          const scriptMask = path.join(__dirname, '..', 'scripts', 'mask_pdf.py');
          await exec(
            "\" "\" "\" "\" "\",
            { env: { ...process.env, MASK_PDF_LYRIC_SELECTIVE: '0', MASK_PDF_GLOBAL_HANGUL_SYLLABLE_BLANK: '0' } }
          );
        } catch (err) {
          console.warn([job \] Early mask failed:, err);
        }
      }

"""

new_text = text.replace(injection_point, injected_code + injection_point)

with open('server/index.ts', 'w', encoding='utf-8') as f:
    f.write(new_text)

print("Injected successfully")

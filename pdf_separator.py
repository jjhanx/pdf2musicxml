"""레거시 진입점 — scripts/pdf_separator.py 를 호출합니다."""
import subprocess
import sys
from pathlib import Path

_SCRIPT = Path(__file__).resolve().parent / "scripts" / "pdf_separator.py"


def extract_text_and_graphics_pdf(input_pdf_path, output_json_path, output_pdf_path):
    subprocess.run(
        [
            sys.executable,
            str(_SCRIPT),
            input_pdf_path,
            output_json_path,
            output_pdf_path,
        ],
        check=True,
    )


if __name__ == "__main__":
    input_file = "sample.pdf"
    output_json = "extracted_music_text.json"
    output_pdf = "clean_score_only.pdf"

    if not Path(input_file).is_file():
        print(f"'{input_file}' 파일이 현재 폴더에 없습니다.")
    else:
        extract_text_and_graphics_pdf(input_file, output_json, output_pdf)

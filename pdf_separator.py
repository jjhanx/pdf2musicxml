import subprocess
import sys
from pathlib import Path

_SCRIPT = Path(__file__).resolve().parent / "scripts" / "pdf_separator.py"


def extract_text_and_graphics_pdf(input_pdf_path, output_json_path, output_pdf_path):
    subprocess.run(
        [
            sys.executable,
            str(_SCRIPT),
            "all",
            input_pdf_path,
            output_json_path,
            output_pdf_path,
            "--ranges",
            "7-17",
        ],
        check=True,
    )

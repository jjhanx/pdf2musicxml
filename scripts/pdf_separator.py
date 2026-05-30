#!/usr/bin/env python3
"""pdfplumber로 문자 레이아웃 추출, pikepdf로 가사 크기 텍스트만 제거해 악보 PDF를 만듭니다."""
import argparse
import json
import sys

import pikepdf
import pdfplumber

DEFAULT_MIN_LYRICS_SIZE = 7.0
DEFAULT_MAX_LYRICS_SIZE = 17.0


def extract_text_and_graphics_pdf(
    input_pdf_path: str,
    output_json_path: str,
    output_pdf_path: str,
    *,
    min_lyrics_size: float = DEFAULT_MIN_LYRICS_SIZE,
    max_lyrics_size: float = DEFAULT_MAX_LYRICS_SIZE,
) -> None:
    print("[1/3] pdfplumber를 사용하여 가사 및 문자 레이아웃을 추출하는 중...", file=sys.stderr)
    extracted_data = []

    with pdfplumber.open(input_pdf_path) as pdf:
        for page_idx, page in enumerate(pdf.pages):
            page_info = {
                "page_number": page_idx + 1,
                "width": float(page.width),
                "height": float(page.height),
                "text_elements": [],
            }
            for char in page.chars:
                char_info = {
                    "raw_text": char["text"],
                    "x0": round(float(char["x0"]), 2),
                    "y0": round(float(char["y0"]), 2),
                    "x1": round(float(char["x1"]), 2),
                    "y1": round(float(char["y1"]), 2),
                    "fontname": char.get("fontname", "Unknown"),
                    "size": round(float(char["size"]), 2),
                }
                page_info["text_elements"].append(char_info)
            extracted_data.append(page_info)

    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump(extracted_data, f, ensure_ascii=False, indent=2)
    print(f" -> 레이아웃 정보 JSON 저장 완료: {output_json_path}", file=sys.stderr)

    print(
        f"[2/3] pikepdf를 사용하여 {min_lyrics_size}pt~{max_lyrics_size}pt 텍스트 레이어만 제거하는 중...",
        file=sys.stderr,
    )

    with pikepdf.open(input_pdf_path) as pdf:
        for page in pdf.pages:
            if "/Contents" not in page:
                continue

            try:
                commands = pikepdf.parse_content_stream(page)
            except Exception:
                continue

            clean_commands = []
            current_font_size = 0.0

            for operands, operator in commands:
                op_name = str(operator)

                if op_name == "Tf":
                    if len(operands) > 1:
                        try:
                            current_font_size = float(operands[1])
                        except (ValueError, TypeError):
                            current_font_size = 0.0

                if op_name in ["Tj", "TJ", "'", '"']:
                    if min_lyrics_size <= current_font_size <= max_lyrics_size:
                        if len(operands) > 0:
                            if op_name == "TJ":
                                operands[0] = pikepdf.Array([])
                            else:
                                operands[0] = pikepdf.String("")

                clean_commands.append((operands, operator))

            page.Contents = pdf.make_stream(pikepdf.unparse_content_stream(clean_commands))

        print("[3/3] 음표가 보존된 악보 PDF를 저장하는 중...", file=sys.stderr)
        pdf.save(output_pdf_path, linearize=True)

    print(f" -> 결과 PDF 저장 완료: {output_pdf_path}", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(description="PDF에서 가사 크기 텍스트를 분리·제거합니다.")
    parser.add_argument("input_pdf", help="입력 PDF 경로")
    parser.add_argument("output_json", help="extracted_music_text.json 출력 경로")
    parser.add_argument("output_pdf", help="clean_score_only.pdf 출력 경로")
    parser.add_argument(
        "--min-size",
        type=float,
        default=DEFAULT_MIN_LYRICS_SIZE,
        help=f"가사로 간주할 최소 폰트 크기(pt, 기본 {DEFAULT_MIN_LYRICS_SIZE})",
    )
    parser.add_argument(
        "--max-size",
        type=float,
        default=DEFAULT_MAX_LYRICS_SIZE,
        help=f"가사로 간주할 최대 폰트 크기(pt, 기본 {DEFAULT_MAX_LYRICS_SIZE})",
    )
    args = parser.parse_args()

    extract_text_and_graphics_pdf(
        args.input_pdf,
        args.output_json,
        args.output_pdf,
        min_lyrics_size=args.min_size,
        max_lyrics_size=args.max_size,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

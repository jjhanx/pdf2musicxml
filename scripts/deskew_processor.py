import sys
import json
import argparse
import os
import math
import cv2
import numpy as np

try:
    import fitz  # PyMuPDF
except ImportError:
    print("PyMuPDF (fitz) is not installed.", file=sys.stderr)
    sys.exit(1)

def _get_skew_angle(image_np: np.ndarray) -> float:
    # Convert to grayscale
    gray = cv2.cvtColor(image_np, cv2.COLOR_RGB2GRAY)
    
    # Invert the image (black background, white text/lines)
    gray = cv2.bitwise_not(gray)
    
    # Threshold
    thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]
    
    # Use Hough lines to find staff lines
    # Staff lines are typically long horizontal lines
    lines = cv2.HoughLinesP(thresh, 1, np.pi/180, 100, minLineLength=image_np.shape[1] // 4, maxLineGap=20)
    
    if lines is None:
        return 0.0
        
    angles = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
        angle = math.degrees(math.atan2(y2 - y1, x2 - x1))
        # We only care about nearly horizontal lines (staff lines)
        if -15 <= angle <= 15:
            angles.append(angle)
            
    if not angles:
        return 0.0
        
    # Median angle is usually robust against outliers
    median_angle = np.median(angles)
    return round(float(median_angle), 2)

def analyze(input_pdf: str, output_json: str):
    print(f"[deskew_processor] Analyzing {input_pdf}...", file=sys.stderr)
    
    doc = fitz.open(input_pdf)
    results = []
    
    # For speed and good enough line detection, DPI 150 is usually fine
    zoom = 150 / 72.0
    mat = fitz.Matrix(zoom, zoom)
    
    for page_idx in range(len(doc)):
        page = doc[page_idx]
        pix = page.get_pixmap(matrix=mat)
        
        # Convert to numpy array
        img_np = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
        if pix.n == 4:
            img_np = cv2.cvtColor(img_np, cv2.COLOR_RGBA2RGB)
            
        angle = _get_skew_angle(img_np)
        
        results.append({
            "page_number": page_idx + 1,
            "angle": angle
        })
        
    doc.close()
    
    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
        
    print(f"[deskew_processor] Analysis complete -> {output_json}", file=sys.stderr)

def apply(input_pdf: str, angles_json: str, output_pdf: str):
    print(f"[deskew_processor] Applying deskew to {input_pdf}...", file=sys.stderr)
    
    with open(angles_json, "r", encoding="utf-8") as f:
        angles_data = json.load(f)
        
    doc = fitz.open(input_pdf)
    out_doc = fitz.open()
    
    # We want a high DPI for the final clean_score. 300 DPI is standard for OMR.
    zoom = 300 / 72.0
    mat = fitz.Matrix(zoom, zoom)
    
    for page_idx in range(len(doc)):
        page = doc[page_idx]
        
        angle_info = next((item for item in angles_data if item["page_number"] == page_idx + 1), None)
        angle = angle_info["angle"] if angle_info else 0.0
        
        if abs(angle) > 0.01:
            pix = page.get_pixmap(matrix=mat)
            img_np = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
            
            if pix.n == 4:
                img_np = cv2.cvtColor(img_np, cv2.COLOR_RGBA2RGB)
            
            # Rotate image with white background
            h, w = img_np.shape[:2]
            center = (w // 2, h // 2)
            M = cv2.getRotationMatrix2D(center, angle, 1.0)
            
            # Calculate new bounding box dimensions
            cos = np.abs(M[0, 0])
            sin = np.abs(M[0, 1])
            nW = int((h * sin) + (w * cos))
            nH = int((h * cos) + (w * sin))
            
            # Adjust translation
            M[0, 2] += (nW / 2) - center[0]
            M[1, 2] += (nH / 2) - center[1]
            
            rotated_img = cv2.warpAffine(img_np, M, (nW, nH), borderValue=(255, 255, 255))
            
            # Convert back to fitz Pixmap
            rotated_pix = fitz.Pixmap(fitz.csRGB, nW, nH, rotated_img.tobytes(), 0) # 0 for alpha
            out_page = out_doc.new_page(width=nW / zoom, height=nH / zoom)
            out_page.insert_image(out_page.rect, pixmap=rotated_pix)
        else:
            # If no rotation, just insert the page directly to preserve vector
            out_doc.insert_pdf(doc, from_page=page_idx, to_page=page_idx)
            
    out_doc.save(output_pdf)
    out_doc.close()
    doc.close()
    
    print(f"[deskew_processor] Deskew complete -> {output_pdf}", file=sys.stderr)

def main():
    parser = argparse.ArgumentParser(description="Image PDF Deskew Processor")
    subparsers = parser.add_subparsers(dest="command", required=True)
    
    p_analyze = subparsers.add_parser("analyze")
    p_analyze.add_argument("input_pdf")
    p_analyze.add_argument("output_json")
    
    p_apply = subparsers.add_parser("apply")
    p_apply.add_argument("input_pdf")
    p_apply.add_argument("angles_json")
    p_apply.add_argument("output_pdf")
    
    args = parser.parse_args()
    
    if args.command == "analyze":
        analyze(args.input_pdf, args.output_json)
    elif args.command == "apply":
        apply(args.input_pdf, args.angles_json, args.output_pdf)

if __name__ == "__main__":
    main()

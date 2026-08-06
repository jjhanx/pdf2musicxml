import sys
import numpy as np
import traceback

def run_test(config_name, params):
    print(f"\n--- Testing {config_name} ---")
    try:
        from rapidocr import RapidOCR
        # Initialize
        ocr = RapidOCR(params=params)
        
        # Create a dummy image (white 100x100)
        img = np.ones((100, 100, 3), dtype=np.uint8) * 255
        
        # Run OCR
        res = ocr(img)
        print(f"SUCCESS: {config_name} initialized and ran successfully.")
    except Exception as e:
        print(f"FAILED: {config_name} threw an exception: {e}")
        # traceback.print_exc()

if __name__ == '__main__':
    print("Testing RapidOCR configurations...")
    
    # 1. Default (English/Chinese)
    run_test("Default", {})
    
    # 2. Korean Default
    run_test("Korean Default", {"Rec.lang_type": "korean"})
    
    # 3. Korean PP-OCRv3
    run_test("Korean PP-OCRv3", {"Rec.lang_type": "korean", "Rec.ocr_version": "PP-OCRv3"})
    
    # 4. Korean PP-OCRv4
    run_test("Korean PP-OCRv4", {"Rec.lang_type": "korean", "Rec.ocr_version": "PP-OCRv4"})
    
    print("\nTests complete. (If you see this line, the script didn't segfault entirely!)")

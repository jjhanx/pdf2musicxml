from rapidocr import LangRec, RapidOCR
try:
    ocr = RapidOCR(params={'Rec.lang_type': LangRec.KOREAN})
    print('Success:', ocr)
except Exception as e:
    print('Error:', e)

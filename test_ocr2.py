from rapidocr import RapidOCR
print("Testing Korean RapidOCR...")
try:
    ocr = RapidOCR(params={'Rec.lang_type': 'korean'})
    print('Success:', ocr)
except Exception as e:
    print('Error:', e)

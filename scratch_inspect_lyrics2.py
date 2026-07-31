import json, zipfile
with zipfile.ZipFile('omr-work-82157d8d.zip') as z:
    data = json.loads(z.read('omr_hitl_checkpoint.json').decode('utf-8'))
for measure in data.get('measures', []):
    parts = measure.get('parts', {})
    for p, pd in parts.items():
        if p == 'P4' and pd.get('lyrics'):
            print(f"Measure {measure.get('measure_number')}: {json.dumps(pd.get('lyrics'), ensure_ascii=False)}")

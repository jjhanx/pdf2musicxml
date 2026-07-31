import json, zipfile
with zipfile.ZipFile('omr-work-82157d8d.zip') as z:
    data = json.loads(z.read('omr_hitl_checkpoint.json').decode('utf-8'))
for measure in data.get('measures', []):
    if measure.get('measure_number') == 14:
        parts = measure.get('parts', {})
        for p, pd in parts.items():
            if p == 'P4':
                print(json.dumps(pd.get('lyrics'), ensure_ascii=False, indent=2))

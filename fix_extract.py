import re

def update_extract_text():
    with open(r'd:\pdf2musicxml\scripts\extract_text.py', 'r', encoding='utf-8') as f:
        text = f.read()
    
    # Add is_meaningless_noise check to extract_image
    old = """            text = strip_pua(text)

            if not text.strip():
                continue"""
    new = """            text = strip_pua(text)

            if not text.strip():
                continue
                
            from merge_lyric_sources import is_meaningless_noise
            if is_meaningless_noise(text):
                continue"""
    
    text = text.replace(old, new)
    with open(r'd:\pdf2musicxml\scripts\extract_text.py', 'w', encoding='utf-8') as f:
        f.write(text)

def update_merge_lyric_sources():
    with open(r'd:\pdf2musicxml\scripts\merge_lyric_sources.py', 'r', encoding='utf-8') as f:
        text = f.read()

    # Strengthen condition B, C, E, etc.
    old = """    # 조건 C: 노이즈 문자와 유효한 음악 기호, 숫자만이 섞여 있는 경우
    if len(words) > 1 and all((w in extended_noise_pool or w in _VALID_MUSIC_TERMS or w.isdigit()) for w in lower_words):
        if any(w in noise_seed for w in lower_words):
            return True"""
    
    new = """    # 추가 조건: tempo mark 형태 (=82, = 82, q=82 등) 포함 시
    if re.search(r'(=|≈)\s*\d+', text) or re.search(r'[A-Za-z]\s*=\s*\d+', text):
        return True
        
    # 조건 C: 노이즈 문자와 유효한 음악 기호, 숫자만이 섞여 있는 경우
    if len(words) >= 1 and all((w in extended_noise_pool or w in _VALID_MUSIC_TERMS or w.isdigit()) for w in lower_words):
        return True"""
        
    text = text.replace(old, new)
    with open(r'd:\pdf2musicxml\scripts\merge_lyric_sources.py', 'w', encoding='utf-8') as f:
        f.write(text)

update_extract_text()
update_merge_lyric_sources()

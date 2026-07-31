import sys
sys.path.append(r'd:\pdf2musicxml\scripts')
from merge_lyric_sources import is_meaningless_noise

examples = [
    "j kkk kk k kkk kkk k k jjj kk kk jj",
    "f D j kk kk kk",
    "k k k k k k k k k k k k k k k k k j",
    "k j k k jz k k k kz k k i",
    "bf k k k fk k k k",
    "af m n k j k k kz",
    "l l l l",
    "f D",
    "l l l m n k k",
    "bf D",
    "G k",
    "=82j kkk kk k kkk kkk k k jjj kk kk jj"
]

for e in examples:
    print(f"'{e}': {is_meaningless_noise(e)}")

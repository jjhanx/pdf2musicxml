from pathlib import Path
p = Path("_smoke/_patch_docs_revert.py")
lines = p.read_text(encoding="utf-8").splitlines(True)
lines[13] = (
    '    "direction은 **part·\ub354\ub514·\uc74c\ud45c `#n`** + anchor `voice`·`default-x`(\uc800\uc7a5 MXL). "\n'
)
p.write_text("".join(lines), encoding="utf-8")
print("fixed")

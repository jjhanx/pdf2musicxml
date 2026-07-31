from pathlib import Path

root = Path(__file__).resolve().parents[1]

readme = (root / "README.md").read_text(encoding="utf-8")
old = (
    "**전체 악보 미리보기**는 OSMD 한계로 피아노 2단 part를 **PR·PL 단일 줄 part로만** 쪼개 표시(저장 MXL·MuseScore는 grand staff 그대로). "
    "PL 줄 추출 시 **`<forward>`(backup duration)** 로 리듬 시점을 맞춰 P1 등 **마디 앞 direction과 timeline 겹침**을 방지(미리보기 전용). "
    "direction은 **part·마디·음표 `#n`** + anchor `voice`·`default-x`(저장 MXL). "
    "**전체 미리보기** PL part 추출 시 direction **`default-x`는 제거**(OSMD timeline 겹침 방지)."
)
new = (
    "**전체 악보 미리보기**는 **2단 grand staff MXL 그대로**(PR·PL part 분리·`<forward>` 없음 — 분리 시 악보가 순차 연주처럼 깨짐). "
    "direction은 **part·더디·음표 `#n`** + anchor `voice`·`default-x`(저장 MXL). "
    "OSMD에서 PL direction이 P2·P1 등에 어긋나 보이면 **PL 필터**로 해당 줄만 확인."
)
if old not in readme:
    raise SystemExit("README block not found")
(root / "README.md").write_text(readme.replace(old, new, 1), encoding="utf-8")

lines = (root / "docs/악보_변환_품질_가이드.md").read_text(encoding="utf-8").splitlines(keepends=True)
lines[293] = (
    "| **PL \ub354\ub514 \uc55e** direction\uc774 **P2(Alto) \uc904**\uc5d0 \ubcf4\uc784 | "
    "OSMD\uac00 `<direction><staff>2</staff>`(\ub610\ub294 grand staff staff 2)\ub97c **\uc545\ubcf4 2\ubc88\uc9f8 \uc904(P2)** \ub85c \uadf8\ub림(part `P5` staff 2 \u2260 part `P2`). "
    "**\uc800\uc7a5 MXL**\uc740 part\xb7`#n` \uae30\uc900 P5\uc5d0\ub9cc \ub4e4\uc5b4\uac10. **\uc804\uccb4 \ubbf8\ub9ac\ubcf4\uae30**\ub294 grand staff \uadf8\ub300\ub85c \u2014 **PL \ud544\ud130**\ub85c \ud655\uc778\xb7\ud3b8\uc9d1 |\n"
)
lines[294] = (
    "| **PL direction**\uc774 **P1 \ub354\ub514 \ub9e8 \uc704**\uc640 \uaca9\uccd0 \ubcf4\uc784 | "
    "**\uc804\uccb4 \uc545\ubcf4** OSMD \ubbf8\ub9ac\ubcf4\uae30 \ud55c\uacc4 \u2014 **PL \ud544\ud130** \uc0ac\uc6a9. MXL\uc5d0\ub294 part `P5`\xb7`#n` \uae30\uc900\uc73c\ub85c \uc800\uc7a5\ub428 |\n"
)
(root / "docs/악보_변환_품질_가이드.md").write_text("".join(lines), encoding="utf-8")
print("ok")

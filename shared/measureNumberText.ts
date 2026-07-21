/** PDF·OCR 마디 번호 문자열 → ASCII 숫자(1–999) 정규화 */

const CIRCLED_1_20: Record<number, string> = Object.fromEntries(
  Array.from({ length: 20 }, (_, i) => [0x2460 + i, String(i + 1)]),
) as Record<number, string>;

const PAREN_1_20: Record<number, string> = Object.fromEntries(
  Array.from({ length: 20 }, (_, i) => [0x2474 + i, String(i + 1)]),
) as Record<number, string>;

const CIRCLED_21_35: Record<number, string> = Object.fromEntries(
  Array.from({ length: 15 }, (_, i) => [0x3251 + i, String(i + 21)]),
) as Record<number, string>;

const FULLWIDTH_ZERO = '０'.charCodeAt(0);

function stripPua(text: string): string {
  return text.replace(/[\uE000-\uF8FF]/g, '');
}

function mapSpecialDigitChar(code: number): string | null {
  if (code in CIRCLED_1_20) return CIRCLED_1_20[code];
  if (code in PAREN_1_20) return PAREN_1_20[code];
  if (code in CIRCLED_21_35) return CIRCLED_21_35[code];
  if (code >= FULLWIDTH_ZERO && code <= FULLWIDTH_ZERO + 9) {
    return String(code - FULLWIDTH_ZERO);
  }
  if (code >= 0x30 && code <= 0x39) return String.fromCharCode(code);
  return null;
}

/**
 * ①, ⓵, ㈀, (1), １, PUA 제거 후 남은 숫자 등 → "17" 같은 ASCII 라벨.
 * 원문자(동그라미 숫자)는 글리프 하나가 한 자리로 매핑됩니다.
 */
export function normalizePrintedMeasureNumberText(raw: string): string | null {
  const trimmed = stripPua(String(raw ?? '')).trim();
  if (!trimmed) return null;

  let digits = '';
  for (const ch of trimmed) {
    const mapped = mapSpecialDigitChar(ch.charCodeAt(0));
    if (mapped !== null) {
      digits += mapped;
      continue;
    }
    if (/\d/.test(ch)) {
      digits += ch;
      continue;
    }
    // 장식 문자(○, ●, 괄호 등)는 무시
  }

  if (!digits) {
    const fallback = trimmed.replace(/\D/g, '');
    digits = fallback;
  }

  if (!/^\d{1,3}$/.test(digits)) return null;
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n) || n < 1 || n > 999) return null;
  return String(n);
}

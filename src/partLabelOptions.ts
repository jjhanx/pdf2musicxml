/** 성부 라벨 — PDF **페이지(p.)** 번호와 구분 */
export const STANDARD_PART_LABELS = ['S', 'A', 'T', 'B', 'PR', 'PL'] as const;

/** 남·녀·합창(Unison) 등 대체 성부 약어 */
export const MEN_WOMEN_UNISON_LABELS = ['M', 'W', 'U'] as const;

export const PART_LABEL_PICKLIST = [
  'S',
  'A',
  'T',
  'B',
  'M',
  'W',
  'U',
  'P',
  'PR',
  'PL',
  'P1',
  'P2',
  'P3',
  'P4',
  'P5',
  'P6',
  'P7',
  'P8',
] as const;

/** picklist 드롭다운 표시 — 저장·MXL 값은 짧은 약어(M/W/U) 그대로 */
export const PART_LABEL_PICKLIST_HINT: Partial<Record<(typeof PART_LABEL_PICKLIST)[number], string>> = {
  M: 'M (Men)',
  W: 'W (Women)',
  U: 'U (Unison)',
};

export function defaultPartLabels(count: number): string[] {
  const n = Math.max(1, Math.min(12, count));
  const base = [...STANDARD_PART_LABELS];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(base[i] ?? `P${i + 1}`);
  }
  return out;
}

function combinedPartText(partName: string, instrumentName?: string): string {
  return `${partName || ''} ${instrumentName || ''}`.toUpperCase();
}

export function isPianoPart(partName: string, instrumentName?: string): boolean {
  return /PIANO|PNO\.?/.test(combinedPartText(partName, instrumentName));
}

function inferChoirLabelFromName(partName: string, instrumentName?: string): string | null {
  const upper = combinedPartText(partName, instrumentName);
  if (/\bUNISON\b|\bUNIS\.?\b/.test(upper)) return 'U';
  if (/\bWOMEN\b|\bWOMAN\b|\bFEMALE\b/.test(upper) && !/\bMEN\b/.test(upper)) return 'W';
  if (/\bMEN\b|\bMAN\b|\bMALE\b/.test(upper) && !/\bWOMEN\b/.test(upper)) return 'M';
  return null;
}

/** Piano(악기명·part-name)는 preset/API PR보다 P 우선. 양손 표기만 PR/PL */
export function suggestedPartLabel(
  partName: string,
  partIndex: number,
  partCount: number,
  apiSuggestion?: string,
  instrumentName?: string,
): string {
  const upper = combinedPartText(partName, instrumentName);
  if (/PIANO|PNO\.?/.test(upper)) {
    if (/LEFT|\bLH\b|LEFT\s*HAND/.test(upper)) return 'PL';
    if (/RIGHT|\bRH\b|RIGHT\s*HAND/.test(upper)) return 'PR';
    return 'P';
  }
  const choir = inferChoirLabelFromName(partName, instrumentName);
  if (choir) return choir;
  const sug = (apiSuggestion || '').trim();
  if (sug) return sug;
  return defaultPartLabels(partCount)[partIndex] ?? `P${partIndex + 1}`;
}

export type ScorePartLabelInput = {
  index: number;
  name?: string;
  instrumentName?: string;
  suggestedLabel?: string;
};

/** part_labels.json(확정) → preset → OMR 추정 순으로 미리보기·필터용 라벨 결정. */
export function resolvePartDisplayLabels(
  parts: ScorePartLabelInput[],
  savedByIndex?: string[],
  presetByIndex?: string[],
): string[] {
  const n = Math.max(parts.length, savedByIndex?.length ?? 0, presetByIndex?.length ?? 0);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const saved = savedByIndex?.[i]?.trim();
    const preset = presetByIndex?.[i]?.trim();
    const p = parts[i];
    const inferred = p
      ? suggestedPartLabel(
          p.name ?? '',
          p.index,
          Math.max(parts.length, n),
          p.suggestedLabel,
          p.instrumentName,
        )
      : '';
    out.push((saved || preset || inferred || defaultPartLabels(n)[i] || `P${i + 1}`).trim());
  }
  return out;
}

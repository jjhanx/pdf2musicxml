/** 성부 라벨 — PDF **페이지(p.)** 번호와 구분 */
export const STANDARD_PART_LABELS = ['S', 'A', 'T', 'B', 'PR', 'PL'] as const;

export const PART_LABEL_PICKLIST = [
  'S',
  'A',
  'T',
  'B',
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
  const sug = (apiSuggestion || '').trim();
  if (sug) return sug;
  return defaultPartLabels(partCount)[partIndex] ?? `P${partIndex + 1}`;
}

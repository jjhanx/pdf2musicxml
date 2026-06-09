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

/** Audiveris part-name·API 제안보다 우선 — 단일 Piano는 P, 양손만 PR/PL */
export function suggestedPartLabel(
  partName: string,
  partIndex: number,
  partCount: number,
  apiSuggestion?: string,
): string {
  const upper = (partName || '').toUpperCase();
  if (/PIANO|PNO\.?/.test(upper)) {
    if (/LEFT|\bLH\b|LEFT\s*HAND/.test(upper)) return 'PL';
    if (/RIGHT|\bRH\b|RIGHT\s*HAND/.test(upper)) return 'PR';
    return 'P';
  }
  const sug = (apiSuggestion || '').trim();
  if (sug) return sug;
  return defaultPartLabels(partCount)[partIndex] ?? `P${partIndex + 1}`;
}

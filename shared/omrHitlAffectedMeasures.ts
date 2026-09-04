/** HITL fix 목록에서 MXL에 실제로 바뀐 (partId, measureMxl) 집합 — 증분 미리보기용 */

export type AffectedMeasureRef = { partId: string; measureMxl: number };

export function expandMeasureMxlSpec(spec: string): number[] {
  const s = spec.trim();
  if (!s) return [];
  if (s.includes('-')) {
    const [aRaw, bRaw] = s.split('-', 2);
    const a = parseInt(aRaw.trim(), 10);
    const b = parseInt(bRaw.trim(), 10);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return [];
    const out: number[] = [];
    for (let m = a; m <= b; m += 1) out.push(m);
    return out;
  }
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 1 ? [n] : [];
}

function addMeasure(
  set: Map<string, AffectedMeasureRef>,
  partId: string | undefined | null,
  measureMxl: number,
): void {
  const pid = (partId ?? '').trim();
  if (!pid || !Number.isFinite(measureMxl) || measureMxl < 1) return;
  set.set(`${pid}:${measureMxl}`, { partId: pid, measureMxl });
}

/** @param fixes omr_hitl_fixes.json 항목 배열(느슨한 타입) */
export function affectedMeasuresFromFixes(fixes: unknown[]): AffectedMeasureRef[] {
  const map = new Map<string, AffectedMeasureRef>();
  for (const raw of fixes) {
    if (!raw || typeof raw !== 'object') continue;
    const fix = raw as Record<string, unknown>;
    const kind = String(fix.kind ?? '');
    const measureSpec = String(fix.measureMxl ?? '').trim();
    const measures = expandMeasureMxlSpec(measureSpec);
    const toSpec = String(fix.toMeasureMxl ?? '').trim();
    const toMeasures = toSpec ? expandMeasureMxlSpec(toSpec) : measures;

    if (kind === 'copyMeasureContent' || kind === 'copyMeasurePart') {
      const fromPart = String(fix.fromPartId ?? fix.partId ?? '').trim();
      for (const m of measures) addMeasure(map, fromPart, m);
      const toParts = Array.isArray(fix.toPartIds)
        ? fix.toPartIds.map((p) => String(p).trim()).filter(Boolean)
        : fix.toPartId
          ? [String(fix.toPartId).trim()]
          : [];
      for (const tp of toParts) {
        for (let i = 0; i < measures.length; i += 1) {
          addMeasure(map, tp, toMeasures[i] ?? measures[i]!);
        }
      }
      continue;
    }

    const partId = String(fix.partId ?? '').trim();
    for (const m of measures) addMeasure(map, partId, m);
  }
  return [...map.values()].sort(
    (a, b) => a.partId.localeCompare(b.partId) || a.measureMxl - b.measureMxl,
  );
}

export function affectedMeasureNumbers(fixes: unknown[]): number[] {
  const nums = new Set<number>();
  for (const ref of affectedMeasuresFromFixes(fixes)) nums.add(ref.measureMxl);
  return [...nums].sort((a, b) => a - b);
}

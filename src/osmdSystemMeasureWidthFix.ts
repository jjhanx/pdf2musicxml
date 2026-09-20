/**
 * OSMD 미리보기 — 마디 폭 밀도 배분(순수 계산).
 *
 * 렌더 후 AbsolutePosition·stave·`g.vf-measure`를 옮기는 재배분은
 * 오선·마디구분선·clipPath가 어긋나 흰 블록·음표 떡짐이 난다(101d772).
 * SoftmaxFactorVexFlow↑ + Softmax 칸 안 duration remesh만 사용한다.
 */
export type DensityLayoutTarget = {
  measureNumber: number;
  defaultXTenths: number;
};

/**
 * 현재 폭 합을 유지한 채 onset 밀도 비례로 재배분(단위 테스트·사전 계산용).
 * ideal = base + beginInstr + perOnset×count 를 목표로 두고, 합이 total을 넘으면 비례 축소.
 */
export function allocateMeasureWidthsByDensity(
  currentWidths: number[],
  onsetCounts: number[],
  beginInstrWidths: number[] = [],
  opts?: { perOnset?: number; base?: number; minShrinkRatio?: number },
): number[] {
  const n = currentWidths.length;
  if (n === 0) return [];
  const total = currentWidths.reduce((a, b) => a + Math.max(0.5, b), 0);
  if (!(total > 1)) return currentWidths.slice();
  const perOnset = opts?.perOnset ?? 3.2;
  const base = opts?.base ?? 5;
  const minShrink = opts?.minShrinkRatio ?? 0.55;
  const ideals = currentWidths.map((cw, i) => {
    const onsets = Math.max(1, onsetCounts[i] ?? 1);
    const bi = Math.max(0, beginInstrWidths[i] ?? 0);
    const ideal = bi + base + onsets * perOnset;
    return Math.max(ideal, cw * minShrink);
  });
  const idealSum = ideals.reduce((a, b) => a + b, 0);
  if (!(idealSum > 0)) return currentWidths.slice();
  if (idealSum <= total + 0.01) {
    const leftover = total - idealSum;
    const weightSum = onsetCounts.reduce((a, c) => a + Math.max(1, c), 0);
    return ideals.map((ideal, i) => {
      const w = Math.max(1, onsetCounts[i] ?? 1);
      return ideal + leftover * (w / weightSum);
    });
  }
  const scale = total / idealSum;
  return ideals.map((ideal) => ideal * scale);
}

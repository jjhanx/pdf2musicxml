/**
 * onset-column SVG align — 좌표계 혼용·과대 shift 방지.
 * Run: npx tsx _smoke/test_onset_align_shift_guard.ts
 */

const MAX_ONSET_ALIGN_SHIFT_PX = 120;

function wouldAlign(centerXs: number[]): { anchorX: number; shifts: number[] } | null {
  if (centerXs.length < 2) return null;
  const anchorX = Math.min(...centerXs);
  const shifts = centerXs.map((x) => anchorX - x);
  const maxShift = Math.max(...shifts.map(Math.abs));
  if (maxShift > MAX_ONSET_ALIGN_SHIFT_PX) return null;
  return { anchorX, shifts };
}

/** m1 PR: v1 quarter + v2 C6 eighth — voice column ~30px */
const m1 = wouldAlign([280, 312]);
if (!m1 || m1.anchorX !== 280) throw new Error(`m1 voice column align expected anchor 280 got ${JSON.stringify(m1)}`);

/** m17 parallel: ~30px simulated voice offset */
const m17 = wouldAlign([208, 238, 238]);
if (!m17 || m17.anchorX !== 208) throw new Error(`m17 parallel align expected anchor 208 got ${JSON.stringify(m17)}`);

/** OSMD AbsolutePosition(≈3) + SVG pixel(280) 혼용 — align 생략 */
const mixed = wouldAlign([3.5, 280]);
if (mixed !== null) throw new Error('mixed coordinate anchor must skip align');

/** 과대 shift — align 생략 */
const huge = wouldAlign([50, 280]);
if (huge !== null) throw new Error('huge shift must skip align');

console.log('OK onset align shift guard', { m1, m17 });

/**
 * pendingFixesRef must update synchronously when adding a fix,
 * otherwise 「세잇단 적용」직후 auto MXL 반영이 빈 목록을 읽는다.
 */
import { mergeFix, newFixId, type OmrHitlFix } from '../src/omrHitlFixes.ts';

function simulateAddFix(ref: { current: OmrHitlFix[] }, fix: OmrHitlFix): OmrHitlFix[] {
  const prev = ref.current;
  const next = mergeFix(prev, fix);
  if (next === prev) return prev;
  ref.current = next;
  return next;
}

const ref = { current: [] as OmrHitlFix[] };
const triplet: OmrHitlFix = {
  id: newFixId(),
  kind: 'applyTriplet',
  partId: 'P5',
  measureMxl: '7',
  fromNoteIndex: 12,
  toNoteIndex: 14,
  actualNotes: 3,
  normalNotes: 2,
  normalType: '16th',
  staff: 2,
  source: 'manual',
};

simulateAddFix(ref, triplet);
const atApplyTime = ref.current;
if (atApplyTime.length !== 1 || atApplyTime[0]?.kind !== 'applyTriplet') {
  console.error('FAIL: ref not updated synchronously', atApplyTime);
  process.exit(1);
}
if (atApplyTime[0]?.fromNoteIndex !== 12 || atApplyTime[0]?.toNoteIndex !== 14) {
  console.error('FAIL: indices', atApplyTime[0]);
  process.exit(1);
}
console.log('OK sync pendingFixesRef for applyTriplet');

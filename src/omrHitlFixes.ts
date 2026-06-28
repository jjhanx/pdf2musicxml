export function newFixId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      /* secure context 외 HTTP 등 */
    }
  }
  return `fix-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export type OmrHitlFix = {
  id: string;
  kind: string;
  partId: string;
  measureMxl: string;
  detail?: string;
  noteIndex?: number;
  directionIndex?: number;
  staff?: number;
  restType?: string;
  noteType?: string;
  dotCount?: number;
  lineDelta?: number;
  displayStep?: string;
  displayOctave?: number;
  pitchStep?: string;
  pitchOctave?: number;
  pitchAlter?: number;
  stem?: 'up' | 'down';
  tieEnd?: 'start' | 'stop' | 'both';
  fromNoteIndex?: number;
  toNoteIndex?: number;
  afterNoteIndex?: number;
  removeFollowingNote?: boolean;
  articulation?: string;
  actualNotes?: number;
  normalNotes?: number;
  normalType?: string;
  beamNumber?: number;
  fromPitch?: string;
  toPitch?: string;
  source?: string;
  lintCode?: string;
};

export const FIX_KIND_LABEL: Record<string, string> = {
  removeSpuriousDirection: 'P·9 direction 제거',
  removeDirection: 'direction 제거',
  removeTrailingPhantomRest: '마디 끝 쉼표 제거',
  setNoteStaff: '스태프 지정',
  nudgeRestDisplay: '쉼표 줄 이동',
  removeNote: '음·쉼표 삭제',
  removeNoteDot: '점(·) 제거',
  setNoteUndotted: '덧점·점(·) 제거',
  clearRestDots: '쉼표 옆 점(·) 없애기',
  setNotePitch: '음높이 변경',
  setNoteType: '박자(음표 종류) 변경',
  setNoteStem: '줄기 방향 변경',
  removeTie: '이음줄 제거',
  addTie: '이음줄 연결',
  insertRest: '쉼표 추가',
  insertNote: '음표 추가',
  removeArticulation: '표(스타카토 등) 제거',
  applyTriplet: '세잇단(잇단) 적용',
  removeTriplet: '세잇단(잇단) 해제',
  applyBeam: '빔(연결줄) 적용',
  removeBeam: '빔(연결줄) 해제',
};

export function fixDedupeKey(fix: OmrHitlFix): string {
  return [
    fix.kind,
    fix.partId,
    fix.measureMxl,
    fix.noteIndex ?? '',
    fix.directionIndex ?? '',
    fix.detail ?? '',
    fix.staff ?? '',
    fix.lineDelta ?? '',
    fix.noteType ?? '',
    fix.dotCount ?? '',
    fix.pitchStep ?? '',
    fix.pitchOctave ?? '',
    fix.fromNoteIndex ?? '',
    fix.toNoteIndex ?? '',
    fix.afterNoteIndex ?? '',
    fix.tieEnd ?? '',
    fix.articulation ?? '',
    fix.actualNotes ?? '',
    fix.normalNotes ?? '',
    fix.normalType ?? '',
    fix.beamNumber ?? '',
    fix.fromPitch ?? '',
    fix.toPitch ?? '',
  ].join('|');
}

export function mergeFix(fixes: OmrHitlFix[], next: OmrHitlFix): OmrHitlFix[] {
  const key = fixDedupeKey(next);
  if (fixes.some((f) => fixDedupeKey(f) === key)) return fixes;
  return [...fixes, { ...next, id: next.id || newFixId() }];
}

export function formatFixSummary(fix: OmrHitlFix): string {
  const label = FIX_KIND_LABEL[fix.kind] ?? fix.kind;
  const parts = [label, fix.partId, `m.${fix.measureMxl}`];
  if (fix.noteIndex != null) parts.push(`#${fix.noteIndex}`);
  if (fix.directionIndex != null) parts.push(`dir#${fix.directionIndex}`);
  if (fix.fromNoteIndex != null && fix.toNoteIndex != null) {
    parts.push(`${fix.fromNoteIndex}→${fix.toNoteIndex}`);
  }
  return parts.join(' · ');
}

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
  attachedToNoteIndex?: number;
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
  slurEnd?: 'start' | 'stop' | 'both';
  fromNoteIndex?: number;
  toNoteIndex?: number;
  afterNoteIndex?: number;
  leaderNoteIndex?: number;
  toMeasureMxl?: string;
  fromMeasureMxl?: string;
  toPitchStep?: string;
  toPitchOctave?: number;
  toPitchAlter?: number;
  fromPitchStep?: string;
  fromPitchOctave?: number;
  fromPitchAlter?: number;
  removeFollowingNote?: boolean;
  directionType?: 'dynamics' | 'words' | 'rehearsal';
  directionValue?: string;
  placement?: 'above' | 'below';
  tempoBpm?: number;
  beatUnit?: string;
  articulation?: string;
  fermataType?: 'upright' | 'inverted';
  actualNotes?: number;
  normalNotes?: number;
  normalType?: string;
  preserveNoteTypes?: boolean;
  beamNumber?: number;
  beamNoteCount?: number;
  beforeNoteIndex?: number;
  graceSlash?: boolean;
  fromPitch?: string;
  toPitch?: string;
  fromStaff?: number;
  toStaff?: number;
  source?: string;
  lintCode?: string;
};

export const FIX_KIND_LABEL: Record<string, string> = {
  removeSpuriousDirection: 'P·9 direction 제거',
  removeDirection: 'direction 제거',
  insertDirection: 'direction 추가',
  addNoteDirection: '음표 direction 추가',
  removeNoteDirection: '음표 direction 제거',
  setNoteDirection: '음표 direction',
  clearNoteDirection: 'direction 지우기',
  addArticulation: '표(articulation) 추가',
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
  removeTie: '붙임줄 제거',
  addTie: '붙임줄 연결',
  removeSlur: '이음줄 제거',
  addSlur: '이음줄 연결',
  insertRest: '쉼표 추가',
  insertNote: '음표 추가',
  insertGraceNote: '꾸밈음 추가',
  removeGraceBeforeNote: '앞 꾸밈음 삭제',
  repairParallelOnsets: '동시 시작 voice 복원',
  insertChordMember: '화음 음 추가',
  removeArticulation: '표(스타카토 등) 제거',
  addFermata: '늘임표 추가',
  removeFermata: '늘임표 제거',
  applyTriplet: '세잇단(잇단) 적용',
  removeTriplet: '세잇단(잇단) 해제',
  applyBeam: '빔(연결줄) 적용',
  removeBeam: '빔(연결줄) 해제',
  setMeasureTempo: '마디 템포 설정',
  removeMeasureTempo: '마디 템포 삭제',
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
    fix.pitchAlter ?? '',
    fix.fromNoteIndex ?? '',
    fix.toNoteIndex ?? '',
    fix.toMeasureMxl ?? '',
    fix.fromMeasureMxl ?? '',
    fix.toPitchStep ?? '',
    fix.toPitchOctave ?? '',
    fix.toPitchAlter ?? '',
    fix.fromPitchStep ?? '',
    fix.fromPitchOctave ?? '',
    fix.fromPitchAlter ?? '',
    fix.afterNoteIndex ?? '',
    fix.leaderNoteIndex ?? '',
    fix.tieEnd ?? '',
    fix.slurEnd ?? '',
    fix.articulation ?? '',
    fix.fermataType ?? '',
    fix.actualNotes ?? '',
    fix.normalNotes ?? '',
    fix.normalType ?? '',
    fix.preserveNoteTypes ? '1' : '',
    fix.beamNumber ?? '',
    fix.beamNoteCount ?? '',
    fix.beforeNoteIndex ?? '',
    fix.graceSlash === undefined ? '' : fix.graceSlash ? '1' : '0',
    fix.fromPitch ?? '',
    fix.toPitch ?? '',
    fix.fromStaff ?? '',
    fix.toStaff ?? '',
    fix.directionType ?? '',
    fix.directionValue ?? '',
    fix.placement ?? '',
    fix.tempoBpm ?? '',
    fix.beatUnit ?? '',
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
  if (fix.kind === 'setNoteDirection' || fix.kind === 'insertDirection' || fix.kind === 'addNoteDirection' || fix.kind === 'removeNoteDirection') {
    if (fix.noteIndex != null) parts.push(`#${fix.noteIndex}`);
    else if (fix.afterNoteIndex != null && fix.afterNoteIndex < 0) parts.push('마디 앞');
    else if (fix.afterNoteIndex != null) parts.push(`#${fix.afterNoteIndex}`);
    if (fix.staff != null) parts.push(`staff ${fix.staff}`);
    if (fix.directionType) parts.push(fix.directionType);
    if (fix.directionValue?.trim()) parts.push(fix.directionValue.trim());
  }
  if (fix.kind === 'setMeasureTempo' || fix.kind === 'removeMeasureTempo') {
    if (fix.tempoBpm != null) parts.push(`${fix.tempoBpm} BPM`);
    if (fix.beatUnit) parts.push(fix.beatUnit);
  }
  if (fix.fromNoteIndex != null && fix.toNoteIndex != null) {
    parts.push(`${fix.fromNoteIndex}→${fix.toNoteIndex}`);
  }
  return parts.join(' · ');
}

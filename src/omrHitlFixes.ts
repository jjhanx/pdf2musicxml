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
  voice?: string | number;
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
  directionType?: 'dynamics' | 'words' | 'rehearsal' | 'segno' | 'coda' | 'fine' | 'dacapo' | 'dalsegno' | 'tocoda' | 'wedge';
  directionValue?: string;
  placement?: 'above' | 'below';
  defaultY?: number;
  distance?: string;
  ornament?: string;
  /** 진행 제어 — 마디 처음(start) / 마디 끝(end). above/below보다 우선. */
  measureAnchor?: 'start' | 'end';
  tempoBpm?: number;
  beatUnit?: string;
  articulation?: string;
  fermataType?: 'upright' | 'inverted' | string;
  text?: string;
  actualNotes?: number;
  normalNotes?: number;
  normalType?: string;
  preserveNoteTypes?: boolean;
  beamNumber?: number;
  beamNoteCount?: number;
  beforeNoteIndex?: number;
  graceSlash?: boolean;
  graceNotes?: Array<{
    pitchStep: string;
    pitchOctave: number;
    pitchAlter?: number;
    noteType?: string;
    graceSlash?: boolean;
  }>;
  beamGraceNotes?: boolean;
  fromPitch?: string;
  toPitch?: string;
  fromStaff?: number;
  toStaff?: number;
  parallelNoteIndices?: number[];
  playOrder?: number;
  source?: string;
  lintCode?: string;
  fromPartId?: string;
  toPartId?: string;
  toPartIds?: string[];
  clearSource?: boolean;
  splitVoices?: boolean;
  endMeasureMxl?: string;
  clefSign?: 'G' | 'F' | 'C' | string;
  clefLine?: number;
  removeSubsequentClefs?: boolean;
};

export const FIX_KIND_LABEL: Record<string, string> = {
  setMeasureClef: '음자리표 변경',
  setPartClef: '음자리표 변경',
  copyMeasureContent: '마디 파트 복사/이동',
  copyMeasurePart: '마디 파트 복사/이동',
  removeSpuriousDirection: 'P·9 direction 제거',
  removeDirection: 'direction 제거',
  setMeasureDirectionText: '마디 direction 텍스트',
  setDirectionPlacement: 'direction 위/아래',
  setNoteDirectionPlacement: '음표 direction 위/아래',
  insertDirection: 'direction 추가',
  addNoteDirection: '음표 direction 추가',
  removeNoteDirection: '음표 direction 제거',
  setNoteDirection: '음표 direction',
  clearNoteDirection: 'direction 지우기',
  addArticulation: '표(articulation) 추가',
  setArticulationPlacement: '표 위/아래',
  addOrnament: '꾸밈음(ornament) 추가',
  removeOrnament: '꾸밈음(ornament) 제거',
  insertWedge: '셈여림 점선(wedge) 추가',
  moveWedgeStop: 'wedge(stop) 위치',
  removeTrailingPhantomRest: '마디 끝 쉼표 제거',
  setNoteStaff: '스태프 지정',
  setNoteVoice: '성부(Voice) 지정',
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
  setSlurPlacement: '이음줄 위/아래',
  insertRest: '쉼표 추가',
  insertNote: '음표 추가',
  insertGraceNote: '꾸밈음 추가',
  removeGraceBeforeNote: '앞 꾸밈음 삭제',
  repairParallelOnsets: '동시 시작 voice 복원',
  linkParallelOnsets: '동시 시작 묶기',
  setPlayOrder: '연주순번',
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
  insertEmptyMeasureBefore: '빈 마디 삽입(앞)',
  insertEmptyMeasureAfter: '빈 마디 삽입(뒤)',
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
    fix.voice ?? '',
    fix.placement ?? '',
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
    fix.defaultY ?? '',
    fix.distance ?? '',
    fix.ornament ?? '',
    fix.fermataType ?? '',
    fix.actualNotes ?? '',
    fix.normalNotes ?? '',
    fix.normalType ?? '',
    fix.preserveNoteTypes ? '1' : '',
    fix.beamNumber ?? '',
    fix.beamNoteCount ?? '',
    fix.beforeNoteIndex ?? '',
    fix.graceSlash === undefined ? '' : fix.graceSlash ? '1' : '0',
    fix.parallelNoteIndices?.join(',') ?? '',
    fix.playOrder ?? '',
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
  if (next.kind === 'setPlayOrder' && next.noteIndex != null) {
    const mxl = String(next.measureMxl);
    const filtered = fixes.filter(
      (f) =>
        !(
          f.kind === 'setPlayOrder' &&
          f.partId === next.partId &&
          String(f.measureMxl) === mxl &&
          f.noteIndex === next.noteIndex
        ),
    );
    return [...filtered, { ...next, id: next.id || newFixId() }];
  }
  if (next.kind === 'setSlurPlacement' && next.noteIndex != null) {
    const mxl = String(next.measureMxl);
    const slurEnd = next.slurEnd ?? 'both';
    const filtered = fixes.filter(
      (f) =>
        !(
          f.kind === 'setSlurPlacement' &&
          f.partId === next.partId &&
          String(f.measureMxl) === mxl &&
          f.noteIndex === next.noteIndex &&
          (f.slurEnd ?? 'both') === slurEnd
        ),
    );
    return [...filtered, { ...next, id: next.id || newFixId() }];
  }
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
    else if (fix.measureAnchor === 'start') parts.push('마디 처음');
    else if (fix.measureAnchor === 'end') parts.push('마디 끝');
    else if (fix.afterNoteIndex != null && fix.afterNoteIndex < 0) parts.push('마디 앞');
    else if (fix.afterNoteIndex != null) parts.push(`#${fix.afterNoteIndex}`);
    if (fix.staff != null) parts.push(`staff ${fix.staff}`);
    if (fix.directionType) {
      parts.push(
        isNavigationDirectionType(fix.directionType, fix.directionValue)
          ? navigationDirectionLabel(fix.directionType, fix.directionValue)
          : fix.directionType,
      );
    }
    if (fix.directionValue?.trim()) parts.push(fix.directionValue.trim());
  }
  if (fix.kind === 'setMeasureTempo' || fix.kind === 'removeMeasureTempo') {
    if (fix.tempoBpm != null) parts.push(`${fix.tempoBpm} BPM`);
    if (fix.beatUnit) parts.push(fix.beatUnit);
  }
  if (fix.kind === 'insertEmptyMeasureBefore' || fix.kind === 'insertEmptyMeasureAfter') {
    parts.push(fix.kind === 'insertEmptyMeasureBefore' ? '앞' : '뒤');
  }
  if (fix.kind === 'linkParallelOnsets' && fix.parallelNoteIndices?.length) {
    parts.push(`#${fix.parallelNoteIndices.join(',#')}`);
  }
  if (fix.kind === 'setPlayOrder' && fix.playOrder != null) {
    parts.push(`순번 ${fix.playOrder}`);
  }
  if (fix.kind === 'setNoteVoice' && fix.voice != null) {
    parts.push(`voice ${fix.voice}`);
  }
  if (fix.kind === 'insertWedge' || fix.kind === 'moveWedgeStop') {
    if (fix.staff != null) parts.push(`staff ${fix.staff}`);
    if (fix.directionValue) parts.push(fix.directionValue);
    if (fix.kind === 'moveWedgeStop' && (fix.beforeNoteIndex != null || fix.toNoteIndex != null)) {
      parts.push(`끝 #${fix.beforeNoteIndex ?? fix.toNoteIndex} 뒤`);
    }
  }
  if (
    fix.kind === 'addArticulation' ||
    fix.kind === 'setArticulationPlacement' ||
    fix.kind === 'removeArticulation' ||
    fix.kind === 'setDirectionPlacement' ||
    fix.kind === 'setNoteDirectionPlacement' ||
    fix.kind === 'addSlur' ||
    fix.kind === 'setSlurPlacement'
  ) {
    if (fix.articulation) parts.push(articulationDisplayName(fix.articulation));
    if (fix.directionType) parts.push(fix.directionType);
    if (fix.directionValue) parts.push(fix.directionValue);
    if (fix.placement === 'above') parts.push('위');
    if (fix.placement === 'below') parts.push('아래');
    if (fix.distance) parts.push(`거리: ${fix.distance}`);
    else if (fix.defaultY != null) parts.push(`y=${fix.defaultY}`);
  }
  if (fix.kind === 'addOrnament' || fix.kind === 'removeOrnament') {
    if (fix.ornament) parts.push(fix.ornament);
  }
  if (fix.fromNoteIndex != null && fix.toNoteIndex != null) {
    parts.push(`${fix.fromNoteIndex}→${fix.toNoteIndex}`);
  }
  return parts.join(' · ');
}

export const ARTICULATION_DISPLAY_NAMES: Record<string, string> = {
  accent: 'Accent (>)',
  'strong-accent': 'Strong accent (^)',
  staccato: 'Staccato (.)',
  tenuto: 'Tenuto (-)',
  marcato: 'Marcato (^)',
  staccatissimo: 'Staccatissimo (▾)',
  'breath-mark': '숨표 (쉼표 모양 , / Breath mark)',
  caesura: '카에수라 (// / Caesura)',
  'detached-legato': 'Detached legato',
  spiccato: 'Spiccato',
};

export function articulationDisplayName(id: string): string {
  const base = id.split('(')[0].trim().toLowerCase();
  return ARTICULATION_DISPLAY_NAMES[base] ?? id;
}

const NAVIGATION_TAG_LABELS: Record<string, string> = {
  segno: 'Segno',
  coda: 'Coda',
  fine: 'Fine',
  dacapo: 'D.C.',
  dalsegno: 'D.S.',
  tocoda: 'To Coda',
};

export function navigationDirectionLabel(type?: string, value?: string): string {
  const t = (type || '').trim();
  const v = (value || '').trim();
  if (NAVIGATION_TAG_LABELS[t]) {
    // If value is provided and has extra info (not just the type name), append it
    if (v && v !== t && v !== NAVIGATION_TAG_LABELS[t]) {
      return `${NAVIGATION_TAG_LABELS[t]} (${v})`;
    }
    return NAVIGATION_TAG_LABELS[t];
  }
  return (v || t || '').trim();
}

export function isNavigationDirectionType(type?: string, value?: string): boolean {
  const t = (type || '').trim();
  if (t in NAVIGATION_TAG_LABELS) return true;
  if (t === 'words') {
    const v = (value || '').trim();
    return /^(D\.(C|S)\.|To Coda|Fine\b)/i.test(v);
  }
  return false;
}

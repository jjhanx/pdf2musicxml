export type OmrHitlFix = {
  id: string;
  kind: string;
  partId: string;
  measureMxl: string;
  detail?: string;
  noteIndex?: number;
  staff?: number;
  restType?: string;
  lineDelta?: number;
  displayStep?: string;
  displayOctave?: number;
  source?: string;
  lintCode?: string;
};

export type MxlLintIssueForFix = {
  code: string;
  partId?: string;
  measureMxl?: string;
  detail?: string;
  noteIndex?: number;
  suggestedStaff?: number;
  suggestedLineDelta?: number;
};

const ACTIONABLE_LINT = new Set([
  'spuriousDirection',
  'trailingPhantomRest',
  'restMissingStaff',
  'restDisplayHigh',
]);

export function isActionableLintCode(code: string): boolean {
  return ACTIONABLE_LINT.has(code);
}

export function lintIssueToFix(issue: MxlLintIssueForFix): OmrHitlFix | null {
  const partId = issue.partId;
  const measureMxl = issue.measureMxl;
  if (!partId || !measureMxl) return null;
  const base = {
    id: crypto.randomUUID(),
    partId,
    measureMxl: String(measureMxl),
    source: 'lint' as const,
    lintCode: issue.code,
  };
  if (issue.code === 'spuriousDirection') {
    return { ...base, kind: 'removeSpuriousDirection', detail: issue.detail };
  }
  if (issue.code === 'trailingPhantomRest') {
    return {
      ...base,
      kind: 'removeTrailingPhantomRest',
      detail: issue.detail,
      restType: issue.detail,
      noteIndex: issue.noteIndex,
    };
  }
  if (issue.code === 'restMissingStaff') {
    return {
      ...base,
      kind: 'setNoteStaff',
      noteIndex: issue.noteIndex,
      staff: issue.suggestedStaff ?? 2,
    };
  }
  if (issue.code === 'restDisplayHigh') {
    return {
      ...base,
      kind: 'nudgeRestDisplay',
      noteIndex: issue.noteIndex,
      lineDelta: issue.suggestedLineDelta ?? 1,
    };
  }
  return null;
}

export function fixDedupeKey(fix: OmrHitlFix): string {
  return [
    fix.kind,
    fix.partId,
    fix.measureMxl,
    fix.noteIndex ?? '',
    fix.detail ?? '',
    fix.staff ?? '',
    fix.lineDelta ?? '',
  ].join('|');
}

export function mergeFix(fixes: OmrHitlFix[], next: OmrHitlFix): OmrHitlFix[] {
  const key = fixDedupeKey(next);
  if (fixes.some((f) => fixDedupeKey(f) === key)) return fixes;
  return [...fixes, next];
}

export const LINT_CODE_LABEL: Record<string, string> = {
  spuriousDirection: 'P·9 등 제거',
  trailingPhantomRest: '마디 끝 쉼표 제거',
  restMissingStaff: '쉼표 스태프 지정',
  restDisplayHigh: '쉼표 한 줄 아래',
  measureBoundaryOrderSuspect: '마디 경계 순서(수동)',
};

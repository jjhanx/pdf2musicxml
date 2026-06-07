type LintIssueLike = {
  staff?: string;
  partId?: string;
  pageEstimate?: number | string;
};

type ScorePartLike = {
  id?: string;
  index?: number;
};

function labelFromPartToken(token: string, labelsByIndex: string[]): string | undefined {
  const m = /^P(\d+)$/i.exec(token.trim());
  if (!m) return undefined;
  const idx = Number.parseInt(m[1], 10) - 1;
  if (idx >= 0 && idx < labelsByIndex.length) return labelsByIndex[idx];
  return undefined;
}

export function relabelLintIssues<T extends LintIssueLike>(
  issues: T[],
  labelsByIndex: string[],
  parts?: ScorePartLike[],
): T[] {
  if (!labelsByIndex.length || !issues.length) return issues;

  const idToLabel = new Map<string, string>();
  parts?.forEach((p, i) => {
    const id = p.id;
    const idx = typeof p.index === 'number' && Number.isFinite(p.index) ? p.index : i;
    if (id && idx >= 0 && idx < labelsByIndex.length) idToLabel.set(id, labelsByIndex[idx]);
  });

  return issues.map((iss) => {
    let staff = iss.staff;
    if (iss.partId) {
      if (idToLabel.has(iss.partId)) {
        staff = idToLabel.get(iss.partId);
      } else {
        const fromId = labelFromPartToken(iss.partId, labelsByIndex);
        if (fromId) staff = fromId;
      }
    }
    if (typeof staff === 'string' && /^P\d+$/i.test(staff.trim())) {
      const fromToken = labelFromPartToken(staff, labelsByIndex);
      if (fromToken) staff = fromToken;
    }
    return staff !== iss.staff ? { ...iss, staff } : iss;
  });
}

export function relabelLintReport<T extends { issues?: LintIssueLike[] }>(
  report: T,
  labelsByIndex: string[],
  parts?: ScorePartLike[],
): T & {
  partLabelsByIndex?: string[];
  staffOrderHint?: string[];
  staffsInIssues?: string[];
  byPageStaff?: { key: string; count: number }[];
} {
  if (!labelsByIndex.length) return report;
  const issues = relabelLintIssues(report.issues ?? [], labelsByIndex, parts);
  const byPageStaff: Record<string, number> = {};
  for (const iss of issues) {
    const key = `p${iss.pageEstimate ?? 1}:${iss.staff ?? '?'}`;
    byPageStaff[key] = (byPageStaff[key] ?? 0) + 1;
  }
  return {
    ...report,
    issues,
    issueCount: issues.length,
    partLabelsByIndex: labelsByIndex,
    staffOrderHint: labelsByIndex,
    staffsInIssues: [
      ...new Set(issues.map((i) => i.staff).filter((s): s is string => Boolean(s && String(s).trim()))),
    ].sort(),
    byPageStaff: Object.entries(byPageStaff)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, count]) => ({ key, count })),
  };
}

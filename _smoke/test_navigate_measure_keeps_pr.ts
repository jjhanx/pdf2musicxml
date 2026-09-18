/**
 * 벡터 HITL: 마디 이동 시 편집 성부 선택 우선순위.
 * OSMD는 시스템 전체 성부를 보여도, 편집기는 클릭/필터(PR)를 유지해야 함.
 */
import assert from 'node:assert/strict';

function resolveMusicXmlPartFromPreviewId(id: string): {
  partId: string;
  staffWithinPart?: number;
} {
  const trimmed = id.trim();
  if (trimmed.endsWith('__PR')) return { partId: trimmed.slice(0, -4), staffWithinPart: 1 };
  if (trimmed.endsWith('__PL')) return { partId: trimmed.slice(0, -4), staffWithinPart: 2 };
  return { partId: trimmed };
}

function pickEditorPart(opts: {
  clickPartId?: string | null;
  clickStaffWithin?: number | null;
  filterPartId?: string | null;
  filterStaffWithin?: number | null;
  fallbackStaffIndexPartId: string;
}): { partId: string; staffWithinPart: number | null } {
  const fromClick = opts.clickPartId?.trim()
    ? resolveMusicXmlPartFromPreviewId(opts.clickPartId)
    : null;
  const partId =
    fromClick?.partId ||
    opts.filterPartId ||
    opts.fallbackStaffIndexPartId;
  const staffWithinPart =
    fromClick?.staffWithinPart ??
    opts.clickStaffWithin ??
    opts.filterStaffWithin ??
    null;
  return { partId, staffWithinPart };
}

{
  const r = pickEditorPart({
    clickPartId: 'P5__PR',
    fallbackStaffIndexPartId: 'P1',
  });
  assert.equal(r.partId, 'P5');
  assert.equal(r.staffWithinPart, 1);
}

{
  const r = pickEditorPart({
    filterPartId: 'P5',
    filterStaffWithin: 1,
    fallbackStaffIndexPartId: 'P1',
  });
  assert.equal(r.partId, 'P5');
  assert.equal(r.staffWithinPart, 1);
  assert.notEqual(r.partId, 'P1');
}

{
  const r = pickEditorPart({
    fallbackStaffIndexPartId: 'P1',
  });
  assert.equal(r.partId, 'P1');
}

console.log('test_navigate_measure_keeps_pr: OK');

/**
 * 회귀: OMR HITL 검토 결과(review.mxl)가 최종 주입·출력 대상 MXL에 반영되는지.
 *
 * 증상: omr-work.zip을 불러와 고친 뒤 가사와 병합하면, 고치기 전(가져온 시점) MXL로 병합되던 문제.
 * 원인: 편집·ZIP 불러오기는 세션 canonical(review.mxl)만 갱신하는데,
 *       가사 주입·다운로드는 별도 출력 MXL(preInjectMxlPaths[0])을 사용했다.
 *
 * 실행: node _smoke/test_hitl_review_mxl_propagation.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  planHitlResultPropagation,
  shouldRestoreOmrScoreFromRaw,
} from '../shared/omrHitlScoreSync.ts';

const samePath = (a, b) => path.resolve(a) === path.resolve(b);

// 1) canonical(review.mxl)이 있으면 대표 대상에 복사, 나머지는 종전대로 보정 적용
{
  const steps = planHitlResultPropagation({
    injectTargets: ['/out/score.mxl', '/out/score-2.mxl'],
    canonicalReviewPath: '/session/review.mxl',
    samePath,
  });
  assert.deepEqual(steps[0], {
    kind: 'copy-canonical',
    from: '/session/review.mxl',
    to: '/out/score.mxl',
  });
  assert.deepEqual(steps[1], { kind: 'apply-pending-fixes', target: '/out/score-2.mxl' });
}

// 2) canonical이 없으면(검토 편집 파일 없음) 기존 동작 유지
{
  const steps = planHitlResultPropagation({
    injectTargets: ['/out/score.mxl'],
    canonicalReviewPath: null,
    samePath,
  });
  assert.deepEqual(steps, [{ kind: 'apply-pending-fixes', target: '/out/score.mxl' }]);
}

// 3) 대표 대상이 canonical 자신이면 자기 복사 없음
{
  const steps = planHitlResultPropagation({
    injectTargets: ['/session/review.mxl'],
    canonicalReviewPath: '/session/./review.mxl',
    samePath,
  });
  assert.deepEqual(steps, [{ kind: 'apply-pending-fixes', target: '/session/review.mxl' }]);
}

// 4) 실제 파일로 전파 재현 — 병합 대상이 "마지막 교정본" 내용이 되어야 한다
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hitl-propagate-'));
  const canonical = path.join(dir, 'review.mxl');
  const injectTarget = path.join(dir, 'out', 'score.mxl');
  fs.mkdirSync(path.dirname(injectTarget), { recursive: true });
  fs.writeFileSync(injectTarget, 'ZIP-IMPORT-STATE');
  fs.writeFileSync(canonical, 'HITL-EDITED-STATE');

  for (const step of planHitlResultPropagation({
    injectTargets: [injectTarget],
    canonicalReviewPath: canonical,
    samePath,
  })) {
    if (step.kind === 'copy-canonical') fs.copyFileSync(step.from, step.to);
  }
  assert.equal(fs.readFileSync(injectTarget, 'utf8'), 'HITL-EDITED-STATE');
  fs.rmSync(dir, { recursive: true, force: true });
}

// 5) raw 롤백 규칙 — 교정이 담긴 baseline은 되돌리지 않는다
{
  const base = { totalHitlApplied: 0, baselineOwnsEdits: false, pendingFixCount: 0, hasRawBackup: true };
  assert.equal(shouldRestoreOmrScoreFromRaw(base), true, '교정 없는 baseline은 raw로 정리');
  assert.equal(
    shouldRestoreOmrScoreFromRaw({ ...base, baselineOwnsEdits: true }),
    false,
    '자동 정리·수동 편집본이 담긴 baseline은 유지',
  );
  assert.equal(
    shouldRestoreOmrScoreFromRaw({ ...base, totalHitlApplied: 3 }),
    false,
    '이미 적용된 HITL 보정이 있으면 유지',
  );
  assert.equal(
    shouldRestoreOmrScoreFromRaw({ ...base, pendingFixCount: 1 }),
    false,
    '대기 중 보정이 있으면 롤백 대상 아님',
  );
  assert.equal(
    shouldRestoreOmrScoreFromRaw({ ...base, hasRawBackup: false }),
    false,
    'raw 백업이 없으면 롤백 불가',
  );
}

console.log('OK: HITL 교정본이 최종 주입 대상 MXL에 반영됨');

/**
 * OMR HITL 검토가 끝났을 때, 세션 canonical 교정본(`review.mxl`)을
 * 최종 주입·출력 대상 MXL에 어떻게 반영할지 정하는 규칙.
 *
 * 편집 UI(마디 편집·자동 정리·작업 ZIP 불러오기)는 항상 canonical 파일 하나만 갱신하므로,
 * 검토 종료 시 canonical을 대표 대상(파이프라인이 가사 주입·다운로드에 쓰는 첫 MXL)에 복사해야
 * 병합 결과가 마지막 교정본과 일치한다. 곡·마디에 의존하지 않는 일반 규칙이다.
 */
export type HitlPropagationStep =
  | { kind: 'copy-canonical'; from: string; to: string }
  | { kind: 'apply-pending-fixes'; target: string };

/**
 * 검토 재동기화 시 `audiveris_raw.mxl`로 되돌릴지 판단.
 *
 * raw 롤백은 "사용자 교정이 하나도 없는 baseline"의 후처리 오염을 지우기 위한 것이다.
 * HITL 보정·자동 정리·외부 수동 편집본이 baseline에 담긴 뒤에는 되돌리면 안 된다
 * (되돌리면 최종 병합이 교정 전 악보를 쓰게 된다).
 */
export function shouldRestoreOmrScoreFromRaw(opts: {
  totalHitlApplied: number;
  baselineOwnsEdits: boolean;
  pendingFixCount: number;
  hasRawBackup: boolean;
}): boolean {
  return (
    opts.hasRawBackup &&
    opts.pendingFixCount === 0 &&
    opts.totalHitlApplied === 0 &&
    !opts.baselineOwnsEdits
  );
}

export function planHitlResultPropagation(opts: {
  /** 파이프라인이 가사 주입·최종 출력에 사용하는 MXL 경로들(첫 항목이 대표) */
  injectTargets: string[];
  /** 세션 canonical 교정본 경로 — 없으면(검토 중 편집 파일이 없으면) null */
  canonicalReviewPath: string | null;
  /** 경로 동일성 비교(서버는 path.resolve 사용) */
  samePath?: (a: string, b: string) => boolean;
}): HitlPropagationStep[] {
  const same = opts.samePath ?? ((a: string, b: string) => a === b);
  const targets = opts.injectTargets.filter((p) => typeof p === 'string' && p.length > 0);
  const canonical = opts.canonicalReviewPath;
  return targets.map((target, idx) => {
    if (canonical && idx === 0 && !same(target, canonical)) {
      return { kind: 'copy-canonical', from: canonical, to: target } as const;
    }
    return { kind: 'apply-pending-fixes', target } as const;
  });
}

/**
 * OSMD 미리보기 — 시스템 가중치로 배분한 마디 content [left,right] (px).
 * onset align이 쓰고, contain/clip이 Softmax 바로 다시 뭉개지 않게 공유.
 */
export type OsmdPreviewMeasureExtent = {
  leftEdge: number;
  rightEdge: number;
  /** 마디 g.vf-measure 전체를 옮긴 양(px). */
  measureShiftPx: number;
};

const extentsByOsmd = new WeakMap<object, Map<number, OsmdPreviewMeasureExtent>>();

export function setOsmdPreviewAllocatedExtents(
  osmd: object,
  extents: Map<number, OsmdPreviewMeasureExtent>,
): void {
  extentsByOsmd.set(osmd, extents);
}

export function getOsmdPreviewAllocatedExtent(
  osmd: object,
  measureNumber: number,
): OsmdPreviewMeasureExtent | null {
  return extentsByOsmd.get(osmd)?.get(measureNumber) ?? null;
}

export function getOsmdPreviewAllocatedExtents(
  osmd: object,
): Map<number, OsmdPreviewMeasureExtent> | null {
  return extentsByOsmd.get(osmd) ?? null;
}

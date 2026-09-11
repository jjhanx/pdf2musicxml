/**
 * HITL·MusicXML dynamics 태그 — UI 풀다운·승격·적용 공통.
 * MusicXML 4.0 dynamics 요소명과 `scripts/omr_hitl_lib._DYNAMICS_TAGS`와 동일 집합.
 */
export const HITL_DYNAMICS_DIRECTION_VALUES = [
  'pppp',
  'ppp',
  'pp',
  'p',
  'mp',
  'mf',
  'f',
  'ff',
  'fff',
  'ffff',
  'n',
  'fp',
  'pf',
  'sf',
  'sfz',
  'fz',
  'rf',
  'sfp',
  'sfpp',
  'sffz',
] as const;

export type HitlDynamicsDirectionValue = (typeof HITL_DYNAMICS_DIRECTION_VALUES)[number];

export const HITL_DYNAMICS_TAG_NAMES = new Set<string>(HITL_DYNAMICS_DIRECTION_VALUES);

export function isHitlDynamicsTag(tag: string): boolean {
  return HITL_DYNAMICS_TAG_NAMES.has(tag.trim().toLowerCase());
}

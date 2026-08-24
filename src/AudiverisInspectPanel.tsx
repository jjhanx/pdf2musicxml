import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import {
  realignMeasureDefaultXFromTimelineForOsmd,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  leadingDirectionsBeforeNote,
  trailingDirectionsAfterNoteGroup,
  reanchorWedgeStopsForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup';
import {
  drawOsmdMeasureHighlight,
  drawOsmdMeasureHover,
  hitTestOsmdMeasure,
  installMeasureClickOverlays,
  type OsmdMeasureClickInfo,
  removeMeasureClickOverlays,
  removeMeasureHover,
  scrollOsmdMeasureIntoView,
} from './osmdMeasureClick';
import { installOsmdPartLabelOverlay, removeOsmdPartLabelOverlay } from './osmdPartLabelOverlay';
import { retargetGraphicalChordSlurBeziers } from './osmdChordSlurFix';
import {
  applyOsmdArticulationOffsets,
  registerOsmdPreviewXmlForArticulation,
} from './osmdArticulationOffsetFix';
import { alignOsmdPreviewNotesByOnsetColumn, registerOsmdPreviewXmlForAlign } from './osmdOnsetColumnAlignFix';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse';
import { repairMissingNoteTypesForOsmdPreview, repairRestDisplayForOsmdPreview } from '../shared/musicXmlRestDisplay';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd';
import { normalizeTiePlacementsForOsmdPreview } from '../shared/musicXmlTiePlacement';
import {
  removeDanglingTimelineElementsForOsmdPreview,
  repairTimelineForOsmdPreview,
  stripPageBreakPrintForOsmdPreview,
  stripDefaultXyKeepLayoutAttrsForOsmdPreview,
  stripArticulationDefaultYForOsmdPreview,
  prepareArticulationDefaultYForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup';
import {
  repositionDirectionsBeforeAttributesForOsmdPreview,
  ensureMetronomeOnSoundTempoDirectionsForOsmdPreview,
  normalizeDynamicsAndWedgesForOsmdPreview,
  measureHeaderInsertIndex,
  directionHasTempo,
} from '../shared/musicXmlDirectionPlacement';
import {
  enforceOsmdPreviewMeasureNumberRules,
  finalizeOsmdMeasureNumberPreview,
  patchOsmdRenderForMeasureNumbers,
  uninstallOsmdMeasureNumberSuppressObserver,
} from './osmdMeasureNumberSuppress';

type InspectErrorBoundaryProps = {
  children: ReactNode;
  onBack?: () => void;
};

type InspectErrorBoundaryState = {
  error: Error | null;
  copied?: boolean;
};

/** OMR·HITL 미리보기 — 이음줄·성부 라벨 등 OSMD 규칙 조정 */
export function applyOsmdPreviewEngravingRules(
  rules: OpenSheetMusicDisplay['EngravingRules'],
): void {
  rules.TupletNumberLimitConsecutiveRepetitions = false;
  rules.TupletNumberAlwaysDisableAfterFirstMax = false;
  rules.SlurPlacementFromXML = true;
  rules.SlurPlacementAtStems = true;
  rules.SlurPlacementUseSkyBottomLine = false;
  // 오선 사이 간격을 충분히 확보하여 이음줄·가사가 위아래 오선과 겹치거나 잘리지 않도록 함
  rules.BetweenStaffDistance = Math.max(rules.BetweenStaffDistance || 5.5, 8.0);
  rules.StaffDistance = Math.max(rules.StaffDistance || 6.5, 8.5);
  (rules as unknown as { MinStaffDistance?: number }).MinStaffDistance = Math.max(
    (rules as unknown as { MinStaffDistance?: number }).MinStaffDistance || 5.0,
    7.0,
  );
  // 성부 라벨은 installOsmdPartLabelOverlay(HTML)로 모든 system에 그림 — OSMD SVG 라벨은 z-order·Y 어긋남
  rules.RenderPartNames = false;
  rules.RenderPartAbbreviations = false;
  rules.RenderSystemLabelsAfterFirstPage = false;
  // OSMD 기본 줄머리 번호는 measure@number+layout으로 전부 그려짐 — PDF 인쇄 번호만 HTML 오버레이
  rules.RenderMeasureNumbers = false;
  rules.RenderMeasureNumbersOnlyAtSystemStart = false;
  rules.UseXMLMeasureNumbers = false;
  // OSMD 기본은 연속 온쉼 마디를 다중쉼표(오선 중 굵은 선+숫자)로 접음.
  // OMR 검토는 PDF와 마디 1:1 — load() 전에 끔. 저장 MXL은 변경하지 않음.
  const r = rules as OpenSheetMusicDisplay['EngravingRules'] & {
    DisplacedNoteMargin?: number;
    VoiceSpacingAddendVexflow?: number;
    RepetitionEndInstructionXShiftAsPercentOfStaveWidth?: number;
    RenderMultipleRestMeasures?: boolean;
    AutoGenerateMultipleRestMeasuresFromRestMeasures?: boolean;
  };
  r.RenderMultipleRestMeasures = false;
  r.AutoGenerateMultipleRestMeasuresFromRestMeasures = false;
  if (typeof r.DisplacedNoteMargin === 'number') r.DisplacedNoteMargin = 0.05;
  if (typeof r.VoiceSpacingAddendVexflow === 'number') r.VoiceSpacingAddendVexflow = 2.0;
  // 셈여림표(p, f, mf 등) 및 쐐기형 기호(crescendo, diminuendo)의 오선 이격 거리 충분히 확보
  rules.DynamicExpressionSpacer = 3.0;
  rules.WedgePlacementAboveY = -5.5;
  rules.WedgePlacementBelowY = 3.5;
  rules.WedgeVerticalMargin = 2.5;
  // 슬러 끝점 아티큘레이션 및 이음줄 간격 여백 확보
  rules.SlurEndArticulationYOffset = 2.4;
  rules.SlurStartArticulationYOffsetOfArticulation = 2.4;
  rules.SlurNoteHeadYOffset = 0.2;
  // OSMD 기본 0.4는 줄 끝 마디의 D.S./Fine를 오른쪽으로 밀어 다음 마디 앞으로 보이게 함
  if (typeof r.RepetitionEndInstructionXShiftAsPercentOfStaveWidth === 'number') {
    r.RepetitionEndInstructionXShiftAsPercentOfStaveWidth = 0;
  }
}

/** OSMD·레이아웃 예외가 나도 모달 전체가 검은 빈 화면으로 보이지 않게 함 */
export class InspectPanelErrorBoundary extends Component<
  InspectErrorBoundaryProps,
  InspectErrorBoundaryState
> {
  state: InspectErrorBoundaryState = { error: null, copied: false };

  static getDerivedStateFromError(error: Error): InspectErrorBoundaryState {
    return { error, copied: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[inspect-panel]', error, info.componentStack);
  }

  handleCopyError = () => {
    if (!this.state.error) return;
    const msg = this.state.error.stack || this.state.error.message;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(msg).then(() => {
        this.setState({ copied: true });
        setTimeout(() => this.setState({ copied: false }), 2000);
      }).catch(() => {});
    } else {
      const ta = document.createElement('textarea');
      ta.value = msg;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    }
  };

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: '1rem 1.1rem',
            borderRadius: 8,
            background: '#3a1f1f',
            border: '1px solid #8b3a3a',
            color: '#f28b82',
            lineHeight: 1.5,
            fontSize: '0.9rem',
          }}
        >
          <p style={{ margin: '0 0 8px', fontWeight: 600 }}>
            마스킹·인식 점검 화면을 표시하지 못했습니다.
          </p>
          <p style={{ margin: '0 0 10px', color: '#e8eaed' }}>
            아래 「보정·이어하기」로 돌아가거나, 작업 목록에서 점검을 다시 열어 보세요. PNG 비교만 필요하면
            브라우저에서 <code>/api/diagnostic/…/page/1/png?source=original</code> URL을 직접 열 수 있습니다.
          </p>
          <pre
            style={{
              margin: '0 0 12px',
              padding: 8,
              background: '#1a1d24',
              borderRadius: 6,
              fontSize: '0.78rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: '#f28b82',
            }}
          >
            {this.state.error.message}
          </pre>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px' }}>
            <button
              type="button"
              onClick={this.handleCopyError}
              style={{
                padding: '6px 12px',
                background: '#4a2525',
                color: '#fff',
                border: '1px solid #8b3a3a',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: 'bold',
              }}
            >
              {this.state.copied ? '✓ 복사됨!' : '에러 메시지 복사'}
            </button>
            {this.props.onBack ? (
              <button
                type="button"
                onClick={this.props.onBack}
                style={{
                  padding: '6px 12px',
                  background: '#2a2d34',
                  color: '#fff',
                  border: '1px solid #555',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                보정·이어하기로 돌아가기
              </button>
            ) : null}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export type InspectSummary = {
  jobId: string;
  status: string;
  originalName: string;
  pipelineMode?: string;
  originalPdf: { exists: boolean; pageCount: number | null };
  maskedPdf: { exists: boolean; pageCount: number | null };
  cleanScorePdf?: { exists: boolean; pageCount: number | null };
  audiverisInputPdf?: 'clean_score' | 'masked' | 'original' | null;
  lyricManifestStats?: Record<string, unknown>;
  pageCountForUi: number;
  pageCountsMatch: boolean;
  scoreMusicXmlAvailable: boolean;
};

export function parseScoreParts(xml: string): { id: string; name: string }[] {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) return [];
    const nodes = doc.querySelectorAll('part-list > score-part, part-list > *|score-part');
    const out: { id: string; name: string }[] = [];
    nodes.forEach((sp) => {
      const id = sp.getAttribute('id');
      if (!id) return;
      const pn = sp.querySelector('part-name');
      const name = pn?.textContent?.trim() || id;
      out.push({ id, name });
    });
    return out;
  } catch {
    return [];
  }
}

export function filterMusicXmlToPart(xml: string, partId: string | null): string {
  if (!partId) return xml;
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) return xml;
    const root = doc.documentElement;
    const rootName = root.localName || root.tagName.replace(/^.*:/, '');
    if (rootName !== 'score-partwise') return xml;
    const partList = root.querySelector('part-list, *|part-list');
    if (!partList) return xml;
    partList.querySelectorAll(':scope > score-part, :scope > *|score-part').forEach((n) => {
      if (n.getAttribute('id') !== partId) n.remove();
    });
    for (const el of Array.from(root.children)) {
      const tag = el.localName || el.tagName.replace(/^.*:/, '');
      if (tag === 'part' && el.getAttribute('id') !== partId) el.remove();
    }
    return new XMLSerializer().serializeToString(doc);
  } catch {
    return xml;
  }
}

const xmlLocalName = (el: Element) =>
  typeof el.localName === 'string' ? el.localName.toLowerCase() : String(el.tagName).toLowerCase().replace(/^.*:/, '');

/** MusicXML part의 `<staves>`·`<staff>` 태그로 줄 수 추정 (피아노 PR/PL 분리용). */
export function staveCountForPart(xml: string, partId: string): number {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) return 1;
    const part = [...doc.querySelectorAll('part, *|part')].find((el) => el.getAttribute('id') === partId);
    if (!part) return 1;
    let max = 1;
    part.querySelectorAll('staves, *|staves').forEach((el) => {
      const n = parseInt(el.textContent?.trim() ?? '1', 10);
      if (Number.isFinite(n) && n > max) max = n;
    });
    part.querySelectorAll('note staff, note *|staff').forEach((el) => {
      const n = parseInt(el.textContent?.trim() ?? '1', 10);
      if (Number.isFinite(n) && n > max) max = n;
    });
    return max;
  } catch {
    return 1;
  }
}

export type StaffFilterEntry = {
  label: string;
  partId: string;
  /** 같은 part id가 여러 줄(피아노)일 때 1=윗줄(PR), 2=아랫줄(PL) … */
  staffWithinPart?: number;
};

export type ScorePartForPreview = {
  id: string;
  suggestedLabel: string;
  /** part_labels.json 등 사용자 확정 라벨 — 미리보기·필터에 우선 */
  displayLabel?: string;
};

/** 성부 필터 버튼 — 피아노 `P`는 2줄이면 PR·PL로 분리. */
export function buildStaffFilterEntries(
  scoreParts: ScorePartForPreview[],
  xml: string | null,
): StaffFilterEntry[] {
  const out: StaffFilterEntry[] = [];
  for (const p of scoreParts) {
    const label = (p.displayLabel || p.suggestedLabel || p.id).trim();
    const staves = xml ? staveCountForPart(xml, p.id) : 1;
    if (label === 'P' && staves >= 2) {
      out.push({ label: 'PR', partId: p.id, staffWithinPart: 1 });
      out.push({ label: 'PL', partId: p.id, staffWithinPart: 2 });
    } else {
      out.push({ label, partId: p.id });
    }
  }
  return out;
}

function flattenNameElement(el: Element, text: string): void {
  while (el.firstChild) el.removeChild(el.firstChild);
  el.textContent = text;
}

/** score-part의 part-name·instrument-name 등 OSMD가 읽는 표시명을 통일. */
function applyLabelToScorePart(sp: Element, label: string): void {
  const abbrev = label.length <= 4 ? label : label.slice(0, 4);
  let pn = sp.querySelector('part-name, *|part-name');
  if (!pn) {
    pn = sp.ownerDocument!.createElementNS(sp.namespaceURI, 'part-name');
    sp.insertBefore(pn, sp.firstChild);
  }
  flattenNameElement(pn, label);

  const pa = sp.querySelector('part-abbreviation, *|part-abbreviation');
  if (!pa) {
    const created = sp.ownerDocument!.createElementNS(sp.namespaceURI, 'part-abbreviation');
    sp.insertBefore(created, pn.nextSibling);
    flattenNameElement(created, abbrev);
  } else {
    flattenNameElement(pa, abbrev);
  }

  sp.querySelectorAll('instrument-name, *|instrument-name').forEach((el) => {
    el.textContent = label;
  });
  sp.querySelectorAll(
    'part-name display-text, part-name *|display-text, part-abbreviation display-text, part-abbreviation *|display-text',
  ).forEach((el) => {
    el.textContent = label;
  });
}

/** OSMD 미리보기: Audiveris Voice/Piano 등을 사용자 라벨(S/A/T/B/PR/PL)로 교체. */
export function applyPartLabelsToMusicXml(xml: string, scoreParts: ScorePartForPreview[]): string {
  if (!scoreParts.length) return xml;
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) return xml;
    const byId = new Map(
      scoreParts.map((p) => [p.id, (p.displayLabel || p.suggestedLabel || p.id).trim()]),
    );
    doc.querySelectorAll('part-list score-part, part-list *|score-part').forEach((sp) => {
      const id = sp.getAttribute('id');
      if (!id) return;
      const label = byId.get(id);
      if (!label) return;
      applyLabelToScorePart(sp, label);
    });
    return new XMLSerializer().serializeToString(doc);
  } catch {
    return xml;
  }
}

function setPartDisplayName(xml: string, partId: string, displayName: string): string {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) return xml;
    const sp = [...doc.querySelectorAll('part-list score-part, part-list *|score-part')].find(
      (el) => el.getAttribute('id') === partId,
    );
    if (!sp) return xml;
    applyLabelToScorePart(sp, displayName);
    return new XMLSerializer().serializeToString(doc);
  } catch {
    return xml;
  }
}

function noteStaffN(noteEl: Element): number {
  const staffEl = noteEl.querySelector(':scope > staff, :scope > *|staff');
  if (!staffEl) return 1;
  const n = parseInt(staffEl.textContent?.trim() ?? '1', 10);
  return Number.isFinite(n) ? n : 1;
}


function maxStavesInPart(part: Element): number {
  let max = 1;
  for (const measure of [...part.children]) {
    if (xmlLocalName(measure) !== 'measure') continue;
    measure.querySelectorAll('attributes staves, attributes *|staves').forEach((el) => {
      const n = parseInt(el.textContent?.trim() ?? '1', 10);
      if (Number.isFinite(n) && n > max) max = n;
    });
    measure.querySelectorAll('note staff, note *|staff').forEach((el) => {
      const n = parseInt(el.textContent?.trim() ?? '1', 10);
      if (Number.isFinite(n) && n > max) max = n;
    });
  }
  return max;
}





function forceStaffTagOnDirectionToOne(dir: Element): void {
  let staffEl = dir.querySelector(':scope > staff, :scope > *|staff');
  if (!staffEl) {
    staffEl = dir.ownerDocument!.createElementNS(dir.namespaceURI || 'http://www.musicxml.org/xsd/MusicXML', 'staff');
    dir.appendChild(staffEl);
  }
  staffEl.textContent = '1';
}

/**
 * OSMD는 ritard./accel. 등을 ContinuousTempo로 보고 **시스템 최상단 줄에만** 그림.
 * PL·PR 등 하위 줄 텍스트가 안 보이거나 S로 붙는 것을 막기 위해 ZWSP로 키워드 매칭을 깨뜨림(미리보기 전용).
 */
function defeatOsmdTempoKeywordMatchingOnDirectionWords(dir: Element): void {
  const words = dir.querySelectorAll(
    ':scope > direction-type > words, :scope > *|direction-type > *|words',
  );
  words.forEach((w) => {
    if (!w.textContent) return;
    w.textContent = w.textContent.replace(/([a-zA-Z]+)/g, (m) => m[0] + '\u200B' + m.slice(1));
  });
}

/**
 * PR/PL·staff 분리 후 direction 유지.
 * **음표 staff를 1로 바꾸기 전에** 호출해야 함 — 바꾸면 staffN=2 대조가 실패해 PL words(ritard. 등)가 삭제됨.
 */
function directionWedgeType(dir: Element): string | null {
  for (const dt of [...dir.children].filter((c) => xmlLocalName(c) === 'direction-type')) {
    for (const w of [...dt.children].filter((c) => xmlLocalName(c) === 'wedge')) {
      const t = (w.getAttribute('type') || '').trim().toLowerCase();
      if (t) return t;
    }
  }
  return null;
}

function reattachDirectionsForSingleStaffOsmdPreview(measure: Element, staffN: number): void {
  reanchorWedgeStopsForOsmdPreview(measure, staffN);
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) !== 'direction') continue;
    if (isNavigationDirectionElement(child)) {
      // 진행 제어는 마디 처음/끝 위치 유지 — 음표에 끌어붙이거나 삭제하지 않음
      const staffEl = child.querySelector(':scope > staff, :scope > *|staff');
      const dStaff = staffEl?.textContent?.trim() ? parseInt(staffEl.textContent.trim(), 10) : staffN;
      if (dStaff !== staffN) {
        child.remove();
        continue;
      }
      continue;
    }
    if (directionHasTempo(child)) {
      // 템포는 마디 header(print·attributes 뒤)에 유지 — anchor 음표 없어도 삭제하지 않음
      continue;
    }
    syncWedgeDirectionVoiceFromNeighbor(measure, child);
    const dirStaffEl = child.querySelector(':scope > staff, :scope > *|staff');
    if (dirStaffEl?.textContent?.trim()) {
      const dStaff = parseInt(dirStaffEl.textContent.trim(), 10);
      if (Number.isFinite(dStaff) && dStaff !== staffN) {
        child.remove();
        continue;
      }
    }
    if (directionWedgeType(child) === 'stop') {
      continue;
    }
    const anchor = anchorNoteForDirection(measure, child);
    if (!anchor) {
      child.remove();
      continue;
    }
    // 단일 staff로 이미 필터된 뒤 note staff 태그가 없으면 staffN 불일치로 지우지 않음
    const anchorStaffEl = anchor.querySelector(':scope > staff, :scope > *|staff');
    if (anchorStaffEl?.textContent?.trim()) {
      const aStaff = parseInt(anchorStaffEl.textContent.trim(), 10);
      if (Number.isFinite(aStaff) && aStaff !== staffN) {
        child.remove();
        continue;
      }
    }
    ensureDirectionBeforeAnchor(measure, child, anchor);
  }
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) !== 'direction') continue;
    defeatOsmdTempoKeywordMatchingOnDirectionWords(child);
    forceStaffTagOnDirectionToOne(child);
  }
}

/** wedge start/stop voice를 backup을 넘지 않는 인접 음에 맞춤 (stop이 voice1로 붙어 OSMD 소실 방지). */
function syncWedgeDirectionVoiceFromNeighbor(measure: Element, dir: Element): void {
  const wt = directionWedgeType(dir);
  if (!wt) return;
  const children = [...measure.children];
  const idx = children.indexOf(dir);
  if (idx < 0) return;
  let note: Element | null = null;
  if (wt === 'stop') {
    for (let j = idx - 1; j >= 0; j -= 1) {
      const c = children[j]!;
      const tag = xmlLocalName(c);
      if (tag === 'backup') break;
      if (tag !== 'note') continue;
      if (c.querySelector(':scope > chord, :scope > *|chord')) continue;
      note = c;
      break;
    }
  } else {
    for (let j = idx + 1; j < children.length; j += 1) {
      const c = children[j]!;
      const tag = xmlLocalName(c);
      if (tag === 'backup') break;
      if (tag !== 'note') continue;
      if (c.querySelector(':scope > chord, :scope > *|chord')) continue;
      note = c;
      break;
    }
  }
  if (note) attachVoiceFromNote(dir, note);
}

function findXmlParts(doc: Document): Element[] {
  const out: Element[] = [];
  const root = doc.documentElement;
  if (!root) return out;
  const walk = (el: Element) => {
    if (xmlLocalName(el) === 'part') out.push(el);
    for (const c of [...el.children]) walk(c);
  };
  walk(root);
  return out;
}

/** grand staff split 시 다른 staff 전용 clef만 제거 — clef 추가·교체·복제 없음. */
function stripForeignStaffClefsInAttributes(attrs: Element, staffN: number): void {
  for (const clef of [...attrs.children].filter((c) => xmlLocalName(c) === 'clef')) {
    const numAttr = clef.getAttribute('number');
    if (!numAttr) {
      if (staffN !== 1) clef.remove();
      continue;
    }
    const num = parseInt(numAttr, 10);
    if (Number.isFinite(num) && num !== staffN) clef.remove();
  }
}

/** grand staff split 시 다른 staff 전용 `<key number>` 제거·대상 staff는 number 속성 제거. */
function stripForeignStaffKeysInAttributes(attrs: Element, staffN: number): void {
  for (const key of [...attrs.children].filter((c) => xmlLocalName(c) === 'key')) {
    const numAttr = key.getAttribute('number');
    if (!numAttr) continue;
    const num = parseInt(numAttr, 10);
    if (!Number.isFinite(num) || num !== staffN) {
      key.remove();
      continue;
    }
    key.removeAttribute('number');
  }
}

/** 단일 staff part로 쪼갠 뒤 OSMD가 1줄로 그리도록 attributes 정리(staves·clef number). */
function normalizeAttributesForSingleStaffPart(attrs: Element, staffN: number): void {
  let stavesEl = [...attrs.children].find((c) => xmlLocalName(c) === 'staves');
  if (!stavesEl) {
    stavesEl = attrs.ownerDocument!.createElementNS(
      attrs.namespaceURI || 'http://www.musicxml.org/xsd/MusicXML',
      'staves',
    );
    attrs.insertBefore(stavesEl, attrs.firstChild);
  }
  stavesEl.textContent = '1';
  stripForeignStaffClefsInAttributes(attrs, staffN);
  stripForeignStaffKeysInAttributes(attrs, staffN);
  for (const clef of [...attrs.children].filter((c) => xmlLocalName(c) === 'clef')) {
    if (clef.getAttribute('number')) clef.setAttribute('number', '1');
  }
}

function noteDurationN(note: Element): number {
  const d = note.querySelector(':scope > duration, :scope > *|duration');
  const n = parseInt(d?.textContent?.trim() ?? '0', 10);
  return Number.isFinite(n) ? n : 0;
}

function noteVoiceN(note: Element): string {
  const v = note.querySelector(':scope > voice, :scope > *|voice');
  const text = v?.textContent?.trim();
  return text || '1';
}

function isChordNote(note: Element): boolean {
  return note.querySelector(':scope > chord, :scope > *|chord') != null;
}

function timelineDurationEl(el: Element): number {
  const d = el.querySelector(':scope > duration, :scope > *|duration');
  const n = parseInt(d?.textContent?.trim() ?? '0', 10);
  return Number.isFinite(n) ? n : 0;
}

type StaffTimedNote = { note: Element; time: number; voice: string; end: number };

function timelineVoiceN(el: Element, fallbackVoice: string): string {
  const v = el.querySelector(':scope > voice, :scope > *|voice');
  const text = v?.textContent?.trim();
  return text || fallbackVoice;
}

/** voice별 cursor — backup(voice 없음)은 직전 note voice에만 적용(MusicXML·HITL 삽입 후 stale backup 대응).
 * voice 없는 forward는 **다음 음표 성부**에 적용(backup 뒤 멜로디 onset). */
function staffTimedNotesInMeasure(measure: Element): StaffTimedNote[] {
  const children = [...measure.children];
  const voiceCursor = new Map<string, number>();
  let lastNoteVoice = '1';
  const out: StaffTimedNote[] = [];
  const nextNoteVoice = (fromIdx: number): string => {
    for (let j = fromIdx + 1; j < children.length; j += 1) {
      const c = children[j]!;
      if (xmlLocalName(c) !== 'note') continue;
      if (isChordNote(c)) continue;
      return noteVoiceN(c);
    }
    return lastNoteVoice;
  };
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i]!;
    const tag = xmlLocalName(child);
    if (tag === 'backup') {
      const v = timelineVoiceN(child, lastNoteVoice);
      const dur = timelineDurationEl(child);
      voiceCursor.set(v, Math.max(0, (voiceCursor.get(v) ?? 0) - dur));
    } else if (tag === 'forward') {
      const explicit = child.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim();
      let v = explicit || nextNoteVoice(i);
      if (explicit) {
        let hasNote = false;
        for (let j = i + 1; j < children.length; j += 1) {
          const c = children[j]!;
          if (xmlLocalName(c) !== 'note' || isChordNote(c)) continue;
          if (noteVoiceN(c) === explicit) {
            hasNote = true;
            break;
          }
        }
        if (!hasNote) v = nextNoteVoice(i);
      }
      const dur = timelineDurationEl(child);
      voiceCursor.set(v, (voiceCursor.get(v) ?? 0) + dur);
    } else if (tag === 'note') {
      const voice = noteVoiceN(child);
      lastNoteVoice = voice;
      const t = voiceCursor.get(voice) ?? 0;
      const dur = noteDurationN(child);
      const end = isChordNote(child) ? t : t + dur;
      out.push({ note: child, time: t, voice, end });
      if (!isChordNote(child)) voiceCursor.set(voice, end);
    }
  }
  return out;
}

function staffVoicesOverlap(timed: StaffTimedNote[]): boolean {
  const byVoice = new Map<string, Array<{ start: number; end: number }>>();
  for (const { voice, time, end } of timed) {
    const list = byVoice.get(voice) ?? [];
    list.push({ start: time, end });
    byVoice.set(voice, list);
  }
  const voices = [...byVoice.keys()];
  for (let i = 0; i < voices.length; i += 1) {
    for (let j = i + 1; j < voices.length; j += 1) {
      for (const a of byVoice.get(voices[i]!)!) {
        for (const b of byVoice.get(voices[j]!)!) {
          if (Math.max(a.start, b.start) < Math.min(a.end, b.end)) return true;
        }
      }
    }
  }
  return false;
}

function measureMusicalContentInsertIndex(measure: Element): number {
  /** print·attributes·leading direction(템포 등) 뒤에 note/forward/backup 재삽입 */
  return measureHeaderInsertIndex(measure);
}

function measureHasLeadingForward(measure: Element): boolean {
  for (const child of [...measure.children]) {
    const tag = xmlLocalName(child);
    if (tag === 'print' || tag === 'attributes' || tag === 'direction') continue;
    if (tag === 'forward') return true;
    if (tag === 'note') return false;
  }
  return false;
}

function measureHasSharedPlayOrderAcrossVoices(measure: Element): boolean {
  const byPo = new Map<string, Set<string>>();
  let anyPo = false;
  const voices = new Set<string>();
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) !== 'note') continue;
    if (isChordNote(child)) continue;
    const voice = noteVoiceN(child);
    voices.add(voice);
    const po = child.getAttribute('data-hitl-play-order')?.trim();
    if (!po) continue;
    anyPo = true;
    const set = byPo.get(po) ?? new Set<string>();
    set.add(voice);
    byPo.set(po, set);
  }
  if (voices.size >= 2 && anyPo) return true;
  return [...byPo.values()].some((vs) => vs.size >= 2);
}

/**
 * OSMD split 미리보기: backup(voice 없음)+forward(voice 지정) 등 다중 voice를
 * 순차(비겹침) 단일 voice + forward로 평탄화 — PL·PR 박자 정렬 유지.
 * 같은 연주순번이 서로 다른 voice에 있으면(동시 column) 평탄화하지 않음.
 */
function flattenNonOverlappingStaffVoicesForOsmd(measure: Element): void {
  const timed = staffTimedNotesInMeasure(measure);
  if (timed.length < 2) return;
  const voices = new Set(timed.map((x) => x.voice));
  if (voices.size < 2) return;
  if (measureHasLeadingForward(measure)) return;
  if (measureHasSharedPlayOrderAcrossVoices(measure)) return;
  if (staffVoicesOverlap(timed)) return;

  timed.sort((a, b) => a.time - b.time || Number(a.voice) - Number(b.voice));

  const doc = measure.ownerDocument!;
  const ns = measure.namespaceURI || 'http://www.musicxml.org/ns/partwise';
  const mk = (local: string) => (ns ? doc.createElementNS(ns, local) : doc.createElement(local));

  const gluedBefore = new Map<Element, Element[]>();
  const gluedAfter = new Map<Element, Element[]>();
  const extraDirs = new Set<Element>();
  const claimedTrailing = new Set<Element>();
  for (const { note } of timed) {
    const after = trailingDirectionsAfterNoteGroup(measure, note);
    gluedAfter.set(note, after);
    for (const d of after) {
      extraDirs.add(d);
      claimedTrailing.add(d);
    }
  }
  for (const { note } of timed) {
    const before = leadingDirectionsBeforeNote(measure, note).filter((d) => !claimedTrailing.has(d));
    gluedBefore.set(note, before);
    for (const d of before) extraDirs.add(d);
  }

  const toRemove = [...measure.children].filter((c) => {
    const tag = xmlLocalName(c);
    return tag === 'note' || tag === 'backup' || tag === 'forward' || extraDirs.has(c);
  });
  for (const el of toRemove) measure.removeChild(el);

  let insertAt = measureMusicalContentInsertIndex(measure);
  let cursor = 0;
  for (const { note, time } of timed) {
    if (time > cursor) {
      const fwd = mk('forward');
      const durEl = mk('duration');
      durEl.textContent = String(time - cursor);
      fwd.appendChild(durEl);
      measure.insertBefore(fwd, measure.children[insertAt] ?? null);
      insertAt += 1;
      cursor = time;
    }
    for (const d of gluedBefore.get(note) ?? []) {
      measure.insertBefore(d, measure.children[insertAt] ?? null);
      insertAt += 1;
    }
    const clone = note.cloneNode(true) as Element;
    clone.querySelectorAll('voice, *|voice').forEach((v) => {
      v.textContent = '1';
    });
    measure.insertBefore(clone, measure.children[insertAt] ?? null);
    insertAt += 1;
    if (!isChordNote(clone)) cursor = time + noteDurationN(clone);
    for (const d of gluedAfter.get(note) ?? []) {
      measure.insertBefore(d, measure.children[insertAt] ?? null);
      insertAt += 1;
    }
  }
}

/** @deprecated use pruneCrossStaffTimelineForOsmdPreview from shared/musicXmlStaffPreview */
function pruneCrossStaffTimeline(measure: Element, staffN: number): void {
  pruneCrossStaffTimelineForOsmdPreview(measure, staffN);
}

function transformMeasureToSingleStaffVerbatim(measure: Element, staffN: number): void {
  for (const attrs of [...measure.children].filter((c) => xmlLocalName(c) === 'attributes')) {
    normalizeAttributesForSingleStaffPart(attrs, staffN);
  }
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) === 'note' && noteStaffN(child) !== staffN) {
      child.remove();
    }
  }
  pruneCrossStaffTimeline(measure, staffN);
  /** verbatim HITL도 OSMD split part는 voice 타임라인 평탄화 — PL 박자 부족·음수 폭 skip 방지 */
  flattenNonOverlappingStaffVoicesForOsmd(measure);
  snapshotNoteDefaultXForOsmdPreview(measure);
  reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
  normalizeMultiVoiceLayersForOsmdPreview(measure);
  realignMeasureDefaultXFromTimelineForOsmd(measure);
  /** staff→1 변환 전에 direction 재부착 — 순서 바뀌면 PL ritard. 등이 삭제됨 */
  reattachDirectionsForSingleStaffOsmdPreview(measure, staffN);
  measure.querySelectorAll('note staff, note *|staff').forEach((el) => {
    el.textContent = '1';
  });
}

function transformMeasureToSingleStaff(measure: Element, staffN: number): void {
  for (const attrs of [...measure.children].filter((c) => xmlLocalName(c) === 'attributes')) {
    normalizeAttributesForSingleStaffPart(attrs, staffN);
  }
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) === 'note' && noteStaffN(child) !== staffN) {
      child.remove();
    }
  }
  pruneCrossStaffTimeline(measure, staffN);
  flattenNonOverlappingStaffVoicesForOsmd(measure);
  snapshotNoteDefaultXForOsmdPreview(measure);
  reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
  normalizeMultiVoiceLayersForOsmdPreview(measure);
  realignMeasureDefaultXFromTimelineForOsmd(measure);
  reattachDirectionsForSingleStaffOsmdPreview(measure, staffN);
  measure.querySelectorAll('note staff, note *|staff').forEach((el) => {
    el.textContent = '1';
  });
}

function transformPartToSingleStaff(part: Element, staffN: number, verbatim = false): void {
  const transform = verbatim ? transformMeasureToSingleStaffVerbatim : transformMeasureToSingleStaff;
  for (const measure of [...part.children]) {
    if (xmlLocalName(measure) === 'measure') transform(measure, staffN);
  }
}

/** OSMD 미리보기용 가상 part id(P5__PL) → 실제 MXL part id + staff. */
export function resolveMusicXmlPartFromPreviewId(id: string): {
  partId: string;
  staffWithinPart?: number;
} {
  const trimmed = id.trim();
  if (trimmed.endsWith('__PR')) return { partId: trimmed.slice(0, -4), staffWithinPart: 1 };
  if (trimmed.endsWith('__PL')) return { partId: trimmed.slice(0, -4), staffWithinPart: 2 };
  return { partId: trimmed };
}

/**
 * OSMD 전체 악보: 2단 grand staff part를 PR·PL 단일 줄 part로 쪼갬.
 * staff=2 direction이 악보 2번째 줄(P2)로 그려지는 OSMD 버그 회피(미리보기 전용).
 */
export function splitGrandStaffPartsForFullScoreOsmd(
  xml: string,
  scoreParts: ScorePartForPreview[],
  options?: { verbatim?: boolean },
): string {
  const verbatim = options?.verbatim === true;
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) return xml;
    const root = doc.documentElement;
    const partList = [...root.children].find((c) => xmlLocalName(c) === 'part-list');

    for (const part of findXmlParts(doc)) {
      const partId = part.getAttribute('id');
      if (!partId || partId.endsWith('__PR') || partId.endsWith('__PL')) continue;
      if (maxStavesInPart(part) < 2) continue;

      const spMeta = scoreParts.find((p) => p.id === partId);
      const baseLabel = (spMeta?.displayLabel || spMeta?.suggestedLabel || partId).trim();
      const prLabel = baseLabel === 'P' ? 'PR' : `${baseLabel}·1`;
      const plLabel = baseLabel === 'P' ? 'PL' : `${baseLabel}·2`;

      const prPart = part.cloneNode(true) as Element;
      const plPart = part.cloneNode(true) as Element;
      prPart.setAttribute('id', `${partId}__PR`);
      plPart.setAttribute('id', `${partId}__PL`);
      transformPartToSingleStaff(prPart, 1, verbatim);
      transformPartToSingleStaff(plPart, 2, verbatim);

      const parent = part.parentNode;
      if (parent) {
        parent.insertBefore(prPart, part);
        parent.insertBefore(plPart, part);
        parent.removeChild(part);
      }

      if (partList) {
        const sp = [...partList.children].find(
          (c) => xmlLocalName(c) === 'score-part' && c.getAttribute('id') === partId,
        );
        if (sp) {
          const mkScorePart = (id: string, label: string) => {
            const nsp = sp.cloneNode(false) as Element;
            nsp.setAttribute('id', id);
            applyLabelToScorePart(nsp, label);
            return nsp;
          };
          partList.insertBefore(mkScorePart(`${partId}__PR`, prLabel), sp);
          partList.insertBefore(mkScorePart(`${partId}__PL`, plLabel), sp);
          partList.removeChild(sp);
        }
      }
    }
    return new XMLSerializer().serializeToString(doc);
  } catch {
    return xml;
  }
}

/** @deprecated splitGrandStaffPartsForFullScoreOsmd 사용 */
export function relocateMultiStaffLayerStartDirectionsForOsmd(xml: string): string {
  return xml;
}

/** @deprecated splitGrandStaffPartsForFullScoreOsmd 사용 */
export function prepareMultiStaffDirectionsForOsmdPreview(xml: string): string {
  return xml;
}

/** 한 part 안에서 특정 staff(1=PR, 2=PL)만 남김. verbatim=true면 clef/key·voice·direction 변환 없음. */
export function filterMusicXmlToPartStaff(
  xml: string,
  partId: string,
  staffN: number,
  options?: { verbatim?: boolean },
): string {
  if (staffN < 1) return xml;
  const verbatim = options?.verbatim === true;
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) return xml;
    const part = findXmlParts(doc).find((el) => el.getAttribute('id') === partId);
    if (!part) return xml;
    transformPartToSingleStaff(part, staffN, verbatim);
    return new XMLSerializer().serializeToString(doc);
  } catch {
    return xml;
  }
}

const DYNAMICS_TAGS = new Set([
  'p', 'pp', 'ppp', 'pppp', 'f', 'ff', 'fff', 'ffff', 'mp', 'mf', 'sf', 'sfz', 'fp', 'rf', 'fz', 'sfp', 'sfpp', 'n', 'pf', 'sffz',
]);

function firstNoteOnStaff(measure: Element, staffN: number): Element | null {
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) === 'note' && noteStaffN(child) === staffN) return child;
  }
  return null;
}

/** flatten 후 note voice가 1로 바뀌면 direction voice도 맞춤(기존 voice 덮어씀). */
function attachVoiceFromNote(dir: Element, note: Element): void {
  const noteVoice = note.querySelector(':scope > voice, :scope > *|voice');
  const voiceText = noteVoice?.textContent?.trim();
  if (!voiceText) return;
  let dirVoice = dir.querySelector(':scope > voice, :scope > *|voice');
  if (!dirVoice) {
    dirVoice = dir.ownerDocument!.createElementNS(dir.namespaceURI, noteVoice!.tagName);
    dir.appendChild(dirVoice);
  }
  dirVoice.textContent = voiceText;
}

function directionVoiceText(direction: Element): string | null {
  const voiceEl = direction.querySelector(':scope > voice, :scope > *|voice');
  const text = voiceEl?.textContent?.trim();
  return text || null;
}

function noteHasExplicitStaff(note: Element): boolean {
  const staffEl = note.querySelector(':scope > staff, :scope > *|staff');
  return !!(staffEl && staffEl.textContent?.trim());
}

function anchorNoteForDirection(measure: Element, direction: Element): Element | null {
  const children = [...measure.children];
  const idx = children.indexOf(direction);
  if (idx < 0) return null;
  const wantVoice = directionVoiceText(direction);
  const staffEl = direction.querySelector(':scope > staff, :scope > *|staff');
  const wantStaff = staffEl && staffEl.textContent ? parseInt(staffEl.textContent, 10) : null;

  const staffCompatible = (note: Element): boolean => {
    if (wantStaff === null) return true;
    // 단일 staff 필터 후 note staff 태그가 없으면 이미 해당 staff만 남음
    if (!noteHasExplicitStaff(note)) return true;
    return noteStaffN(note) === wantStaff;
  };

  // 1. 바로 뒤따라오는 음표(중간 direction 건너뜀) 탐색
  for (let j = idx + 1; j < children.length; j += 1) {
    const c = children[j]!;
    if (xmlLocalName(c) === 'direction') continue;
    if (xmlLocalName(c) === 'backup') break;
    if (xmlLocalName(c) === 'note' && staffCompatible(c)) {
      if (!wantVoice) return c;
      const nv = c.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim();
      if (!nv || nv === wantVoice) return c;
    }
  }
  if (wantVoice) {
    for (const c of children) {
      if (xmlLocalName(c) !== 'note') continue;
      if (!staffCompatible(c)) continue;
      const nv = c.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim();
      if (nv === wantVoice) return c;
    }
  }
  if (wantStaff !== null) {
    const onStaff = firstNoteOnStaff(measure, wantStaff);
    if (onStaff) return onStaff;
    // staff 태그 없는 단일-staff 마디 — 다음/첫 음
    for (let j = idx + 1; j < children.length; j += 1) {
      const c = children[j]!;
      if (xmlLocalName(c) === 'backup') break;
      if (xmlLocalName(c) === 'note' && !c.querySelector(':scope > chord, :scope > *|chord')) return c;
    }
    return firstNoteOnStaff(measure, 1);
  }
  return null;
}

function copyLayoutFromAnchor(direction: Element, anchor: Element): void {
  const dx = anchor.getAttribute('default-x');
  if (dx) direction.setAttribute('default-x', dx);
}

function ensureDirectionBeforeAnchor(measure: Element, direction: Element, anchor: Element): void {
  attachVoiceFromNote(direction, anchor);
  copyLayoutFromAnchor(direction, anchor);
  const children = [...measure.children];
  const di = children.indexOf(direction);
  const ai = children.indexOf(anchor);
  if (di >= 0 && ai >= 0 && di + 1 === ai) return;
  direction.remove();
  measure.insertBefore(direction, anchor);
}

function attachDynamicsToNote(note: Element, dynTag: string, placement: string | null): void {
  const tag = DYNAMICS_TAGS.has(dynTag.toLowerCase()) ? dynTag.toLowerCase() : 'p';
  const ns = note.namespaceURI;
  let notations = [...note.children].find((c) => xmlLocalName(c) === 'notations') as Element | undefined;
  if (!notations) {
    notations = note.ownerDocument!.createElementNS(ns, ns ? 'notations' : 'notations');
    note.appendChild(notations);
  }
  notations.querySelectorAll(':scope > dynamics, :scope > *|dynamics').forEach((el) => el.remove());
  const dyn = note.ownerDocument!.createElementNS(ns, ns ? 'dynamics' : 'dynamics');
  if (placement === 'above' || placement === 'below') dyn.setAttribute('placement', placement);
  const mark = note.ownerDocument!.createElementNS(ns, ns ? tag : tag);
  dyn.appendChild(mark);
  notations.appendChild(dyn);
}

/** 음표 `<notations><dynamics>` — OSMD 미리보기용으로 `<direction>` 승격 후 notations에서 제거. */
function extractAndRemoveDynamicsFromNote(
  note: Element,
): { tag: string; placement: 'above' | 'below' } | null {
  for (const notations of [...note.children].filter((c) => xmlLocalName(c) === 'notations')) {
    for (const dyn of [...notations.children].filter((c) => xmlLocalName(c) === 'dynamics')) {
      const tags = [...dyn.children]
        .map((c) => xmlLocalName(c))
        .filter((t) => DYNAMICS_TAGS.has(t));
      if (!tags.length) continue;
      const pl = dyn.getAttribute('placement');
      const placement: 'above' | 'below' = pl === 'below' ? 'below' : 'above';
      dyn.remove();
      if (!notations.children.length) note.removeChild(notations);
      return { tag: tags[0], placement };
    }
  }
  return null;
}

function buildDynamicsDirectionElement(
  note: Element,
  tag: string,
  placement: 'above' | 'below',
): Element {
  const ns = note.namespaceURI;
  const mk = (local: string) =>
    ns ? note.ownerDocument!.createElementNS(ns, local) : note.ownerDocument!.createElement(local);
  const direction = mk('direction');
  direction.setAttribute('placement', placement);
  const dtype = mk('direction-type');
  const dyn = mk('dynamics');
  dyn.setAttribute('placement', placement);
  dyn.appendChild(mk(tag));
  dtype.appendChild(dyn);
  direction.appendChild(dtype);
  attachVoiceFromNote(direction, note);
  const staffN = noteStaffN(note);
  if (staffN > 0) {
    let staffEl = direction.querySelector(':scope > staff, :scope > *|staff');
    if (!staffEl) {
      staffEl = note.ownerDocument!.createElementNS(ns || null, ns ? 'staff' : 'staff');
      direction.appendChild(staffEl);
    }
    staffEl.textContent = String(staffN);
  }
  copyLayoutFromAnchor(direction, note);
  return direction;
}

/**
 * OSMD는 HITL이 저장한 `<notations><dynamics>`(ff 등)를 거의 그리지 않음.
 * 미리보기 XML만 measure-level `<direction>`으로 올림 — 저장 MXL은 notations 그대로.
 */
export function promoteNoteDynamicsForOsmdPreview(xml: string): string {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) return xml;
    for (const part of findXmlParts(doc)) {
      for (const measure of [...part.children]) {
        if (xmlLocalName(measure) !== 'measure') continue;
        for (const note of [...measure.children].filter((c) => xmlLocalName(c) === 'note')) {
          const info = extractAndRemoveDynamicsFromNote(note);
          if (!info) continue;
          const dir = buildDynamicsDirectionElement(note, info.tag, info.placement);
          measure.insertBefore(dir, note);
        }
      }
    }
    return new XMLSerializer().serializeToString(doc);
  } catch {
    return xml;
  }
}

/** measure-level `<direction>` → anchor 음표 속성(notations·앞 direction).
 * Segno·Coda·To Coda·Fine·D.C./D.S. 등 진행 제어는 음표에 붙이지 않음(마디 처음/끝 위치 유지). */
export function migrateDirectionsToNotes(xml: string): string {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) return xml;
    for (const part of findXmlParts(doc)) {
      for (const measure of [...part.children]) {
        if (xmlLocalName(measure) !== 'measure') continue;
        for (const direction of [...measure.children].filter((c) => xmlLocalName(c) === 'direction')) {
          if (isNavigationDirectionElement(direction)) continue;
          if (directionHasTempo(direction)) continue;
          const anchor = anchorNoteForDirection(measure, direction);
          if (!anchor) continue;

          // Ensure the direction has the correct staff matching the anchor
          const astaff = noteStaffN(anchor);
          if (astaff > 0) {
            let staffEl = direction.querySelector(':scope > staff, :scope > *|staff');
            if (!staffEl) {
              staffEl = direction.ownerDocument!.createElementNS(direction.namespaceURI, 'staff');
              direction.appendChild(staffEl);
            }
            if (staffEl.textContent !== String(astaff)) {
              staffEl.textContent = String(astaff);
            }
          }

          ensureDirectionBeforeAnchor(measure, direction, anchor);
        }
      }
    }
    return new XMLSerializer().serializeToString(doc);
  } catch {
    return xml;
  }
}

function isNavigationDirectionElement(direction: Element): boolean {
  for (const sound of [...direction.children].filter((c) => xmlLocalName(c) === 'sound')) {
    if (sound.getAttribute('tocoda') || sound.getAttribute('dalsegno')) return true;
    const fine = (sound.getAttribute('fine') || '').toLowerCase();
    if (fine === 'yes' || fine === 'true' || fine === '1') return true;
    const dacapo = (sound.getAttribute('dacapo') || '').toLowerCase();
    if (dacapo === 'yes' || dacapo === 'true' || dacapo === '1') return true;
  }
  for (const dt of [...direction.children].filter((c) => xmlLocalName(c) === 'direction-type')) {
    for (const child of [...dt.children]) {
      const tag = xmlLocalName(child);
      if (tag === 'segno' || tag === 'coda' || tag === 'fine' || tag === 'dacapo' || tag === 'dalsegno' || tag === 'tocoda') {
        return true;
      }
      if (tag === 'words') {
        const t = (child.textContent || '').trim();
        if (/^(D\.(C|S)\.|To Coda|Fine\b)/i.test(t)) return true;
      }
    }
  }
  return false;
}

/** @deprecated migrateDirectionsToNotes */
export function convertMultiStaffDirectionsToNoteAttached(xml: string): string {
  return migrateDirectionsToNotes(xml);
}

/**
 * Audiveris는 조표 없는 구간에서 m1 `<key>`를 생략한다. OSMD는 뒤쪽 조바꿈(예: m17 4♯)을
 * 악보 첫머리 조표로 당겨 그리는 경우가 있어, 조건을 만족할 때만 m1에 C major(`fifths=0`)를 명시한다.
 *
 * - m1에 `<key>` 없음
 * - 픽업(m0)에 `<key>` 없음 (m0 조표는 m1이 이어받음)
 * - 파트의 첫 `<key>`가 m2 이후 (중간 조바꿈)
 */


function previewKeyFifthsBefore(part: Element, measureNum: number): number {
  let fifths = 0;
  for (const meas of [...part.children]) {
    if (xmlLocalName(meas) !== 'measure') continue;
    const mn = parseInt(meas.getAttribute('number') ?? '0', 10);
    if (mn >= measureNum) break;
    for (const attr of [...meas.children]) {
      if (xmlLocalName(attr) !== 'attributes') continue;
      const fText = attr.querySelector('key fifths, key *|fifths, *|key fifths, *|key *|fifths')?.textContent?.trim();
      if (fText && /^-?\d+$/.test(fText)) fifths = parseInt(fText, 10);
    }
  }
  return fifths;
}

function previewClefSign(clef: Element): string {
  return clef.querySelector('sign, *|sign')?.textContent?.trim() ?? '';
}

function previewClefSignBefore(part: Element, measureNum: number, staffNum: number): string {
  let current = 'G';
  for (const meas of [...part.children]) {
    if (xmlLocalName(meas) !== 'measure') continue;
    const mn = parseInt(meas.getAttribute('number') ?? '0', 10);
    if (mn >= measureNum) break;
    for (const attr of [...meas.children]) {
      if (xmlLocalName(attr) !== 'attributes') continue;
      for (const clef of [...attr.children].filter((c) => xmlLocalName(c) === 'clef')) {
        const numAttr = clef.getAttribute('number');
        const cStaff = numAttr && /^\d+$/.test(numAttr) ? parseInt(numAttr, 10) : 1;
        if (cStaff !== staffNum) continue;
        const sign = previewClefSign(clef);
        if (sign) current = sign;
      }
    }
  }
  return current;
}

const PREVIEW_PITCH_STEP_SEMITONE: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

function notePitchMidi(note: Element): number | null {
  const pitch = note.querySelector(':scope > pitch, :scope > *|pitch');
  if (!pitch) return null;
  const step = pitch.querySelector('step, *|step')?.textContent?.trim();
  const octEl = pitch.querySelector('octave, *|octave');
  const oct = parseInt(octEl?.textContent?.trim() ?? '', 10);
  if (!step || !Number.isFinite(oct)) return null;
  const alterText = pitch.querySelector('alter, *|alter')?.textContent?.trim();
  const alter = alterText && /^-?\d+$/.test(alterText) ? parseInt(alterText, 10) : 0;
  const semi = PREVIEW_PITCH_STEP_SEMITONE[step.toUpperCase()];
  if (semi == null) return null;
  return (oct + 1) * 12 + semi + alter;
}

function medianPitchOnStaffInMeasure(measure: Element, staffN: number): number | null {
  const midis: number[] = [];
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) !== 'note') continue;
    if (noteStaffN(child) !== staffN) continue;
    const midi = notePitchMidi(child);
    if (midi != null) midis.push(midi);
  }
  if (!midis.length) return null;
  midis.sort((a, b) => a - b);
  const mid = Math.floor(midis.length / 2);
  return midis.length % 2 ? midis[mid]! : (midis[mid - 1]! + midis[mid]!) / 2;
}

function medianPitchOnStaffBefore(part: Element, measureNum: number, staffN: number): number | null {
  for (let back = 1; back <= 4; back += 1) {
    const mn = measureNum - back;
    if (mn < 1) break;
    const meas = [...part.children].find(
      (c) => xmlLocalName(c) === 'measure' && parseInt(c.getAttribute('number') ?? '0', 10) === mn,
    );
    if (!meas) continue;
    const med = medianPitchOnStaffInMeasure(meas, staffN);
    if (med != null) return med;
  }
  return null;
}

/** G clef part에서 F clef 오인 제거 후, 직전 마디 median 대비 bass-octave export를 복구(1~3 octave). */
function octavesToRestoreAfterFClefMisread(
  part: Element,
  measure: Element,
  staffN: number,
): number {
  const cur = medianPitchOnStaffInMeasure(measure, staffN);
  const prev = medianPitchOnStaffBefore(part, parseInt(measure.getAttribute('number') ?? '0', 10), staffN);
  if (cur == null) return 0;
  if (prev == null) return cur < 52 ? 2 : 1;
  if (cur >= prev - 12) return 0;
  let best = 0;
  let bestDist = Math.abs(cur - prev);
  for (const n of [1, 2, 3]) {
    const dist = Math.abs(cur + n * 12 - prev);
    if (dist < bestDist) {
      best = n;
      bestDist = dist;
    }
  }
  return best;
}

function transposeNotePitchByOctaves(note: Element, delta: number): void {
  const pitch = note.querySelector(':scope > pitch, :scope > *|pitch');
  if (!pitch) return;
  const octEl = pitch.querySelector('octave, *|octave');
  if (!octEl?.textContent?.trim()) return;
  const n = parseInt(octEl.textContent.trim(), 10);
  if (!Number.isFinite(n)) return;
  octEl.textContent = String(Math.max(0, Math.min(9, n + delta)));
}

/** 조바꿈 F clef 오인 제거 후 같은 줄 위치의 bass-octave pitch를 treble로 복구(미리보기 전용). */
function transposePitchedNotesOnStaffInMeasure(measure: Element, staffN: number, delta: number): void {
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) !== 'note') continue;
    if (!child.querySelector(':scope > pitch, :scope > *|pitch')) continue;
    if (noteStaffN(child) !== staffN) continue;
    transposeNotePitchByOctaves(child, delta);
  }
}

function staffHasKeyInMeasure(measure: Element, staffN: number): boolean {
  for (const attr of [...measure.children].filter((c) => xmlLocalName(c) === 'attributes')) {
    for (const key of [...attr.children].filter((c) => xmlLocalName(c) === 'key')) {
      const numAttr = key.getAttribute('number');
      if (!numAttr) return true;
      const num = parseInt(numAttr, 10);
      if (Number.isFinite(num) && num === staffN) return true;
    }
  }
  return false;
}

function isTrebleFClefKeyChangeMisread(
  part: Element,
  measure: Element,
  mnum: number,
  staffN: number,
  globalKeyChange: boolean,
): boolean {
  if (previewClefSignBefore(part, mnum, staffN) !== 'G') return false;
  let hasF = false;
  for (const attr of [...measure.children].filter((c) => xmlLocalName(c) === 'attributes')) {
    for (const clef of [...attr.children].filter((c) => xmlLocalName(c) === 'clef')) {
      if (previewClefSign(clef) !== 'F') continue;
      const numAttr = clef.getAttribute('number');
      const staff = numAttr && /^\d+$/.test(numAttr) ? parseInt(numAttr, 10) : 1;
      if (staff === staffN) hasF = true;
    }
  }
  if (!hasF || staffHasKeyInMeasure(measure, staffN)) return false;
  if (globalKeyChange) {
    if (maxStavesInPart(part) >= 2) return staffN === 1;
    return true;
  }
  const med = medianPitchOnStaffInMeasure(measure, staffN);
  return med != null && med >= 52;
}

function promoteStaffNumberedKeysToGlobalInMeasure(
  measure: Element,
  fifths: number | null,
  mk: (local: string) => Element,
): void {
  for (const attr of [...measure.children].filter((c) => xmlLocalName(c) === 'attributes')) {
    const keys = [...attr.children].filter((c) => xmlLocalName(c) === 'key');
    const numbered = keys.filter((k) => k.getAttribute('number'));
    if (!numbered.length) continue;
    let target = fifths;
    if (target == null) {
      const fText = numbered[0]?.querySelector('fifths, *|fifths')?.textContent?.trim();
      if (fText && /^-?\d+$/.test(fText)) target = parseInt(fText, 10);
    }
    for (const k of numbered) k.remove();
    if (target != null && !attr.querySelector('key, *|key')) {
      const keyEl = mk('key');
      const fifthsEl = mk('fifths');
      fifthsEl.textContent = String(target);
      keyEl.appendChild(fifthsEl);
      attr.appendChild(keyEl);
    }
    if (!attr.children.length) attr.remove();
  }
}

/**
 * 조바꿈 마디에서 Audiveris가 F clef로 오인한 `<clef>` 제거 + 빠진 `<key>` 보충.
 * G clef·전역 조바꿈·treble pitch(≥E3)에서 F clef 오인을 제거하고 octave pitch를 복구.
 * OSMD 미리보기 전용 — 저장 MXL·HITL 편집 XML에는 적용하지 않음.
 */
export function repairKeyChangeClefMisreadForOsmd(xml: string): string {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) return xml;

    const measureKeyChanges = (part: Element, meas: Element): number[] => {
      const mn = parseInt(meas.getAttribute('number') ?? '0', 10);
      const prev = previewKeyFifthsBefore(part, mn);
      const out: number[] = [];
      for (const attr of [...meas.children]) {
        if (xmlLocalName(attr) !== 'attributes') continue;
        for (const key of [...attr.children].filter((c) => xmlLocalName(c) === 'key')) {
          const fText = key.querySelector('fifths, *|fifths')?.textContent?.trim();
          if (!fText || !/^-?\d+$/.test(fText)) continue;
          const nf = parseInt(fText, 10);
          if (nf !== prev) out.push(nf);
        }
      }
      return out;
    };

    const findMeasure = (part: Element, mnum: number): Element | undefined =>
      [...part.children].find(
        (c) => xmlLocalName(c) === 'measure' && parseInt(c.getAttribute('number') ?? '0', 10) === mnum,
      );

    const parts = findXmlParts(doc);
    const measureNums = new Set<number>();
    for (const part of parts) {
      for (const meas of [...part.children]) {
        if (xmlLocalName(meas) === 'measure') {
          measureNums.add(parseInt(meas.getAttribute('number') ?? '0', 10));
        }
      }
    }

    for (const mnum of [...measureNums].sort((a, b) => a - b)) {
      const declared: number[] = [];
      for (const part of parts) {
        const meas = findMeasure(part, mnum);
        if (meas) declared.push(...measureKeyChanges(part, meas));
      }
      if (!declared.length) continue;
      const globalKeyChange = true;
      const counts = new Map<number, number>();
      for (const f of declared) counts.set(f, (counts.get(f) ?? 0) + 1);
      const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      if (ranked.length > 1 && ranked[0]![1] === ranked[1]![1]) continue;
      const newFifths = ranked[0]![0];

      for (const part of parts) {
        const meas = findMeasure(part, mnum);
        if (!meas) continue;
        const ns = meas.namespaceURI;
        const mk = (local: string) =>
          ns ? doc.createElementNS(ns, local) : doc.createElement(local);
        const partChanges = measureKeyChanges(part, meas);

        for (const attr of [...meas.children].filter((c) => xmlLocalName(c) === 'attributes')) {
          let hasKey = attr.querySelector('key, *|key') != null;
          let removedMisreadFClef = false;

          for (const clef of [...attr.children].filter((c) => xmlLocalName(c) === 'clef')) {
            if (previewClefSign(clef) !== 'F') continue;
            const numAttr = clef.getAttribute('number');
            const staff = numAttr && /^\d+$/.test(numAttr) ? parseInt(numAttr, 10) : 1;
            const med = medianPitchOnStaffInMeasure(meas, staff);
            const trebleMisread =
              isTrebleFClefKeyChangeMisread(part, meas, mnum, staff, globalKeyChange)
              || (
                previewClefSignBefore(part, mnum, staff) === 'G'
                && !staffHasKeyInMeasure(meas, staff)
                && med != null
                && med >= 52
              );
            if (trebleMisread) {
              clef.remove();
              removedMisreadFClef = true;
              const oct = octavesToRestoreAfterFClefMisread(part, meas, staff);
              if (oct) transposePitchedNotesOnStaffInMeasure(meas, staff, oct);
            }
          }

          hasKey = attr.querySelector('key, *|key') != null;
          if (!hasKey) {
            const fifthsToInject =
              partChanges.length ? partChanges[partChanges.length - 1]!
              : removedMisreadFClef ? newFifths
              : null;
            if (fifthsToInject != null) {
              const keyEl = mk('key');
              const fifthsEl = mk('fifths');
              fifthsEl.textContent = String(fifthsToInject);
              keyEl.appendChild(fifthsEl);
              attr.appendChild(keyEl);
            }
          }
          if (!attr.children.length) attr.remove();
        }
        if (globalKeyChange && maxStavesInPart(part) >= 2) {
          promoteStaffNumberedKeysToGlobalInMeasure(meas, newFifths, mk);
        }
      }
    }

    return new XMLSerializer().serializeToString(doc);
  } catch {
    return xml;
  }
}

/**
 * Audiveris `<print><measure-numbering>system</measure-numbering>` 제거 — OSMD 미리보기 전용.
 * OMR이 줄머리 마디 번호를 추론해 MusicXML에 넣지만 원본 PDF(clean_score)에는 없을 수 있음.
 */
export function removeAudiverisMeasureNumberingForOsmd(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;

    doc.querySelectorAll('measure-numbering').forEach((mn) => mn.remove());

    for (const part of findXmlParts(doc)) {
      for (const meas of [...part.children]) {
        if (xmlLocalName(meas) !== 'measure') continue;
        for (const print of [...meas.children].filter((c) => xmlLocalName(c) === 'print')) {
          if (print.childElementCount === 0 && !print.textContent?.trim()) print.remove();
        }
      }
    }

    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
  }
}

import { normalizePrintedMeasureNumberText } from '../shared/measureNumberText';

function normalizeMeasureNumberWords(text: string): string {
  return normalizePrintedMeasureNumberText(text) ?? text.replace(/[\uE000-\uF8FF]/g, '').trim();
}

function isLikelyPrintedMeasureNumberWords(text: string): boolean {
  return /^\d{1,3}$/.test(normalizeMeasureNumberWords(text));
}

function measureHasPrintedNumberWords(meas: Element, label: string): boolean {
  for (const dir of [...meas.children].filter((c) => xmlLocalName(c) === 'direction')) {
    for (const dt of [...dir.children].filter((c) => xmlLocalName(c) === 'direction-type')) {
      for (const words of [...dt.children].filter((c) => xmlLocalName(c) === 'words')) {
        if (words.textContent?.trim() === label) return true;
      }
    }
  }
  return false;
}

function insertIndexForMeasureHeader(meas: Element): number {
  let idx = 0;
  for (const child of [...meas.children]) {
    const name = xmlLocalName(child);
    if (name === 'print' || name === 'attributes') idx += 1;
    else break;
  }
  return idx;
}

const MEASURE_NUM_WORDS_RE = /^\d{1,3}$/;

function directionWordsText(dir: Element): string | null {
  for (const dt of [...dir.children].filter((c) => xmlLocalName(c) === 'direction-type')) {
    for (const tag of ['words', 'rehearsal'] as const) {
      for (const el of [...dt.children].filter((c) => xmlLocalName(c) === tag)) {
        const t = el.textContent?.trim();
        if (t) return t;
      }
    }
  }
  return null;
}



/**
 * Audiveris OCR·`<measure-numbering>` 잔여가 아닌, 마디마다 생긴 `<words>` 숫자(1,2,3…) 제거.
 * lyric_manifest에 있는 인쇄 마디만 injectPrintedMeasureNumberDirectionsForOsmd에서 다시 넣습니다.
 */
export function stripSpuriousMeasureNumberWordsForOsmd(
  xml: string,
  allowed: ReadonlyMap<number, string>,
): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    const parts = findXmlParts(doc);
    if (!parts.length) return xml;

    for (const part of parts) {
      for (const meas of [...part.children]) {
        if (xmlLocalName(meas) !== 'measure') continue;
        const mnum = parseInt(meas.getAttribute('number') ?? '0', 10);
        const allowedLabel = allowed.get(mnum);
        for (const dir of [...meas.children].filter((c) => xmlLocalName(c) === 'direction')) {
          if (directionHasTempo(dir)) continue;
          const words = directionWordsText(dir);
          if (!words || !isLikelyPrintedMeasureNumberWords(words)) continue;
          const normalized = normalizeMeasureNumberWords(words);
          if (allowedLabel && normalized === allowedLabel) continue;
          dir.remove();
        }
      }
    }

    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
  }
}

/**
 * lyric_manifest 인쇄 마디 번호만 OSMD `<words>` direction으로 표시 (첫 part만).
 * OSMD 자동 measure@number 라벨은 applyOsmdPreviewEngravingRules에서 끔.
 */
export function injectPrintedMeasureNumberDirectionsForOsmd(
  xml: string,
  markers: ReadonlyMap<number, string>,
): string {
  if (!markers.size) return xml;
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    const ns = doc.documentElement.namespaceURI;
    const mk = (local: string) => (ns ? doc.createElementNS(ns, local) : doc.createElement(local));
    const parts = findXmlParts(doc);
    if (!parts.length) return xml;
    const part = parts[0]!;

    for (const meas of [...part.children]) {
      if (xmlLocalName(meas) !== 'measure') continue;
      const mnum = parseInt(meas.getAttribute('number') ?? '0', 10);
      const label = markers.get(mnum);
      if (!label || measureHasPrintedNumberWords(meas, label)) continue;

      const dir = mk('direction');
      dir.setAttribute('placement', 'above');
      const dt = mk('direction-type');
      const words = mk('words');
      words.setAttribute('font-weight', 'bold');
      words.textContent = label;
      dt.appendChild(words);
      dir.appendChild(dt);
      const idx = insertIndexForMeasureHeader(meas);
      if (idx >= meas.childElementCount) meas.appendChild(dir);
      else meas.insertBefore(dir, meas.children[idx] ?? null);
    }

    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
  }
}

/** 줄바꿈 등에서 이전과 동일한 `<clef>` courtesy 반복 제거 — OSMD 미리보기 전용. */
export function removeRedundantCourtesyClefsForOsmd(xml: string): string {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) return xml;

    for (const part of findXmlParts(doc)) {
      for (const meas of [...part.children]) {
        if (xmlLocalName(meas) !== 'measure') continue;
        const mnum = parseInt(meas.getAttribute('number') ?? '0', 10);
        for (const attr of [...meas.children].filter((c) => xmlLocalName(c) === 'attributes')) {
          for (const clef of [...attr.children].filter((c) => xmlLocalName(c) === 'clef')) {
            const numAttr = clef.getAttribute('number');
            const staff = numAttr && /^\d+$/.test(numAttr) ? parseInt(numAttr, 10) : 1;
            const sign = previewClefSign(clef);
            if (!sign) continue;
            if (sign === previewClefSignBefore(part, mnum, staff)) clef.remove();
          }
          if (!attr.children.length) attr.remove();
        }
      }
    }

    return new XMLSerializer().serializeToString(doc);
  } catch {
    return xml;
  }
}

export type OsmdPreviewOptions = {
  /** true: part/성부 필터·PR·PL split만, clef/key/pitch/direction 변환 없음 (HITL 대조용) */
  verbatim?: boolean;
};

export { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd';
export { repairRestDisplayForOsmdPreview, repairMissingNoteTypesForOsmdPreview, repairNotesForOsmdPreview } from '../shared/musicXmlRestDisplay';
  export {
  removeDanglingTimelineElementsForOsmdPreview,
  repairTimelineForOsmdPreview,
  stripPrintElementsForOsmdPreview,
  stripMeasureWidthAttributesForOsmdPreview,
  stripDefaultXyForOsmdPreview,
  stripDefaultXyKeepLayoutAttrsForOsmdPreview,
  stripArticulationDefaultYForOsmdPreview,
  prepareArticulationDefaultYForOsmdPreview,
  stripNewSystemPrintForOsmdPreview,
  stripPageBreakPrintForOsmdPreview,
  inferFirstMxlMeasureForPdfPage,
} from '../shared/musicXmlTimelineCleanup';

/** part 추출 + (선택) staff 필터 + 표시 라벨을 한 번에 적용. */
export function buildOsmdPreviewXml(
  rawXml: string,
  scoreParts: ScorePartForPreview[],
  filter: StaffFilterEntry | null,
  options?: OsmdPreviewOptions,
): string {
  const verbatim = options?.verbatim === true;
  let xml = applyPartLabelsToMusicXml(rawXml, scoreParts);
  /** sound-only tempo는 OSMD가 첫 마디 음표를 버림 — metronome 보충 후 attributes 뒤로 */
  xml = ensureMetronomeOnSoundTempoDirectionsForOsmdPreview(xml);
  xml = repositionDirectionsBeforeAttributesForOsmdPreview(xml, { tempoOnly: true });
  /** split·dynamics 변환 전에 timeline 정리 — orphan backup이 clone/part split에 복제되기 전 제거 */
  xml = repairTimelineForOsmdPreview(xml);
  if (!verbatim) {
    xml = migrateDirectionsToNotes(xml);
  }
  if (!filter) {
    xml = splitGrandStaffPartsForFullScoreOsmd(xml, scoreParts, { verbatim });
  } else {
    xml = filterMusicXmlToPart(xml, filter.partId);
    if (filter.staffWithinPart != null && filter.staffWithinPart > 0) {
      xml = filterMusicXmlToPartStaff(xml, filter.partId, filter.staffWithinPart, { verbatim });
      xml = setPartDisplayName(xml, filter.partId, filter.label);
    }
  }
  /** 셈여림 승격은 PR/PL·staff 분리 **후** — 분리 전이면 direction이 양쪽 줄에 복제되어 다음 마디 PR에 mf가 붙음 */
  xml = promoteNoteDynamicsForOsmdPreview(xml);
  xml = normalizeTiePlacementsForOsmdPreview(xml);
  xml = repairTimelineForOsmdPreview(xml);
  xml = repairUnderfullMeasuresForOsmdPreview(xml);
  return xml;
}

/**
 * OSMD가 잘린/단독 octave-shift 때문에 `realValue`(Fraction) 접근 크래시를 내는 경우가 있음
 * (예: 단일 파트 추출 후 방향 시작·끝 불일치 · Audiveres 내보내기).
 * 미리보기 전용으로 8바·선 표기만 빼 원곡 높이는 그대로 두고 레이아웃만 깨지지 않게 함.
 */
function sanitizeMusicXmlForOsmd(
  xml: string,
  verbatim = false,
  printedMeasureMarkers?: ReadonlyMap<number, string>,
): string {
  try {
    let out = xml;
    if (!verbatim) {
      out = repairKeyChangeClefMisreadForOsmd(out);
      out = removeRedundantCourtesyClefsForOsmd(out);
    }
    out = ensureMetronomeOnSoundTempoDirectionsForOsmdPreview(out);
    out = repositionDirectionsBeforeAttributesForOsmdPreview(out, { tempoOnly: true });
    out = repairRestDisplayForOsmdPreview(out);
    out = repairMissingNoteTypesForOsmdPreview(out);
    out = repairTimelineForOsmdPreview(out);
    out = repairUnderfullMeasuresForOsmdPreview(out);
    out = normalizeTiePlacementsForOsmdPreview(out);
    out = normalizeDynamicsAndWedgesForOsmdPreview(out);
    out = removeAudiverisMeasureNumberingForOsmd(out);
    out = stripSpuriousMeasureNumberWordsForOsmd(out, new Map());
    if (printedMeasureMarkers?.size) {
      out = injectPrintedMeasureNumberDirectionsForOsmd(out, printedMeasureMarkers);
    }
    const doc = parseMusicXmlDocument(out);
    if (!doc) return xml;

    const local = (el: Element) =>
      typeof el.localName === 'string' ? el.localName.toLowerCase() : String(el.tagName).toLowerCase();

    doc.querySelectorAll('*').forEach((el) => {
      if (local(el) === 'octave-shift') {
        const words = doc.createElement('words');
        el.replaceWith(words);
      }
    });

    // layout default-x는 OSMD engraver에 넘기지 않음 — data-osmd-layout-x만 SVG align용으로 유지
    return stripDefaultXyKeepLayoutAttrsForOsmdPreview(serializeMusicXmlDocument(doc));
  } catch {
    return xml;
  }
}

const OSMD_RENDER_MIN_WIDTH = 56;
const OSMD_WIDTH_RAF_RETRIES = 90;

/** Clears OSMD output and replaces with inline error message. */
function showOsmdHostError(host: HTMLDivElement, message: string) {
  host.innerHTML = '';
  const container = document.createElement('div');
  container.style.cssText = 'position:relative;height:100%;';
  
  const d = document.createElement('div');
  d.style.cssText =
    'padding:14px;font-size:0.86rem;line-height:1.5;color:#b71c1c;white-space:pre-wrap;word-break:break-word;overflow-y:auto;max-height:400px;user-select:text;-webkit-user-select:text;';
  d.textContent = message;

  const btn = document.createElement('button');
  btn.textContent = '에러 복사';
  btn.style.cssText = 'position:absolute;top:10px;right:10px;padding:4px 8px;font-size:0.75rem;cursor:pointer;border:1px solid #fca5a5;background:#fee2e2;color:#b71c1c;border-radius:4px;';
  btn.onclick = () => {
    const fallbackCopy = (text: string) => {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
      } catch (err) {}
      document.body.removeChild(textArea);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(message).then(() => {
        btn.textContent = '복사됨!';
        setTimeout(() => { btn.textContent = '에러 복사'; }, 2000);
      });
    } else {
      fallbackCopy(message);
      btn.textContent = '복사됨!';
      setTimeout(() => { btn.textContent = '에러 복사'; }, 2000);
    }
  };

  container.appendChild(d);
  container.appendChild(btn);
  host.appendChild(container);
}

function appendOsmdWidthHint(host: HTMLDivElement) {
  if (host.querySelector('[data-osmd-warn="width"]')) return;
  const d = document.createElement('div');
  d.dataset.osmdWarn = 'width';
  d.style.cssText =
    'padding:8px 10px;margin:0;font-size:0.81rem;line-height:1.4;color:#664d03;background:#fffbeb;border-bottom:1px solid #fcd34d;';
  d.textContent =
    '미리보기 영역 폭이 아직 거의 비어 있습니다. 패널·창을 조금 더 넓히면 악보가 그려지며, 또는 PNG 줄만 비교해도 마스킹을 확인할 수 있습니다.';
  host.insertBefore(d, host.firstChild);
}

/**
 * Wait for nonzero layout width then call OSMD.render; catch layout bugs realValue/octave-shift.
 * ResizeObserver retries if the modal column stayed at ~0 CSS width briefly.
 */
function scheduleOsmdRender(opts: {
  host: HTMLDivElement;
  osmd: OpenSheetMusicDisplay;
  zoom: number;
  isStale: () => boolean;
  onPaintFailure: () => void;
  roRef: MutableRefObject<ResizeObserver | null>;
  onAfterRender?: () => void;
  afterOsmdRenderSync?: (host: HTMLDivElement, osmd: OpenSheetMusicDisplay) => void;
}) {
  const {
    host,
    osmd,
    zoom,
    isStale,
    onPaintFailure,
    roRef,
    onAfterRender,
    afterOsmdRenderSync,
  } = opts;

  const disconnectRo = () => {
    roRef.current?.disconnect();
    roRef.current = null;
  };

  const tryPaint = () => {
    if (isStale()) return;
    try {
      osmd.zoom = zoom;
      applyOsmdPreviewEngravingRules(osmd.EngravingRules);
      enforceOsmdPreviewMeasureNumberRules(osmd);
      osmd.render();
      afterOsmdRenderSync?.(host, osmd);
      host.querySelector('[data-osmd-warn="width"]')?.remove();
      onAfterRender?.();
    } catch (e) {
      try {
        osmd.clear();
      } catch {
        /* ignore */
      }
      let msg = e instanceof Error ? e.message : String(e);
      if (e instanceof Error && e.stack) {
        msg += `\n\n[상세 에러 정보 (개발자용)]\n${e.stack}`;
      }
      showOsmdHostError(
        host,
        `악보를 그리는 중 오류가 났습니다: ${msg}\n\n(미리보기 렌더링 엔진의 한계로 특정 기호 처리 중 크래시가 발생했을 수 있습니다. MXL 파일 자체는 정상이므로, PNG와 비교하며 나머지 요소를 검증하셔도 무방합니다.)`,
      );
      disconnectRo();
      onPaintFailure();
    }
  };

  let tries = 0;
  const tick = () => {
    if (isStale()) return;
    tries += 1;
    const w = host.getBoundingClientRect().width;
    if (w < OSMD_RENDER_MIN_WIDTH && tries < OSMD_WIDTH_RAF_RETRIES) {
      requestAnimationFrame(tick);
      return;
    }
    if (w < OSMD_RENDER_MIN_WIDTH) {
      appendOsmdWidthHint(host);
      disconnectRo();
      const ro = new ResizeObserver(() => {
        if (isStale()) {
          disconnectRo();
          return;
        }
        if (host.getBoundingClientRect().width >= OSMD_RENDER_MIN_WIDTH) {
          disconnectRo();
          host.querySelector('[data-osmd-warn="width"]')?.remove();
          requestAnimationFrame(tryPaint);
        }
      });
      roRef.current = ro;
      ro.observe(host);
      return;
    }
    tryPaint();
  };
  requestAnimationFrame(tick);
}

export function OsmdBlock({
  xml,
  zoom,
  onMeasureClick,
  highlightMeasureMxl,
  highlightMeasureStaffIndex,
  scrollToMeasure,
  scrollToMeasureTrigger = 0,
  embeddedInOmrFrame,
  verbatimPreview,
  printedMeasureMarkers,
}: {
  xml: string;
  zoom: number;
  onMeasureClick?: (info: OsmdMeasureClickInfo) => void;
  highlightMeasureMxl?: number | null;
  highlightMeasureStaffIndex?: number | null;
  /** MXL 반영·미리보기 직후 해당 마디가 스크롤 영역 세로 중앙에 오도록 */
  scrollToMeasure?: OsmdMeasureClickInfo | null;
  scrollToMeasureTrigger?: number;
  /** OMR 검토 패널처럼 바깥 .omr-mxl-osmd-frame이 스크롤할 때 내부 overflow 제거 */
  embeddedInOmrFrame?: boolean;
  /** HITL: clef/key/pitch 등 MXL 그대로 — OSMD 크래시 방지(octave-shift 등)만 */
  verbatimPreview?: boolean;
  /** lyric_manifest 인쇄 마디 번호만 미리보기에 표시 */
  printedMeasureMarkers?: ReadonlyMap<number, string>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const xmlRef = useRef(xml);
  const zoomRef = useRef(zoom);
  const xmlGenRef = useRef(0);
  /** Invalidates overlapping RAF/resize paint attempts (load-complete vs zoom). */
  const paintSeqRef = useRef(0);
  const roRef = useRef<ResizeObserver | null>(null);
  const onMeasureClickRef = useRef(onMeasureClick);
  const highlightMeasureMxlRef = useRef(highlightMeasureMxl);
  const highlightMeasureStaffIndexRef = useRef(highlightMeasureStaffIndex);
  const scrollToMeasureRef = useRef(scrollToMeasure);
  const scrollToMeasureTriggerRef = useRef(scrollToMeasureTrigger);
  const lastHandledScrollTriggerRef = useRef(0);
  const printedMeasureMarkersRef = useRef(printedMeasureMarkers);

  useEffect(() => {
    printedMeasureMarkersRef.current = printedMeasureMarkers;
  }, [printedMeasureMarkers]);

  useEffect(() => {
    scrollToMeasureRef.current = scrollToMeasure;
    scrollToMeasureTriggerRef.current = scrollToMeasureTrigger;
  }, [scrollToMeasure, scrollToMeasureTrigger]);

  useEffect(() => {
    onMeasureClickRef.current = onMeasureClick;
  }, [onMeasureClick]);

  useEffect(() => {
    highlightMeasureMxlRef.current = highlightMeasureMxl;
    highlightMeasureStaffIndexRef.current = highlightMeasureStaffIndex;
    const host = hostRef.current;
    const osmd = osmdRef.current;
    if (host && osmd?.IsReadyToRender()) {
      drawOsmdMeasureHighlight(
        host,
        osmd,
        highlightMeasureMxl ?? null,
        highlightMeasureStaffIndex ?? null,
      );
    }
  }, [highlightMeasureMxl, highlightMeasureStaffIndex, xml, zoom]);

  useEffect(() => {
    xmlRef.current = xml;
    zoomRef.current = zoom;
  }, [xml, zoom]);

  const syncPartLabelOverlay = useCallback(() => {
    const host = hostRef.current;
    const osmd = osmdRef.current;
    if (!host || !osmd?.IsReadyToRender()) return;
    installOsmdPartLabelOverlay(host, osmd, xmlRef.current);
  }, []);

  const syncMeasureClickUi = useCallback(() => {
    const host = hostRef.current;
    const osmd = osmdRef.current;
    if (!host || !osmd?.IsReadyToRender()) return;
    syncPartLabelOverlay();
    if (onMeasureClickRef.current) {
      installMeasureClickOverlays(host, osmd);
    } else {
      removeMeasureClickOverlays(host);
      removeMeasureHover(host);
    }
    drawOsmdMeasureHighlight(
      host,
      osmd,
      highlightMeasureMxlRef.current ?? null,
      highlightMeasureStaffIndexRef.current ?? null,
    );
  }, [syncPartLabelOverlay]);

  const syncOnsetColumnAlign = useCallback((_host: HTMLDivElement, osmd: OpenSheetMusicDisplay) => {
    try {
      // WeakMap(register) 우선 — sanitize 후 XML. prop xml은 sanitize 전이라 column이 어긋날 수 있음.
      // 2회: over-cap 클램프 후 재측정해 같은 po column으로 수렴 (po2 [F4,Bb4]↔E5).
      alignOsmdPreviewNotesByOnsetColumn(osmd);
      alignOsmdPreviewNotesByOnsetColumn(osmd);
    } catch (e) {
      console.warn('[osmd] play-order align skipped:', e);
    }
  }, []);

  const afterOsmdRender = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        syncMeasureClickUi();
        const host = hostRef.current;
        const osmd = osmdRef.current;
        if (host && osmd?.IsReadyToRender()) {
          syncOnsetColumnAlign(host, osmd);
          applyOsmdArticulationOffsets(host, osmd);
          finalizeOsmdMeasureNumberPreview(host, osmd, printedMeasureMarkersRef.current);
        }
        const trigger = scrollToMeasureTriggerRef.current;
        const target = scrollToMeasureRef.current;
        if (
          host &&
          osmd?.IsReadyToRender() &&
          target &&
          trigger > 0 &&
          trigger !== lastHandledScrollTriggerRef.current
        ) {
          scrollOsmdMeasureIntoView(host, osmd, target);
          lastHandledScrollTriggerRef.current = trigger;
        }
      });
    });
  }, [syncMeasureClickUi, syncOnsetColumnAlign]);

  useEffect(() => {
    const disconnectRo = () => {
      roRef.current?.disconnect();
      roRef.current = null;
    };

    const host = hostRef.current;
    if (!host || !xml.trim()) return;

    disconnectRo();
    const gen = ++xmlGenRef.current;
    host.innerHTML = '';
    let osmd: OpenSheetMusicDisplay;
    try {
      osmd = new OpenSheetMusicDisplay(host, {
        autoResize: true,
        backend: 'svg',
        drawMeasureNumbers: false,
        useXMLMeasureNumbers: false,
        autoGenerateMultipleRestMeasuresFromRestMeasures: false,
      } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
      applyOsmdPreviewEngravingRules(osmd.EngravingRules);
      patchOsmdRenderForMeasureNumbers(osmd, host, () => printedMeasureMarkersRef.current);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const d = document.createElement('div');
      d.style.cssText =
        'padding:14px;font-size:0.86rem;line-height:1.5;color:#b71c1c;white-space:pre-wrap;';
      d.textContent = `악보 미리보기(OSMD)를 초기화하지 못했습니다: ${msg}`;
      host.appendChild(d);
      osmdRef.current = null;
      return;
    }
    osmdRef.current = osmd;

    let cancelled = false;
    const stale = () => cancelled || gen !== xmlGenRef.current;
    const xmlForOsmd = sanitizeMusicXmlForOsmd(
      xml,
      verbatimPreview === true,
      printedMeasureMarkersRef.current,
    );
    /** SVG hint(거리 tier)용 — sanitize 전 filteredXml(pending articulation attr 포함) */
    registerOsmdPreviewXmlForArticulation(osmd, xml);
    registerOsmdPreviewXmlForAlign(osmd, xmlForOsmd);
    const xmlForOsmdLoad = prepareArticulationDefaultYForOsmdPreview(xmlForOsmd);
    void osmd
      .load(xmlForOsmdLoad)
      .then(() => {
        if (stale() || !host) return;
        applyOsmdPreviewEngravingRules(osmd.EngravingRules);
        try {
          retargetGraphicalChordSlurBeziers(osmd);
        } catch (e) {
          console.warn('[osmd] preview engraving adjust skipped:', e);
        }
        const seq = ++paintSeqRef.current;
        scheduleOsmdRender({
          host,
          osmd,
          zoom: zoomRef.current,
          isStale: () => stale() || seq !== paintSeqRef.current || !host.isConnected,
          onPaintFailure: () => {
            osmdRef.current = null;
          },
          roRef,
          onAfterRender: afterOsmdRender,
          afterOsmdRenderSync: (h, o) => {
            finalizeOsmdMeasureNumberPreview(h, o, printedMeasureMarkersRef.current);
            // render 직후 동기 align — rAF만 기다리면 autoResize/후속 paint가 transform을 덮어쓸 수 있음
            syncOnsetColumnAlign(h, o);
            applyOsmdArticulationOffsets(h, o);
          },
        });
      })
      .catch((loadErr: unknown) => {
        if (cancelled || !host) return;
        try {
          osmd.clear();
        } catch {
          /* ignore */
        }
        osmdRef.current = null;
        host.innerHTML = '';
        const d = document.createElement('div');
        d.style.cssText =
          'padding:14px;font-size:0.86rem;line-height:1.5;color:#b71c1c;white-space:pre-wrap;word-break:break-word;';
        
        let msg =
          loadErr instanceof Error ? loadErr.message : typeof loadErr === 'string' ? loadErr : String(loadErr);
        
        if (msg.includes('The provided duration is not valid')) {
          const match = xmlForOsmd.match(/<duration>\s*([^<]+)\s*<\/duration>/);
          let extraMsg = '';
          if (match && !/^\d+$/.test(match[1])) {
            const invalidVal = match[1];
            const idx = match.index!;
            const beforeStr = xmlForOsmd.substring(0, idx);
            const measureMatches = [...beforeStr.matchAll(/<measure[^>]*number="([^"]+)"/g)];
            const partMatches = [...beforeStr.matchAll(/<part[^>]*id="([^"]+)"/g)];
            const measureNum = measureMatches.length > 0 ? measureMatches[measureMatches.length - 1][1] : '?';
            const partId = partMatches.length > 0 ? partMatches[partMatches.length - 1][1] : '?';
            extraMsg = `\n\n[분석 결과] 파트 ${partId}, 마디 ${measureNum} 근처에서 유효하지 않은 길이(duration) 값 '${invalidVal}'이(가) 발견되었습니다.`;
          } else {
            // duration 값이 숫자로 정상이거나 없는 경우, divisions 누락 가능성 분석
            const dirIdx = xmlForOsmd.indexOf('<direction');
            const attrIdx = xmlForOsmd.indexOf('<attributes>');
            if (dirIdx !== -1 && attrIdx !== -1 && dirIdx < attrIdx) {
              extraMsg = `\n\n[분석 결과] 길이(duration) 관련 오류가 발생했습니다. <attributes> (divisions 선언부)보다 <direction> (템포 등)이 먼저 등장하여 발생한 MusicXML 구조 문제일 수 있습니다. (템포 지정 위치 조정 필요)`;
            } else {
              extraMsg = `\n\n[분석 결과] 길이(duration) 관련 오류가 발생했습니다. 특정 마디의 <duration> 값이 잘못되었거나 구조가 깨졌을 수 있습니다.`;
            }
          }
          msg += extraMsg;
        }

        const textSpan = document.createElement('span');
        textSpan.textContent = `MusicXML 미리보기를 불러오지 못했습니다(${msg}).\n\n곡별로 OSMXL 스키마 차이 등으로 실패할 수 있습니다. PNG 비교만으로도 마스킹 여부를 확인할 수 있습니다.\n\n`;
        d.appendChild(textSpan);

        const copyBtn = document.createElement('button');
        copyBtn.textContent = '에러 메시지 복사';
        copyBtn.className = 'btn-muted';
        copyBtn.style.marginTop = '10px';
        copyBtn.onclick = () => {
          navigator.clipboard.writeText(msg).then(() => {
            copyBtn.textContent = '복사되었습니다!';
            setTimeout(() => {
              if (copyBtn.isConnected) copyBtn.textContent = '에러 메시지 복사';
            }, 2000);
          });
        };
        d.appendChild(copyBtn);

        host.appendChild(d);
      });

    return () => {
      cancelled = true;
      disconnectRo();
      uninstallOsmdMeasureNumberSuppressObserver(host);
      removeOsmdPartLabelOverlay(host);
      try {
        osmd.clear();
      } catch {
        /* tab 전환·Strict Mode 이중 마운트 시 clear 실패 무시 */
      }
      osmdRef.current = null;
    };
  }, [xml, printedMeasureMarkers]);

  useEffect(() => {
    const host = hostRef.current;
    const osmd = osmdRef.current;
    const gen = xmlGenRef.current;
    const seq = ++paintSeqRef.current;

    if (!host || !osmd || !osmd.IsReadyToRender()) return;
    scheduleOsmdRender({
      host,
      osmd,
      zoom,
      isStale: () =>
        gen !== xmlGenRef.current ||
        seq !== paintSeqRef.current ||
        !host ||
        !host.isConnected ||
        !osmdRef.current?.IsReadyToRender(),
      onPaintFailure: () => {
        osmdRef.current = null;
      },
      roRef,
      onAfterRender: afterOsmdRender,
      afterOsmdRenderSync: (h, o) => {
        finalizeOsmdMeasureNumberPreview(h, o, printedMeasureMarkersRef.current);
        syncOnsetColumnAlign(h, o);
        applyOsmdArticulationOffsets(h, o);
      },
    });
  }, [zoom, afterOsmdRender]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const onHostClick = (evt: MouseEvent) => {
      if (evt.button !== 0 || !onMeasureClickRef.current) return;
      const osmd = osmdRef.current;
      if (!osmd?.IsReadyToRender()) return;
      const hit = hitTestOsmdMeasure(osmd, host, evt);
      if (!hit) return;
      evt.preventDefault();
      evt.stopPropagation();
      onMeasureClickRef.current(hit);
    };

    const onHostMove = (evt: MouseEvent) => {
      if (!onMeasureClickRef.current) return;
      const osmd = osmdRef.current;
      if (!osmd?.IsReadyToRender()) return;
      const hit = hitTestOsmdMeasure(osmd, host, evt);
      drawOsmdMeasureHover(host, osmd, hit, evt);
    };

    const onHostLeave = () => {
      removeMeasureHover(host);
    };

    host.addEventListener('click', onHostClick, true);
    host.addEventListener('mousemove', onHostMove, { passive: true });
    host.addEventListener('mouseleave', onHostLeave);

    const scrollParent = host.closest('.omr-mxl-osmd-frame');
    const onScroll = () => syncMeasureClickUi();
    scrollParent?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    if (onMeasureClick) {
      syncMeasureClickUi();
    } else {
      removeMeasureClickOverlays(host);
      removeMeasureHover(host);
    }

    return () => {
      host.removeEventListener('click', onHostClick, true);
      host.removeEventListener('mousemove', onHostMove);
      host.removeEventListener('mouseleave', onHostLeave);
      scrollParent?.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [xml, onMeasureClick, zoom, syncMeasureClickUi]);

  return (
    <div
      ref={hostRef}
      className="audiveris-inspect-osmd omr-osmd-clickable"
      data-omr-suppress-measure-numbers="1"
      style={{
        minHeight: 160,
        minWidth: 'min(100%, 260px)',
        overflow: embeddedInOmrFrame ? 'visible' : 'auto',
        border: embeddedInOmrFrame ? 'none' : '1px solid #ddd',
        borderRadius: embeddedInOmrFrame ? 0 : 6,
        background: '#fff',
        cursor: onMeasureClick ? 'pointer' : undefined,
      }}
    />
  );
}

type StepProbeArtifact = { relPath: string; bytes: number };

type StepProbeResponse = {
  runId: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  argv: string[];
  pdfRequested: string;
  pdfUsed: string;
  note?: string;
  artifacts: StepProbeArtifact[];
};

/** 서버 `/api/audiveris-sheet-steps` 실패 시 폴백 (공식 CLI 순서와 동일). */
const AUDIVERIS_STEP_NAMES_FALLBACK = [
  'LOAD',
  'BINARY',
  'SCALE',
  'GRID',
  'HEADERS',
  'STEM_SEEDS',
  'BEAMS',
  'LEDGERS',
  'HEADS',
  'STEMS',
  'REDUCTION',
  'CUE_BEAMS',
  'TEXTS',
  'MEASURES',
  'CHORDS',
  'CURVES',
  'SYMBOLS',
  'LINKS',
  'RHYTHMS',
  'PAGE',
] as const;

function AudiverisStepProbeSection({
  jobId,
  maskedPdfExists,
  cleanScorePdfExists,
}: {
  jobId: string;
  maskedPdfExists: boolean;
  cleanScorePdfExists: boolean;
}) {
  const [steps, setSteps] = useState<string[]>([]);
  const [step, setStep] = useState('GRID');
  const [force, setForce] = useState(false);
  const [sheets, setSheets] = useState('');
  const [pdfSource, setPdfSource] = useState<'clean_score' | 'masked' | 'original'>(
    cleanScorePdfExists ? 'clean_score' : maskedPdfExists ? 'masked' : 'original',
  );
  const [busy, setBusy] = useState(false);
  const [probeErr, setProbeErr] = useState<string | null>(null);
  const [last, setLast] = useState<StepProbeResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/audiveris-sheet-steps', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { steps?: unknown }) => {
        if (cancelled || !Array.isArray(j.steps)) return;
        const list = j.steps.filter((x): x is string => typeof x === 'string');
        setSteps(list);
        setStep((prev) => {
          if (list.includes(prev)) return prev;
          if (list.includes('GRID')) return 'GRID';
          return list[0] ?? prev;
        });
      })
      .catch(() => {
        if (!cancelled) setSteps([...AUDIVERIS_STEP_NAMES_FALLBACK]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (cleanScorePdfExists) {
      setPdfSource((prev) => (prev === 'original' && !maskedPdfExists ? 'clean_score' : prev));
      return;
    }
    if (!maskedPdfExists && pdfSource === 'masked') setPdfSource('original');
  }, [maskedPdfExists, cleanScorePdfExists, pdfSource]);

  const runProbe = async () => {
    setProbeErr(null);
    setBusy(true);
    setLast(null);
    try {
      const r = await fetch(`/api/diagnostic/${jobId}/audiveris-step-probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step,
          force,
          sheets: sheets.trim() || undefined,
          pdfSource,
        }),
      });
      const ct = r.headers.get('Content-Type') ?? '';
      const j = ct.includes('application/json') ? await r.json() : null;
      if (!r.ok) {
        const msg =
          j && typeof j === 'object' && j !== null && 'error' in j
            ? String((j as { error?: unknown }).error ?? `HTTP ${r.status}`)
            : `HTTP ${r.status}`;
        setProbeErr(msg);
        return;
      }
      setLast(j as StepProbeResponse);
    } catch (e) {
      setProbeErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details
      style={{
        marginTop: 14,
        padding: '12px 14px',
        background: '#252a33',
        borderRadius: 8,
        border: '1px solid #3c4049',
      }}
    >
      <summary style={{ cursor: 'pointer', fontWeight: 700, color: '#e8eaed', userSelect: 'none' }}>
        Audiveris 단계별 실행 (디버깅)
      </summary>
      <p style={{ margin: '10px 0 12px', fontSize: '0.86rem', color: '#bdc1c6', lineHeight: 1.5 }}>
        서버에서 Audiveris CLI로 <code>-batch -save -step …</code> 를 실행합니다(<strong>-export 없음</strong>). SCALE→GRID→… 순으로 단계를 올려 가며 로그와 생성된{' '}
        <code>.omr</code>·로그 파일을 받아 GitHub 이슈 재현에 쓸 수 있습니다. 단계별 의미·디버깅 순서는 저장소{' '}
        <code>docs/Audiveris_단계별_디버깅.md</code> 를 참고하세요. 서버 부하가 크므로 필요할 때만 실행하세요.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px', alignItems: 'flex-end', marginBottom: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.78rem', color: '#9aa0a6' }}>목표 단계 (-step)</span>
          <select value={step} onChange={(e) => setStep(e.target.value)} style={{ minWidth: 140 }}>
            {steps.length === 0 ? (
              <option value={step}>{step}</option>
            ) : (
              steps.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))
            )}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.78rem', color: '#9aa0a6' }}>-sheets (선택)</span>
          <input
            type="text"
            placeholder="예: 1 또는 1 4-7"
            value={sheets}
            onChange={(e) => setSheets(e.target.value)}
            style={{ width: 140 }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          <span style={{ fontSize: '0.88rem', color: '#e8eaed' }}>-force (BINARY부터 재처리)</span>
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.78rem', color: '#9aa0a6' }}>입력 PDF</span>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {cleanScorePdfExists && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name={`pdfSrc-${jobId}`}
                  checked={pdfSource === 'clean_score'}
                  onChange={() => setPdfSource('clean_score')}
                />
                <span style={{ color: '#e8eaed' }}>clean_score (OMR 입력)</span>
              </label>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: maskedPdfExists ? 'pointer' : 'not-allowed' }}>
              <input
                type="radio"
                name={`pdfSrc-${jobId}`}
                checked={pdfSource === 'masked'}
                disabled={!maskedPdfExists}
                onChange={() => setPdfSource('masked')}
              />
              <span style={{ color: maskedPdfExists ? '#e8eaed' : '#666' }}>마스킹</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="radio" name={`pdfSrc-${jobId}`} checked={pdfSource === 'original'} onChange={() => setPdfSource('original')} />
              <span style={{ color: '#e8eaed' }}>업로드 원본</span>
            </label>
          </div>
        </div>
        <button type="button" disabled={busy} onClick={() => void runProbe()}>
          {busy ? '실행 중…' : '실행'}
        </button>
      </div>
      {probeErr && (
        <div className="status err" style={{ margin: '8px 0' }}>
          {probeErr}
        </div>
      )}
      {last && (
        <div style={{ marginTop: 10, fontSize: '0.82rem', color: '#bdc1c6' }}>
          <div>
            <strong>종료 코드</strong> {last.exitCode ?? '(null)'} · <strong>사용 PDF</strong> {last.pdfUsed}{' '}
            {last.pdfRequested !== last.pdfUsed && `(요청: ${last.pdfRequested})`}
          </div>
          {last.note && <div style={{ marginTop: 4, color: '#fdd663' }}>{last.note}</div>}
          <div style={{ marginTop: 8 }}>
            <strong>명령 인자</strong>
            <pre
              style={{
                margin: '6px 0 0',
                padding: 8,
                background: '#1a1d24',
                borderRadius: 6,
                overflow: 'auto',
                maxHeight: 120,
                fontSize: '0.76rem',
              }}
            >
              {JSON.stringify(last.argv)}
            </pre>
          </div>
          {last.artifacts.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <strong>생성 파일</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {last.artifacts.map((a) => (
                  <li key={a.relPath}>
                    <a
                      href={`/api/diagnostic/${jobId}/audiveris-step-probe/${last.runId}/download?rel=${encodeURIComponent(a.relPath)}`}
                      style={{ color: '#8ab4ff' }}
                      download
                    >
                      {a.relPath}
                    </a>{' '}
                    ({a.bytes} bytes)
                  </li>
                ))}
              </ul>
            </div>
          )}
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: 'pointer', color: '#e8eaed' }}>stdout / stderr</summary>
            <pre
              style={{
                marginTop: 8,
                padding: 8,
                background: '#1a1d24',
                borderRadius: 6,
                maxHeight: 220,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                fontSize: '0.76rem',
              }}
            >
              === stdout ==={'\n'}
              {last.stdout}
              {'\n\n'}=== stderr ==={'\n'}
              {last.stderr}
            </pre>
          </details>
        </div>
      )}
    </details>
  );
}

type Props = {
  jobId: string;
  onClose: () => void;
};

export function AudiverisInspectPanel({ jobId, onClose }: Props) {
  const [summary, setSummary] = useState<InspectSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(true);
  const [pngFailOrig, setPngFailOrig] = useState(false);
  const [pngFailMasked, setPngFailMasked] = useState(false);
  const [pngFailClean, setPngFailClean] = useState(false);
  const [page, setPage] = useState(1);
  const [dpi, setDpi] = useState(132);
  const [rawXml, setRawXml] = useState<string | null>(null);
  const [partId, setPartId] = useState<string>('');
  const [scoreZoom, setScoreZoom] = useState(0.6);
  /** 기본 끔 — 탭 전환 직후 OSMD가 멈추거나 빈 검은 영역처럼 보이는 경우 방지 */
  const [showOsmdPreview, setShowOsmdPreview] = useState(false);
  const [pngBust, setPngBust] = useState(0);
  const [audiverisLegacy, setAudiverisLegacy] = useState(false);

  useEffect(() => {
    fetch('/api/health', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((h: { omrEngine?: string; audiverisConfigured?: boolean } | null) => {
        setAudiverisLegacy(h?.omrEngine === 'audiveris' && Boolean(h?.audiverisConfigured));
      })
      .catch(() => setAudiverisLegacy(false));
  }, []);

  useEffect(() => {
    setShowOsmdPreview(false);
    setPngBust(0);
  }, [jobId]);

  const refreshSummary = useCallback(async () => {
    setSummaryBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/diagnostic/${jobId}/summary`, { cache: 'no-store' });
      const ct = r.headers.get('Content-Type') ?? '';
      if (!r.ok) {
        if (ct.includes('application/json')) {
          const j = (await r.json()) as { error?: string };
          setErr(j.error || `HTTP ${r.status}`);
        } else {
          setErr(`HTTP ${r.status}`);
        }
        setSummary(null);
        return;
      }
      const data = (await r.json()) as InspectSummary;
      setSummary(data);
      setPage(1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSummary(null);
    } finally {
      setSummaryBusy(false);
    }
  }, [jobId]);

  const refreshScore = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`/api/diagnostic/${jobId}/score-musicxml`, { cache: 'no-store' });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setRawXml(null);
        setErr(j.error || `악보 XML HTTP ${r.status}`);
        return;
      }
      const text = await r.text();
      setRawXml(text);
      setPartId('');
    } catch (e) {
      setRawXml(null);
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [jobId]);

  const parts = rawXml ? parseScoreParts(rawXml) : [];
  const filteredXml = rawXml ? filterMusicXmlToPart(rawXml, partId || null) : '';

  const pngQuery = `dpi=${dpi}&cb=${pngBust}`;
  const origSrc =
    summary && page >= 1 && page <= summary.pageCountForUi
      ? `/api/diagnostic/${jobId}/page/${page}/png?source=original&${pngQuery}`
      : '';
  const maskedSrc =
    summary?.maskedPdf.exists && page >= 1 && page <= summary.pageCountForUi
      ? `/api/diagnostic/${jobId}/page/${page}/png?source=masked&${pngQuery}`
      : '';
  const cleanScoreSrc =
    summary?.cleanScorePdf?.exists && page >= 1 && page <= summary.pageCountForUi
      ? `/api/diagnostic/${jobId}/page/${page}/png?source=clean_score&${pngQuery}`
      : '';
  const audiverisCompareSrc = cleanScoreSrc || maskedSrc;
  const audiverisCompareLabel = summary?.cleanScorePdf?.exists
    ? 'clean_score PDF (OMR 입력)'
    : '마스킹 PDF';

  useEffect(() => {
    void refreshSummary();
  }, [refreshSummary]);

  useEffect(() => {
    setPngFailOrig(false);
    setPngFailMasked(false);
    setPngFailClean(false);
  }, [origSrc, maskedSrc, cleanScoreSrc, page, dpi]);

  useEffect(() => {
    if (!summary?.scoreMusicXmlAvailable) {
      setRawXml(null);
      return;
    }
    void refreshScore();
  }, [summary?.scoreMusicXmlAvailable, refreshScore]);

  return (
    <div
      className="audiveris-inspect-root"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        minHeight: 200,
        minWidth: 0,
        overflowX: 'hidden',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: '0 0 6px', color: 'var(--text-color, #e8eaed)' }}>마스킹·OMR 인식 점검</h3>
          <p style={{ margin: 0, fontSize: '0.9rem', color: '#bdc1c6', lineHeight: 1.45 }}>
            같은 <strong>페이지</strong>에서 <strong>원본 PDF</strong>와 OMR에 넘긴 PDF(
            <code>clean_score_only.pdf</code> 또는 <code>masked_input.pdf</code>)를 나란히 보고, 가사·제목 등이 과하게 지워졌는지·음표가 보존됐는지 확인하세요.
            오른쪽은 OMR이 낸 악보(MusicXML) 미리보기입니다.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn-muted" onClick={() => void refreshSummary()}>
            요약 새로고침
          </button>
          {summary?.scoreMusicXmlAvailable && (
            <button type="button" className="btn-muted" onClick={() => void refreshScore()}>
              악보 XML 새로고침
            </button>
          )}
          <button type="button" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>

      {summaryBusy && !summary && !err && (
        <div className="status" style={{ margin: 0 }}>
          작업 요약을 불러오는 중…
        </div>
      )}

      {err && (
        <div className="status err" style={{ margin: 0 }}>
          {err}
        </div>
      )}

      {summary && (
        <div style={{ fontSize: '0.88rem', color: '#bdc1c6', lineHeight: 1.5 }}>
          <strong>파일</strong> {summary.originalName} · <strong>작업 상태</strong> {summary.status}
          {summary.pipelineMode && (
            <>
              {' '}
              · <strong>파이프라인</strong> {summary.pipelineMode}
            </>
          )}
          <br />
          <strong>원본</strong> 페이지 수 {summary.originalPdf.pageCount ?? '(알 수 없음)'}
          {summary.cleanScorePdf?.exists ? (
            <>
              {' '}
              · <strong>clean_score</strong> 페이지 수 {summary.cleanScorePdf.pageCount ?? '(알 수 없음)'}
              {summary.audiverisInputPdf === 'clean_score' && ' (OMR 입력)'}
            </>
          ) : null}
          {summary.maskedPdf.exists ? (
            <>
              {' '}
              · <strong>마스킹</strong> 페이지 수 {summary.maskedPdf.pageCount ?? '(알 수 없음)'}
              {summary.audiverisInputPdf === 'masked' && ' (OMR 입력)'}
            </>
          ) : !summary.cleanScorePdf?.exists ? (
            <>
              {' '}
              · <strong>OMR 입력 PDF 없음</strong>(선행 처리 없이 원본만 사용한 경우 등)
            </>
          ) : null}
          {summary.lyricManifestStats && (
            <>
              <br />
              <strong>가사 병합</strong> pdfplumber {String(summary.lyricManifestStats.pdfplumberLines ?? '?')}줄 · PyMuPDF{' '}
              {String(summary.lyricManifestStats.pymupdfItems ?? '?')}항목 · 양쪽 매칭{' '}
              {String(summary.lyricManifestStats.mergedFromBoth ?? '?')}
              {' · '}
              <a
                href={`/api/lyric-manifest/${jobId}/download`}
                style={{ color: '#8ab4ff', fontWeight: 600 }}
                download
              >
                lyric_manifest.json 다운로드
              </a>
            </>
          )}
          {!summary.pageCountsMatch && (
            <>
              {' '}
              · <span className="err">원본/마스킹 페이지 수가 다릅니다. PDF·스크립트를 확인하세요.</span>
            </>
          )}
          <br />
          {summary.scoreMusicXmlAvailable ? (
            <>악보 미리보기용 MusicXML 사용 가능.</>
          ) : (
            <span className="err">이 단계에서는 악보 XML을 아직 쓸 수 없습니다.</span>
          )}
          {summary.cleanScorePdf?.exists && (
            <div
              style={{
                marginTop: 10,
                padding: '10px 12px',
                background: '#2a2f3a',
                borderRadius: 8,
                border: '1px solid #3c4049',
              }}
            >
              <div style={{ marginBottom: 8, color: '#e8eaed', lineHeight: 1.45 }}>
                <strong>OMR 입력 PDF</strong> — <code style={{ fontSize: '0.82rem' }}>clean_score_only.pdf</code>
                (폰트 크기로 가사만 제거). 음표·오선이 원본과 같아야 합니다.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', alignItems: 'center' }}>
                <a
                  href={`/api/diagnostic/${jobId}/clean-score-pdf`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#8ab4ff', fontWeight: 600 }}
                >
                  새 탭에서 PDF 열기
                </a>
                <a
                  href={`/api/diagnostic/${jobId}/clean-score-pdf?download=1`}
                  style={{ color: '#8ab4ff', fontWeight: 600 }}
                  download
                >
                  clean_score PDF 다운로드
                </a>
              </div>
            </div>
          )}
          {summary.maskedPdf.exists && (
            <div
              style={{
                marginTop: 10,
                padding: '10px 12px',
                background: '#2a2f3a',
                borderRadius: 8,
                border: '1px solid #3c4049',
              }}
            >
              <div style={{ marginBottom: 8, color: '#e8eaed', lineHeight: 1.45 }}>
                <strong>OMR 입력 PDF</strong> — 서버의 <code style={{ fontSize: '0.82rem' }}>masked_input.pdf</code>와 동일합니다. MXL·MusicXML이 이미 잘못돼
                있어도, <strong>OCR 마스킹 직후</strong> 악보가 맞는지 여기서 먼저 확인하세요.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', alignItems: 'center' }}>
                <a
                  href={`/api/diagnostic/${jobId}/masked-pdf`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#8ab4ff', fontWeight: 600 }}
                >
                  새 탭에서 PDF 열기
                </a>
                <a
                  href={`/api/diagnostic/${jobId}/masked-pdf?download=1`}
                  style={{ color: '#8ab4ff', fontWeight: 600 }}
                  download
                >
                  마스킹 PDF 다운로드
                </a>
              </div>
            </div>
          )}
          {summary.originalPdf.exists && (
            <div style={{ marginTop: 8, fontSize: '0.84rem', color: '#9aa0a6' }}>
              업로드 원본 PDF:{' '}
              <a
                href={`/api/diagnostic/${jobId}/original-pdf`}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#8ab4ff' }}
              >
                열기
              </a>
              {' · '}
              <a href={`/api/diagnostic/${jobId}/original-pdf?download=1`} style={{ color: '#8ab4ff' }} download>
                다운로드
              </a>
            </div>
          )}
          {audiverisLegacy && (
          <AudiverisStepProbeSection
            jobId={jobId}
            maskedPdfExists={summary.maskedPdf.exists}
            cleanScorePdfExists={Boolean(summary.cleanScorePdf?.exists)}
          />
          )}
        </div>
      )}

      {summary && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            페이지 (1〜{summary.pageCountForUi})
            <input
              type="number"
              min={1}
              max={summary.pageCountForUi}
              value={page}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setPage(Number.isFinite(n) ? Math.max(1, Math.min(summary.pageCountForUi, n)) : 1);
              }}
              style={{ width: '4.5rem' }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            렌더 DPI
            <select value={dpi} onChange={(e) => setDpi(parseInt(e.target.value, 10))}>
              <option value={96}>96</option>
              <option value={132}>132</option>
              <option value={168}>168</option>
              <option value={200}>200</option>
            </select>
          </label>
          {summary.scoreMusicXmlAvailable && showOsmdPreview && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                파트(성부)
                <select
                  value={partId}
                  onChange={(e) => setPartId(e.target.value)}
                  style={{ minWidth: 120 }}
                >
                  <option value="">전체</option>
                  {parts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.id})
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                악보 확대
                <input
                  type="range"
                  min={0.35}
                  max={1.2}
                  step={0.05}
                  value={scoreZoom}
                  onChange={(e) => setScoreZoom(parseFloat(e.target.value))}
                />
                <span style={{ width: '2.5rem' }}>{Math.round(scoreZoom * 100)}%</span>
              </label>
            </>
          )}
          {summary.scoreMusicXmlAvailable && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showOsmdPreview}
                onChange={(e) => setShowOsmdPreview(e.target.checked)}
              />
              악보 미리보기 (MusicXML·무거울 수 있음)
            </label>
          )}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            summary?.scoreMusicXmlAvailable && showOsmdPreview
              ? 'repeat(auto-fit, minmax(220px, 1fr))'
              : 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 12,
          flex: 1,
          minHeight: 280,
          minWidth: 0,
          overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-color, #e8eaed)' }}>원본 PDF (페이지 {page})</div>
          {origSrc ? (
            <>
              <div
                style={{
                  background: '#eef0f3',
                  borderRadius: 4,
                  border: '1px solid #bdc1c6',
                  overflow: 'auto',
                  maxHeight: 'min(72vh, 920px)',
                }}
              >
                <img
                  key={origSrc}
                  src={origSrc}
                  alt={`원본 ${page}p`}
                  decoding="async"
                  loading="eager"
                  style={{
                    display: 'block',
                    width: '100%',
                    height: 'auto',
                    minHeight: 60,
                  }}
                  onLoad={() => setPngFailOrig(false)}
                  onError={() => setPngFailOrig(true)}
                />
              </div>
              {pngFailOrig && (
                <div className="err" style={{ fontSize: '0.82rem', lineHeight: 1.35 }}>
                  원본 페이지 PNG 미리보기 로드 실패. 서버의 <code style={{ fontSize: '0.76rem' }}>pdf_diagnostic.py</code>·Python 실행 경로·캐시(
                  <code style={{ fontSize: '0.76rem' }}>.diag-cache/</code>)를 확인하거나 DPI를 바꿔 다시 불러오세요.{' '}
                  <button type="button" className="btn-muted" style={{ marginTop: 6 }} onClick={() => setPngBust((n) => n + 1)}>
                    PNG 다시 불러오기
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="sub">{summaryBusy ? '…' : '이미지 없음'}</div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-color, #e8eaed)' }}>
            {audiverisCompareLabel} (페이지 {page})
          </div>
          {!audiverisCompareSrc && <div className="sub">OMR 입력 PDF 없음 — 비교 불가</div>}
          {audiverisCompareSrc && (
            <>
              <div
                style={{
                  background: '#eef0f3',
                  borderRadius: 4,
                  border: '1px solid #bdc1c6',
                  overflow: 'auto',
                  maxHeight: 'min(72vh, 920px)',
                }}
              >
                <img
                  key={audiverisCompareSrc}
                  src={audiverisCompareSrc}
                  alt={`OMR 입력 ${page}p`}
                  decoding="async"
                  loading="eager"
                  style={{
                    display: 'block',
                    width: '100%',
                    height: 'auto',
                    minHeight: 60,
                  }}
                  onLoad={() => {
                    if (cleanScoreSrc) setPngFailClean(false);
                    else setPngFailMasked(false);
                  }}
                  onError={() => {
                    if (cleanScoreSrc) setPngFailClean(true);
                    else setPngFailMasked(true);
                  }}
                />
              </div>
              {(cleanScoreSrc ? pngFailClean : pngFailMasked) && (
                <div className="err" style={{ fontSize: '0.82rem', lineHeight: 1.35 }}>
                  OMR 입력 PDF PNG 미리보기 로드 실패. 위쪽 PDF 링크로 직접 열어 확인하세요.{' '}
                  <button type="button" className="btn-muted" style={{ marginTop: 6 }} onClick={() => setPngBust((n) => n + 1)}>
                    PNG 다시 불러오기
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        {summary?.scoreMusicXmlAvailable && showOsmdPreview && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, maxHeight: '70vh' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-color, #e8eaed)' }}>OMR 악보(파트 필터)</div>
            {filteredXml ? (
              <OsmdBlock xml={filteredXml} zoom={scoreZoom} />
            ) : (
              <div className="sub">불러오는 중…</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

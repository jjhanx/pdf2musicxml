import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { forEachGraphicalMeasure, measureMxlFromGraphic, partIdFromGraphic } from './osmdMeasureClick';

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function getNoteSvgElement(
  osmd: OpenSheetMusicDisplay,
  gn: Record<string, unknown>,
  sourceNote: Record<string, unknown> | null,
): SVGGraphicsElement | null {
  const rules = (osmd as unknown as { EngravingRules?: { GNote?: (n: unknown) => unknown } }).EngravingRules;
  const candidates: unknown[] = [];
  if (rules?.GNote && sourceNote) {
    try {
      candidates.push(rules.GNote(sourceNote));
    } catch {
      /* ignore */
    }
  }
  candidates.push(gn);

  for (const cand of candidates) {
    const rec = asRecord(cand);
    if (!rec) continue;
    const svgEl = (rec as { getSVGGElement?: () => SVGGraphicsElement | null }).getSVGGElement?.();
    if (svgEl instanceof SVGElement) {
      return (svgEl.closest('.vf-stavenote, .vf-staveNote') ?? svgEl) as SVGGraphicsElement;
    }
    // Also check vfnote / vfStaveNote
    const vf = rec.vfnote ?? rec.VfNote ?? rec.vfStaveNote ?? rec.VfStaveNote;
    if (vf && typeof vf === 'object') {
      const vel = (vf as { getSVGElement?: () => SVGElement; attrs?: { el?: SVGElement } }).getSVGElement?.() ??
        (vf as { attrs?: { el?: SVGElement } }).attrs?.el;
      if (vel instanceof SVGElement) {
        return (vel.closest('.vf-stavenote, .vf-staveNote') ?? vel) as SVGGraphicsElement;
      }
    }
  }
  return null;
}

/**
 * OSMD / VexFlow에서 아티큘레이션(Accent, Staccato, Breath-mark 등)이 이음줄(Slur)이나 오선과 겹치지 않도록
 * MusicXML default-y 또는 슬러-아티큘레이션 동시 배치 시 안전한 수직 오프셋(충돌 회피 간격)을 SVG에 적용합니다.
 */
export function applyOsmdArticulationOffsets(host: HTMLElement, osmd: OpenSheetMusicDisplay): number {
  if (!host || !osmd?.GraphicSheet) return 0;

  let shiftedCount = 0;
  const zoom = osmd.zoom || 1.0;

  forEachGraphicalMeasure(osmd, (measureGraphic, mIndex) => {
    const mg = asRecord(measureGraphic);
    if (!mg) return;

    for (const seRaw of (mg.staffEntries ?? mg.StaffEntries ?? []) as unknown[]) {
      const se = asRecord(seRaw);
      if (!se) continue;

      for (const gveRaw of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as unknown[]) {
        const gve = asRecord(gveRaw);
        if (!gve) continue;

        for (const gnRaw of (gve.notes ?? gve.Notes ?? []) as unknown[]) {
          const gn = asRecord(gnRaw);
          if (!gn) continue;

          const sourceNote = asRecord(gn.sourceNote ?? gn.SourceNote);
          if (!sourceNote) continue;

          const articulations = (sourceNote.Articulations ?? sourceNote.articulations) as unknown[];
          if (!Array.isArray(articulations) || articulations.length === 0) continue;

          let hasBelowSlur = false;
          let hasBelowArticulation = false;
          let hasAboveArticulation = false;

          // Check slurs on sourceNote
          const slurs = (sourceNote.Slurs ?? sourceNote.slurs ?? []) as unknown[];
          if (Array.isArray(slurs) && slurs.length > 0) {
            for (const s of slurs) {
              const sr = asRecord(s);
              const spl = sr?.placement ?? sr?.PlacementXml;
              if (spl === 1 || spl === 'below' || spl === 'Below' || spl === undefined) {
                hasBelowSlur = true;
              }
            }
          }

          // Check articulations
          for (const art of articulations) {
            const ar = asRecord(art);
            if (!ar) continue;
            const pl = ar.placement ?? ar.PlacementXml ?? ar.placementXml;
            if (pl === 1 || pl === 'below' || pl === 'Below' || pl === undefined) {
              hasBelowArticulation = true;
            } else if (pl === 0 || pl === 'above' || pl === 'Above') {
              hasAboveArticulation = true;
            }
          }

          // Calculate desired pixel shift
          let shiftY = 0;
          if (hasBelowArticulation) {
            // 이음줄(Slur)과 악센트가 둘 다 아래쪽이면 슬러 곡선 아래로 22px 이상 내려 충돌을 완전히 피함
            if (hasBelowSlur) {
              shiftY = 22 * zoom;
            } else {
              shiftY = 12 * zoom;
            }
          } else if (hasAboveArticulation) {
            shiftY = -12 * zoom;
          }

          if (Math.abs(shiftY) < 1) continue;

          const stavenote = getNoteSvgElement(osmd, gn, sourceNote);
          if (!stavenote) continue;

          // Find articulation elements in stavenote or in adjacent modifiers
          const artCandidates: Element[] = [];
          
          // 1. Direct modifier/articulation classes
          for (const el of stavenote.querySelectorAll('.vf-modifiers, .vf-articulation, g.vf-modifier, [class*="articulation"]')) {
            artCandidates.push(el);
          }

          // 2. If none found with class, look for non-notehead, non-stem path elements in stavenote
          if (artCandidates.length === 0) {
            for (const p of stavenote.querySelectorAll('path')) {
              if (p.closest('.vf-notehead, .vf-stem, .vf-flag, [class*="notehead"], [class*="stem"]')) continue;
              artCandidates.push(p);
            }
          }

          // 3. Also check sibling elements if VexFlow drew modifiers right after stavenote
          let nextEl = stavenote.nextElementSibling;
          while (nextEl && (nextEl.classList.contains('vf-modifiers') || nextEl.classList.contains('vf-articulation') || nextEl.classList.contains('vf-modifier'))) {
            artCandidates.push(nextEl);
            nextEl = nextEl.nextElementSibling;
          }

          for (const targetEl of artCandidates) {
            const svgEl = targetEl as SVGGraphicsElement;
            if (svgEl.getAttribute('data-art-shifted') === 'true') continue;

            const tr = svgEl.getAttribute('transform') ?? '';
            const m = /translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/.exec(tr);
            const ox = m ? parseFloat(m[1]!) : 0;
            const oy = m ? parseFloat(m[2] ?? '0') : 0;
            const rest = tr.replace(/translate\(\s*[-\d.]+\s*(?:,\s*[-\d.]+)?\s*\)/, '').trim();
            const prefix = `translate(${ox}, ${oy + shiftY})`;
            svgEl.setAttribute('transform', rest ? `${prefix} ${rest}` : prefix);
            svgEl.setAttribute('data-art-shifted', 'true');
            shiftedCount++;
          }
        }
      }
    }
  });

  return shiftedCount;
}

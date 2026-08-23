import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { forEachGraphicalMeasure, measureMxlFromGraphic, partIdFromGraphic } from './osmdMeasureClick';

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function graphicNoteStavenote(osmd: OpenSheetMusicDisplay, gn: Record<string, unknown>): SVGGraphicsElement | null {
  const gve = asRecord(gn.parentStaffEntry ?? gn.ParentStaffEntry);
  const vfGroup = gve?.vfStaveNote ?? gve?.VfStaveNote ?? gn.vfnote ?? gn.VfNote;
  if (vfGroup && typeof vfGroup === 'object') {
    const el = (vfGroup as { getSVGElement?: () => SVGElement; attrs?: { el?: SVGElement } }).getSVGElement?.() ??
      (vfGroup as { attrs?: { el?: SVGElement } }).attrs?.el;
    if (el instanceof (osmd as any).graphic?.window?.SVGGraphicsElement || el instanceof SVGElement) {
      return el as SVGGraphicsElement;
    }
  }
  return null;
}

/**
 * OSMD / VexFlow에서 아티큘레이션(Accent, Staccato 등)이 이음줄(Slur)이나 오선과 겹치지 않도록
 * MusicXML default-y 또는 슬러-아티큘레이션 동시 배치 시 안전한 수직 오프셋을 SVG에 적용합니다.
 */
export function applyOsmdArticulationOffsets(host: HTMLElement, osmd: OpenSheetMusicDisplay): number {
  if (!host || !osmd?.GraphicSheet) return 0;

  let shiftedCount = 0;
  const unit = (osmd.EngravingRules as any)?.unit ?? 10;
  const zoom = osmd.zoom || 1.0;

  forEachGraphicalMeasure(osmd, (measureGraphic, mIndex) => {
    const measureMxl = measureMxlFromGraphic(measureGraphic) || String(mIndex + 1);
    const partId = partIdFromGraphic(measureGraphic) || '';

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

          // Check notations for default-y or below placement
          const notations = asRecord(sourceNote.notations ?? sourceNote.Notations);
          let customDefaultY: number | null = null;
          let hasBelowSlur = false;
          let hasBelowArticulation = false;
          let hasAboveArticulation = false;

          // Check slurs on note or voice
          const slurs = (sourceNote.Slurs ?? sourceNote.slurs ?? []) as unknown[];
          if (Array.isArray(slurs)) {
            for (const s of slurs) {
              const sr = asRecord(s);
              const spl = sr?.placement ?? sr?.PlacementXml;
              if (spl === 1 || spl === 'below' || spl === 'Below') {
                hasBelowSlur = true;
              }
            }
          }

          // Check articulations
          for (const art of articulations) {
            const ar = asRecord(art);
            if (!ar) continue;
            const pl = ar.placement ?? ar.PlacementXml ?? ar.placementXml;
            if (pl === 1 || pl === 'below' || pl === 'Below') {
              hasBelowArticulation = true;
            } else if (pl === 0 || pl === 'above' || pl === 'Above') {
              hasAboveArticulation = true;
            }
          }

          const stavenote = graphicNoteStavenote(osmd, gn);
          if (!stavenote) continue;

          // Calculate desired pixel offset
          let shiftY = 0;
          if (hasBelowArticulation) {
            // If there is a slur below or below articulation, shift down by 14~20px to clear the slur curve
            if (hasBelowSlur) {
              shiftY = 16 * zoom;
            } else {
              shiftY = 8 * zoom;
            }
          } else if (hasAboveArticulation) {
            shiftY = -8 * zoom;
          }

          if (Math.abs(shiftY) < 1) continue;

          // Find articulation elements in stavenote
          // VexFlow attaches modifiers with class 'vf-modifiers', 'vf-articulation', or child paths
          const artEls = Array.from(stavenote.querySelectorAll('.vf-modifiers, .vf-articulation, g.vf-modifier'));
          
          if (artEls.length > 0) {
            for (const artEl of artEls) {
              const svgEl = artEl as SVGGraphicsElement;
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
          } else {
            // Look for non-notehead, non-stem, non-flag path/g elements inside stavenote
            const childGroups = Array.from(stavenote.querySelectorAll('path:not(.vf-notehead path), g:not(.vf-notehead):not(.vf-stem):not(.vf-flag)'));
            for (const cg of childGroups) {
              const svgEl = cg as SVGGraphicsElement;
              if (svgEl.classList.contains('vf-notehead') || svgEl.classList.contains('vf-stem')) continue;
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
    }
  });

  return shiftedCount;
}

/**
 * 463 + po1/2/2/3/4 + full-score-like (no staff strip reorder) — does SVG align pull F4 to E5?
 */
import fs from "node:fs";
import { JSDOM } from "jsdom";
import osmdLib from "opensheetmusicdisplay";
import { buildOsmdPreviewXml, type ScorePartForPreview } from "../src/AudiverisInspectPanel";
import { repairRestDisplayForOsmdPreview, repairMissingNoteTypesForOsmdPreview } from "../shared/musicXmlRestDisplay";
import { repairUnderfullMeasuresForOsmdPreview } from "../shared/musicXmlUnderfullMeasureForOsmd";
import { repairTimelineForOsmdPreview, stripDefaultXyKeepLayoutAttrsForOsmdPreview } from "../shared/musicXmlTimelineCleanup";
import { alignOsmdPreviewNotesByOnsetColumn, registerOsmdPreviewXmlForAlign } from "../src/osmdOnsetColumnAlignFix";
import { forEachGraphicalMeasure, measureMxlFromGraphic } from "../src/osmdMeasureClick";
import { collectPreviewNoteLayoutTargetsFromXml } from "../shared/musicXmlPlayOrder";

const OSMD =
  (osmdLib as any).OpenSheetMusicDisplay ?? (osmdLib as any).default?.OpenSheetMusicDisplay;
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
  requestAnimationFrame: (cb: any) => { setTimeout(() => cb(0), 0); return 0; },
});

function sanitize(xml: string) {
  let out = repairRestDisplayForOsmdPreview(xml);
  out = repairMissingNoteTypesForOsmdPreview(out);
  out = repairTimelineForOsmdPreview(out);
  out = repairUnderfullMeasuresForOsmdPreview(out);
  return stripDefaultXyKeepLayoutAttrsForOsmdPreview(out);
}

function asRecord(v: unknown): any {
  return v && typeof v === "object" ? v : null;
}
function pitchFromVf(vfpitch: unknown): string | null {
  const raw = Array.isArray(vfpitch) ? vfpitch[0] : vfpitch;
  if (typeof raw !== "string") return null;
  const m = /^([a-g])(b?)n\/(\d+)$/i.exec(raw.trim());
  if (!m) return null;
  return `${m[1]!.toUpperCase()}${m[2] === "b" ? "b" : ""}${m[3]}`;
}
function noteheadX(sn: SVGGraphicsElement): number | null {
  const xs: number[] = [];
  for (const path of sn.querySelectorAll(".vf-notehead path")) {
    const d = path.getAttribute("d");
    if (!d) continue;
    const m = /^M\s*([-\d.]+)/.exec(d.trim());
    if (!m) continue;
    const pathEl = path as SVGGraphicsElement;
    const ctm = pathEl.getCTM?.() ?? sn.getCTM?.();
    if (ctm) xs.push(ctm.a * parseFloat(m[1]!) + ctm.e);
    else xs.push(parseFloat(m[1]!));
  }
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

const raw = fs.readFileSync("_smoke/_tmp_463_po_fixed.xml", "utf8");
const scoreParts: ScorePartForPreview[] = [
  { id: "P1", name: "S", label: "S" },
  { id: "P2", name: "A", label: "A" },
  { id: "P3", name: "T", label: "T" },
  { id: "P4", name: "B", label: "B" },
  { id: "P5", name: "Piano", label: "PR", staffWithinPart: 1 },
];
// Full score (filter null) like stage-3 overview, OR PR filter
for (const mode of ["full", "pr"] as const) {
  const built =
    mode === "full"
      ? buildOsmdPreviewXml(raw, scoreParts, null, { verbatim: true })
      : buildOsmdPreviewXml(raw, scoreParts, { partId: "P5", label: "PR", staffWithinPart: 1 }, { verbatim: true });
  const forOsmd = sanitize(built);
  const targets = collectPreviewNoteLayoutTargetsFromXml(forOsmd).filter(
    (t) => t.measureNumber === 17 && ["F4", "Bb4", "E5", "F5"].includes(t.pitch) && (t.playOrder != null || t.pitch === "F4"),
  );
  console.log(mode, "targets sample", targets.slice(0, 12));

  const host = document.getElementById("host")!;
  host.innerHTML = "";
  host.style.width = "1100px";
  const osmd = new OSMD(host, { autoResize: true, backend: "svg", drawMeasureNumbers: false });
  registerOsmdPreviewXmlForAlign(osmd, forOsmd);
  await osmd.load(forOsmd);
  osmd.render();
  // BEFORE align
  const before: any[] = [];
  const after: any[] = [];
  const collect = (into: any[]) => {
    const seen = new Set();
    forEachGraphicalMeasure(osmd, (gmRaw) => {
      if (measureMxlFromGraphic(gmRaw) !== 17) return;
      const gm = asRecord(gmRaw);
      for (const seRaw of gm?.staffEntries ?? []) {
        for (const gveRaw of asRecord(seRaw)?.graphicalVoiceEntries ?? []) {
          const gve = asRecord(gveRaw);
          for (const gnRaw of gve?.notes ?? []) {
            const gn = asRecord(gnRaw);
            const pitch = pitchFromVf(gn?.vfpitch);
            if (!pitch || !["F4", "E5", "F5", "Bb4"].includes(pitch)) continue;
            const src = asRecord(gn.sourceNote);
            const rules = asRecord(osmd.EngravingRules);
            let stavenote = null;
            try {
              const gnote = rules?.GNote?.(src);
              const svgEl = asRecord(gnote)?.getSVGGElement?.();
              stavenote = svgEl?.closest?.(".vf-stavenote") ?? svgEl;
            } catch {}
            if (!stavenote || seen.has(stavenote)) continue;
            seen.add(stavenote);
            const x = noteheadX(stavenote);
            if (x == null) continue;
            into.push({ pitch, x, heads: stavenote.querySelectorAll(".vf-notehead").length });
          }
        }
      }
    });
  };
  collect(before);
  alignOsmdPreviewNotesByOnsetColumn(osmd, forOsmd);
  collect(after);
  console.log(mode, "BEFORE", before.sort((a,b)=>a.x-b.x));
  console.log(mode, "AFTER", after.sort((a,b)=>a.x-b.x));
}

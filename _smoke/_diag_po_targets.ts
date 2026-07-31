import { JSDOM } from "jsdom";
const dom = new JSDOM("<!DOCTYPE html><html></html>");
Object.assign(globalThis, { document: dom.window.document, DOMParser: dom.window.DOMParser, XMLSerializer: dom.window.XMLSerializer, Node: dom.window.Node, Element: dom.window.Element });
import fs from "node:fs";
import { execSync } from "node:child_process";
import { repairTimelineForOsmdPreview, snapshotNoteDefaultXForOsmdPreview, reorderSingleStaffTimelineByOnsetForOsmdPreview, normalizeMultiVoiceLayersForOsmdPreview, realignMeasureDefaultXFromTimelineForOsmd, stripDefaultXyKeepLayoutAttrsForOsmdPreview } from "../shared/musicXmlTimelineCleanup";
import { pruneCrossStaffTimelineForOsmdPreview } from "../shared/musicXmlStaffPreview";
import { applyPlayOrderLayoutToMeasure, collectPreviewNoteLayoutTargetsFromXml, HITL_PLAY_ORDER_ATTR } from "../shared/musicXmlPlayOrder";

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
execSync("python _smoke/_export_463_po.py", { stdio: "inherit" });
const raw = fs.readFileSync("_smoke/_tmp_463_po_fixed.xml", "utf8");
let xml = repairTimelineForOsmdPreview(raw);
const doc = new DOMParser().parseFromString(xml, "text/xml");
const part = [...doc.querySelectorAll("part")].find(p => p.getAttribute("id")==="P5")!;
const m17 = [...part.children].find(c => local(c)==="measure" && c.getAttribute("number")==="17") as Element;
for (const child of [...m17.children]) {
  if (local(child)==="note") {
    const st = child.querySelector("staff")?.textContent?.trim();
    if (st && st !== "1") child.remove();
  }
}
m17.querySelectorAll("note staff").forEach(el => { el.textContent = "1"; });
pruneCrossStaffTimelineForOsmdPreview(m17, 1);
snapshotNoteDefaultXForOsmdPreview(m17);
reorderSingleStaffTimelineByOnsetForOsmdPreview(m17);
normalizeMultiVoiceLayersForOsmdPreview(m17);
realignMeasureDefaultXFromTimelineForOsmd(m17);
applyPlayOrderLayoutToMeasure(m17);
console.log("leaders:");
for (const c of [...m17.children]) {
  if (local(c)!=="note" || c.querySelector("chord")) continue;
  const step = c.querySelector("step")?.textContent;
  const oct = c.querySelector("octave")?.textContent;
  const alter = c.querySelector("alter")?.textContent;
  const acc = alter==="-1"?"b":"";
  const v = c.querySelector("voice")?.textContent;
  const po = c.getAttribute(HITL_PLAY_ORDER_ATTR);
  const lx = c.getAttribute("data-osmd-layout-x");
  console.log(`  ${step}${acc}${oct} v=${v} po=${po} lx=${lx}`);
}
const ser = stripDefaultXyKeepLayoutAttrsForOsmdPreview(new XMLSerializer().serializeToString(doc));
const t = collectPreviewNoteLayoutTargetsFromXml(ser).filter(x => x.measureNumber===17 && x.staff===1);
console.log("targets:");
for (const x of t) console.log(`  ${x.pitch} v=${x.voice} po=${x.playOrder} x=${x.defaultXTenths}`);

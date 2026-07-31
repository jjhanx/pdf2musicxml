import { JSDOM } from "jsdom";
const dom = new JSDOM("<!DOCTYPE html><html></html>");
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
});
import fs from "node:fs";
import {
  repairTimelineForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
  stripDefaultXyKeepLayoutAttrsForOsmdPreview,
} from "../shared/musicXmlTimelineCleanup";
import { pruneCrossStaffTimelineForOsmdPreview } from "../shared/musicXmlStaffPreview";
import { applyPlayOrderLayoutToMeasure, collectPreviewNoteLayoutTargetsFromXml } from "../shared/musicXmlPlayOrder";

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
const raw = fs.readFileSync("_smoke/_tmp_463_po_fixed.xml", "utf8");
let xml = repairTimelineForOsmdPreview(raw);
const doc = new DOMParser().parseFromString(xml, "text/xml");
const part = [...doc.querySelectorAll("part,*|part")].find((p) => p.getAttribute("id") === "P5")!;
const m17 = [...part.children].find((c) => local(c) === "measure" && c.getAttribute("number") === "17") as Element;
for (const child of [...m17.children]) {
  if (local(child) === "note") {
    const st = child.querySelector("staff,*|staff")?.textContent?.trim();
    if (st && st !== "1") child.remove();
  }
}
m17.querySelectorAll("note staff,note *|staff").forEach((el) => { el.textContent = "1"; });
pruneCrossStaffTimelineForOsmdPreview(m17, 1);
snapshotNoteDefaultXForOsmdPreview(m17);
reorderSingleStaffTimelineByOnsetForOsmdPreview(m17);
normalizeMultiVoiceLayersForOsmdPreview(m17);
realignMeasureDefaultXFromTimelineForOsmd(m17);
applyPlayOrderLayoutToMeasure(m17);
console.log("463 after layout:");
for (const child of [...m17.children]) {
  if (local(child) !== "note") continue;
  if (child.querySelector(":scope > chord, :scope > *|chord")) continue;
  const step = child.querySelector("step,*|step")?.textContent ?? "?";
  const oct = child.querySelector("octave,*|octave")?.textContent ?? "?";
  const alter = child.querySelector("alter,*|alter")?.textContent;
  const acc = alter === "-1" ? "b" : alter === "1" ? "#" : "";
  const v = child.querySelector("voice,*|voice")?.textContent ?? "?";
  const po = child.getAttribute("data-hitl-play-order");
  const lx = child.getAttribute("data-osmd-layout-x");
  console.log(`  ${step}${acc}${oct} v=${v} po=${po} layout=${lx}`);
}

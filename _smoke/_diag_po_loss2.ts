import { JSDOM } from "jsdom";
const w = new JSDOM("").window;
Object.assign(globalThis, { DOMParser: w.DOMParser, Element: w.Element, Node: w.Node });
import fs from "fs";
import { execSync } from "child_process";
import {
  repairTimelineForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
  collectStaffNoteOnsets,
} from "../shared/musicXmlTimelineCleanup";
import { pruneCrossStaffTimelineForOsmdPreview } from "../shared/musicXmlStaffPreview";
import { HITL_PLAY_ORDER_ATTR, applyPlayOrderLayoutToMeasure, sanitizeConflictingPlayOrders } from "../shared/musicXmlPlayOrder";

const local = (el: Element) => el.localName?.toLowerCase() ?? "";
execSync("python _smoke/_export_463_po.py", { stdio: "inherit" });
let xml = repairTimelineForOsmdPreview(fs.readFileSync("_smoke/_tmp_463_po_fixed.xml", "utf8"));
const doc = new DOMParser().parseFromString(xml, "text/xml");
const part = [...doc.querySelectorAll("part")].find((p) => p.getAttribute("id") === "P5")!;
const m17 = [...part.children].find((c) => local(c) === "measure" && c.getAttribute("number") === "17") as Element;
for (const child of [...m17.children]) {
  if (local(child) === "note") {
    const st = child.querySelector("staff")?.textContent?.trim();
    if (st && st !== "1") child.remove();
  }
}
m17.querySelectorAll("note staff").forEach((el) => { el.textContent = "1"; });
pruneCrossStaffTimelineForOsmdPreview(m17, 1);

function dump(label: string) {
  console.log("===", label, "===");
  const onsets = collectStaffNoteOnsets(m17);
  for (const c of [...m17.children]) {
    if (local(c) === "note" && !c.querySelector("chord")) {
      console.log(
        `  ${c.querySelector("step")?.textContent}${c.querySelector("octave")?.textContent} v=${c.querySelector("voice")?.textContent} po=${c.getAttribute(HITL_PLAY_ORDER_ATTR)} onset=${onsets.get(c)} lx=${c.getAttribute("data-osmd-layout-x")}`,
      );
    } else if (local(c) === "backup" || local(c) === "forward") {
      console.log(`  <${local(c)}> d=${c.querySelector("duration")?.textContent} v=${c.querySelector("voice")?.textContent}`);
    }
  }
}

dump("1 prune");
snapshotNoteDefaultXForOsmdPreview(m17);
reorderSingleStaffTimelineByOnsetForOsmdPreview(m17);
dump("2 reorder");
normalizeMultiVoiceLayersForOsmdPreview(m17);
dump("3 normalize");
console.log("sanitize?", sanitizeConflictingPlayOrders(m17));
dump("4 sanitize");
applyPlayOrderLayoutToMeasure(m17);
dump("5 applyPlayOrderLayout");
realignMeasureDefaultXFromTimelineForOsmd(m17);
dump("6 realign");

// second repairTimeline like sanitize
const ser = new XMLSerializer().serializeToString(doc);
const xml2 = repairTimelineForOsmdPreview(ser);
const doc2 = new DOMParser().parseFromString(xml2, "text/xml");
const m172 = [...[...doc2.querySelectorAll("part")].find((p) => p.getAttribute("id") === "P5")!.children].find(
  (c) => local(c) === "measure" && c.getAttribute("number") === "17",
)!;
console.log("=== after full-doc repairTimeline ===");
for (const c of [...m172.children]) {
  if (local(c) === "note" && !c.querySelector("chord")) {
    console.log(
      `  ${c.querySelector("step")?.textContent}${c.querySelector("octave")?.textContent} v=${c.querySelector("voice")?.textContent} po=${c.getAttribute(HITL_PLAY_ORDER_ATTR)} lx=${c.getAttribute("data-osmd-layout-x")}`,
    );
  } else if (local(c) === "backup" || local(c) === "forward") {
    console.log(`  <${local(c)}> d=${c.querySelector("duration")?.textContent} v=${c.querySelector("voice")?.textContent}`);
  }
}

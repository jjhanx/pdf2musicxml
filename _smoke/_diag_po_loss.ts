import { JSDOM } from "jsdom";
Object.assign(globalThis, { DOMParser: new JSDOM().window.DOMParser, Element: new JSDOM().window.Element });
import fs from "fs";
import { execSync } from "child_process";
import { repairTimelineForOsmdPreview, snapshotNoteDefaultXForOsmdPreview, reorderSingleStaffTimelineByOnsetForOsmdPreview, normalizeMultiVoiceLayersForOsmdPreview, realignMeasureDefaultXFromTimelineForOsmd } from "../shared/musicXmlTimelineCleanup";
import { pruneCrossStaffTimelineForOsmdPreview } from "../shared/musicXmlStaffPreview";
import { HITL_PLAY_ORDER_ATTR, sanitizeConflictingPlayOrders } from "../shared/musicXmlPlayOrder";
import { collectStaffNoteOnsets } from "../shared/musicXmlTimelineCleanup";

const local = (el: Element) => el.localName?.toLowerCase() ?? "";
execSync("python _smoke/_export_463_po.py", { stdio: "inherit" });
let xml = repairTimelineForOsmdPreview(fs.readFileSync("_smoke/_tmp_463_po_fixed.xml","utf8"));
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

function dump(label: string) {
  const onsets = collectStaffNoteOnsets(m17);
  console.log("===", label, "===");
  for (const c of [...m17.children]) {
    if (local(c)==="note" && !c.querySelector("chord")) {
      const step = c.querySelector("step")?.textContent;
      const oct = c.querySelector("octave")?.textContent;
      console.log(`  ${step}${oct} v=${c.querySelector("voice")?.textContent} po=${c.getAttribute(HITL_PLAY_ORDER_ATTR)} onset=${onsets.get(c)}`);
    } else if (local(c)==="backup" || local(c)==="forward") {
      console.log(`  <${local(c)}> d=${c.querySelector("duration")?.textContent} v=${c.querySelector("voice")?.textContent}`);
    }
  }
}
dump("after prune");
snapshotNoteDefaultXForOsmdPreview(m17);
reorderSingleStaffTimelineByOnsetForOsmdPreview(m17);
dump("after reorder");
normalizeMultiVoiceLayersForOsmdPreview(m17);
dump("after normalize");
console.log("sanitize would change?", sanitizeConflictingPlayOrders(m17));
dump("after sanitize");

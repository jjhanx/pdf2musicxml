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
import { execSync } from "node:child_process";
import {
  repairTimelineForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
  stripDefaultXyKeepLayoutAttrsForOsmdPreview,
} from "../shared/musicXmlTimelineCleanup";
import { pruneCrossStaffTimelineForOsmdPreview } from "../shared/musicXmlStaffPreview";
import {
  applyPlayOrderLayoutToMeasure,
  collectPreviewNoteLayoutTargetsFromXml,
  HITL_PLAY_ORDER_ATTR,
  OSMD_LAYOUT_X_ATTR,
} from "../shared/musicXmlPlayOrder";

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function dump(label: string, raw: string) {
  let xml = repairTimelineForOsmdPreview(raw);
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const part = [...doc.querySelectorAll("part,*|part")].find((p) => p.getAttribute("id") === "P5")!;
  const m17 = [...part.children].find(
    (c) => local(c) === "measure" && c.getAttribute("number") === "17",
  ) as Element;
  for (const child of [...m17.children]) {
    if (local(child) === "note") {
      const st = child.querySelector("staff,*|staff")?.textContent?.trim();
      if (st && st !== "1") child.remove();
    }
  }
  m17.querySelectorAll("note staff,note *|staff").forEach((el) => {
    el.textContent = "1";
  });
  pruneCrossStaffTimelineForOsmdPreview(m17, 1);
  snapshotNoteDefaultXForOsmdPreview(m17);
  reorderSingleStaffTimelineByOnsetForOsmdPreview(m17);
  normalizeMultiVoiceLayersForOsmdPreview(m17);
  realignMeasureDefaultXFromTimelineForOsmd(m17);
  applyPlayOrderLayoutToMeasure(m17);
  console.log("===", label, "after layout ===");
  for (const child of [...m17.children]) {
    if (local(child) !== "note") continue;
    if (child.querySelector(":scope > chord, :scope > *|chord")) continue;
    const step = child.querySelector("step,*|step")?.textContent ?? "?";
    const oct = child.querySelector("octave,*|octave")?.textContent ?? "?";
    const alter = child.querySelector("alter,*|alter")?.textContent;
    const acc = alter === "-1" ? "b" : alter === "1" ? "#" : "";
    const v = child.querySelector("voice,*|voice")?.textContent ?? "?";
    const po = child.getAttribute(HITL_PLAY_ORDER_ATTR);
    const lx = child.getAttribute("data-osmd-layout-x");
    const dx = child.getAttribute("default-x");
    console.log(`  ${step}${acc}${oct} v=${v} po=${po} layout=${lx} dx=${dx}`);
  }
  const ser = new XMLSerializer().serializeToString(doc);
  const stripped = stripDefaultXyKeepLayoutAttrsForOsmdPreview(ser);
  const targets = collectPreviewNoteLayoutTargetsFromXml(stripped).filter(
    (t) => t.measureNumber === 17 && t.staff === 1,
  );
  console.log("targets after strip:");
  for (const t of targets) {
    if (!["F4", "Bb4", "B4", "E5", "F5", "D5"].includes(t.pitch)) continue;
    console.log(`  ${t.pitch} v=${t.voice} po=${t.playOrder} x=${t.defaultXTenths}`);
  }
}

const raw0 = execSync("python _smoke/_export_m17_play_order_234.py", {
  encoding: "utf8",
  maxBuffer: 30e6,
});
dump("0ea5", raw0);

const raw463 = execSync(
  'python -c "import io,sys,zipfile,xml.etree.ElementTree as ET; from pathlib import Path; sys.path.insert(0,\"scripts\"); import omr_hitl_lib as lib; z=zipfile.ZipFile(\"omr-work-4637986c.zip\"); data=z.read(\"review.mxl\");\ninner=zipfile.ZipFile(io.BytesIO(data)); xml=inner.read([n for n in inner.namelist() if n.endswith(\".xml\") and \"META\" not in n.upper()][0]); root=ET.fromstring(xml); lib.apply_fixes_to_root(root, [{\"kind\":\"setPlayOrder\",\"partId\":\"P5\",\"measureMxl\":\"17\",\"noteIndex\":0,\"playOrder\":1,\"staff\":1},{\"kind\":\"setPlayOrder\",\"partId\":\"P5\",\"measureMxl\":\"17\",\"noteIndex\":5,\"playOrder\":2,\"staff\":1},{\"kind\":\"setPlayOrder\",\"partId\":\"P5\",\"measureMxl\":\"17\",\"noteIndex\":3,\"playOrder\":2,\"staff\":1},{\"kind\":\"setPlayOrder\",\"partId\":\"P5\",\"measureMxl\":\"17\",\"noteIndex\":4,\"playOrder\":3,\"staff\":1},{\"kind\":\"setPlayOrder\",\"partId\":\"P5\",\"measureMxl\":\"17\",\"noteIndex\":7,\"playOrder\":4,\"staff\":1}]); sys.stdout.write(ET.tostring(root, encoding=\"unicode\"))"',
  { encoding: "utf8", maxBuffer: 30e6 },
);
dump("463", raw463);

/**
 * Dump m17 through HITL verbatim preview pipeline; find OSMD-invalid fields.
 * Run: npx tsx _smoke/inspect_m17_preview_pipeline.ts
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import { realignMeasureDefaultXFromTimelineForOsmd } from '../shared/musicXmlTimelineCleanup';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function measureHasLeadingForward(measure: Element): boolean {
  for (const child of [...measure.children]) {
    const tag = local(child);
    if (tag === 'forward') return true;
    if (tag === 'note') return false;
  }
  return false;
}

function buildPreview(rawXml: string): string {
  let xml = repairTimelineForOsmdPreview(rawXml);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = [...doc.querySelectorAll('part, *|part')].find((p) => p.getAttribute('id') === 'P5');
  if (!part) throw new Error('P5 missing');
  for (const measure of [...part.children]) {
    if (local(measure) !== 'measure') continue;
    for (const child of [...measure.children]) {
      if (local(child) === 'note') {
        const st = child.querySelector('staff, *|staff')?.textContent?.trim();
        if (st && st !== '1') child.remove();
      }
    }
    measure.querySelectorAll('note staff, note *|staff').forEach((el) => {
      el.textContent = '1';
    });
    pruneCrossStaffTimelineForOsmdPreview(measure, 1);
    console.log('m17 leading forward?', measure.getAttribute('number') === '17' && measureHasLeadingForward(measure));
    realignMeasureDefaultXFromTimelineForOsmd(measure);
  }
  xml = new XMLSerializer().serializeToString(doc);
  return repairTimelineForOsmdPreview(xml);
}

function inspectMeasure(measure: Element) {
  console.log('\n--- measure', measure.getAttribute('number'), '---');
  for (const c of [...measure.children]) {
    const tag = local(c);
    if (tag === 'note') {
      const step = c.querySelector('step, *|step')?.textContent ?? '?';
      const oct = c.querySelector('octave, *|octave')?.textContent ?? '?';
      const dur = c.querySelector('duration, *|duration')?.textContent ?? '';
      const type = c.querySelector('type, *|type')?.textContent ?? '';
      const voice = c.querySelector('voice, *|voice')?.textContent ?? '';
      const rest = c.querySelector('rest, *|rest') ? 'rest' : '';
      console.log(`${tag} ${step}${oct} dur=${JSON.stringify(dur)} type=${JSON.stringify(type)} voice=${voice} x=${c.getAttribute('default-x')} ${rest}`);
      if (!/^\d+$/.test(dur.trim())) console.log('  BAD DURATION');
      if (type && !/^(maxima|long|breve|whole|half|quarter|eighth|16th|32nd|64th|128th|256th|512th|1024th)$/.test(type)) {
        console.log('  BAD TYPE');
      }
    } else if (tag === 'forward' || tag === 'backup') {
      const dur = c.querySelector('duration, *|duration')?.textContent ?? '';
      const voice = c.querySelector('voice, *|voice')?.textContent ?? '';
      console.log(`${tag} dur=${JSON.stringify(dur)} voice=${voice}`);
      if (!/^\d+$/.test(dur.trim())) console.log('  BAD DURATION');
    }
  }
}

async function main() {
  if (!fs.existsSync('omr-work-0ea5ea52.zip')) {
    console.log('skip');
    return;
  }
  const rawXml = execSync('python _smoke/_export_m17_parallel_fix.py', {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  const preview = buildPreview(rawXml);
  fs.writeFileSync('_smoke/_m17_preview_pipeline.xml', preview);

  const doc = new DOMParser().parseFromString(preview, 'text/xml');
  const part = [...doc.querySelectorAll('part, *|part')].find((p) => p.getAttribute('id') === 'P5');
  const m17 = [...part!.children].find(
    (c) => local(c as Element) === 'measure' && (c as Element).getAttribute('number') === '17',
  ) as Element;
  inspectMeasure(m17);

  const bad = preview.match(/<duration>[^<\d][^<]*<\/duration>/g);
  console.log('\nNon-numeric durations in full preview:', bad?.slice(0, 20) ?? 'none');

  const osmdLib = await import('opensheetmusicdisplay');
  const OpenSheetMusicDisplay =
    (osmdLib as { OpenSheetMusicDisplay?: typeof import('opensheetmusicdisplay').OpenSheetMusicDisplay })
      .OpenSheetMusicDisplay ??
    (osmdLib as { default?: { OpenSheetMusicDisplay?: typeof import('opensheetmusicdisplay').OpenSheetMusicDisplay } })
      .default?.OpenSheetMusicDisplay;
  const host = document.createElement('div');
  const osmd = new OpenSheetMusicDisplay!(host, { autoResize: false, backend: 'svg' });
  try {
    await osmd.load(preview);
    console.log('\nOSMD load OK');
  } catch (e) {
    console.error('\nOSMD load FAIL', e);
    // try P5 only part extract
    const partOnly = `<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd"><score-partwise version="3.1">${part!.outerHTML}</score-partwise>`;
    fs.writeFileSync('_smoke/_m17_p5_only.xml', partOnly);
    try {
      await osmd.load(partOnly);
      console.log('P5-only load OK');
    } catch (e2) {
      console.error('P5-only load FAIL', e2);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

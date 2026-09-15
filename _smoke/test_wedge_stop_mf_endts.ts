/**
 * Probe OSMD continuous-dynamic endTs: stop±mf adjacency.
 * Run: npx tsx _smoke/test_wedge_stop_mf_endts.ts
 */
import { JSDOM } from 'jsdom';
import { normalizeDynamicsAndWedgesForOsmdPreview } from '../shared/musicXmlDirectionPlacement';
import { articulationDefaultYFromStaffSpaces } from '../shared/musicXmlArticulationDistance';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
  requestAnimationFrame: (cb: (t: number) => void) => setTimeout(() => cb(0), 0),
});

function buildXml(opts: {
  withMf: boolean;
  /** if true: notes0-2, note3, stop(+mf), note4 — stop after 4th sounding note start */
  stopAfterNote3: boolean;
}): string {
  const wDy = articulationDefaultYFromStaffSpaces('above', 1);
  const mfDy = articulationDefaultYFromStaffSpaces('above', 3);
  const stop =
    `<direction placement="above" default-y="${wDy}">` +
    `<direction-type><wedge type="stop" number="1" spread="0"/></direction-type>` +
    `<staff>1</staff></direction>`;
  const mf = opts.withMf
    ? `<direction placement="above" default-y="${mfDy}" data-hitl-dir-distance="3">` +
      `<direction-type><dynamics placement="above"><mf/></dynamics></direction-type>` +
      `<staff>1</staff></direction>`
    : '';
  const mid = opts.stopAfterNote3
    ? `<note><pitch><step>A</step><octave>4</octave></pitch><duration>12</duration><type>eighth</type><voice>1</voice></note>${stop}${mf}`
    : `${stop}${mf}<note><pitch><step>A</step><octave>4</octave></pitch><duration>12</duration><type>eighth</type><voice>1</voice></note>`;
  return `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list>
  <part id="P1"><measure number="39">
    <attributes><divisions>12</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
    <clef><sign>G</sign><line>2</line></clef></attributes>
    <direction placement="above" default-y="${wDy}">
      <direction-type><wedge type="diminuendo" number="1" spread="15"/></direction-type>
      <staff>1</staff>
    </direction>
    <note><pitch><step>C</step><octave>5</octave></pitch><duration>12</duration><type>eighth</type><voice>1</voice></note>
    <note><pitch><step>A</step><octave>4</octave></pitch><duration>36</duration><type>half</type><dot/><voice>1</voice></note>
    <note><pitch><step>A</step><octave>4</octave></pitch><duration>24</duration><type>quarter</type><voice>1</voice></note>
    ${mid}
    <note><pitch><step>E</step><octave>5</octave></pitch><duration>12</duration><type>eighth</type><voice>1</voice></note>
  </measure></part>
</score-partwise>`;
}

async function probe(label: string, raw: string): Promise<void> {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, {
    autoResize: false,
    backend: 'svg',
    drawTitle: false,
    useXMLMeasureNumbers: true,
  } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
  osmd.EngravingRules.UseXMLMeasureNumbers = true;
  await osmd.load(normalizeDynamicsAndWedgesForOsmdPreview(raw));
  osmd.render();
  const rows: unknown[] = [];
  for (const m of (osmd as unknown as { Sheet: { SourceMeasures: any[] } }).Sheet.SourceMeasures) {
    for (const staff of m.StaffLinkedExpressions || []) {
      for (const e of staff || []) {
        const s = e.StartingContinuousDynamic;
        if (s) {
          rows.push({
            label,
            startTs: s.StartMultiExpression?.AbsoluteTimestamp?.RealValue,
            endTs: s.EndMultiExpression?.AbsoluteTimestamp?.RealValue,
            endOff: s.EndMultiExpression?.EndOffsetFraction?.RealValue,
          });
        } else if (e.InstantaneousDynamic) {
          rows.push({ label, ts: e.AbsoluteTimestamp?.RealValue, inst: true });
        } else if (e.EndingContinuousDynamic) {
          rows.push({ label, ts: e.AbsoluteTimestamp?.RealValue, endingOnly: true });
        }
      }
    }
  }
  console.log(JSON.stringify(rows, null, 2));
}

async function main(): Promise<void> {
  await probe('stop+mf before n3 (HITL shape)', buildXml({ withMf: true, stopAfterNote3: false }));
  await probe('stop only before n3', buildXml({ withMf: false, stopAfterNote3: false }));
  await probe('stop+mf after n3 body', buildXml({ withMf: true, stopAfterNote3: true }));
  await probe('stop only after n3 body', buildXml({ withMf: false, stopAfterNote3: true }));

  // After normalize (includes advance past following note), HITL shape must end at mf onset 1.5
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, {
    autoResize: false,
    backend: 'svg',
    drawTitle: false,
    useXMLMeasureNumbers: true,
  } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
  osmd.EngravingRules.UseXMLMeasureNumbers = true;
  const raw = buildXml({ withMf: true, stopAfterNote3: false });
  await osmd.load(normalizeDynamicsAndWedgesForOsmdPreview(raw));
  osmd.render();
  let endTs: number | undefined;
  let mfTs: number | undefined;
  for (const m of (osmd as unknown as { Sheet: { SourceMeasures: any[] } }).Sheet.SourceMeasures) {
    for (const staff of m.StaffLinkedExpressions || []) {
      for (const e of staff || []) {
        const s = e.StartingContinuousDynamic;
        if (s) endTs = s.EndMultiExpression?.AbsoluteTimestamp?.RealValue;
        if (e.InstantaneousDynamic) mfTs = e.AbsoluteTimestamp?.RealValue;
      }
    }
  }
  if (endTs !== 1.5) {
    console.error(`FAIL expected endTs=1.5 after advance, got ${endTs}`);
    process.exit(1);
  }
  if (mfTs !== 1.5) {
    console.error(`FAIL expected mfTs=1.5, got ${mfTs}`);
    process.exit(1);
  }
  console.log('ok advance wedge stop past following note → endTs=mfTs=1.5');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

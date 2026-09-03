/**
 * 다성부 F1+F2 화음 + voice2 쉼표 — OSMD Source Pitch를 오선 위(F5)로 고정하는지.
 * Run: npx tsx _smoke/test_polyphonic_rest_osmd_above.ts
 */
import { JSDOM } from 'jsdom';
import { patchOsmdPolyphonicRestVfpitch } from '../src/osmdRestPlacementFix';
import { repairRestDisplayForOsmdPreview } from '../shared/musicXmlRestDisplay';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
  requestAnimationFrame: (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  },
});

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>F</step><octave>1</octave></pitch>
        <duration>2</duration><voice>1</voice><type>quarter</type>
      </note>
      <note>
        <chord/><pitch><step>F</step><octave>2</octave></pitch>
        <duration>2</duration><voice>1</voice><type>quarter</type>
      </note>
      <backup><duration>2</duration></backup>
      <note>
        <rest/><duration>2</duration><voice>2</voice><type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>`;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function restPitchAfterPatch(osmd: { Sheet?: unknown }): { o: number; f: number } | null {
  const sheet = asRecord(osmd.Sheet);
  const measures = (sheet?.SourceMeasures ?? sheet?.sourceMeasures ?? []) as unknown[];
  for (const measureRaw of measures) {
    const measure = asRecord(measureRaw);
    const containers = (measure?.VerticalSourceStaffEntryContainers ??
      measure?.verticalSourceStaffEntryContainers ??
      []) as unknown[];
    for (const containerRaw of containers) {
      const container = asRecord(containerRaw);
      for (const seRaw of (container?.StaffEntries ?? container?.staffEntries ?? []) as unknown[]) {
        const se = asRecord(seRaw);
        for (const veRaw of (se?.VoiceEntries ?? se?.voiceEntries ?? []) as unknown[]) {
          const ve = asRecord(veRaw);
          for (const noteRaw of (ve?.Notes ?? ve?.notes ?? []) as unknown[]) {
            const note = asRecord(noteRaw);
            if (!note) continue;
            const isRest =
              typeof note.isRest === 'function'
                ? Boolean((note.isRest as () => boolean)())
                : note.isRest === true;
            if (!isRest) continue;
            const pitch = asRecord(note.Pitch ?? note.pitch);
            if (!pitch) continue;
            return {
              o: Number(pitch.Octave ?? pitch.octave),
              f: Number(pitch.FundamentalNote ?? pitch.fundamentalNote),
            };
          }
        }
      }
    }
  }
  return null;
}

async function main(): Promise<void> {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host')!;
  const xml = repairRestDisplayForOsmdPreview(XML);

  const osmd = new OpenSheetMusicDisplay(host, {
    backend: 'svg',
    autoResize: false,
    alignRests: 0,
    autoGenerateMultipleRestMeasuresFromRestMeasures: false,
  } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
  (osmd.EngravingRules as { AlignRests?: number }).AlignRests = 0;

  await osmd.load(xml);
  const n = patchOsmdPolyphonicRestVfpitch(osmd);
  if (n < 1) throw new Error(`expected to patch ≥1 rest Pitch, got ${n}`);

  const pitch = restPitchAfterPatch(osmd);
  // NoteEnum.F = 5, MusicXML octave 5 → F5 (G-clef top line)
  if (!pitch || pitch.f !== 5 || pitch.o !== 5) {
    throw new Error(`expected rest Pitch F5 (f=5,o=5), got ${JSON.stringify(pitch)}`);
  }

  osmd.render();
  console.log('ok polyphonic rest Source Pitch F5 above F1+F2 chord');
}

void main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});

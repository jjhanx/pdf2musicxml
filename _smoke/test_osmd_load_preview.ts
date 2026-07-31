/**
 * Try OSMD load on preview XML — reproduce beam error.
 * Run: npx tsx _smoke/test_osmd_load_preview.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

// DOMParser/XMLSerializer for buildOsmdPreviewXml
const dom = new JSDOM('');
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = dom.window.DOMParser;
(globalThis as unknown as { XMLSerializer: typeof XMLSerializer }).XMLSerializer = dom.window.XMLSerializer;
(globalThis as unknown as { Document: typeof Document }).Document = dom.window.Document;
(globalThis as unknown as { Element: typeof Element }).Element = dom.window.Element;

async function loadXmlFromZip(zipPath: string): Promise<string> {
  const tmp = path.resolve('_smoke/_osmd_load_tmp');
  fs.mkdirSync(tmp, { recursive: true });
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${tmp}'"`,
    { stdio: 'pipe' },
  );
  const rawMxl = path.join(tmp, 'review.mxl');
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -Force -Path '${rawMxl}' -DestinationPath '${tmp}/mxl'"`,
    { stdio: 'pipe' },
  );
  const xmlFiles = fs
    .readdirSync(path.join(tmp, 'mxl'))
    .filter((f) => f.endsWith('.xml') && !f.toUpperCase().includes('META'));
  return fs.readFileSync(path.join(tmp, 'mxl', xmlFiles[0]!), 'utf8');
}

function sanitizeLikePanel(xml: string, verbatim: boolean): string {
  // dynamic import after jsdom globals
  return xml;
}

async function main() {
  const zipPath = path.resolve('너에게 난 나에게 넌/omr-work-6cbf1add.zip');
  if (!fs.existsSync(zipPath)) {
    console.log('skip: zip missing');
    return;
  }
  const raw = await loadXmlFromZip(zipPath);
  const mod = await import('../src/AudiverisInspectPanel.tsx');
  const manifestPath = path.resolve('_smoke/_osmd_load_tmp/manifest.json');
  const scoreParts = fs.existsSync(manifestPath)
    ? (JSON.parse(fs.readFileSync(manifestPath, 'utf8')).scoreParts as Array<{
        id: string;
        displayLabel?: string;
        suggestedLabel?: string;
      }>)
    : [
        { id: 'P1', displayLabel: 'T' },
        { id: 'P2', displayLabel: 'S' },
        { id: 'P3', displayLabel: 'B' },
        { id: 'P4', displayLabel: 'P' },
      ];

  const preview = mod.buildOsmdPreviewXml(raw, scoreParts, null, { verbatim: true });
  fs.writeFileSync('_smoke/_preview_full.xml', preview);

  const host = dom.window.document.createElement('div');
  host.style.width = '800px';
  const osmd = new OpenSheetMusicDisplay(host, { drawTitle: false, drawComposer: false });
  try {
    // replicate OsmdBlock: sanitize is not exported — write inline by reading dist... 
    // Import won't export sanitize. Use osmd load on preview directly first.
    await osmd.load(preview);
    await osmd.render();
    console.log('OK loaded preview without sanitize export');
  } catch (e) {
    console.error('FAIL preview raw:', e instanceof Error ? e.message : e);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

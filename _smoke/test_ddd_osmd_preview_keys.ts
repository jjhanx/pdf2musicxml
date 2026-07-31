/**
 * Check buildOsmdPreviewXml does not inject keys at m1 for ddd2447d raw.
 * Run: npx tsx _smoke/test_ddd_osmd_preview_keys.ts
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOsmdPreviewXml } from '../src/AudiverisInspectPanel.tsx';

const root = path.dirname(fileURLToPath(import.meta.url));
const zip = path.join(root, '..', 'omr-work-ddd2447d.zip');
if (!fs.existsSync(zip)) {
  console.log('skip: no omr-work-ddd2447d.zip');
  process.exit(0);
}

const xml = execSync(
  `python -c "import io,zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); d=z.read('audiveris_raw.mxl'); z2=zipfile.ZipFile(io.BytesIO(d)); n=[x for x in z2.namelist() if x.endswith('.xml') and 'META' not in x.upper()][0]; sys.stdout.buffer.write(z2.read(n))" "${zip}"`,
  { encoding: 'buffer' },
).toString('utf8');

const scoreParts = [
  { id: 'P1', suggestedLabel: 'S', displayLabel: 'S' },
  { id: 'P2', suggestedLabel: 'A', displayLabel: 'A' },
  { id: 'P3', suggestedLabel: 'T', displayLabel: 'T' },
  { id: 'P4', suggestedLabel: 'B', displayLabel: 'B' },
];

function earlyKeys(xmlStr: string, label: string) {
  const doc = new DOMParser().parseFromString(xmlStr, 'text/xml');
  const out: string[] = [];
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    const pid = part.getAttribute('id') ?? '?';
    for (const meas of [...part.children]) {
      if ((meas.localName ?? meas.tagName).toLowerCase().replace(/^.*:/, '') !== 'measure') continue;
      const mn = parseInt(meas.getAttribute('number') ?? '0', 10);
      if (mn >= 17) break;
      for (const attr of [...meas.children]) {
        if ((attr.localName ?? attr.tagName).toLowerCase().replace(/^.*:/, '') !== 'attributes') continue;
        for (const key of [...attr.children]) {
          if ((key.localName ?? key.tagName).toLowerCase().replace(/^.*:/, '') !== 'key') continue;
          const f = key.querySelector('fifths, *|fifths')?.textContent ?? '?';
          out.push(`${pid} m${mn} fifths=${f}`);
        }
      }
    }
  }
  console.log(`${label}: early keys (${out.length})`, out.slice(0, 8));
}

earlyKeys(xml, 'raw');
const preview = buildOsmdPreviewXml(xml, scoreParts, null);
earlyKeys(preview, 'preview full');

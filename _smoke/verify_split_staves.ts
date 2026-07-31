import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import {
  buildOsmdPreviewXml,
  splitGrandStaffPartsForFullScoreOsmd,
} from '../src/AudiverisInspectPanel.ts';

function maxStavesInXml(xml: string): Map<string, number> {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const out = new Map<string, number>();
  doc.querySelectorAll('part').forEach((part) => {
    const id = part.getAttribute('id') ?? '?';
    let max = 1;
    part.querySelectorAll('attributes staves, note staff').forEach((el) => {
      const n = parseInt(el.textContent?.trim() ?? '1', 10);
      if (Number.isFinite(n) && n > max) max = n;
    });
    out.set(id, max);
  });
  return out;
}

function partIds(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return [...doc.querySelectorAll('part-list score-part')].map(
    (sp) => sp.getAttribute('id') ?? '',
  );
}

const rawPath = process.argv[2] ?? '_smoke/omr-work-1b1b34df/audiveris_raw.mxl';
const buf = readFileSync(rawPath);
// mxl is zip — use extracted xml if present
let xml: string;
try {
  xml = buf.toString('utf8');
  if (!xml.includes('<score-partwise')) {
    throw new Error('not xml');
  }
} catch {
  const { execSync } = await import('node:child_process');
  const xmlPath = rawPath.replace(/\.mxl$/, '.xml');
  execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${rawPath}' -DestinationPath '_smoke/_tmp_mxl' -Force"`, {
    stdio: 'ignore',
  });
  xml = readFileSync('_smoke/_tmp_mxl/score.xml', 'utf8');
}

const scoreParts = [
  { id: 'P1', displayLabel: 'T' },
  { id: 'P2', displayLabel: 'S' },
  { id: 'P3', displayLabel: 'B' },
  { id: 'P4', displayLabel: 'P' },
];

const preview = buildOsmdPreviewXml(xml, scoreParts, null, { verbatim: true });
console.log('part-list:', partIds(preview).join(', '));
console.log('max staves per part:');
for (const [id, n] of maxStavesInXml(preview)) {
  console.log(`  ${id}: ${n}`);
}

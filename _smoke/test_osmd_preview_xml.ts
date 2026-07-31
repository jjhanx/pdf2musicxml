/**
 * Quick check: buildOsmdPreviewXml transforms for omr-work-20e53bc4.
 * Run: npx tsx _smoke/test_osmd_preview_xml.ts
 */
import fs from 'node:fs';
import {
  buildOsmdPreviewXml,
  relocateMultiStaffLayerStartDirectionsForOsmd,
} from '../src/AudiverisInspectPanel.tsx';

const raw = fs.readFileSync('_smoke/20e5_score.xml', 'utf8');
const scoreParts = [
  { id: 'P1', suggestedLabel: 'P1', displayLabel: 'P1' },
  { id: 'P2', suggestedLabel: 'P2', displayLabel: 'P2' },
  { id: 'P3', suggestedLabel: 'P3', displayLabel: 'P3' },
  { id: 'P4', suggestedLabel: 'P4', displayLabel: 'P4' },
  { id: 'P5', suggestedLabel: 'P', displayLabel: 'P' },
];

const pl = buildOsmdPreviewXml(raw, scoreParts, { label: 'PL', partId: 'P5', staffWithinPart: 2 });
const full = buildOsmdPreviewXml(raw, scoreParts, null);

function snippet(xml: string, label: string) {
  const m = xml.match(/<measure number="17"[\s\S]*?<\/measure>/);
  const partIds = [...xml.matchAll(/<part id="([^"]+)"/g)].map((x) => x[1]);
  const dirs = [...(m?.[0] ?? '').matchAll(/<direction[\s\S]*?<\/direction>/g)].map((d) => d[0]);
  console.log(`\n=== ${label} parts=${partIds.join(',')} ===`);
  for (const d of dirs) {
    const staff = d.match(/<staff>(\d+)<\/staff>/)?.[1] ?? 'none';
    const voice = d.match(/<voice>(\d+)<\/voice>/)?.[1] ?? 'none';
    const words = d.match(/<words[^>]*>([^<]*)<\/words>/)?.[1] ?? '';
    console.log(`  direction staff=${staff} voice=${voice} text=${words}`);
  }
  if (!dirs.length) console.log('  (no directions in m17)');
}

snippet(full, 'full score preview');
snippet(pl, 'PL filter preview');

const relocated = relocateMultiStaffLayerStartDirectionsForOsmd(raw);
snippet(relocated, 'relocate only (no filter)');

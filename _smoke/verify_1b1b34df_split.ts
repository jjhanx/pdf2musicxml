#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dom = new JSDOM('');
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;

const xml = fs.readFileSync(path.join(__dirname, '1b1b34df_score.xml'), 'utf-8');
const scoreParts = [
  { id: 'P1', displayLabel: 'T' },
  { id: 'P2', displayLabel: 'S' },
  { id: 'P3', displayLabel: 'B' },
  { id: 'P4', displayLabel: 'P' },
];

const { buildOsmdPreviewXml } = await import('../src/AudiverisInspectPanel.tsx');

function analyze(label: string, s: string) {
  const doc = new DOMParser().parseFromString(s, 'text/xml');
  const parts = [...doc.querySelectorAll('part-list score-part')].map((sp) => {
    const id = sp.getAttribute('id') ?? '';
    const abbrev = sp.querySelector('part-abbreviation')?.textContent?.trim() ?? '';
    const part = doc.querySelector(`part[id="${id}"]`);
    let maxStaves = 1;
    part?.querySelectorAll('attributes staves, note staff').forEach((el) => {
      const n = parseInt(el.textContent?.trim() ?? '1', 10);
      if (Number.isFinite(n) && n > maxStaves) maxStaves = n;
    });
    return `${abbrev || id}(staves=${maxStaves})`;
  });
  console.log(`${label}: ${parts.join(', ')}`);
}

analyze('before split (labels only)', xml);
const preview = buildOsmdPreviewXml(xml, scoreParts, null, { verbatim: true });
analyze('after verbatim preview', preview);
const nonVerbatim = buildOsmdPreviewXml(xml, scoreParts, null, { verbatim: false });
analyze('after full preview', nonVerbatim);

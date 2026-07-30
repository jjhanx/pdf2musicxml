/**
 * OSMD(VexFlow) 진행 제어 라벨·기호 패치 (특정 곡 아님).
 * - TO_CODA: "To"+코다 → "To Coda"+코다
 * - DS: "D.S."만 → "D.S."+Segno 기호(v8c)
 * npm install 후 postinstall에서 실행.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(
  root,
  'node_modules',
  'opensheetmusicdisplay',
  'build',
  'opensheetmusicdisplay.min.js',
);

/** @type {{ name: string, from: string, to: string }[]} */
const PATCHES = [
  {
    name: 'TO_CODA label',
    from: 'TO_CODA:this.drawSymbolText(t,e,"To",!0)',
    to: 'TO_CODA:this.drawSymbolText(t,e,"To Coda",!0)',
  },
  {
    name: 'DS draw segno glyph flag',
    from: 'type.DS:this.drawSymbolText(t,e,"D.S.",!1)',
    to: 'type.DS:this.drawSymbolText(t,e,"D.S.",!0)',
  },
  {
    name: 'DS uses segno glyph not coda',
    from: 's&&f.renderGlyph(n,o,a,40,"v4d",!0)',
    to: 's&&f.renderGlyph(n,o,a,40,this.symbol_type===pt.type.DS?"v8c":"v4d",!0)',
  },
];

if (!fs.existsSync(target)) {
  console.warn('[patch_osmd_navigation_labels] OSMD min.js 없음 — skip');
  process.exit(0);
}

let src = fs.readFileSync(target, 'utf8');
let changed = 0;
for (const p of PATCHES) {
  if (src.includes(p.to)) {
    console.log(`[patch_osmd_navigation_labels] ${p.name}: already patched`);
    continue;
  }
  if (!src.includes(p.from)) {
    console.warn(`[patch_osmd_navigation_labels] ${p.name}: 패턴 없음 — OSMD 버전 확인`);
    continue;
  }
  src = src.replace(p.from, p.to);
  changed += 1;
  console.log(`[patch_osmd_navigation_labels] ${p.name}: ok`);
}

if (changed > 0) {
  fs.writeFileSync(target, src, 'utf8');
  console.log(`[patch_osmd_navigation_labels] wrote ${changed} patch(es)`);
} else {
  console.log('[patch_osmd_navigation_labels] nothing to write');
}

/**
 * OSMD(VexFlow)는 TO_CODA를 기본으로 "To"+코다 기호로 그린다.
 * MusicXML words·HITL 라벨과 맞추기 위해 "To Coda"+기호로 패치한다.
 * npm install 후 postinstall에서 실행 — 특정 곡이 아닌 OSMD 렌더 일반 규칙.
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

const FROM = 'TO_CODA:this.drawSymbolText(t,e,"To",!0)';
const TO = 'TO_CODA:this.drawSymbolText(t,e,"To Coda",!0)';

if (!fs.existsSync(target)) {
  console.warn('[patch_osmd_to_coda_label] OSMD min.js 없음 — skip');
  process.exit(0);
}

let src = fs.readFileSync(target, 'utf8');
if (src.includes(TO)) {
  console.log('[patch_osmd_to_coda_label] already patched');
  process.exit(0);
}
if (!src.includes(FROM)) {
  console.warn(
    '[patch_osmd_to_coda_label] 패턴을 찾지 못함 — OSMD 버전 확인 필요. skip',
  );
  process.exit(0);
}

fs.writeFileSync(target, src.replace(FROM, TO), 'utf8');
console.log('[patch_osmd_to_coda_label] patched TO_CODA label → "To Coda"');

/**
 * partial voice 연주순번 column — 회귀 묶음.
 * layout column · timeline realign · OSMD align(보조) 순으로 검증.
 *
 * Run: npx tsx _smoke/test_partial_voice_regression.ts
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const tests = [
  'test_partial_voice_play_order_column.ts',
  'test_partial_voice_timeline_realign.ts',
  'test_partial_voice_play_order_ref.ts',
  'test_partial_voice_osmd_align.ts',
] as const;

for (const file of tests) {
  const rel = `_smoke/${file}`;
  console.log(`\n=== ${rel} ===`);
  execSync(`npx tsx ${path.join(root, file)}`, { stdio: 'inherit', cwd: path.join(root, '..') });
}

console.log('\npartial_voice_regression ok');

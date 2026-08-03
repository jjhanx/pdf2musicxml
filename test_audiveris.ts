import { runAudiveris, resolveAudiverisBin } from './shared/audiveris.js';
import dotenv from 'dotenv';
dotenv.config();

const bin = resolveAudiverisBin();
console.log('Audiveris Bin:', bin);

async function test() {
  const res = await runAudiveris({
    audiverisBin: bin!,
    inputPdfPath: 'debug-2596/input.pdf',
    outputBaseDir: 'debug-2596/test_raw',
    onStreamLine: (stream, line) => console.log(`[${stream}] ${line}`)
  });
  console.log('Result:', res);
}
test().catch(console.error);

const { spawnSync } = require('child_process');
const result = spawnSync('C:\\Program Files\\Audiveris\\Audiveris.exe', [
  '-batch',
  '-export',
  '-output',
  'debug-2596/test_raw_2',
  '-constant', 'org.audiveris.omr.score.TimeSignature.defaultNumerator=4',
  '-constant', 'org.audiveris.omr.score.TimeSignature.defaultDenominator=4',
  '--',
  'debug-2596/input.pdf'
], { encoding: 'utf-8' });
console.log(result.stdout);
console.error(result.stderr);
console.log('Status:', result.status);

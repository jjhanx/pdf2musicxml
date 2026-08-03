const { spawnSync } = require('child_process');
const result = spawnSync('C:\\Program Files\\Audiveris\\Audiveris.exe', [
  '-batch',
  '-export',
  '-output',
  'debug-2596/test_raw',
  '--',
  'debug-2596/input.pdf'
], { encoding: 'utf-8' });
console.log(result.stdout);
console.error(result.stderr);
console.log('Status:', result.status);

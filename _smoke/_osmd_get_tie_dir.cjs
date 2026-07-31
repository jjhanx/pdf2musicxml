const fs = require('fs');
const s = fs.readFileSync('node_modules/opensheetmusicdisplay/build/opensheetmusicdisplay.min.js', 'utf8');
const i = s.indexOf('getTieDirection(e)');
console.log('first', i);
console.log(s.slice(i, i + 500));
// also search getTieDirection=
let idx = 0;
let c = 0;
while ((idx = s.indexOf('getTieDirection', idx)) >= 0 && c < 8) {
  console.log('\n@', idx, s.slice(idx, idx + 280));
  idx += 1;
  c += 1;
}

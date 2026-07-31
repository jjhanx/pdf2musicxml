const fs = require('fs');
const s = fs.readFileSync('node_modules/opensheetmusicdisplay/build/opensheetmusicdisplay.min.js', 'utf8');
const i = s.indexOf('setTieDirections(t){');
console.log(s.slice(i, i + 900));
const j = s.indexOf('TieDirection');
// find where TieDirection is assigned from MusicXML
let idx = 0;
let c = 0;
while ((idx = s.indexOf('TieDirection=', idx)) >= 0 && c < 15) {
  console.log('\n===', idx);
  console.log(s.slice(idx - 80, idx + 120));
  idx += 1;
  c += 1;
}

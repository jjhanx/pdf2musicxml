const fs = require('fs');
const s = fs.readFileSync('node_modules/opensheetmusicdisplay/build/opensheetmusicdisplay.min.js', 'utf8');
for (const k of [
  'vfTie',
  'Tie(',
  'new Vex.Flow.StaveTie',
  'StaveTie',
  'direction:',
  'TieDirection',
  'tie.Placement',
  'PlacementEnum',
  'NoteTie',
  'createGraphicalTie',
  'Tie.TieDirections',
]) {
  let i = 0;
  let c = 0;
  while ((i = s.indexOf(k, i)) >= 0 && c < 2) {
    console.log('---', k, i);
    console.log(s.slice(Math.max(0, i - 60), i + 200).replace(/\n/g, ' '));
    i += 1;
    c += 1;
  }
}

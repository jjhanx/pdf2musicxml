const fs = require('fs');
const s = fs.readFileSync('node_modules/opensheetmusicdisplay/build/opensheetmusicdisplay.min.js', 'utf8');
const needles = [
  'Tied',
  'placement',
  'PlacementEnum',
  'Tie',
  'above',
  'getPlacement',
  'OrientationEnum.Above',
  'tieDirection',
];
for (const k of [
  'OrientationEnum',
  'placement:"above"',
  "placement:'above'",
  'Placement.Above',
  'isAbove',
  'TiedExpression',
  'GraphicalTie',
  'calculateTie',
]) {
  let i = 0;
  let c = 0;
  while ((i = s.indexOf(k, i)) >= 0 && c < 3) {
    console.log('---', k, i);
    console.log(s.slice(Math.max(0, i - 40), i + 160).replace(/\n/g, ' '));
    i += 1;
    c += 1;
  }
}

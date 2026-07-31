const fs = require('fs');
const s = fs.readFileSync('node_modules/opensheetmusicdisplay/build/opensheetmusicdisplay.min.js', 'utf8');
const i = s.indexOf('rForTie()');
console.log(s.slice(i - 200, i + 400));

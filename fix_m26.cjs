const fs = require('fs');
const { JSDOM } = require('jsdom');

const xmlPath = 'C:/Users/jjhan/.gemini/antigravity-ide/brain/0009d072-c932-4a3d-8371-4463bfeebbbc/scratch/omr-work-0ea5ea52/audiveris_raw_mxl/clean_score_only.xml';
const xml = fs.readFileSync(xmlPath, 'utf8');

// Quick and dirty replace just for M26 in Part 5 to test:
const fixedXml = xml.replace(
    '<measure number="26" width="255">\n      <note default-x="24">\n        <pitch>\n          <step>F</step>\n          <octave>5</octave>\n        </pitch>\n        <duration>4</duration>\n        <voice>1</voice>\n        <type>quarter</type>\n        <stem default-y="-35">down</stem>\n        <staff>1</staff>\n      </note>',
    '__MAGIC_REPLACE_ME__'
);

// Actually, wait, it's easier to just use string replace on the <backup> in M26 of Part 5.
// Let's use DOM.
const domParser = new (new JSDOM().window.DOMParser)();
const doc = domParser.parseFromString(xml, 'application/xml');

const p5 = doc.querySelectorAll('part')[4]; // 5th part
const m26 = p5.querySelector('measure[number="26"]');
const backup = m26.querySelector('backup duration');
backup.textContent = '14'; // Change 16 to 14

const serializer = new (new JSDOM().window.XMLSerializer)();
const outXml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n` + serializer.serializeToString(doc.documentElement);

fs.writeFileSync('C:/Users/jjhan/.gemini/antigravity-ide/brain/0009d072-c932-4a3d-8371-4463bfeebbbc/scratch/omr-work-0ea5ea52/audiveris_raw_mxl/clean_score_only_fixed.xml', outXml);
console.log('Fixed XML written.');

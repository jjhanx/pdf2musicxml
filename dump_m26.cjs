const fs = require('fs');
const { JSDOM } = require('jsdom');

const xmlPath = 'C:/Users/jjhan/.gemini/antigravity-ide/brain/0009d072-c932-4a3d-8371-4463bfeebbbc/scratch/omr-work-0ea5ea52/audiveris_raw_mxl/clean_score_only.xml';
const xml = fs.readFileSync(xmlPath, 'utf8');

const domParser = new (new JSDOM().window.DOMParser)();
const doc = domParser.parseFromString(xml, 'application/xml');

const parts = doc.querySelectorAll('part');
for (let i = 0; i < parts.length; i++) {
    const m26 = parts[i].querySelector('measure[number="26"]');
    if (m26) {
        console.log(`\n\n--- PART ${i+1} M26 ---`);
        console.log(m26.outerHTML);
    }
}

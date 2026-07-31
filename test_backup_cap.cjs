const fs = require('fs');
const { parseMusicXmlDocument, serializeMusicXmlDocument } = require('./musicXmlParse'); // Need to mock or use jsdom if doing standalone

function capBackupDurationsForOsmdPreviewTest(xml) {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM().window.DOMParser;
    const parser = new dom();
    const doc = parser.parseFromString(xml, 'application/xml');
    
    const parts = doc.querySelectorAll('part');
    for (const part of parts) {
        const measures = part.querySelectorAll('measure');
        for (const measure of measures) {
            let cursor = 0;
            for (const child of Array.from(measure.children)) {
                const tag = (child.localName || child.tagName).replace(/^.*:/, '').toLowerCase();
                
                if (tag === 'note') {
                    const isChord = child.querySelector('chord') !== null;
                    const durationEl = child.querySelector('duration');
                    if (durationEl && !isChord) {
                        const dur = parseInt(durationEl.textContent || '0', 10);
                        if (!isNaN(dur)) cursor += dur;
                    }
                } else if (tag === 'forward') {
                    const durationEl = child.querySelector('duration');
                    if (durationEl) {
                        const dur = parseInt(durationEl.textContent || '0', 10);
                        if (!isNaN(dur)) cursor += dur;
                    }
                } else if (tag === 'backup') {
                    const durationEl = child.querySelector('duration');
                    if (durationEl) {
                        const dur = parseInt(durationEl.textContent || '0', 10);
                        if (!isNaN(dur)) {
                            if (dur > cursor) {
                                durationEl.textContent = cursor.toString();
                                cursor = 0;
                            } else {
                                cursor -= dur;
                            }
                        }
                    }
                }
            }
        }
    }
    
    const serializer = new (new JSDOM().window.XMLSerializer)();
    return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n` + serializer.serializeToString(doc.documentElement);
}

const inXml = fs.readFileSync('C:/Users/jjhan/.gemini/antigravity-ide/brain/0009d072-c932-4a3d-8371-4463bfeebbbc/scratch/omr-work-0ea5ea52/audiveris_raw_mxl/clean_score_only.xml', 'utf8');
const outXml = capBackupDurationsForOsmdPreviewTest(inXml);
fs.writeFileSync('C:/Users/jjhan/.gemini/antigravity-ide/brain/0009d072-c932-4a3d-8371-4463bfeebbbc/scratch/omr-work-0ea5ea52/audiveris_raw_mxl/clean_score_only_fixed2.xml', outXml);
console.log('Done!');

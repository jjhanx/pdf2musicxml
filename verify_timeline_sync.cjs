const fs = require('fs');
const { JSDOM } = require('jsdom');

function getMeasureDurationMax(measureNode) {
    let cursor = 0;
    let maxCursor = 0;
    for (const child of Array.from(measureNode.children)) {
        if (child.tagName === 'note') {
            const isChord = child.querySelector('chord') !== null;
            if (!isChord) {
                const durEl = child.querySelector('duration');
                if (durEl && durEl.textContent) {
                    cursor += parseInt(durEl.textContent, 10) || 0;
                }
            }
            maxCursor = Math.max(maxCursor, cursor);
        } else if (child.tagName === 'forward') {
            const durEl = child.querySelector('duration');
            if (durEl && durEl.textContent) {
                cursor += parseInt(durEl.textContent, 10) || 0;
            }
            maxCursor = Math.max(maxCursor, cursor);
        } else if (child.tagName === 'backup') {
            const durEl = child.querySelector('duration');
            if (durEl && durEl.textContent) {
                cursor -= parseInt(durEl.textContent, 10) || 0;
            }
        }
    }
    return maxCursor;
}

function verifyTimeline(xmlPath) {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    const parser = new dom.window.DOMParser();
    const doc = parser.parseFromString(fs.readFileSync(xmlPath, 'utf8'), 'application/xml');
    
    const parts = Array.from(doc.querySelectorAll('part'));
    const measureNumbers = [];
    
    // get unique measure numbers in order
    if (parts.length > 0) {
        Array.from(parts[0].querySelectorAll('measure')).forEach(m => {
            if (m.hasAttribute('number')) measureNumbers.push(m.getAttribute('number'));
        });
    }

    let desyncFound = false;
    for (const mNum of measureNumbers) {
        let maxGlobal = 0;
        const durs = {};
        
        for (const p of parts) {
            const m = p.querySelector(`measure[number="${mNum}"]`);
            if (m) {
                const dur = getMeasureDurationMax(m);
                durs[p.getAttribute('id')] = dur;
                maxGlobal = Math.max(maxGlobal, dur);
            }
        }
        
        let hasMismatch = false;
        for (const pid in durs) {
            if (durs[pid] !== maxGlobal) {
                hasMismatch = true;
            }
        }
        if (hasMismatch) {
            console.log(`Measure ${mNum} mismatch: global max = ${maxGlobal}, parts =`, durs);
            desyncFound = true;
        }
    }
    if (!desyncFound) {
        console.log("No desync found!");
    }
}

verifyTimeline('C:/Users/jjhan/.gemini/antigravity-ide/brain/0009d072-c932-4a3d-8371-4463bfeebbbc/scratch/omr-work-0ea5ea52/audiveris_raw_mxl/clean_score_only.xml');

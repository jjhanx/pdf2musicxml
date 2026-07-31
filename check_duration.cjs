const fs = require('fs');
const { DOMParser } = require('xmldom');

const xml = fs.readFileSync('C:/Users/jjhan/.gemini/antigravity-ide/brain/0009d072-c932-4a3d-8371-4463bfeebbbc/scratch/omr-work-0ea5ea52/audiveris_raw_mxl/clean_score_only.xml', 'utf8');
const doc = new DOMParser().parseFromString(xml, 'application/xml');

const parts = doc.getElementsByTagName('part');
for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const pid = part.getAttribute('id');
    const measures = part.getElementsByTagName('measure');
    
    for (let j = 0; j < measures.length; j++) {
        const m = measures[j];
        if (m.getAttribute('number') === '26') {
            let dur = 0;
            const children = m.childNodes;
            for (let k = 0; k < children.length; k++) {
                const c = children[k];
                if (c.tagName === 'note') {
                    // Check if chord
                    let isChord = false;
                    const cChildren = c.childNodes;
                    let nDur = 0;
                    for (let x = 0; x < cChildren.length; x++) {
                        if (cChildren[x].tagName === 'chord') isChord = true;
                        if (cChildren[x].tagName === 'duration') nDur = parseInt(cChildren[x].textContent, 10);
                    }
                    if (!isChord) {
                        dur += nDur;
                    }
                } else if (c.tagName === 'backup') {
                    const durNode = c.getElementsByTagName('duration')[0];
                    dur -= parseInt(durNode.textContent, 10);
                } else if (c.tagName === 'forward') {
                    const durNode = c.getElementsByTagName('duration')[0];
                    dur += parseInt(durNode.textContent, 10);
                }
            }
            console.log(`Part ${pid} M26 Duration: ${dur}`);
        }
    }
}

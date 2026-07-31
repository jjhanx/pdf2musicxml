function pruneCrossStaffTimeline(measure) {
  const children = Array.from(measure.children);
  for (const child of children) {
    const tag = child.tagName.toLowerCase();
    if (tag !== 'backup' && tag !== 'forward') continue;
    const idx = children.indexOf(child);
    if (idx < 0) continue;
    let prevStaff = null;
    for (let j = idx - 1; j >= 0; j--) {
      const c = children[j];
      if (c.tagName.toLowerCase() === 'note') {
        prevStaff = c.getAttribute('staff');
        break;
      }
    }
    let nextStaff = null;
    for (let j = idx + 1; j < children.length; j++) {
      const c = children[j];
      if (c.tagName.toLowerCase() === 'note') {
        nextStaff = c.getAttribute('staff');
        break;
      }
    }
    
    let removed = false;
    if (nextStaff !== '2') {
      console.log('REMOVED by condition 1');
      removed = true;
    } else if ((tag === 'backup' || tag === 'forward') && (prevStaff === null || prevStaff !== '2')) {
      console.log('REMOVED by condition 2');
      removed = true;
    }
    console.log('backup removed?', removed);
  }
}

const jsdom = require('jsdom');
const dom = new jsdom.JSDOM('<measure><backup><duration>16</duration></backup><note staff="2"><duration>2</duration></note></measure>');
pruneCrossStaffTimeline(dom.window.document.querySelector('measure'));

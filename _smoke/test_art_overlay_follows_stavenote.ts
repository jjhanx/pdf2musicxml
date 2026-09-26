/**
 * HITL articulation overlay(`>` text)는 음표 stavenote 그룹 안에 그려져
 * 이후 align·contain translate를 따라가야 한다(오른쪽에 남지 않음).
 * Run: npx tsx _smoke/test_art_overlay_follows_stavenote.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { paintHitlArticulationOverlayTexts, resolveNoteHeadX } from '../src/osmdArticulationOverlay';

const dom = new JSDOM(
  `<!DOCTYPE html><svg xmlns="http://www.w3.org/2000/svg">
    <g class="vf-measure">
      <g class="vf-stavenote" transform="translate(-19.4, 0)">
        <g class="vf-note">
          <g class="vf-notehead"><path d="M1021.2 103 C1021.2 98,1033.2 98,1033.2 103 C1033.2 108,1021.2 108,1021.2 103Z"/></g>
          <g class="vf-notehead"><path d="M1021.2 68 C1021.2 63,1033.2 63,1033.2 68 C1033.2 73,1021.2 73,1021.2 68Z"/></g>
        </g>
      </g>
    </g>
  </svg>`,
);
const doc = dom.window.document;
const svg = doc.querySelector('svg') as unknown as SVGSVGElement;
const sn = doc.querySelector('.vf-stavenote')!;

function translateX(el: Element | null): number {
  let x = 0;
  for (let cur = el; cur && cur.tagName.toLowerCase() !== 'svg'; cur = cur.parentElement) {
    const m = /translate\(\s*([-\d.]+)/.exec(cur.getAttribute('transform') || '');
    if (m) x += parseFloat(m[1]!);
  }
  return x;
}

const headRootX = () => 1027.2 + translateX(sn);
const noteHeadX = resolveNoteHeadX(sn, []);
assert.ok(Math.abs(noteHeadX - headRootX()) < 0.01, `resolveNoteHeadX=${noteHeadX} head=${headRootX()}`);

const n = paintHitlArticulationOverlayTexts(
  svg,
  [{ tag: 'accent', placement: 'above', staffSpaces: 5, glyph: '>', x: noteHeadX, noteHeadY: 103 }],
  10,
  sn,
);
assert.equal(n, 1);
const text = doc.querySelector('text[data-hitl-art-overlay]')!;
assert.equal(text.parentElement, sn, 'overlay must live inside the stavenote group');
const textRootX = () => parseFloat(text.getAttribute('x')!) + translateX(text.parentElement);
assert.ok(Math.abs(textRootX() - headRootX()) < 0.01, `overlay ${textRootX()} vs head ${headRootX()}`);
assert.equal(parseFloat(text.getAttribute('y')!), 53);

// 이후 align/contain이 stavenote translate를 바꿔도 `>`는 음표머리와 같은 x
sn.setAttribute('transform', 'translate(0, 0)');
assert.ok(Math.abs(textRootX() - headRootX()) < 0.01, `after shift overlay ${textRootX()} vs head ${headRootX()}`);

// anchor 없으면 기존처럼 SVG root에 절대 x
const n2 = paintHitlArticulationOverlayTexts(
  svg,
  [{ tag: 'tenuto', placement: 'above', staffSpaces: 2, glyph: '–', x: 500, noteHeadY: 103 }],
  10,
);
assert.equal(n2, 1);
const rootText = [...doc.querySelectorAll('text[data-hitl-art-overlay]')].find((t) => t.textContent === '–')!;
assert.equal(rootText.parentElement, svg as unknown as Element);
assert.equal(rootText.getAttribute('x'), '500');

console.log('OK test_art_overlay_follows_stavenote');

/**
 * 화음(C4+F4) stem-down: 고아 줄기 재부착이 윗음(min Y)에 밑동을 둬야 함.
 * 예전엔 첫 notehead(C4)만 봐서 F4 줄기가 끊김.
 * Run: npx tsx _smoke/test_chord_stem_reattach.ts
 */
import { JSDOM } from 'jsdom';
import { syncVfStemsAndBeamsAfterStavenoteAlign } from '../src/osmdOnsetColumnAlignFix';

const dom = new JSDOM(
  `<!DOCTYPE html><html><body>
<svg>
  <g class="vf-measure" id="1">
    <g class="vf-stavenote" id="vf-auto1034">
      <g class="vf-note">
        <g class="vf-notehead"><path d="M219.996 116.5M227 111"/></g>
        <g class="vf-notehead"><path d="M219.996 101.5M227 96"/></g>
      </g>
    </g>
    <g class="vf-stem" id="vf-auto1034-stem">
      <path class="vf-stem" id="vf-auto1034-stem0" d="M220.746 116.5L220.746 150.75"/>
    </g>
  </g>
</svg>
</body></html>`,
  { contentType: 'text/html' },
);
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  Element: dom.window.Element,
  SVGElement: dom.window.SVGElement,
});

const root = document.querySelector('svg')!;
syncVfStemsAndBeamsAfterStavenoteAlign(root);

const d = document.querySelector('#vf-auto1034-stem0')?.getAttribute('d') ?? '';
const m = /^M\s*([-\d.]+)\s+([-\d.]+)\s*L\s*([-\d.]+)\s+([-\d.]+)/i.exec(d);
if (!m) throw new Error(`stem path missing: ${d}`);
const y1 = parseFloat(m[2]!);
const y2 = parseFloat(m[4]!);
const baseY = Math.min(y1, y2);
const tipY = Math.max(y1, y2);
if (Math.abs(baseY - 101.5) > 0.6) {
  throw new Error(`chord stem-down base should be F4(101.5), got ${baseY} (tip=${tipY}) d=${d}`);
}
if (Math.abs(tipY - 150.75) > 0.6) {
  throw new Error(`chord stem tip should stay at beam ${tipY}`);
}
console.log('OK chord stem reattach keeps/fixes base at upper notehead', d);

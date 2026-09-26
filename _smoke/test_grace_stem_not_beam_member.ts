/**
 * 꾸밈음(본음 stavenote `.vf-modifiers` 안 중첩 stavenote)의 줄기가
 * onset align 후 빔 멤버 줄기로 오인돼 빔이 꾸밈음부터 시작되지 않는지.
 *
 * npx vite-node _smoke/test_grace_stem_not_beam_member.ts
 */
import { JSDOM } from 'jsdom';
import { syncVfStemsAndBeamsAfterStavenoteAlign } from '../src/osmdOnsetColumnAlignFix';

const DX = 36;
const svgText = `<svg xmlns="http://www.w3.org/2000/svg"><g class="vf-measure" id="1">
  <g class="vf-stavenote" id="a" transform="translate(${DX},0)">
    <g class="vf-note"><g class="vf-notehead"><path d="M315.7 511L323 505"/></g></g>
    <g class="vf-modifiers">
      <g class="vf-stavenote" id="grace">
        <g class="vf-note">
          <g class="vf-stem"><path d="M290.5 516L290.5 492.9"/></g>
          <g class="vf-notehead"><path d="M284 516L289 512"/></g>
          <g class="vf-flag"><path d="M290.5 492.9L295 500"/></g>
        </g>
      </g>
    </g>
  </g>
  <g class="vf-stavenote" id="b" transform="translate(${DX},0)">
    <g class="vf-note"><g class="vf-notehead"><path d="M346.3 501L353 497"/></g></g>
  </g>
  <g class="vf-stavenote" id="c" transform="translate(${DX},0)">
    <g class="vf-note"><g class="vf-notehead"><path d="M370.7 501L378 497"/></g></g>
  </g>
  <g class="vf-stem"><path d="M316.4 511L316.4 545.3"/></g>
  <g class="vf-stem"><path d="M347 501L347 542.2"/></g>
  <g class="vf-stem"><path d="M371.4 501L371.4 539.8"/></g>
  <g class="vf-beam"><path d="M315.7 535.6L372.1 535.6L372.1 540.6L315.7 540.6Z"/></g>
</g></svg>`;

const dom = new JSDOM(svgText, { contentType: 'image/svg+xml' });
const doc = dom.window.document;
syncVfStemsAndBeamsAfterStavenoteAlign(doc);

const tx = (el: Element | null): number => {
  let x = 0;
  for (let c = el; c; c = c.parentElement) {
    const m = /translate\(\s*([-\d.]+)/.exec(c.getAttribute('transform') || '');
    if (m) x += parseFloat(m[1]!);
  }
  return x;
};
const nums = (d: string) => (d.match(/-?\d*\.?\d+/g) || []).map(Number);

const beamPath = doc.querySelector('.vf-beam path')!;
const beamXs = nums(beamPath.getAttribute('d')!).filter((_, i) => i % 2 === 0).map((x) => x + tx(beamPath));
const beamLeft = Math.min(...beamXs);

const graceStemPath = doc.querySelector('#grace .vf-stem path')!;
const gNums = nums(graceStemPath.getAttribute('d')!);
const graceX = gNums[0]! + tx(graceStemPath);
const graceYs = [gNums[1]!, gNums[3]!];

const firstBeamStem = doc.querySelector(':scope > g > .vf-stem path, .vf-measure > .vf-stem path')!;
const aStemX = nums(firstBeamStem.getAttribute('d')!)[0]! + tx(firstBeamStem);

let fail = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`);
  if (!ok) fail++;
};
check(Math.abs(beamLeft - aStemX) < 1.5, `빔 왼쪽 ${beamLeft.toFixed(1)} ≈ 본음 A 줄기 ${aStemX.toFixed(1)}`);
check(beamLeft > graceX + 10, `빔 왼쪽 ${beamLeft.toFixed(1)}이 꾸밈음 줄기 ${graceX.toFixed(1)}보다 오른쪽`);
check(
  Math.max(...graceYs) <= 516.5 && Math.min(...graceYs) >= 492.5,
  `꾸밈음 줄기 y ${graceYs.join('–')} 그대로(빔까지 늘어나지 않음)`,
);
process.exit(fail ? 1 : 0);

/**
 * align/contain이 stavenote를 translate한 뒤 세잇단 숫자(·괄호)가 첫·끝 음 이동 평균을 따라가는지.
 *
 * npx vite-node _smoke/test_tuplet_number_follows_align.ts
 */
import { JSDOM } from 'jsdom';
import { createRequire } from 'module';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
const host = dom.window.document.getElementById('host') as HTMLElement;
Object.defineProperty(host, 'clientWidth', { value: 900, configurable: true });
Object.defineProperty(host, 'offsetWidth', { value: 900, configurable: true });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
  SVGGraphicsElement: dom.window.SVGGraphicsElement,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: (cb: (t: number) => void) => setTimeout(() => cb(0), 0),
});

const require = createRequire(import.meta.url);
const { OpenSheetMusicDisplay } = require('opensheetmusicdisplay');

const tupNote = (step: string, pos: 'start' | 'mid' | 'stop', bracket: boolean, beam: string) =>
  `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type>` +
  `<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>` +
  `<stem>down</stem><beam number="1">${beam}</beam>` +
  (pos === 'start'
    ? `<notations><tuplet type="start" number="1" placement="below" bracket="${bracket ? 'yes' : 'no'}"/></notations>`
    : pos === 'stop'
      ? `<notations><tuplet type="stop" number="1"/></notations>`
      : '') +
  `</note>`;
const tuplet = (bracket: boolean) =>
  tupNote('A', 'start', bracket, 'begin') + tupNote('G', 'mid', bracket, 'continue') + tupNote('F', 'stop', bracket, 'end');
const quarter = (step: string) =>
  `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>6</duration><voice>1</voice><type>half</type></note>`;

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
<part id="P1">
<measure number="1"><attributes><divisions>3</divisions><key><fifths>0</fifths></key><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
${quarter('C')}${tuplet(false)}</measure>
<measure number="2">${quarter('E')}${tuplet(true)}</measure>
</part></score-partwise>`;

async function main(): Promise<void> {
  const { syncOsmdTupletsAfterStavenoteAlign } = await import('../src/osmdOnsetColumnAlignFix');
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg', drawTitle: false });
  await osmd.load(xml);
  osmd.render();

  const tuplets: Array<{ x_pos: number; width: number; notes: Array<{ attrs: { id: string } }> }> = [];
  for (const row of osmd.GraphicSheet.MeasureList) {
    for (const gm of row) {
      for (const list of Object.values((gm as { vftuplets?: Record<string, typeof tuplets> }).vftuplets ?? {})) {
        tuplets.push(...list);
      }
    }
  }
  let fail = 0;
  const check = (ok: boolean, msg: string) => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`);
    if (!ok) fail++;
  };
  check(tuplets.length === 2, `세잇단 2개 렌더 (${tuplets.length})`);

  // align 흉내: 첫 음 -4, 가운데 -8, 끝 음 -14
  const shifts = [-4, -8, -14];
  for (const t of tuplets) {
    t.notes.forEach((n, i) => {
      document.getElementById(`vf-${n.attrs.id}`)!.setAttribute('transform', `translate(${shifts[i]},0)`);
    });
  }
  syncOsmdTupletsAfterStavenoteAlign(osmd);
  syncOsmdTupletsAfterStavenoteAlign(osmd);

  const marked = [...host.querySelectorAll('[data-hitl-tuplet-ink]')];
  const want = (shifts[0]! + shifts[2]!) / 2;
  const txs = marked.map((el) => parseFloat(/translate\(\s*([-\d.]+)/.exec(el.getAttribute('transform') ?? '')?.[1] ?? '0'));
  check(marked.length === 6, `세잇단 ink ${marked.length}개 = 숫자 2 + 괄호 rect 4 (세로줄 제외)`);
  check(txs.every((x) => Math.abs(x - want) < 0.01), `모든 ink 이동 ${txs.join(',')} = 첫·끝 평균 ${want} (두 번 호출해도 누적 안 됨)`);
  if (process.env.DEBUG) {
    for (const t of tuplets as unknown as Array<{ x_pos: number; width: number; y_pos: number }>) console.log('tuplet', t.x_pos, t.width, t.y_pos);
    for (const el of marked) console.log(el.tagName, el.getAttribute('x'), el.getAttribute('y'), el.getAttribute('width'), el.getAttribute('height'), (el.getAttribute('d') ?? '').slice(0, 30));
  }
  const tags = marked.map((el) => el.tagName.toLowerCase());
  check(tags.filter((t) => t === 'rect').length === 4, `괄호 rect도 함께 이동 (${tags.join(',')})`);
  const staffInk = [...host.querySelectorAll('.vf-stave [data-hitl-tuplet-ink], .vf-stavenote [data-hitl-tuplet-ink]')];
  check(staffInk.length === 0, '오선·음표 내부 ink는 건드리지 않음');

  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

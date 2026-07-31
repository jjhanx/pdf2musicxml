/**
 * 청산 26마디 OSMD 미리보기 — split 후 orphan backup·note 수 확인
 * Run: npx tsx _smoke/test_cheongsan_osmd_m26.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('');
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = dom.window.DOMParser;
(globalThis as unknown as { XMLSerializer: typeof XMLSerializer }).XMLSerializer = dom.window.XMLSerializer;
(globalThis as unknown as { Document: typeof Document }).Document = dom.window.Document;
(globalThis as unknown as { Element: typeof Element }).Element = dom.window.Element;

function loadReviewXml(): string {
  const xmlPath = path.resolve('_smoke/_cheongsan_review.xml');
  if (fs.existsSync(xmlPath)) return fs.readFileSync(xmlPath, 'utf8');
  const mxl = path.resolve('청산에 살리라 F/_inspect_0ea5/review.mxl');
  const tmp = path.resolve('_smoke/_cheongsan_osmd_tmp');
  fs.mkdirSync(tmp, { recursive: true });
  execSync(`python -c "import zipfile,pathlib; z=zipfile.ZipFile(r'${mxl}'); n=[x for x in z.namelist() if x.endswith('.xml') and 'META' not in x][0]; pathlib.Path(r'${xmlPath}').write_bytes(z.read(n))"`, {
    stdio: 'pipe',
  });
  return fs.readFileSync(xmlPath, 'utf8');
}

function measureChildSummary(xml: string, partId: string, mnum: number): string {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
  const part = [...doc.querySelectorAll('part, *|part')].find((p) => p.getAttribute('id') === partId);
  if (!part) return 'NO_PART';
  const meas = [...part.children].find(
    (c) => local(c as Element) === 'measure' && parseInt((c as Element).getAttribute('number') ?? '0', 10) === mnum,
  ) as Element | undefined;
  if (!meas) return 'NO_MEAS';
  return [...meas.children]
    .map((c) => {
      const tag = local(c as Element);
      if (tag === 'note') return 'note';
      if (tag === 'backup' || tag === 'forward') {
        const dur = (c as Element).querySelector('duration, *|duration')?.textContent ?? '?';
        return `${tag}(${dur})`;
      }
      return tag;
    })
    .join(',');
}

async function main() {
  const raw = loadReviewXml();
  const mod = await import('../src/AudiverisInspectPanel.tsx');
  const scoreParts = [
    { id: 'P1', displayLabel: 'S' },
    { id: 'P2', displayLabel: 'A' },
    { id: 'P3', displayLabel: 'T' },
    { id: 'P4', displayLabel: 'B' },
    { id: 'P5', displayLabel: 'P' },
  ];

  const preview = mod.buildOsmdPreviewXml(raw, scoreParts, null, { verbatim: true });
  fs.writeFileSync('_smoke/_cheongsan_preview_full.xml', preview);

  for (const pid of ['P1', 'P2', 'P3', 'P4', 'P5__PR', 'P5__PL']) {
    for (const m of [25, 26, 27]) {
      console.log(`${pid} m${m}: ${measureChildSummary(preview, pid, m)}`);
    }
  }

  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = dom.window.document.createElement('div');
  host.style.width = '1200px';
  const osmd = new OpenSheetMusicDisplay(host, { drawTitle: false, drawComposer: false });
  await osmd.load(preview);
  await osmd.render();

  const g = osmd as unknown as {
    GraphicSheet?: {
      MeasureList?: Array<{ measureNumber?: number; staffEntries?: unknown[]; verticalMeasureList?: unknown[] }>;
    };
  };
  const measures = g.GraphicSheet?.MeasureList ?? [];
  const byNum = new Map<number, number>();
  for (const m of measures) {
    const num = Number(m.measureNumber ?? 0);
    const entries = (m.staffEntries ?? m.verticalMeasureList ?? []) as unknown[];
    byNum.set(num, (byNum.get(num) ?? 0) + entries.length);
  }
  for (const n of [24, 25, 26, 27, 28]) {
    console.log(`graphic m${n} staffEntries=${byNum.get(n) ?? 'MISSING'}`);
  }
  console.log('cheongsan osmd m26 probe ok');
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});

import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

const host = document.getElementById('host') as HTMLDivElement;
const out = document.getElementById('out') as HTMLPreElement;

async function main() {
  const file = new URLSearchParams(location.search).get('f') ?? 'm13_score.xml';
  const xml = await (await fetch(`/_smoke/${file}`)).text();
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' });
  await osmd.load(xml);
  osmd.zoom = 1.0;
  osmd.render();
  out.textContent = 'rendered ok';
}

main().catch((e) => {
  out.textContent = `실패: ${e}`;
});

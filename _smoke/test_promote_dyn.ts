/**
 * promoteNoteDynamicsForOsmdPreview — ff in notations → direction for OSMD.
 * Run: npx tsx _smoke/test_promote_dyn.ts
 */
import { promoteNoteDynamicsForOsmdPreview } from '../src/AudiverisInspectPanel.tsx';

const raw = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>4</divisions></attributes>
<direction><direction-type><words>a tempo</words></direction-type><voice>1</voice></direction>
<note><pitch><step>D</step><alter>-1</alter><octave>5</octave></pitch>
<duration>6</duration><type>eighth</type><stem>down</stem><voice>1</voice>
<notations><dynamics placement="below"><ff/></dynamics></notations>
</note>
</measure></part></score-partwise>`;

const out = promoteNoteDynamicsForOsmdPreview(raw);
if (!out.includes('<ff')) throw new Error('ff direction missing');
if (out.includes('<notations>') && out.includes('dynamics')) throw new Error('notations dynamics should be promoted');
const dirCount = (out.match(/<direction/g) || []).length;
if (dirCount < 2) throw new Error(`expected 2 directions, got ${dirCount}`);
console.log('promote dynamics ok');

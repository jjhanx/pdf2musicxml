import { readFileSync, writeFileSync } from 'fs';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';

const raw = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
const clean = repairTimelineForOsmdPreview(raw);
writeFileSync('_smoke/_p1_m25_26_clean.snip', clean.match(/<part id="P1">[\s\S]*?<measure number="25"[\s\S]*?<\/measure>[\s\S]*?<measure number="26"[\s\S]*?<\/measure>[\s\S]*?<measure number="27"[\s\S]*?<\/measure>/)?.[0] ?? 'NOT FOUND');
console.log('written snippet');

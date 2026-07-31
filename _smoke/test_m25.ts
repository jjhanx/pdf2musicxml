import { readFileSync, writeFileSync } from 'fs';
import { removeDanglingTimelineElementsForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
const xml = readFileSync('_smoke/_raw_cheongsan.xml', 'utf8');
const out = removeDanglingTimelineElementsForOsmdPreview(xml);
writeFileSync('_smoke/_test_m25.xml', out);

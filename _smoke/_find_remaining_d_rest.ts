#!/usr/bin/env node
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { repairRestDisplayForOsmdPreview } from '../shared/musicXmlRestDisplay';

const dom = new JSDOM('');
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;

const raw = fs.readFileSync('_smoke/_6cbf_final/audiveris_raw/clean_score_only.xml', 'utf8');
const fixed = repairRestDisplayForOsmdPreview(raw);

const re = /<note[\s\S]*?<rest[\s\S]*?measure="yes"[\s\S]*?<display-step>\s*D\s*<\/display-step>[\s\S]*?<\/note>/gi;
for (const m of fixed.matchAll(re)) {
  console.log(m[0].slice(0, 400));
}

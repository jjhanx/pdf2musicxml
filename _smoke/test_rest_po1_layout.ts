/**
 * Run: npx tsx _smoke/test_rest_po1_layout.ts
 */
import fs from 'fs';
import { JSDOM } from 'jsdom';
import {
  applyPlayOrderLayoutToXml,
  collectPreviewNoteLayoutTargetsFromXml,
} from '../shared/musicXmlPlayOrder';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = dom.window.DOMParser;
(globalThis as unknown as { XMLSerializer: typeof XMLSerializer }).XMLSerializer =
  dom.window.XMLSerializer;

const xml = fs.readFileSync(new URL('./_pl_m3_voices_fixture.xml', import.meta.url), 'utf8');
const laid = applyPlayOrderLayoutToXml(xml);
const all = collectPreviewNoteLayoutTargetsFromXml(laid);
const po1 = all.filter((t) => t.staff === 2 && t.playOrder === 1);
if (!po1.some((t) => t.pitch === 'REST')) throw new Error(`missing REST: ${JSON.stringify(po1)}`);
if (!po1.some((t) => t.pitch !== 'REST')) throw new Error(`missing pitched: ${JSON.stringify(po1)}`);
const xs = new Set(po1.map((t) => t.defaultXTenths));
if (xs.size !== 1) throw new Error(`po1 x mismatch ${[...xs]}`);
console.log('layout OK', po1);

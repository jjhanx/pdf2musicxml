/**
 * Duplicate voice·pitch: timestamp beats inverted natural x for layout matching.
 * Run: npx tsx _smoke/test_layout_target_pairing.ts
 */
import { pairHitsWithLayoutTargetsByBestMatch } from '../src/osmdOnsetColumnAlignFix';

type Hit = {
  stavenote: SVGGraphicsElement;
  pitch: string;
  voice: string;
  centerX: number;
  timestamp: number | null;
};

const stubSn = {} as SVGGraphicsElement;

function hit(centerX: number, timestamp: number, label: string): Hit {
  return { stavenote: stubSn, pitch: 'F4', voice: '2', centerX, timestamp };
}

// po4 (ts=2) drawn LEFT of po2 (ts=1) — x-only sort would swap columns
const hits = [hit(90, 2, 'po4-natural-left'), hit(210, 1, 'po2-natural-right')];
const targets = [{ defaultXTenths: 132 }, { defaultXTenths: 232 }];

const pairs = pairHitsWithLayoutTargetsByBestMatch(hits, targets);
const po2 = pairs.find((p) => p.hit.timestamp === 1);
const po4 = pairs.find((p) => p.hit.timestamp === 2);

if (!po2 || po2.target.defaultXTenths !== 132) {
  throw new Error(`po2 should map to 132, got ${JSON.stringify(pairs)}`);
}
if (!po4 || po4.target.defaultXTenths !== 232) {
  throw new Error(`po4 should map to 232, got ${JSON.stringify(pairs)}`);
}

console.log('OK layout target pairing by timestamp', {
  po2: po2.target.defaultXTenths,
  po4: po4.target.defaultXTenths,
});

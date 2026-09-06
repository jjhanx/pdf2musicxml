/**
 * 로컬 마디 1을 0-based 둘째로 오인하면 m51 pending → seen만 m52 · claimed=none.
 * Run: npx tsx _smoke/test_measure_local_base.ts
 */
import {
  detectOsmdLocalMeasureBase,
  resolveOsmdGraphicMeasureMxl,
} from '../shared/musicXmlMeasureRange.ts';

const range = { start: 51, end: 52 };

if (detectOsmdLocalMeasureBase([1, 2], range) !== 'one') throw new Error('1,2 → one');
if (detectOsmdLocalMeasureBase([0, 1], range) !== 'zero') throw new Error('0,1 → zero');
if (detectOsmdLocalMeasureBase([51, 52], range) !== 'absolute') throw new Error('51,52 → abs');

if (resolveOsmdGraphicMeasureMxl(1, range, 'one') !== 51) throw new Error('one:1→51');
if (resolveOsmdGraphicMeasureMxl(2, range, 'one') !== 52) throw new Error('one:2→52');
if (resolveOsmdGraphicMeasureMxl(1, range, 'zero') !== 52) throw new Error('zero:1→52');
// 기본값: 로컬 1 → 첫 마디(51). 구버전은 52로 오인.
if (resolveOsmdGraphicMeasureMxl(1, range) !== 51) throw new Error('default 1→51');

console.log('measure local base OK');

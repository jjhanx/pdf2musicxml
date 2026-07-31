#!/usr/bin/env python3
"""Count dangling timeline before/after repairTimeline on raw cheongsan."""
from __future__ import annotations

import subprocess
from pathlib import Path

raw = Path("_smoke/_raw_cheongsan.xml").read_text(encoding="utf-8")
script = """
import { readFileSync, writeFileSync } from 'fs';
import { repairTimelineForOsmdPreview, countDanglingTimelineElements } from '../shared/musicXmlTimelineCleanup.ts';
const raw = readFileSync('_smoke/_raw_cheongsan.xml', 'utf8');
console.log('before dangling', countDanglingTimelineElements(raw));
const fixed = repairTimelineForOsmdPreview(raw);
console.log('after dangling', countDanglingTimelineElements(fixed));
const hasWidth = /<measure[^>]*\\swidth=/i.test(fixed);
const hasSysLayout = /<system-layout/i.test(fixed);
const m25backup = fixed.includes('<measure number="25"') and fixed.split('<measure number="26"')[0].count('<backup');
console.log(JSON.stringify({ hasWidth, hasSysLayout, m25backupSnippet: m25backup }));
"""
Path("_smoke/_tmp_dangling.ts").write_text(script, encoding="utf-8")
subprocess.run(["npx", "tsx", "_smoke/_tmp_dangling.ts"], check=True, cwd=Path("."))

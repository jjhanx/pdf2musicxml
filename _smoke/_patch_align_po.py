from pathlib import Path

path = Path("src/osmdOnsetColumnAlignFix.ts")
text = path.read_text(encoding="utf-8")

old = """  // 1) 연주순번 slot 그리드(layout-x) → SVG 절대 배치 (voice1 마디 비율)
  // 2) 같은 순번끼리 상대 snap으로 잔여 오차 제거
  forEachGraphicalMeasure(osmd, (gmRaw, staffIndex) => {
    alignMeasureNotesByPlayOrderGrid(osmd, gmRaw, staffIndex, targets);
    alignExplicitPlayOrderColumnsRelative(osmd, gmRaw, staffIndex, targets);
  });

  alignLinkedParallelHintGroups(osmd, hints);"""

new = """  // 설정된 연주순번 layout-x만 SVG로 배치. 상대 snap은 다른 순번 화음을 끌어오지 않음.
  forEachGraphicalMeasure(osmd, (gmRaw, staffIndex) => {
    alignMeasureNotesByPlayOrderGrid(osmd, gmRaw, staffIndex, targets);
  });

  alignLinkedParallelHintGroups(osmd, hints);"""

if old not in text:
    raise SystemExit("alignOsmd block not found")
text = text.replace(old, new, 1)

old2 = """  const staff = staffIndex + 1;
  const gm = asRecord(gmRaw);
  if (!gm) return;

  const hits: NoteHit[] = [];
  const seenStavenote = new Set<SVGGraphicsElement>();

  for (const seRaw of (gm.staffEntries ?? gm.StaffEntries ?? []) as unknown[]) {
    const se = asRecord(seRaw);
    if (!se) continue;
    for (const gveRaw of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as unknown[]) {
      const gve = asRecord(gveRaw);
      if (!gve) continue;
      for (const gnRaw of (gve.notes ?? gve.Notes ?? []) as unknown[]) {
        const gn = asRecord(gnRaw);
        if (!gn) continue;
        const pitch = pitchFromGraphicNote(gn);
        if (!pitch) continue;
        const voice = voiceFromGraphicNote(gn) ?? '1';
        const stavenote = graphicNoteStavenote(osmd, gn);
        if (!stavenote || seenStavenote.has(stavenote)) continue;
        seenStavenote.add(stavenote);
        const centerX = noteheadCenterXInSvgRoot(stavenote);
        if (centerX == null || !Number.isFinite(centerX)) continue;
        hits.push({
          stavenote,
          pitch,
          voice,
          centerX,
          timestamp: osmdTimestampFromGraphicVoiceEntry(gve),
          heads: stavenote.querySelectorAll('.vf-notehead').length,
        });
      }
    }
  }
  if (!hits.length) return;

  const measureSpanPx = measureSpanFromHits(hits)?.spanPx ?? null;"""

new2 = """  const staff = staffIndex + 1;
  const hits = collectMeasureNoteHits(osmd, gmRaw);
  if (!hits.length) return;

  const measureSpanPx = measureSpanFromHits(hits)?.spanPx ?? null;"""

if old2 not in text:
    raise SystemExit("relative hit collection not found")
text = text.replace(old2, new2, 1)

old3 = ".filter((h) => `${h.voice}|${h.pitch}` === vp && !usedAcrossColumns.has(h.stavenote))"
new3 = ".filter((h) => h.voice === vp.split('|')[0] && hitHasPitch(h, vp.split('|')[1]!) && !usedAcrossColumns.has(h.stavenote))"
if old3 not in text:
    raise SystemExit("relative filter not found")
text = text.replace(old3, new3, 1)

path.write_text(text, encoding="utf-8")
print("patched ok")

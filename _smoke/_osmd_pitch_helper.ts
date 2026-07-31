/** Extract first note pitch string from OSMD graphic measure */
function firstPitchFromGraphic(gm: Record<string, unknown>): string | null {
  const entries = (gm.staffEntries ?? gm.StaffEntries) as unknown[] | undefined;
  for (const entry of entries ?? []) {
    const er = entry as Record<string, unknown>;
    const gves = (er.graphicalVoiceEntries ?? er.GraphicalVoiceEntries) as unknown[] | undefined;
    for (const gve of gves ?? []) {
      const gr = gve as Record<string, unknown>;
      const notes = (gr.notes ?? gr.Notes) as unknown[] | undefined;
      for (const note of notes ?? []) {
        const nr = note as Record<string, unknown>;
        const src = (nr.sourceNote ?? nr.SourceNote) as Record<string, unknown> | undefined;
        const pitch = (src?.Pitch ?? src?.pitch) as Record<string, unknown> | undefined;
        if (!pitch) continue;
        const names = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
        const fn = pitch.FundamentalNote ?? pitch.fundamentalNote;
        const oct = pitch.Octave ?? pitch.octave;
        if (typeof fn === 'number' && typeof oct === 'number') return `${names[fn] ?? fn}${oct}`;
      }
    }
  }
  return null;
}

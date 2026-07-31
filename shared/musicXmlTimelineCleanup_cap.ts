export function capBackupDurationsForOsmdPreview(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    for (const part of findXmlParts(doc)) {
      for (const measure of [...part.children]) {
        if (xmlLocalName(measure) !== 'measure') continue;
        let cursor = 0;
        for (const child of Array.from(measure.children)) {
          const tag = xmlLocalName(child);
          if (tag === 'note') {
            const isChord = child.querySelector('chord, *|chord') !== null;
            const durationEl = child.querySelector('duration, *|duration');
            if (durationEl && !isChord) {
              const dur = parseInt(durationEl.textContent || '0', 10);
              if (!isNaN(dur)) cursor += dur;
            }
          } else if (tag === 'forward') {
            const durationEl = child.querySelector('duration, *|duration');
            if (durationEl) {
              const dur = parseInt(durationEl.textContent || '0', 10);
              if (!isNaN(dur)) cursor += dur;
            }
          } else if (tag === 'backup') {
            const durationEl = child.querySelector('duration, *|duration');
            if (durationEl) {
              const dur = parseInt(durationEl.textContent || '0', 10);
              if (!isNaN(dur)) {
                if (dur > cursor) {
                  durationEl.textContent = cursor.toString();
                  cursor = 0;
                } else {
                  cursor -= dur;
                }
              }
            }
          }
        }
      }
    }
    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
  }
}

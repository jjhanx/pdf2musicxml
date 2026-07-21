/** MusicXML DOM 파싱 — DOCTYPE·파서 오류 시 null */

export function stripMusicXmlDoctype(xml: string): string {
  return xml.replace(/<!DOCTYPE[\s\S]*?>/gi, '').trim();
}

export function parseMusicXmlDocument(xml: string): Document | null {
  try {
    const doc = new DOMParser().parseFromString(stripMusicXmlDoctype(xml), 'application/xml');
    if (doc.querySelector('parsererror')) return null;
    return doc;
  } catch {
    return null;
  }
}

export function serializeMusicXmlDocument(doc: Document): string {
  return new XMLSerializer().serializeToString(doc);
}

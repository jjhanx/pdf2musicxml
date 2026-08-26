/** HTTP 업로드 실패 메시지를 UI에 읽히게 만든다. */
export function formatConvertHttpError(status: number, contentType: string, body: string): string {
  const raw = body || '';
  if (status === 413 || /request entity too large/i.test(raw) || /<title>\s*413\b/i.test(raw)) {
    return '업로드가 거부되었습니다 (413 Request Entity Too Large). ZIP이 서버 업로드 한도를 넘겼을 수 있습니다.';
  }
  if (contentType.includes('application/json')) {
    try {
      const j = JSON.parse(raw) as { error?: string; detail?: string; stderrTail?: string };
      const msg = [j.error, j.detail, j.stderrTail].filter(Boolean).join('\n');
      if (msg) return msg;
    } catch {
      /* HTML/빈 본문 */
    }
  }
  const stripped = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return stripped.slice(0, 400) || `HTTP ${status}`;
}

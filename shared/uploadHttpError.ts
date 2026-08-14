/** nginx 413 HTML 등을 변환 실패 칸에 읽히게 만든다. Node 한도는 256MB. */
export function formatConvertHttpError(status: number, contentType: string, body: string): string {
  const raw = body || '';
  if (status === 413 || /request entity too large/i.test(raw) || /<title>\s*413\b/i.test(raw)) {
    return [
      '업로드가 nginx에서 거부되었습니다 (413 Request Entity Too Large).',
      '앱 한도는 256MB인데, 앞단 nginx 기본 한도는 보통 1MB입니다.',
      '서버 nginx server 블록에 client_max_body_size 256m; 를 넣고 sudo nginx -t && sudo nginx -s reload 하세요.',
      '지금 ZIP만 급히 올리려면 PDF(clean_score_only.pdf·input.pdf·deskewed.pdf)를 뺀 뒤 다시 압축해도 3단계는 됩니다.',
    ].join('\n');
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

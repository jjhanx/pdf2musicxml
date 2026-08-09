const fs = require('fs');
let text = fs.readFileSync('src/App.tsx', 'utf8');

const targetRegex = /\{t\.phase === 'done' && t\.downloadUrl && \(\s*<>\s*<a href=\{t\.downloadUrl\} download=\{t\.downloadName\}>\s*저장\s*<\/a>\s*\{t\.jobId && t\.pipelineMode === 'image_pdf' && \(\s*<>\s*\{' · '\}\s*<a\s*href=\{`\/api\/deskew\/\$\{t\.jobId\}\/pdf`\}\s*download=\{`deskewed-\$\{t\.jobId\}\.pdf`\}\s*className="btn-link"\s*style=\{\{ color: '#10b981', textDecoration: 'underline' \}\}\s*title="수평보정된 원본 PDF \(가사 포함\)"\s*>\s*수평보정 원본 PDF\s*<\/a>\s*\{' · '\}\s*<a\s*href=\{`\/api\/deskew\/\$\{t\.jobId\}\/clean-score-pdf`\}\s*download=\{`clean-score-\$\{t\.jobId\}\.pdf`\}\s*className="btn-link"\s*style=\{\{ color: '#f59e0b', textDecoration: 'underline' \}\}\s*title="가사가 제거된 수평보정 PDF"\s*>\s*Clean Score PDF\s*<\/a>\s*<\/(\w*)?>\s*\)\}\s*\{t\.jobId && \(\s*<>\s*\{' · '\}\s*<button\s*type="button"\s*className="btn-link"\s*onClick=\{[^}]+\}\s*>\s*마스킹·인식 점검\s*<\/button>\s*\{' · '\}\s*<a\s*href=\{`\/api\/diagnostic\/\$\{t\.jobId\}\/debug-zip`\}\s*download=\{`debug-\$\{t\.jobId\}\.zip`\}\s*className="btn-link"\s*style=\{\{ marginLeft: '4px', color: '#dc3545', textDecoration: 'underline' \}\}\s*(?:title="서버 오류 분석용 디버그 데이터 다운로드"\s*)?>\s*디버그 ZIP(?: 다운로드)?\s*<\/a>\s*<\/(\w*)?>\s*\)\}\s*<\/(\w*)?>\s*\)\}/s;

const replacement = `{t.phase === 'done' && t.downloadUrl && (
                      <a href={t.downloadUrl} download={t.downloadName}>
                        저장
                      </a>
                    )}
                    {t.jobId && t.pipelineMode === 'image_pdf' && (
                      <>
                        {t.phase === 'done' && t.downloadUrl ? ' · ' : ''}
                        <a
                          href={\`/api/deskew/\${t.jobId}/pdf\`}
                          download={\`deskewed-\${t.jobId}.pdf\`}
                          className="btn-link"
                          style={{ color: '#10b981', textDecoration: 'underline' }}
                          title="수평보정된 원본 PDF (가사 포함)"
                        >
                          수평보정 원본 PDF
                        </a>
                        {' · '}
                        <a
                          href={\`/api/deskew/\${t.jobId}/clean-score-pdf\`}
                          download={\`clean-score-\${t.jobId}.pdf\`}
                          className="btn-link"
                          style={{ color: '#f59e0b', textDecoration: 'underline' }}
                          title="가사가 제거된 수평보정 PDF"
                        >
                          Clean Score PDF
                        </a>
                      </>
                    )}
                    {t.jobId && (
                      <>
                        {(t.phase === 'done' && t.downloadUrl) || (t.pipelineMode === 'image_pdf') ? ' · ' : ''}
                        <button
                          type="button"
                          className="btn-link"
                          onClick={() => setInspectJobId(t.jobId!)}
                        >
                          마스킹·인식 점검
                        </button>
                        {' · '}
                        <a
                          href={\`/api/diagnostic/\${t.jobId}/debug-zip\`}
                          download={\`debug-\${t.jobId}.zip\`}
                          className="btn-link"
                          style={{ marginLeft: '4px', color: '#dc3545', textDecoration: 'underline' }}
                          title="서버 오류 분석용 디버그 데이터 다운로드"
                        >
                          디버그 ZIP
                        </a>
                      </>
                    )}`;

if (targetRegex.test(text)) {
    text = text.replace(targetRegex, replacement);
    fs.writeFileSync('src/App.tsx', text, 'utf8');
    console.log("SUCCESS");
} else {
    console.log("NOT FOUND");
}

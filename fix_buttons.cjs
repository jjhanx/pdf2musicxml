const fs = require('fs');
let text = fs.readFileSync('d:/pdf2musicxml/src/App.tsx', 'utf8');

const target = `                  <td>
                    {t.phase === 'done' && t.downloadUrl && (
                      <>
                        <a href={t.downloadUrl} download={t.downloadName}>
                          저장
                        </a>
                        {t.jobId && t.pipelineMode === 'image_pdf' && (
                          <>
                            {' · '}
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
                            {' · '}
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
                            >
                              디버그 ZIP 다운로드
                            </a>
                          </>
                        )}
                      </>
                    )}
                  </td>`;

const replacement = `                  <td>
                    {t.phase === 'done' && t.downloadUrl && (
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
                        >
                          디버그 ZIP 다운로드
                        </a>
                      </>
                    )}
                  </td>`;

text = text.replace(target, replacement);
fs.writeFileSync('d:/pdf2musicxml/src/App.tsx', text, 'utf8');

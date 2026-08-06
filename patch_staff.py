import pathlib

p = pathlib.Path('src/OmrStaffReviewPanel.tsx')
content = p.read_text('utf-8')
if 'activeOmrEngine' not in content:
    content = content.replace('audiverisInputPdf?: string | null;', 'audiverisInputPdf?: string | null;\n  activeOmrEngine?: string;')
    
    h2_target = "<h2 style={{ margin: '0 0 0.5rem', fontSize: '1.2rem' }}>OMR 품질 검토 (페이지×성부)</h2>"
    h2_replace = """<h2 style={{ margin: '0 0 0.5rem', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          OMR 품질 검토 (페이지×성부)
          {summary?.activeOmrEngine && (
            <span style={{
              fontSize: '0.75rem',
              background: '#2563eb',
              color: 'white',
              padding: '2px 6px',
              borderRadius: '12px',
              fontWeight: 500
            }}>
              {summary.activeOmrEngine === 'ai' ? 'AI OMR' : summary.activeOmrEngine === 'pdftomusic' ? 'PDFtoMusic Pro' : 'Audiveris'}
            </span>
          )}
        </h2>"""
    
    content = content.replace(h2_target, h2_replace)
    p.write_text(content, 'utf-8')

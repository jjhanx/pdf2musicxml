import pathlib
p = pathlib.Path('src/App.tsx')
content = p.read_text('utf-8')

old_payload = """      fd.append('pipelineMode', opts?.pipelineMode ?? 'font_separator');
      if (opts?.pipelineMode === 'image_pdf') {
        fd.append('imagePdfOmrEngine', opts?.imagePdfOmrEngine ?? 'ai');
      }"""
new_payload = """      fd.append('pipelineMode', opts?.pipelineMode ?? 'font_separator');
      fd.append('imagePdfOmrEngine', opts?.imagePdfOmrEngine ?? 'ai');"""
content = content.replace(old_payload, new_payload)

old_ui_engine = """                {(startStage === 'full' || startStage === 'clean_score') && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.9rem', color: '#ddd' }}>OMR 엔진:</span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', fontSize: '0.9rem', color: '#ddd' }}>
                      <input 
                        type="radio" 
                        name="imagePdfOmrEngine_global" 
                        value="ai" 
                        checked={imagePdfOmrEngine === 'ai'} 
                        onChange={() => setImagePdfOmrEngine('ai')} 
                        disabled={busy}
                      />
                      AI OMR (최신, 권장)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', fontSize: '0.9rem', color: '#ddd' }}>
                      <input 
                        type="radio" 
                        name="imagePdfOmrEngine_global" 
                        value="audiveris" 
                        checked={imagePdfOmrEngine === 'audiveris'} 
                        onChange={() => setImagePdfOmrEngine('audiveris')} 
                        disabled={busy}
                      />
                      Audiveris
                    </label>
                  </div>
                )}"""

new_ui_engine = """                {(startStage === 'full' || startStage === 'clean_score') && (
                  <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', color: '#ddd' }}>
                    <input type="checkbox" checked={pauseAfterAudiveris} onChange={(e) => setPauseAfterAudiveris(e.target.checked)} disabled={busy} />
                    OMR 직후 멈춤 (MXL 다운로드·조옮김·교체 등 제어하기)
                  </label>
                )}"""
content = content.replace(old_ui_engine, "") 

insert_target = """              {startStage === 'full' && (
                <div style={{ marginTop: '1rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 }}>
                    <input type="checkbox" checked={pipelineMode === 'image_pdf'} onChange={(e) => setPipelineMode(e.target.checked ? 'image_pdf' : 'font_separator')} disabled={busy} />
                    이미지 PDF 모드로 강제 처리 (텍스트 인식이 안 될 때)
                  </label>
                </div>
              )}"""

new_insert = """              {startStage === 'full' && (
                <div style={{ marginTop: '1rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 }}>
                    <input type="checkbox" checked={pipelineMode === 'image_pdf'} onChange={(e) => setPipelineMode(e.target.checked ? 'image_pdf' : 'font_separator')} disabled={busy} />
                    이미지 PDF 모드로 강제 처리 (텍스트 인식이 안 될 때)
                  </label>
                </div>
              )}
              
              {(startStage === 'full' || startStage === 'clean_score') && (
                <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '1rem', background: 'rgba(255,255,255,0.05)', padding: '0.75rem', borderRadius: '4px' }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#fff' }}>사용할 OMR 엔진:</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                    <input 
                      type="radio" 
                      name="imagePdfOmrEngine_global" 
                      value="ai" 
                      checked={imagePdfOmrEngine === 'ai'} 
                      onChange={() => setImagePdfOmrEngine('ai')} 
                      disabled={busy}
                    />
                    AI OMR (권장, 속도 빠름)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                    <input 
                      type="radio" 
                      name="imagePdfOmrEngine_global" 
                      value="audiveris" 
                      checked={imagePdfOmrEngine === 'audiveris'} 
                      onChange={() => setImagePdfOmrEngine('audiveris')} 
                      disabled={busy}
                    />
                    Audiveris (기존 엔진)
                  </label>
                </div>
              )}"""
content = content.replace(insert_target, new_insert)

p.write_text(content, 'utf-8')

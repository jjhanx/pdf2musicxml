const fs = require('fs');
let text = fs.readFileSync('d:/pdf2musicxml/src/App.tsx', 'utf8');

const regex = /\{t\.phase === 'done' && t\.downloadUrl && \(\s*<>\s*<a href=\{t\.downloadUrl\} download=\{t\.downloadName\}>\s*저장\s*<\/a>\s*\{t\.jobId && t\.pipelineMode === 'image_pdf' && \(/s;

if (regex.test(text)) {
  console.log('Match found!');
  text = text.replace(regex, `{t.phase === 'done' && t.downloadUrl && (
                      <a href={t.downloadUrl} download={t.downloadName}>
                        저장
                      </a>
                    )}
                    {t.jobId && t.pipelineMode === 'image_pdf' && (`);
  
  // Also need to remove the trailing `</>\n)}` before `</td>`
  const tailRegex = /<\/>\s*\)\}\s*<\/td>/s;
  text = text.replace(tailRegex, `</td>`);
  
  fs.writeFileSync('d:/pdf2musicxml/src/App.tsx', text, 'utf8');
  console.log('Replaced successfully');
} else {
  console.log('No match found');
}

import sys

def main():
    try:
        with open('d:\\pdf2musicxml\\server\\index.ts', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        return

    # Replace the exec with spawn for deskew
    target = '''        try {
        await exec("\\" "\\" apply "\\" "\\" "\\", {
          maxBuffer: 16 * 1024 * 1024
        });
        if (fsSync.existsSync(deskewedPdfPath)) {'''

    replace = '''        try {
        await new Promise<void>((resolve, reject) => {
          const { spawn } = require('child_process');
          const proc = spawn(pythonBin, [scriptDeskewProcessor, 'apply', inputPdfPath, deskewAnglesPath, deskewedPdfPath]);
          let errOut = '';
          proc.stdout.on('data', (d: Buffer) => {
            const lines = d.toString().split('\\n');
            for (const line of lines) {
              const m = line.match(/PROGRESS:\\s*(\\d+)\\/(\\d+)/);
              if (m) {
                setJobProgress(job, {
                  phase: 'hitl',
                  current: parseInt(m[1], 10),
                  total: parseInt(m[2], 10),
                  detail: '수평 보정 결과 생성 중...',
                });
              }
            }
          });
          proc.stderr.on('data', (d: Buffer) => {
            errOut += d.toString();
          });
          proc.on('close', (code: number) => {
            if (code !== 0) reject(new Error(deskew apply failed with exit code \\: \\));
            else resolve();
          });
          proc.on('error', reject);
        });

        if (fsSync.existsSync(deskewedPdfPath)) {'''

    if target in content:
        content = content.replace(target, replace)
        print("Replaced exec with spawn successfully")
    else:
        print("Could not find the target string for exec replacement")

    # Insert the pause for deskew_save_needed
    target2 = '''      console.log([job \\] Pausing for early part label setup (성부 S/A/T/B지정));'''
    replace2 = '''      console.log([job \\] Pausing for deskew save...);
      setJobProgress(job, {
        phase: 'hitl',
        current: 0,
        total: 1,
        detail: '수평 보정 결과 다운로드 대기...',
      });
      job.status = 'deskew_save_needed';
      await new Promise<void>((resolve, reject) => {
        job.deskewSaveDeferred = { resolve, reject };
      });
      delete job.deskewSaveDeferred;
      job.status = 'processing';
      console.log([job \\] Deskew save confirmed, continuing...);

      console.log([job \\] Pausing for early part label setup (성부 S/A/T/B지정));'''

    if target2 in content:
        content = content.replace(target2, replace2)
        print("Replaced deskew_save_needed pause successfully")
    else:
        print("Could not find the target2 string for pause replacement")
        
    # We also need to add deskewSaveDeferred to JobRecord definition
    target3 = '''  deskewDeferred?: { resolve: () => void; reject: (e: Error) => void };'''
    replace3 = '''  deskewDeferred?: { resolve: () => void; reject: (e: Error) => void };
  deskewSaveDeferred?: { resolve: () => void; reject: (e: Error) => void };'''
  
    if target3 in content:
        content = content.replace(target3, replace3)
        print("Added deskewSaveDeferred to JobRecord")
    else:
        print("Could not find JobRecord deskewDeferred")
        
    # And add POST /api/deskew/:jobId/finish endpoint
    target4 = '''app.post('/api/deskew/:jobId/continue', express.json(), async (req, res) => {'''
    replace4 = '''app.post('/api/deskew/:jobId/finish', async (req, res) => {
  const jobId = req.params.jobId;
  const job = jobs.get(jobId);
  if (!job || job.status !== 'deskew_save_needed' || !job.deskewSaveDeferred) {
    return res.status(400).json({ error: 'Job not in deskew save pending state' });
  }

  try {
    job.deskewSaveDeferred.resolve();
    return res.json({ status: 'ok' });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

app.post('/api/deskew/:jobId/continue', express.json(), async (req, res) => {'''

    if target4 in content:
        content = content.replace(target4, replace4)
        print("Added deskew finish API endpoint")
    else:
        print("Could not find deskew continue API endpoint")

    with open('d:\\pdf2musicxml\\server\\index.ts', 'w', encoding='utf-8') as f:
        f.write(content)

if __name__ == '__main__':
    main()
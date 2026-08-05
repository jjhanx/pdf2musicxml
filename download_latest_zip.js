const fs = require('fs');
const path = require('path');
const os = require('os');
const archiver = require('archiver');

async function main() {
  const tmpdir = os.tmpdir();
  const dirs = fs.readdirSync(tmpdir).filter(d => d.startsWith('pdf2mxl-up-'));
  if (dirs.length === 0) {
    console.log("No job directories found in " + tmpdir);
    return;
  }
  
  // Sort by modification time descending
  dirs.sort((a, b) => {
    return fs.statSync(path.join(tmpdir, b)).mtimeMs - fs.statSync(path.join(tmpdir, a)).mtimeMs;
  });
  
  const latest = path.join(tmpdir, dirs[0]);
  console.log("Zipping latest job directory: " + latest);
  
  const zipPath = path.join(process.cwd(), 'latest-debug.zip');
  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  
  output.on('close', () => {
    console.log(archive.pointer() + ' total bytes');
    console.log('Zip file created successfully at: ' + zipPath);
  });
  
  archive.on('error', (err) => { throw err; });
  archive.pipe(output);
  archive.directory(latest, false);
  await archive.finalize();
}

main().catch(console.error);

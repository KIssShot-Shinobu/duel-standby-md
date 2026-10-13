#!/usr/bin/env node
/**
 * Generate combined patch: v1.3.2-combined (GIF sticker fix + premium/limit fixes)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const files = [
  'plugins/tools-sticker.js',
  'plugins/owner-user.js',
  'tests/owner-user.test.js',
];

const FILES = files.map(f => {
  const fullPath = path.join(process.cwd(), f);
  const content = fs.readFileSync(fullPath, 'utf8');
  const size = Buffer.byteLength(content, 'utf8');
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  const base64 = Buffer.from(content, 'utf8').toString('base64');
  return { path: f, size, sha256, base64 };
});

const patchContent = `#!/usr/bin/env node
/**
 * Patch otomatis rtxzy-md-clean v1.3.2-combined (dibuat ${new Date().toISOString().replace(/[:.]/g, '-')}). 
 * Jalankan dari dalam folder bot:  node patch-v1.3.2-combined.mjs
 * 
 * Perubahan:
 * 1. GIF Sticker Fix:
 *    - Fix WhatsApp GIF detection: chat GIFs are sent as video (gifPlayback=true)
 *    - Distinguish: GIF files (sharp, no ffmpeg) vs GIF playback (video, needs ffmpeg) vs real videos
 *    - Clearer error messages: separate errors for real videos vs WhatsApp GIFs
 *    - GIF files (images/docs) still work without ffmpeg via sharp
 * 
 * 2. Premium/Limit Fixes:
 *    - Add .premium list command to show all premium users with expiry & limit
 *    - Fix action2 variable reference bug in owner-user.js
 *    - Add tests for .premium list (2 new tests)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const BACKUP = path.join(ROOT, \`backup-patch-\${STAMP}\`);
const FILES = ${JSON.stringify(FILES, null, 2)};

async function main() {
  console.log('\\u{1F4E6} Patch v1.3.2-combined (GIF Sticker + Premium/Limit Fixes)');
  console.log('==========================================================');
  
  // Backup existing files
  if (!fs.existsSync(BACKUP)) fs.mkdirSync(BACKUP, { recursive: true });
  
  for (const file of FILES) {
    const target = path.join(ROOT, file.path);
    if (fs.existsSync(target)) {
      const current = fs.readFileSync(target, 'utf8');
      const currentHash = crypto.createHash('sha256').update(current).digest('hex');
      if (currentHash !== file.sha256) {
        fs.copyFileSync(target, path.join(BACKUP, file.path.replace(/\\//g, '_')));
        console.log(\`  \\u{1F4CB} Backup: \${file.path}\`);
      }
    }
  }
  
  // Apply patch
  let applied = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const file of FILES) {
    const target = path.join(ROOT, file.path);
    const targetDir = path.dirname(target);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    
    const newContent = Buffer.from(file.base64, 'base64').toString('utf8');
    const newHash = crypto.createHash('sha256').update(newContent).digest('hex');
    
    if (newHash !== file.sha256) {
      console.error(\`  \\u{274C} Hash mismatch: \${file.path} (expected \${file.sha256}, got \${newHash})\`);
      errors++;
      continue;
    }
    
    let action = '\\u{2705}';
    if (fs.existsSync(target)) {
      const current = fs.readFileSync(target, 'utf8');
      const currentHash = crypto.createHash('sha256').update(current).digest('hex');
      if (currentHash === file.sha256) {
        action = '\\u{23EF}';
        skipped++;
      } else {
        action = '\\u{1F504}';
      }
    } else {
      action = '\\u{2795}';
    }
    
    fs.writeFileSync(target, newContent, 'utf8');
    console.log(\`  \${action} \${file.path} (\${file.size} bytes)\`);
    applied++;
  }
  
  console.log('\\n\\u{1F4CA} Ringkasan:');
  console.log(\`  Diterapkan: \${applied}\`);
  console.log(\`  Dilewati (sudah sama): \${skipped}\`);
  console.log(\`  Error: \${errors}\`);
  console.log(\`  Backup di: \${BACKUP}\`);
  
  if (errors > 0) process.exit(1);
}

main().catch(e => { console.error('\\u{274C} Gagal:', e); process.exit(1); });
`;

fs.writeFileSync(path.join(process.cwd(), 'patches/patch-v1.3.2-combined.mjs'), patchContent);
console.log('Created patches/patch-v1.3.2-combined.mjs');
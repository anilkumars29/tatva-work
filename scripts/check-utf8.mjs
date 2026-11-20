// Fails if a tracked text file is not valid UTF-8 (part of `pnpm run verify`).
// One mis-encoded byte in a .tsx file made every Vercel build fail for hours
// ("invalid utf-8 sequence") while the site kept serving an old deploy.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const BINARY = /\.(png|jpe?g|gif|ico|webp|webm|ogg|mp3|wav|woff2?|ttf|otf|pdf|zip|gz)$/i;
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter((f) => f && !BINARY.test(f) && fs.existsSync(f));
const decoder = new TextDecoder('utf-8', { fatal: true });
const bad = [];
for (const file of files) {
  try {
    decoder.decode(fs.readFileSync(file));
  } catch {
    bad.push(file);
  }
}
if (bad.length) {
  for (const f of bad) console.error(`FAIL  not valid UTF-8: ${f}`);
  process.exit(1);
}
console.log(`PASS  ${files.length} text files are valid UTF-8`);

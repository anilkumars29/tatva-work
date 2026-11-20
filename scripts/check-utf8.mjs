// Fails if a tracked text file is not valid UTF-8 or holds stray control
// characters such as a backspace (part of `pnpm run verify`).
// One mis-encoded byte in a .tsx file made every Vercel build fail for hours
// ("invalid utf-8 sequence") while the site kept serving an old deploy, and a
// backspace where a regex meant \b silently broke a match.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const BINARY = /\.(png|jpe?g|gif|ico|webp|webm|ogg|mp3|wav|woff2?|ttf|otf|pdf|zip|gz)$/i;
const CONTROL = /[\u0000-\u0008\u000B\u000E-\u001F]/;
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter((f) => f && !BINARY.test(f) && fs.existsSync(f));
const decoder = new TextDecoder('utf-8', { fatal: true });
const bad = [];
for (const file of files) {
  let text;
  try {
    text = decoder.decode(fs.readFileSync(file));
  } catch {
    bad.push(`${file} (not valid UTF-8)`);
    continue;
  }
  const at = text.search(CONTROL);
  if (at >= 0) bad.push(`${file} (control character U+${text.charCodeAt(at).toString(16).padStart(4, '0')} at offset ${at})`);
}
if (bad.length) {
  for (const f of bad) console.error(`FAIL  ${f}`);
  process.exit(1);
}
console.log(`PASS  ${files.length} text files are valid UTF-8 with no stray control characters`);

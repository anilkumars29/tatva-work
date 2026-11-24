// Runs one recording through Murf Finch and Groq Whisper and prints the two
// transcripts side by side (30-second windows), plus timing and keyword hits.
//
//   pnpm compare:stt <meeting-id | path/to/recording.webm> [--latest]
//   pnpm compare:stt --latest          (the newest meeting with a recording)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { transcribeWithFinch } from '../src/pipeline/finch.js';
import { loadKeywords } from '../src/pipeline/keywords.js';
import { transcribeWhisper, formatTimestamp, type Segment, type Transcript } from '../src/pipeline/transcribe.js';
import { supabase } from '../src/supabase.js';

const WINDOW = 30;
const COL = 62;

async function resolveInput(arg: string | undefined): Promise<{ file: string; label: string; cleanup?: string }> {
  if (arg && arg !== '--latest' && fs.existsSync(arg)) return { file: arg, label: path.basename(arg) };
  let q = supabase.from('meetings').select('id, title, audio_path, duration_seconds').not('audio_path', 'is', null);
  q = arg && arg !== '--latest' ? q.eq('id', arg) : q.order('created_at', { ascending: false }).limit(1);
  const { data, error } = await q;
  if (error || !data?.length) throw new Error(`No meeting recording found for ${arg ?? '--latest'}: ${error?.message ?? 'none'}`);
  const m = data[0] as { id: string; title: string | null; audio_path: string; duration_seconds: number | null };
  const dl = await supabase.storage.from(config.audioBucket).download(m.audio_path);
  if (dl.error || !dl.data) throw new Error(`Download failed: ${dl.error?.message}`);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tatva-compare-'));
  const file = path.join(dir, path.basename(m.audio_path) || 'recording.webm');
  await fs.promises.writeFile(file, Buffer.from(await dl.data.arrayBuffer()));
  return { file, label: `${m.title ?? 'Untitled'} (${m.id.slice(0, 8)}, ${m.duration_seconds ?? '?'}s)`, cleanup: dir };
}

async function timed(name: string, fn: () => Promise<Transcript>) {
  const t = Date.now();
  try {
    const r = await fn();
    return { name, ms: Date.now() - t, r, err: null as string | null };
  } catch (e) {
    return { name, ms: Date.now() - t, r: null, err: e instanceof Error ? e.message : String(e) };
  }
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if ((line + ' ' + word).trim().length > width) {
      if (line) lines.push(line);
      line = word.slice(0, width);
    } else line = (line + ' ' + word).trim();
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

const inWindow = (segs: Segment[], from: number) =>
  segs.filter((s) => s.start >= from && s.start < from + WINDOW).map((s) => s.text).join(' ');

function countHits(text: string, keywords: string[]) {
  const lower = text.toLowerCase();
  return keywords
    .map((k) => [k, lower.split(k.toLowerCase()).length - 1] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}×${n}`)
    .join(', ');
}

const input = await resolveInput(process.argv[2]);
console.log(`\nRecording: ${input.label}`);
const keywords = await loadKeywords();
console.log(`Keywords (${keywords.length}): ${keywords.join(', ')}\n`);

const [finch, whisper] = await Promise.all([
  timed('Murf Finch', () => transcribeWithFinch(input.file, keywords)),
  timed('Groq Whisper', () => transcribeWhisper(input.file, 'audio/webm')),
]);
if (input.cleanup) await fs.promises.rm(input.cleanup, { recursive: true, force: true }).catch(() => {});

const fSegs = finch.r?.segments ?? [];
const wSegs = whisper.r?.segments ?? [];
const last = Math.max(fSegs.at(-1)?.end ?? 0, wSegs.at(-1)?.end ?? 0);
const bar = '-'.repeat(8 + COL * 2 + 6);
console.log(bar);
console.log(`${'time'.padEnd(8)}| ${finch.name.padEnd(COL)} | ${whisper.name}`);
console.log(bar);
for (let from = 0; from <= last; from += WINDOW) {
  const a = wrap(inWindow(fSegs, from), COL);
  const b = wrap(inWindow(wSegs, from), COL);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    console.log(`${(i === 0 ? formatTimestamp(from) : '').padEnd(8)}| ${(a[i] ?? '').padEnd(COL)} | ${b[i] ?? ''}`);
  }
  console.log(bar);
}
for (const x of [finch, whisper]) {
  const text = x.r?.text ?? '';
  console.log(
    x.err
      ? `${x.name}: FAILED after ${(x.ms / 1000).toFixed(1)}s: ${x.err}`
      : `${x.name}: ${(x.ms / 1000).toFixed(1)}s, ${x.r!.segments.length} segments, ${text.split(/\s+/).filter(Boolean).length} words, language ${x.r!.language ?? '?'}; keyword hits: ${countHits(text, keywords) || 'none'}`,
  );
}

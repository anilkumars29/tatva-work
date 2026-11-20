// Measures the server's memory (RSS) through each processing step for one
// recording, without writing anything to the database.
//   pnpm run measure:memory <meeting-id | path/to/audio> [--batch=N] [--minutes=N]
// Runs with the same Node flags as Render (--expose-gc --max-old-space-size=256).
// --minutes loops the audio to that length (e.g. a 20-minute test from a 6-minute file).
// The embedding batch defaults to the pipeline's own setting (EMBED_BATCH_SIZE).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { config } from '../src/config.js';
import { buildChunks } from '../src/pipeline/chunk.js';
import { embed, EMBED_BATCH_SIZE, warmUpEmbeddings } from '../src/pipeline/embed.js';
import { extractKnowledge } from '../src/pipeline/extract.js';
import { transcribe } from '../src/pipeline/transcribe.js';
import { freeMemory } from '../src/memory.js';
import { supabase } from '../src/supabase.js';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const option = (name: string) => Number(args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]) || undefined;
if (!target) {
  console.error('Usage: pnpm run measure:memory <meeting-id | audio file> [--batch=N] [--minutes=N]');
  process.exit(1);
}

const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);
let peak = 0;
const sample = () => (peak = Math.max(peak, process.memoryUsage().rss));
const timer = setInterval(sample, 25);
const rows: { step: string; peak: number; after: number; seconds: number }[] = [];
async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  peak = process.memoryUsage().rss;
  const t = Date.now();
  const result = await fn();
  sample();
  freeMemory(); // as the pipeline does between steps
  rows.push({ step: name, peak: mb(peak), after: mb(process.memoryUsage().rss), seconds: Math.round((Date.now() - t) / 100) / 10 });
  return result;
}

const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tatva-measure-'));
let file = target;
if (!fs.existsSync(target)) {
  const { data, error } = await supabase.from('meetings').select('audio_path').eq('id', target).single();
  if (error || !data?.audio_path) throw new Error(`No stored audio for meeting ${target}`);
  const download = await supabase.storage.from(config.audioBucket).download(data.audio_path);
  if (download.error) throw download.error;
  file = path.join(tmp, path.basename(data.audio_path));
  await fs.promises.writeFile(file, Buffer.from(await download.data.arrayBuffer()));
}
const minutes = option('minutes');
if (minutes) {
  const looped = path.join(tmp, `looped-${minutes}min.webm`);
  await promisify(execFile)(ffmpegPath as unknown as string, ['-hide_banner', '-loglevel', 'error', '-stream_loop', '-1', '-i', file, '-t', String(minutes * 60), '-c', 'copy', looped]);
  file = looped;
}

await step('start (express not loaded)', async () => undefined);
await step('load embedding model', () => warmUpEmbeddings());
const transcript = await step('transcribe', () => transcribe(file, 'audio/webm'));
const duration = transcript.durationSeconds ?? transcript.segments.at(-1)?.end ?? 0;
const knowledge = await step('extract', () =>
  extractKnowledge(transcript.segments, { recordedAt: new Date(), recordedAtLocal: new Date().toString(), durationMinutes: duration / 60, sourceTitle: null }),
);
const chunks = buildChunks(knowledge, transcript.segments, 'today');
const batch = option('batch') ?? EMBED_BATCH_SIZE;
await step(`embed ${chunks.length} chunks (batch ${batch})`, () => embed(chunks.map((c) => c.content), batch));
clearInterval(timer);

console.log(`\n${path.basename(file)}: ${(duration / 60).toFixed(1)} min, ${transcript.segments.length} segments, ${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB`);
console.table(rows.map((r) => ({ step: r.step, 'peak RSS (MB)': r.peak, 'after (MB)': r.after, seconds: r.seconds })));
console.log(`Overall peak: ${Math.max(...rows.map((r) => r.peak))} MB (Render free plan: 512 MB)`);
await fs.promises.rm(tmp, { recursive: true, force: true });
process.exit(0);

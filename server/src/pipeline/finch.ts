// Scribe on Murf Finch (finch_indic_1.0): file transcription of a recorded meeting.
//
// POST https://in.api.murf.ai/v1/transcription/speech-to-text (multipart) with
// word timestamps. Finch rejects WebM (and a copy-remux to Ogg didn't decode),
// so ffmpeg decodes the recording to 16 kHz mono WAV on disk first (Finch
// resamples to 16 kHz mono anyway; decoding only, no encode, is light on CPU;
// ~115 MB per hour, under Finch's 1 GB limit). The upload is a file-backed Blob
// (fs.openAsBlob), so the recording is never held in memory.
//
// The sync request waits up to 10 min server-side (Finch sends a space every
// 10 s to keep it open); past that it returns a transcription_id that we poll.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { config } from '../config.js';
import { tag } from '../specialists.js';
import { wordsToSegments, type FinchWord } from './finch-segments.js';
import type { Transcript } from './transcribe.js';

const execFileAsync = promisify(execFile);

export class FinchError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

interface FinchResult {
  transcription_id?: string;
  language_code?: string;
  text?: string;
  audio_duration_secs?: number;
  words?: FinchWord[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** WebM/anything -> 16 kHz mono 16-bit WAV on disk. */
async function toWav(filePath: string): Promise<{ file: string; dir: string }> {
  if (!ffmpegPath) throw new FinchError('ffmpeg-static binary not found');
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tatva-finch-'));
  const file = path.join(dir, 'audio.wav');
  await execFileAsync(ffmpegPath as unknown as string, ['-hide_banner', '-loglevel', 'error', '-y', '-i', filePath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', file]);
  return { file, dir };
}

const host = () => config.finchHost.replace(/\/+$/, '');

/** Parses a Finch body: keep-alive spaces first, then JSON (a transcript or {detail}). */
function parseBody(status: number, raw: string): FinchResult & { pendingId?: string } {
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw.trim() || '{}');
  } catch {
    throw new FinchError(`Finch returned non-JSON (HTTP ${status})`, status);
  }
  const detail = body.detail as unknown;
  if (detail) {
    // Timed out waiting, but the job continues: poll it.
    if (typeof body.transcription_id === 'string' && /timed out/i.test(String(detail))) return { pendingId: body.transcription_id };
    const d = typeof detail === 'object' ? (detail as { code?: string; message?: string }) : { message: String(detail) };
    throw new FinchError(`Finch ${status}: ${d.message ?? d.code ?? 'error'}`, status, d.code ?? null);
  }
  if (status >= 400) throw new FinchError(`Finch HTTP ${status}`, status);
  return body as FinchResult;
}

async function poll(id: string, deadline: number): Promise<FinchResult> {
  while (Date.now() < deadline) {
    await sleep(15_000);
    const r = await fetch(`${host()}/v1/transcription/speech-to-text/transcripts/${id}`, { headers: { 'api-key': config.murfApiKey } });
    const body = (await r.json().catch(() => ({}))) as { status?: string; result?: FinchResult; error?: { code?: string; message?: string } };
    if (!r.ok) throw new FinchError(`Finch poll HTTP ${r.status}`, r.status);
    if (body.status === 'completed' && body.result) return body.result;
    if (body.status === 'failed') throw new FinchError(`Finch job failed: ${body.error?.message ?? body.error?.code ?? 'unknown'}`, null, body.error?.code ?? null);
  }
  throw new FinchError('Finch job did not finish in time');
}

export async function transcribeWithFinch(filePath: string, keywords: string[]): Promise<Transcript> {
  if (!config.murfApiKey) throw new FinchError('MURF_API_KEY is not set');
  const started = Date.now();
  const { file, dir } = await toWav(filePath);
  try {
    const bytes = (await fs.promises.stat(file)).size;
    console.log(`${tag('scribe')} Finch ${config.finchModel}: uploading ${(bytes / 1048576).toFixed(1)} MB (bvc ${config.finchBvc ? 'on' : 'off'}, ${keywords.length} keywords)`);
    const blob = await fs.openAsBlob(file, { type: 'audio/wav' });
    const form = new FormData();
    form.append('file', blob, 'meeting.wav');
    form.append('model', config.finchModel);
    if (config.finchLanguage && config.finchLanguage !== 'auto') form.append('language_code', config.finchLanguage);
    form.append('timestamps_granularity', 'word');
    form.append('bvc', String(config.finchBvc));
    for (const k of keywords) form.append('keyterms', k);

    const deadline = started + 40 * 60_000;
    const res = await fetch(`${host()}/v1/transcription/speech-to-text`, {
      method: 'POST',
      headers: { 'api-key': config.murfApiKey },
      body: form,
      signal: AbortSignal.timeout(15 * 60_000),
    });
    const parsed = parseBody(res.status, await res.text());
    const result = parsed.pendingId ? await poll(parsed.pendingId, deadline) : parsed;

    const segments = wordsToSegments(result.words ?? [], result.text ?? '');
    console.log(`${tag('scribe')} Finch done in ${((Date.now() - started) / 1000).toFixed(1)}s: ${result.audio_duration_secs ?? '?'}s audio, ${segments.length} segments, language ${result.language_code ?? '?'}`);
    return {
      segments,
      text: segments.map((s) => s.text).join(' '),
      language: result.language_code ?? null,
      durationSeconds: result.audio_duration_secs ?? null,
    };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

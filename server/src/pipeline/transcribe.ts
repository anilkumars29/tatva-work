import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { config } from '../config.js';
import { groqPost } from '../groq.js';
import { tag } from '../specialists.js';
import { transcribeWithFinch } from './finch.js';
import { loadKeywords } from './keywords.js';

const execFileAsync = promisify(execFile);

export const WHISPER_PROMPT =
  'Indian English work meeting. Amounts use lakh and crore, for example 2 lakh rupees, 45 lakh, 1.5 crore, 40,000 rupees a month. Names like Priya, Rahul, Meera, Anil.';

export interface Segment {
  start: number; // seconds from the start of the recording
  end: number;
  text: string;
}

export interface Transcript {
  segments: Segment[];
  text: string;
  language: string | null;
  durationSeconds: number | null;
}

interface WhisperResponse {
  text: string;
  language?: string;
  duration?: number;
  segments?: { start: number; end: number; text: string; no_speech_prob?: number; avg_logprob?: number }[];
}

async function transcribeFile(filePath: string, mimeType: string): Promise<WhisperResponse> {
  const blob = await fs.openAsBlob(filePath, { type: mimeType });
  const fileName = path.basename(filePath);
  return (await groqPost('/audio/transcriptions', () => {
    const form = new FormData();
    form.append('file', blob, fileName);
    form.append('model', config.whisperModel);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    form.append('temperature', '0');
    if (config.whisperLanguage) form.append('language', config.whisperLanguage);
    // Vocabulary hint: Indian English meetings use lakh/crore; without this
    // Whisper tends to write "2 lakh" as "Rs.2,000".
    form.append('prompt', WHISPER_PROMPT);
    return { body: form, json: false };
  })) as WhisperResponse;
}

function toSegments(response: WhisperResponse, offsetSeconds: number): Segment[] {
  return (response.segments ?? [])
    .filter((s) => s.text.trim())
    // Whisper "hallucinates" text over silence; drop segments it is confident are silent.
    .filter((s) => !((s.no_speech_prob ?? 0) > 0.8 && (s.avg_logprob ?? 0) < -1))
    .map((s) => ({ start: s.start + offsetSeconds, end: s.end + offsetSeconds, text: s.text.trim() }));
}

/**
 * Splits a recording into mono 16 kHz Opus chunks of WHISPER_CHUNK_SECONDS
 * (Whisper resamples to 16 kHz mono anyway, so nothing is lost) and returns
 * each chunk with its start offset.
 */
async function splitIntoChunks(filePath: string): Promise<{ file: string; start: number }[]> {
  if (!ffmpegPath) throw new Error('ffmpeg-static binary not found; reinstall server dependencies.');
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tatva-chunks-'));
  const listFile = path.join(dir, 'list.csv');
  await execFileAsync(ffmpegPath as unknown as string, [
    '-hide_banner', '-loglevel', 'error',
    '-i', filePath,
    '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '32k',
    '-f', 'segment', '-segment_time', String(config.whisperChunkSeconds), '-reset_timestamps', '1',
    '-segment_list', listFile, '-segment_list_type', 'csv',
    path.join(dir, 'chunk_%03d.ogg'),
  ]);
  // CSV rows: <file>,<start seconds>,<end seconds>
  const rows = (await fs.promises.readFile(listFile, 'utf8')).trim().split(/\r?\n/).filter(Boolean);
  return rows.map((row) => {
    const [file, start] = row.split(',');
    return { file: path.join(dir, file), start: Number(start) };
  });
}

export type SttProvider = 'finch' | 'groq-whisper';

export interface TranscribeResult extends Transcript {
  provider: SttProvider;
  /** Why Finch was skipped or failed, when Whisper did the work. */
  fallbackReason: string | null;
  keywords: number;
}

/**
 * Scribe: Murf Finch (finch_indic_1.0) with keyword boosting, falling back to
 * Groq Whisper on any Finch error. Same Transcript shape either way.
 */
export async function transcribe(filePath: string, mimeType: string): Promise<TranscribeResult> {
  let fallbackReason: string | null = null;
  let keywords: string[] = [];
  if (config.sttProvider === 'finch' && config.murfApiKey) {
    keywords = await loadKeywords().catch(() => []);
    try {
      const t = await transcribeWithFinch(filePath, keywords);
      if (t.segments.length) return { ...t, provider: 'finch', fallbackReason: null, keywords: keywords.length };
      fallbackReason = 'Finch returned no speech';
    } catch (err) {
      fallbackReason = err instanceof Error ? err.message : String(err);
    }
    console.warn(`${tag('scribe')} Finch failed (${fallbackReason}), falling back to Groq Whisper`);
  } else {
    fallbackReason = config.sttProvider === 'groq' ? 'STT_PROVIDER=groq' : 'MURF_API_KEY not set';
  }
  const t = await transcribeWhisper(filePath, mimeType);
  return { ...t, provider: 'groq-whisper', fallbackReason, keywords: 0 };
}

/** Groq Whisper with the lakh/crore vocabulary prompt (chunks recordings over the upload limit). */
export async function transcribeWhisper(filePath: string, mimeType: string): Promise<Transcript> {
  const size = (await fs.promises.stat(filePath)).size;

  if (size <= config.whisperMaxBytes) {
    const response = await transcribeFile(filePath, mimeType);
    const segments = toSegments(response, 0);
    return {
      segments,
      text: segments.map((s) => s.text).join(' '),
      language: response.language ?? null,
      durationSeconds: response.duration ?? null,
    };
  }

  console.log(`[Scribe] ${(size / 1024 / 1024).toFixed(1)} MB is over the limit, chunking`);
  const chunks = await splitIntoChunks(filePath);
  const segments: Segment[] = [];
  let language: string | null = null;
  let durationSeconds = 0;
  try {
    for (const [i, chunk] of chunks.entries()) {
      console.log(`[Scribe] chunk ${i + 1}/${chunks.length} (starts at ${chunk.start.toFixed(0)}s)`);
      const response = await transcribeFile(chunk.file, 'audio/ogg');
      segments.push(...toSegments(response, chunk.start));
      language ??= response.language ?? null;
      durationSeconds = chunk.start + (response.duration ?? 0);
    }
  } finally {
    await fs.promises.rm(path.dirname(chunks[0]?.file ?? ''), { recursive: true, force: true }).catch(() => {});
  }
  return { segments, text: segments.map((s) => s.text).join(' '), language, durationSeconds };
}

export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

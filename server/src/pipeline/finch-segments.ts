// Finch word timestamps -> the transcript segments the pipeline already uses
// (pure, unit-tested). Same shape as Whisper's: { start, end, text } in seconds.
//
// Finch's `text` is formatted (punctuation, casing, "quarter's") but its
// `words` are raw lowercase tokens ("quarter", "s"). Segments use the formatted
// text, with each token's time taken from the raw word at the same position in
// the letters-and-digits stream, so they read well and keep accurate timestamps.
import type { Segment } from './transcribe.js';

/** File transcription words: type "word" or "spacing"; start/end in seconds. */
export interface FinchWord {
  text: string;
  start: number;
  end: number;
  type?: string;
}

interface Token {
  text: string;
  start: number;
  end: number;
}

const MAX_SEGMENT_SECONDS = 20;
const PAUSE_SECONDS = 1.2;
const SENTENCE_END = /[.?!।]["')\]]?$/;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Gives every formatted token the time of the raw word at the same character position. */
function alignTokens(text: string, words: FinchWord[]): Token[] {
  const raw = words.filter((w) => w.type !== 'spacing' && norm(w.text ?? ''));
  const parts = text.split(/\s+/).filter(Boolean);
  if (!raw.length) return [];
  if (!parts.length) return raw.map((w) => ({ text: w.text.trim(), start: w.start, end: w.end }));
  const offsets: number[] = [];
  let rawTotal = 0;
  for (const w of raw) {
    offsets.push(rawTotal);
    rawTotal += norm(w.text).length;
  }
  const fmtTotal = parts.reduce((n, p) => n + norm(p).length, 0) || 1;
  const scale = rawTotal / fmtTotal; // ~1; absorbs small spelling differences ("Pria" vs "Priya")
  const wordAt = (pos: number) => {
    let lo = 0;
    let hi = raw.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offsets[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return raw[lo];
  };
  const tokens: Token[] = [];
  let pos = 0;
  for (const p of parts) {
    const len = norm(p).length;
    if (!len) {
      // Pure punctuation ("-"): attach to the previous token.
      if (tokens.length) tokens[tokens.length - 1].text += ` ${p}`;
      continue;
    }
    const first = wordAt(Math.floor(pos * scale));
    const last = wordAt(Math.max(0, Math.floor((pos + len) * scale) - 1));
    tokens.push({ text: p, start: first.start, end: Math.max(first.start, last.end) });
    pos += len;
  }
  return tokens;
}

/**
 * A new segment starts after a sentence ends, after a pause, or when the
 * current one passes ~20 s, so segments read like Whisper's (a sentence or two).
 */
export function wordsToSegments(words: FinchWord[], text = ''): Segment[] {
  const tokens = alignTokens(text, words);
  if (!tokens.length) return text.trim() ? [{ start: 0, end: 0, text: text.trim() }] : [];
  const segments: Segment[] = [];
  let current: Token[] = [];
  const flush = () => {
    if (current.length) segments.push({ start: current[0].start, end: current[current.length - 1].end, text: current.map((t) => t.text).join(' ') });
    current = [];
  };
  for (const t of tokens) {
    const prev = current[current.length - 1];
    if (prev && (t.start - prev.end > PAUSE_SECONDS || t.end - current[0].start > MAX_SEGMENT_SECONDS)) flush();
    current.push(t);
    if (SENTENCE_END.test(t.text) && current.length >= 3) flush();
  }
  flush();
  return segments;
}

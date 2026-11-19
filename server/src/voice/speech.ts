// Pure text helpers for the voice turn (no config, so unit tests need no secrets).

const clean = (text: string) => text.toLowerCase().replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim();

const YES =
  /^(yes|yeah|yea|yep|yup|ya|haan|han|ji|sure|ok|okay|alright|all right|confirm|confirmed|correct|right|exactly|absolutely|definitely|of course|go ahead|go for it|do it|please do|send it|post it|book it|schedule it|add it|create it|sounds good|that's right|that's correct|perfect|proceed|try again|retry|please go ahead|please send)\b/;
const NO = /^(no|nope|nah|na|cancel|stop|don't|do not|never mind|nevermind|forget it|scratch that|not now|leave it)\b/;
const HEDGE = /\b(but|change|instead|wait|actually|edit|also add|not to|rather|hold on|different)\b/;

/** "yes" / "no" / null (anything else, or a yes with changes). */
export function confirmationIntent(text: string): 'yes' | 'no' | null {
  const t = clean(text);
  if (!t || t.split(' ').length > 10) return null;
  if (NO.test(t)) return 'no';
  if (YES.test(t) && !HEDGE.test(t)) return 'yes';
  return null;
}

/**
 * gpt-oss occasionally writes its answer twice in one message; keep the first
 * copy (detected by the opening sentence reappearing later).
 */
export function dropRepeat(text: string): string {
  const first = text.match(/^.{20,}?[.!?](\s|$)/s)?.[0]?.trim();
  if (!first) return text;
  const again = text.indexOf(first.slice(0, 40), first.length);
  return again > 0 ? text.slice(0, again).trim() : text;
}

/** Strips anything TTS shouldn't read: markdown symbols, URLs, list markers. */
export function speakable(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#>|]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '');
}

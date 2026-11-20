// Sanity check on an extraction (pure, unit-tested). A smaller model sometimes
// gives up and answers "The meeting transcript is empty" for a real transcript;
// that answer is retried on the next model instead of being saved.

export interface ExtractionShape {
  summary: string;
  decisions: unknown[];
  action_items: unknown[];
  stats_mentioned: unknown[];
  discuss_later: unknown[];
}

const GAVE_UP = /\b(transcript|meeting|recording)\b[^.]{0,30}\b(is|was|appears|seems)\b[^.]{0,15}\b(empty|blank|missing|not provided|unavailable)\b|\bno (meeting )?(content|transcript|discussion)\b|\bnothing (was )?(discussed|said)\b/i;

/** True when the model clearly didn't read a transcript that has real content. */
export function extractionLooksEmpty(k: ExtractionShape, transcriptChars: number): boolean {
  if (transcriptChars < 600) return false; // a very short recording can be genuinely empty
  if (GAVE_UP.test(k.summary)) return true;
  const items = k.decisions.length + k.action_items.length + k.stats_mentioned.length + k.discuss_later.length;
  return items === 0 && k.summary.trim().length < 120;
}
